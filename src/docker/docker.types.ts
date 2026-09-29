/**
 * Minimal local interface for the slice of the `dockerode` API this project
 * uses. Keeping this local (instead of depending on dockerode's own types)
 * lets tests build lightweight `jest.fn()` mocks that satisfy the interface
 * without needing a real `Dockerode` instance or Docker daemon.
 */

export interface DockerodeContainerInspectInfo {
  State: {
    Running: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DockerodeContainer {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  remove(options?: { force?: boolean }): Promise<void>;
  logs(options: {
    stdout: boolean;
    stderr: boolean;
    tail: number;
    follow: false;
  }): Promise<Buffer>;
  inspect(): Promise<DockerodeContainerInspectInfo>;
}

export interface DockerodeModem {
  followProgress(
    stream: unknown,
    onFinished: (err: Error | null, output: unknown[]) => void,
  ): void;
}

export interface CreateContainerOptions {
  name: string;
  Image: string;
  Env?: string[];
  ExposedPorts?: Record<string, unknown>;
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostPort: string }>>;
  };
}

export interface DockerodeClient {
  modem: DockerodeModem;
  pull(image: string, callback: (err: Error | null, stream?: unknown) => void): void;
  createContainer(options: CreateContainerOptions): Promise<DockerodeContainer>;
  getContainer(id: string): DockerodeContainer;
  ping(): Promise<unknown>;
}

export interface DaemonError extends Error {
  code?: string;
  statusCode?: number;
}
