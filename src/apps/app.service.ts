import { Prisma, PrismaClient, App } from '@prisma/client';
import {
  AppError,
  ConflictError,
  ContainerMissingError,
  DockerUnavailableError,
  NotFoundError,
  NotInstalledError,
  PortInUseError,
} from '../errors';
import type { IDockerService } from '../docker/docker.service';
import type { AppDataStore } from './app-data';
import type { AppStatus, CreateAppInput, LogsInput } from './app.types';

/** The only texts ever stored in `lastError`: raw Docker/Prisma text never reaches the UI. */
export const INSTALL_MESSAGES = {
  dockerDown: "Docker isn't running on the server, so the app couldn't be installed.",
  download: "Couldn't download the app. Check that the server is connected to the internet.",
  start: 'The app was downloaded but could not start.',
  interrupted: 'Installation was interrupted.',
  portInUse: (port: number) => `Port ${port} is already used by another program on the server.`,
};

function installMessage(err: unknown, stage: 'pull' | 'start'): string {
  if (err instanceof DockerUnavailableError) return INSTALL_MESSAGES.dockerDown;
  if (err instanceof PortInUseError) return INSTALL_MESSAGES.portInUse(Number(err.details?.port));
  return stage === 'pull' ? INSTALL_MESSAGES.download : INSTALL_MESSAGES.start;
}

const RECONCILABLE_STATUSES = new Set<AppStatus>(['RUNNING', 'STOPPED']);

function isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function isRecordNotFoundError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
  );
}

function conflictFromUniqueConstraintError(
  err: Prisma.PrismaClientKnownRequestError,
  input: CreateAppInput,
): ConflictError {
  const target = err.meta?.target;
  const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');

  if (targetStr.includes('hostPort')) {
    return new ConflictError(`Host port ${input.hostPort} is already taken`, 'PORT_TAKEN');
  }
  return new ConflictError(`App name "${input.name}" is already taken`, 'NAME_TAKEN');
}

export interface RemoveResult {
  dataPath: string;
  dataDeleted: boolean;
}

/**
 * The subset of `AppService` that the HTTP layer depends on. Extracted as an
 * interface so route tests can hand-roll a mock without a real database.
 */
export interface IAppService {
  create(input: CreateAppInput): Promise<App>;
  start(id: string): Promise<App>;
  stop(id: string): Promise<App>;
  remove(id: string, options?: { deleteData?: boolean }): Promise<RemoveResult>;
  logs(id: string, options: LogsInput): Promise<string>;
  list(): Promise<App[]>;
  get(id: string): Promise<App>;
}

export class AppService implements IAppService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly docker: IDockerService,
    private readonly dataStore: AppDataStore,
  ) {}

  private readonly inflight = new Set<Promise<void>>();
  private readonly installing = new Set<string>();
  /** Apps removed with their data while still installing: the install may recreate the folder. */
  private readonly removedWithData = new Set<string>();

  /** Resolves with the PENDING row at once; the install continues in the background. */
  async create(input: CreateAppInput): Promise<App> {
    await this.checkConflict(input.name, input.hostPort);

    let app: App;
    try {
      app = await this.prisma.app.create({
        data: {
          name: input.name,
          image: input.image,
          hostPort: input.hostPort,
          containerPort: input.containerPort,
          status: 'PENDING',
          catalogId: input.catalogId ?? null,
          volumes: JSON.stringify(input.volumes ?? []),
          fixedPorts: JSON.stringify(input.fixedPorts ?? []),
          secrets: JSON.stringify(input.secrets ?? {}),
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflictFromUniqueConstraintError(err, input);
      }
      throw err;
    }

    this.installing.add(app.id);
    const job = this.install(app.id, input)
      .then(() => {
        this.installing.delete(app.id);
        return this.dropDataOfRemovedApp(app.id);
      })
      .finally(() => this.inflight.delete(job));
    this.inflight.add(job);
    return app;
  }

  /** Resolves when every background install has finished (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  /** Installs cut short by a restart are left PENDING forever otherwise. Call once at startup. */
  async recoverInterruptedInstalls(): Promise<number> {
    const { count } = await this.prisma.app.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'ERROR', lastError: INSTALL_MESSAGES.interrupted },
    });
    return count;
  }

  private async dropDataOfRemovedApp(id: string): Promise<void> {
    if (this.removedWithData.delete(id)) {
      await this.dataStore.remove(id);
    }
  }

  /** Never throws: every outcome is written to the row. */
  private async install(id: string, input: CreateAppInput): Promise<void> {
    let stage: 'pull' | 'start' = 'pull';
    let containerId: string | undefined;
    try {
      await this.docker.pullImage(input.image);
      stage = 'start';
      containerId = await this.docker.createAndStart({
        name: input.name,
        image: input.image,
        hostPort: input.hostPort,
        containerPort: input.containerPort,
        env: input.env,
        fixedPorts: input.fixedPorts,
        mounts: await this.mountsFor(id, input),
      });
      await this.prisma.app.update({ where: { id }, data: { containerId, status: 'RUNNING', lastError: null } });
    } catch (err) {
      if (isRecordNotFoundError(err) && containerId) {
        // The app was removed while installing: do not leave its container behind.
        await this.docker.remove(containerId, { force: true }).catch((e) => console.error(e));
        return;
      }
      console.error(err);
      // If the container was created but start and the best-effort cleanup
      // both failed, DockerService carries the orphaned container's id on
      // the error so the row (and the container) can still be recovered.
      const idFromError = err instanceof AppError ? err.containerId : undefined;
      await this.prisma.app
        .update({
          where: { id },
          data: { status: 'ERROR', containerId: containerId ?? idFromError ?? null, lastError: installMessage(err, stage) },
        })
        .catch((e) => console.error(e));
    }
  }

  private mountsFor(id: string, input: CreateAppInput): Promise<Array<{ hostPath: string; containerPath: string }>> {
    return this.dataStore.ensure(id, input.volumes ?? [], input.dataOwner);
  }

  async start(id: string): Promise<App> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotInstalledError();
    }
    try {
      await this.docker.start(app.containerId);
    } catch (err) {
      await this.markErrorOnContainerMissing(id, err);
      throw err;
    }
    return this.prisma.app.update({ where: { id }, data: { status: 'RUNNING', lastError: null } });
  }

  async stop(id: string): Promise<App> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotInstalledError();
    }
    try {
      await this.docker.stop(app.containerId);
    } catch (err) {
      await this.markErrorOnContainerMissing(id, err);
      throw err;
    }
    return this.prisma.app.update({ where: { id }, data: { status: 'STOPPED', lastError: null } });
  }

  /** Data is kept unless `deleteData` is set; a failed deletion still removes the app. */
  async remove(id: string, { deleteData = false }: { deleteData?: boolean } = {}): Promise<RemoveResult> {
    const app = await this.getOrThrow(id);
    if (app.containerId) {
      await this.docker.remove(app.containerId, { force: true });
    }
    const deleted = await this.prisma.app.delete({ where: { id } });
    // An install may have saved its container between the read and the delete.
    if (deleted.containerId && deleted.containerId !== app.containerId) {
      await this.docker.remove(deleted.containerId, { force: true }).catch((err) => {
        // The app is gone already; leave a trace so the container can be removed by hand.
        console.error(`Could not remove container ${deleted.containerId} of removed app ${id}`, err);
      });
    }
    const dataPath = this.dataStore.appDir(id);
    if (!deleteData) {
      return { dataPath, dataDeleted: false };
    }
    // Still installing: the install may recreate the folder, so it drops it again when done.
    if (this.installing.has(id)) {
      this.removedWithData.add(id);
    }
    const { deleted: dataDeleted } = await this.dataStore.remove(id);
    return { dataPath, dataDeleted };
  }

  async logs(id: string, options: LogsInput): Promise<string> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotInstalledError();
    }
    try {
      return await this.docker.logs(app.containerId, options);
    } catch (err) {
      await this.markErrorOnContainerMissing(id, err);
      throw err;
    }
  }

  async list(): Promise<App[]> {
    const apps = await this.prisma.app.findMany();
    const reconciled = await Promise.all(apps.map((app) => this.reconcile(app)));
    return reconciled.filter((app): app is App => app !== null);
  }

  async get(id: string): Promise<App> {
    const app = await this.getOrThrow(id);
    const reconciled = await this.reconcile(app);
    if (!reconciled) {
      throw new NotFoundError(`App ${id} not found`);
    }
    return reconciled;
  }

  private async getOrThrow(id: string): Promise<App> {
    const app = await this.prisma.app.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundError(`App ${id} not found`);
    }
    return app;
  }

  private async checkConflict(name: string, hostPort: number): Promise<void> {
    const [byName, byPort] = await Promise.all([
      this.prisma.app.findUnique({ where: { name } }),
      this.prisma.app.findUnique({ where: { hostPort } }),
    ]);
    if (byName) {
      throw new ConflictError(`App name "${name}" is already taken`, 'NAME_TAKEN');
    }
    if (byPort) {
      throw new ConflictError(`Host port ${hostPort} is already taken`, 'PORT_TAKEN');
    }
  }

  /**
   * Reconciles the stored status against the live daemon state. If the row
   * was deleted concurrently (e.g. by a parallel `remove()`), the update
   * throws Prisma's `P2025` ("record not found"); that is not an error here,
   * it just means there is nothing left to reconcile, so `null` is returned
   * and callers treat the app as gone. Any other error still propagates.
   */
  private async reconcile(app: App): Promise<App | null> {
    if (!app.containerId || !RECONCILABLE_STATUSES.has(app.status as AppStatus)) {
      return app;
    }
    const state = await this.docker.inspectState(app.containerId);
    try {
      if (!state.exists) {
        return await this.prisma.app.update({ where: { id: app.id }, data: { status: 'ERROR' } });
      }
      const expectedStatus: AppStatus = state.running ? 'RUNNING' : 'STOPPED';
      if (app.status === expectedStatus) {
        return app;
      }
      return await this.prisma.app.update({ where: { id: app.id }, data: { status: expectedStatus } });
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * If the container was deleted outside EasyHost, `docker.start/stop/logs`
   * throw `ContainerMissingError`. The app can no longer be reconciled, so it
   * is marked `ERROR` here; the caller is expected to rethrow the error.
   * Persisting the status is best-effort: if it fails (e.g. the row was
   * deleted concurrently), the failure is logged and swallowed so the
   * original `ContainerMissingError` is always rethrown by the caller.
   */
  private async markErrorOnContainerMissing(id: string, err: unknown): Promise<void> {
    if (err instanceof ContainerMissingError) {
      try {
        await this.prisma.app.update({ where: { id }, data: { status: 'ERROR' } });
      } catch (updateErr) {
        console.error(updateErr);
      }
    }
  }
}
