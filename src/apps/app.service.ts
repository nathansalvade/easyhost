import { Prisma, PrismaClient, App } from '@prisma/client';
import { AppError, ConflictError, ContainerMissingError, NotFoundError } from '../errors';
import type { IDockerService } from '../docker/docker.service';
import type { AppStatus, CreateAppInput, LogsInput } from './app.types';

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

/**
 * The subset of `AppService` that the HTTP layer depends on. Extracted as an
 * interface so route tests can hand-roll a mock without a real database.
 */
export interface IAppService {
  create(input: CreateAppInput): Promise<App>;
  start(id: string): Promise<App>;
  stop(id: string): Promise<App>;
  remove(id: string): Promise<void>;
  logs(id: string, options: LogsInput): Promise<string>;
  list(): Promise<App[]>;
  get(id: string): Promise<App>;
}

export class AppService implements IAppService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly docker: IDockerService,
  ) {}

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
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflictFromUniqueConstraintError(err, input);
      }
      throw err;
    }

    let containerId: string | undefined;
    try {
      await this.docker.pullImage(input.image);
      containerId = await this.docker.createAndStart({
        name: input.name,
        image: input.image,
        hostPort: input.hostPort,
        containerPort: input.containerPort,
        env: input.env,
      });
      return await this.prisma.app.update({
        where: { id: app.id },
        data: { containerId, status: 'RUNNING' },
      });
    } catch (err) {
      // If the container was created but start and the best-effort cleanup
      // both failed, DockerService carries the orphaned container's id on
      // the error so the row (and the container) can still be recovered.
      const idFromError = err instanceof AppError ? err.containerId : undefined;
      await this.prisma.app.update({
        where: { id: app.id },
        data: { containerId: containerId ?? idFromError ?? null, status: 'ERROR' },
      });
      throw err;
    }
  }

  async start(id: string): Promise<App> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotFoundError(`App ${id} has no associated container`);
    }
    try {
      await this.docker.start(app.containerId);
    } catch (err) {
      await this.markErrorOnContainerMissing(id, err);
      throw err;
    }
    return this.prisma.app.update({ where: { id }, data: { status: 'RUNNING' } });
  }

  async stop(id: string): Promise<App> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotFoundError(`App ${id} has no associated container`);
    }
    try {
      await this.docker.stop(app.containerId);
    } catch (err) {
      await this.markErrorOnContainerMissing(id, err);
      throw err;
    }
    return this.prisma.app.update({ where: { id }, data: { status: 'STOPPED' } });
  }

  async remove(id: string): Promise<void> {
    const app = await this.getOrThrow(id);
    if (app.containerId) {
      await this.docker.remove(app.containerId, { force: true });
    }
    await this.prisma.app.delete({ where: { id } });
  }

  async logs(id: string, options: LogsInput): Promise<string> {
    const app = await this.getOrThrow(id);
    if (!app.containerId) {
      throw new NotFoundError(`App ${id} has no associated container`);
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
