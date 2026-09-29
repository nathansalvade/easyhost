import { ContainerMissingError, DockerOperationError, DockerUnavailableError } from '../errors';
import type { DaemonError, DockerodeClient } from './docker.types';

const CONNECTION_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'ECONNREFUSED']);

export interface CreateAndStartOptions {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
}

export interface LogsOptions {
  tail: number;
}

export interface ContainerState {
  exists: boolean;
  running: boolean;
}

function isDaemonError(err: unknown): err is DaemonError {
  return err instanceof Error;
}

function toEnvArray(env: Record<string, string> | undefined): string[] {
  if (!env) {
    return [];
  }
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

/** Demultiplexes Docker's stdout/stderr stream framing (8-byte frame headers). */
function demuxLogs(buffer: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const streamType = buffer.readUInt8(offset);
    const reserved1 = buffer.readUInt8(offset + 1);
    const reserved2 = buffer.readUInt8(offset + 2);
    const reserved3 = buffer.readUInt8(offset + 3);
    const length = buffer.readUInt32BE(offset + 4);

    const isValidHeader =
      streamType <= 2 &&
      reserved1 === 0 &&
      reserved2 === 0 &&
      reserved3 === 0 &&
      offset + 8 + length <= buffer.length;

    if (!isValidHeader) {
      return buffer.toString('utf8');
    }

    chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }

  if (offset !== buffer.length) {
    return buffer.toString('utf8');
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The subset of `DockerService` that `AppService` depends on. Extracted as
 * an interface so tests can hand-roll a mock without a real `Dockerode`.
 */
export interface IDockerService {
  pullImage(image: string): Promise<void>;
  createAndStart(options: CreateAndStartOptions): Promise<string>;
  start(containerId: string): Promise<void>;
  stop(containerId: string): Promise<void>;
  remove(containerId: string, options?: { force?: boolean }): Promise<void>;
  logs(containerId: string, options: LogsOptions): Promise<string>;
  inspectState(containerId: string): Promise<ContainerState>;
  ping(): Promise<boolean>;
}

export interface DockerServiceOptions {
  maxTail?: number;
  /**
   * Host address that published container ports are bound to. Defaults to
   * all interfaces so apps open from other home devices at server-IP:port
   * (see `CONTAINER_BIND_ADDRESS` in config.ts).
   */
  bindAddress?: string;
}

export class DockerService implements IDockerService {
  private readonly maxTail: number;
  private readonly bindAddress: string;

  constructor(
    private readonly docker: DockerodeClient,
    { maxTail = 1000, bindAddress = '0.0.0.0' }: DockerServiceOptions = {},
  ) {
    this.maxTail = maxTail;
    this.bindAddress = bindAddress;
  }

  private translateError(err: unknown): DockerUnavailableError | DockerOperationError {
    if (isDaemonError(err)) {
      if (err.code && CONNECTION_ERROR_CODES.has(err.code)) {
        return new DockerUnavailableError(err.message);
      }
      return new DockerOperationError(err.message);
    }
    return new DockerOperationError('Unknown docker error');
  }

  async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err, stream) => {
        if (err) {
          reject(this.translateError(err));
          return;
        }
        this.docker.modem.followProgress(stream, (progressErr) => {
          if (progressErr) {
            reject(this.translateError(progressErr));
            return;
          }
          resolve();
        });
      });
    });
  }

  async createAndStart(options: CreateAndStartOptions): Promise<string> {
    const { name, image, hostPort, containerPort, env } = options;
    const portKey = `${containerPort}/tcp`;

    const container = await this.docker.createContainer({
      name,
      Image: image,
      Env: toEnvArray(env),
      ExposedPorts: { [portKey]: {} },
      HostConfig: {
        PortBindings: { [portKey]: [{ HostPort: String(hostPort), HostIp: this.bindAddress }] },
      },
    });

    try {
      await container.start();
    } catch (err) {
      const translated = this.translateError(err);
      try {
        await container.remove({ force: true });
      } catch {
        // Best-effort cleanup failed too: the container still exists but its
        // id would otherwise be lost. Carry it on the error (never in the
        // message) so callers can persist it and remove it later.
        translated.containerId = container.id;
      }
      throw translated;
    }

    return container.id;
  }

  async start(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).start();
    } catch (err) {
      if (isDaemonError(err) && err.statusCode === 304) {
        return;
      }
      if (isDaemonError(err) && err.statusCode === 404) {
        throw new ContainerMissingError();
      }
      throw this.translateError(err);
    }
  }

  async stop(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop();
    } catch (err) {
      if (isDaemonError(err) && err.statusCode === 304) {
        return;
      }
      if (isDaemonError(err) && err.statusCode === 404) {
        throw new ContainerMissingError();
      }
      throw this.translateError(err);
    }
  }

  async remove(containerId: string, options: { force?: boolean } = {}): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove(options);
    } catch (err) {
      if (isDaemonError(err) && err.statusCode === 404) {
        return;
      }
      throw this.translateError(err);
    }
  }

  async logs(containerId: string, options: LogsOptions): Promise<string> {
    const tail = Math.min(options.tail, this.maxTail);

    try {
      const buffer = await this.docker.getContainer(containerId).logs({
        stdout: true,
        stderr: true,
        tail,
        follow: false,
      });
      return demuxLogs(buffer);
    } catch (err) {
      if (isDaemonError(err) && err.statusCode === 404) {
        throw new ContainerMissingError();
      }
      throw this.translateError(err);
    }
  }

  async inspectState(containerId: string): Promise<ContainerState> {
    try {
      const info = await this.docker.getContainer(containerId).inspect();
      return { exists: true, running: info.State.Running };
    } catch (err) {
      if (isDaemonError(err) && err.statusCode === 404) {
        return { exists: false, running: false };
      }
      throw this.translateError(err);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }
}
