import { Prisma, PrismaClient } from '@prisma/client';
import { AppService, INSTALL_MESSAGES } from './app.service';
import {
  ContainerMissingError,
  DockerOperationError,
  DockerUnavailableError,
  NotFoundError,
  PortInUseError,
} from '../errors';
import { createTempDb } from '../../test/helpers/temp-db';
import type { IDockerService } from '../docker/docker.service';
import type { CreateAppInput } from './app.types';

function makeDockerMock(): jest.Mocked<IDockerService> {
  return {
    pullImage: jest.fn().mockResolvedValue(undefined),
    createAndStart: jest.fn().mockResolvedValue('container-1'),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    logs: jest.fn().mockResolvedValue('log output'),
    inspectState: jest.fn().mockResolvedValue({ exists: true, running: true }),
    ping: jest.fn().mockResolvedValue(true),
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AppService', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });

  afterAll(async () => {
    await cleanup();
  });

  /** Creates an app and waits for its background install, returning the settled row. */
  async function createInstalled(service: AppService, input: CreateAppInput) {
    const app = await service.create(input);
    await service.settled();
    return prisma.app.findUniqueOrThrow({ where: { id: app.id } });
  }

  afterEach(async () => {
    await prisma.app.deleteMany();
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('deploys the app in the background: pulls, creates+starts, and persists RUNNING with the containerId', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);

      const app = await service.create({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 80,
        env: { FOO: 'bar' },
      });
      await service.settled();

      expect(docker.pullImage).toHaveBeenCalledWith('nginx:latest');
      expect(docker.createAndStart).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-app',
          image: 'nginx:latest',
          hostPort: 8080,
          containerPort: 80,
          env: { FOO: 'bar' },
        }),
      );
      expect(app.status).toBe('PENDING');

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('RUNNING');
      expect(persisted.containerId).toBe('container-1');
      expect(persisted.lastError).toBeNull();
    });

    it('stores catalog id, volumes, fixed ports and secrets on the row and passes fixed ports to Docker', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const fixedPorts = [{ containerPort: 53, hostPort: 53, protocol: 'udp' as const }];
      const app = await service.create({
        name: 'with-meta',
        image: 'pihole/pihole:2026.09.0',
        hostPort: 8082,
        containerPort: 80,
        catalogId: 'pihole',
        volumes: [{ name: 'config', containerPath: '/etc/pihole' }],
        fixedPorts,
        secrets: { adminPassword: 's3cret' },
      });
      await service.settled();
      expect(app).toMatchObject({
        catalogId: 'pihole',
        volumes: JSON.stringify([{ name: 'config', containerPath: '/etc/pihole' }]),
        fixedPorts: JSON.stringify(fixedPorts),
        secrets: JSON.stringify({ adminPassword: 's3cret' }),
      });
      expect(docker.createAndStart).toHaveBeenCalledWith(expect.objectContaining({ fixedPorts }));
    });

    it('rejects with ConflictError NAME_TAKEN before any daemon call when the name is already used', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'dup', image: 'nginx', hostPort: 1000, containerPort: 1000 });
      docker.pullImage.mockClear();
      docker.createAndStart.mockClear();

      await expect(
        service.create({ name: 'dup', image: 'nginx', hostPort: 2000, containerPort: 2000 }),
      ).rejects.toMatchObject({ code: 'NAME_TAKEN' });

      expect(docker.pullImage).not.toHaveBeenCalled();
      expect(docker.createAndStart).not.toHaveBeenCalled();
    });

    it('rejects with ConflictError PORT_TAKEN before any daemon call when the hostPort is already used', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'a', image: 'nginx', hostPort: 3000, containerPort: 3000 });
      docker.pullImage.mockClear();
      docker.createAndStart.mockClear();

      await expect(
        service.create({ name: 'b', image: 'nginx', hostPort: 3000, containerPort: 3000 }),
      ).rejects.toMatchObject({ code: 'PORT_TAKEN' });

      expect(docker.pullImage).not.toHaveBeenCalled();
      expect(docker.createAndStart).not.toHaveBeenCalled();
    });

    it('keeps the containerId on the ERROR row when the container was created but finalizing the row failed', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockResolvedValue('container-known');
      const service = new AppService(prisma, docker);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const app = await service.create({ name: 'fails3', image: 'nginx', hostPort: 4002, containerPort: 4002 });
      jest.spyOn(prisma.app, 'update').mockRejectedValueOnce(new Error('db hiccup'));
      await service.settled();

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
      expect(persisted.containerId).toBe('container-known');
      expect(persisted.lastError).toBe(INSTALL_MESSAGES.start);
    });

    it('persists the orphaned container id when start and cleanup both failed, so remove() can still clean it up', async () => {
      const docker = makeDockerMock();
      const orphanError = new DockerOperationError('docker operation failed');
      orphanError.containerId = 'orphan-container';
      docker.createAndStart.mockRejectedValue(orphanError);
      const service = new AppService(prisma, docker);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const app = await service.create({ name: 'orphan', image: 'nginx', hostPort: 4003, containerPort: 4003 });
      await service.settled();

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
      expect(persisted.containerId).toBe('orphan-container');

      await service.remove(persisted.id);
      expect(docker.remove).toHaveBeenCalledWith('orphan-container', { force: true });
      await expect(prisma.app.findUnique({ where: { id: persisted.id } })).resolves.toBeNull();
    });

    it('translates a race-condition unique constraint violation on name into ConflictError NAME_TAKEN', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);

      jest.spyOn(prisma.app, 'create').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['name'] },
        }),
      );

      await expect(
        service.create({ name: 'race-name', image: 'nginx', hostPort: 5000, containerPort: 5000 }),
      ).rejects.toMatchObject({ code: 'NAME_TAKEN' });

      expect(docker.pullImage).not.toHaveBeenCalled();
    });

    it('translates a race-condition unique constraint violation on hostPort into ConflictError PORT_TAKEN', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);

      jest.spyOn(prisma.app, 'create').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`hostPort`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['hostPort'] },
        }),
      );

      await expect(
        service.create({ name: 'race-port', image: 'nginx', hostPort: 5001, containerPort: 5001 }),
      ).rejects.toMatchObject({ code: 'PORT_TAKEN' });

      expect(docker.pullImage).not.toHaveBeenCalled();
    });
  });

  describe('background install', () => {
    let docker: jest.Mocked<IDockerService>;
    let service: AppService;
    const input = (overrides: { name: string; hostPort: number }) => ({
      image: 'nginx:1.27',
      containerPort: 80,
      ...overrides,
    });

    beforeEach(() => {
      docker = makeDockerMock();
      service = new AppService(prisma, docker);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('returns the PENDING row before the download finishes, then becomes RUNNING', async () => {
      const pull = deferred();
      docker.pullImage.mockReturnValue(pull.promise);

      const app = await service.create(input({ name: 'bg-ok', hostPort: 9101 }));
      expect(app.status).toBe('PENDING');
      expect(docker.createAndStart).not.toHaveBeenCalled();

      pull.resolve();
      await service.settled();
      const row = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(row).toMatchObject({ status: 'RUNNING', containerId: 'container-1', lastError: null });
    });

    it.each([
      ['a download failure', 'pull', new DockerOperationError('manifest unknown raw-docker-text'), INSTALL_MESSAGES.download],
      ['Docker being down', 'pull', new DockerUnavailableError('connect ENOENT raw-docker-text'), INSTALL_MESSAGES.dockerDown],
      ['a start failure', 'start', new DockerOperationError('OCI runtime raw-docker-text'), INSTALL_MESSAGES.start],
      ['a port conflict', 'start', new PortInUseError(8096, 'tcp'), INSTALL_MESSAGES.portInUse(8096)],
    ])('stores a readable lastError for %s and never the raw text', async (_label, stage, error, message) => {
      if (stage === 'pull') docker.pullImage.mockRejectedValue(error);
      else docker.createAndStart.mockRejectedValue(error);

      const app = await service.create(input({ name: 'bg-fail', hostPort: 9201 }));
      await service.settled();
      const row = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(row.status).toBe('ERROR');
      expect(row.containerId).toBeNull();
      expect(row.lastError).toBe(message);
      expect(row.lastError).not.toContain('raw-docker-text');
    });

    it('removes the new container if the app was deleted while installing', async () => {
      const pull = deferred();
      docker.pullImage.mockReturnValue(pull.promise);
      docker.createAndStart.mockResolvedValue('late-container');

      const app = await service.create(input({ name: 'bg-deleted', hostPort: 9702 }));
      await service.remove(app.id);
      pull.resolve();
      await service.settled();

      expect(docker.remove).toHaveBeenCalledWith('late-container', { force: true });
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('marks installs left PENDING by a restart as interrupted, leaving other apps alone', async () => {
      const stale = await prisma.app.create({
        data: { name: 'bg-stale', image: 'x:1', hostPort: 9703, containerPort: 80, status: 'PENDING' },
      });
      const running = await prisma.app.create({
        data: { name: 'bg-running', image: 'x:1', hostPort: 9705, containerPort: 80, status: 'RUNNING' },
      });

      await expect(service.recoverInterruptedInstalls()).resolves.toBe(1);
      await expect(prisma.app.findUniqueOrThrow({ where: { id: stale.id } })).resolves.toMatchObject({
        status: 'ERROR',
        lastError: INSTALL_MESSAGES.interrupted,
      });
      await expect(prisma.app.findUniqueOrThrow({ where: { id: running.id } })).resolves.toMatchObject({
        status: 'RUNNING',
        lastError: null,
      });
    });

    it.each([
      ['start', 'RUNNING'],
      ['stop', 'STOPPED'],
    ] as const)('clears lastError when %s succeeds', async (action, status) => {
      const row = await prisma.app.create({
        data: {
          name: 'bg-restart',
          image: 'x:1',
          hostPort: 9704,
          containerPort: 80,
          status: 'ERROR',
          containerId: 'c-restart',
          lastError: 'old',
        },
      });
      await expect(service[action](row.id)).resolves.toMatchObject({ status, lastError: null });
    });
  });

  describe('start', () => {
    it('starts the container and persists RUNNING', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 's1', image: 'nginx', hostPort: 6000, containerPort: 6000 });
      await service.stop(app.id);
      docker.start.mockClear();

      const updated = await service.start(app.id);

      expect(docker.start).toHaveBeenCalledWith('container-1');
      expect(updated.status).toBe('RUNNING');
    });

    it('throws NotFoundError and never calls docker when the app has no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);

      await createInstalled(service, { name: 'no-container', image: 'nginx', hostPort: 6001, containerPort: 6001 });
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'no-container' } });
      expect(app.containerId).toBeNull();
      docker.start.mockClear();

      await expect(service.start(app.id)).rejects.toBeInstanceOf(NotFoundError);

      expect(docker.start).not.toHaveBeenCalled();
      const unchanged = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(unchanged.status).toBe('ERROR');
    });

    it('throws NotFoundError when the app does not exist', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await expect(service.start('missing-id')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('stop', () => {
    it('stops the container and persists STOPPED', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 's2', image: 'nginx', hostPort: 6002, containerPort: 6002 });

      const updated = await service.stop(app.id);

      expect(docker.stop).toHaveBeenCalledWith('container-1');
      expect(updated.status).toBe('STOPPED');
    });

    it('throws NotFoundError and never calls docker when the app has no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'no-container2', image: 'nginx', hostPort: 6003, containerPort: 6003 });
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'no-container2' } });
      docker.stop.mockClear();

      await expect(service.stop(app.id)).rejects.toBeInstanceOf(NotFoundError);

      expect(docker.stop).not.toHaveBeenCalled();
      const unchanged = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(unchanged.status).toBe('ERROR');
    });
  });

  describe('remove', () => {
    it('force-removes the container, then deletes the row', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'r1', image: 'nginx', hostPort: 6100, containerPort: 6100 });

      await service.remove(app.id);

      expect(docker.remove).toHaveBeenCalledWith('container-1', { force: true });
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('deletes the row without calling docker.remove when there is no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'r2', image: 'nginx', hostPort: 6101, containerPort: 6101 });
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'r2' } });
      docker.remove.mockClear();

      await service.remove(app.id);

      expect(docker.remove).not.toHaveBeenCalled();
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('still deletes the row when the container is already gone', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'r3', image: 'nginx', hostPort: 6102, containerPort: 6102 });
      // DockerService.remove is idempotent about missing containers, so the
      // mock simply resolves as it would for a container that is already gone.

      await service.remove(app.id);

      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('throws NotFoundError when the app does not exist', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await expect(service.remove('missing-id')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('logs', () => {
    it('delegates to docker.logs with the given tail', async () => {
      const docker = makeDockerMock();
      docker.logs.mockResolvedValue('line1\nline2\n');
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'l1', image: 'nginx', hostPort: 6200, containerPort: 6200 });

      const logs = await service.logs(app.id, { tail: 50 });

      expect(docker.logs).toHaveBeenCalledWith('container-1', { tail: 50 });
      expect(logs).toBe('line1\nline2\n');
    });

    it('throws NotFoundError when the app has no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'l2', image: 'nginx', hostPort: 6201, containerPort: 6201 });
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'l2' } });

      await expect(service.logs(app.id, { tail: 50 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list / get reconciliation', () => {
    it('reconciles a RUNNING row to STOPPED when the container is no longer running, and persists it', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'g1', image: 'nginx', hostPort: 6300, containerPort: 6300 });
      docker.inspectState.mockResolvedValue({ exists: true, running: false });

      const fetched = await service.get(app.id);

      expect(fetched.status).toBe('STOPPED');
      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('STOPPED');
    });

    it('reconciles a STOPPED row to RUNNING when the container is running again, and persists it', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'g2', image: 'nginx', hostPort: 6301, containerPort: 6301 });
      await service.stop(app.id);
      docker.inspectState.mockResolvedValue({ exists: true, running: true });

      const fetched = await service.get(app.id);

      expect(fetched.status).toBe('RUNNING');
      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('RUNNING');
    });

    it('reconciles every app in list()', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'g3', image: 'nginx', hostPort: 6302, containerPort: 6302 });
      docker.inspectState.mockResolvedValue({ exists: true, running: false });

      const apps = await service.list();

      expect(apps.every((a) => a.status === 'STOPPED')).toBe(true);
    });

    it('does not call inspectState for apps with no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await createInstalled(service, { name: 'g4', image: 'nginx', hostPort: 6303, containerPort: 6303 });
      docker.inspectState.mockClear();

      const app = await service.get((await prisma.app.findUniqueOrThrow({ where: { name: 'g4' } })).id);

      expect(docker.inspectState).not.toHaveBeenCalled();
      expect(app.status).toBe('ERROR');
    });

    it('throws NotFoundError from get() when the app does not exist', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await expect(service.get('missing-id')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('reconciles a row to ERROR when the container was deleted outside EasyHost, and persists it', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'g5', image: 'nginx', hostPort: 6304, containerPort: 6304 });
      docker.inspectState.mockResolvedValue({ exists: false, running: false });

      const fetched = await service.get(app.id);

      expect(fetched.status).toBe('ERROR');
      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
    });

    it('list() omits an app deleted concurrently (P2025 on reconcile) but still returns the others', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      docker.createAndStart.mockResolvedValueOnce('container-g6');
      const deletedConcurrently = await createInstalled(service, {
        name: 'g6',
        image: 'nginx',
        hostPort: 6305,
        containerPort: 6305,
      });
      docker.createAndStart.mockResolvedValueOnce('container-g7');
      const stillThere = await createInstalled(service, {
        name: 'g7',
        image: 'nginx',
        hostPort: 6306,
        containerPort: 6306,
      });

      // `findMany` returns rows in creation order, and `reconcile` awaits
      // `inspectState` before calling `update`, so the first `update` call
      // queued corresponds to the first-created app (`deletedConcurrently`).
      jest.spyOn(prisma.app, 'update').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('An operation failed because it depends on one or more records that were required but not found.', {
          code: 'P2025',
          clientVersion: '5.22.0',
        }),
      );
      docker.inspectState.mockResolvedValue({ exists: true, running: false });

      const apps = await service.list();

      expect(apps.map((a) => a.id)).not.toContain(deletedConcurrently.id);
      expect(apps.map((a) => a.id)).toContain(stillThere.id);
    });

    it('get() throws NotFoundError when the app is deleted concurrently (P2025 on reconcile)', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'g8', image: 'nginx', hostPort: 6307, containerPort: 6307 });

      jest.spyOn(prisma.app, 'update').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('An operation failed because it depends on one or more records that were required but not found.', {
          code: 'P2025',
          clientVersion: '5.22.0',
        }),
      );
      docker.inspectState.mockResolvedValue({ exists: true, running: false });

      await expect(service.get(app.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('container deleted outside EasyHost', () => {
    it('start persists ERROR and rethrows ContainerMissingError', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'm1', image: 'nginx', hostPort: 6400, containerPort: 6400 });
      docker.start.mockRejectedValue(new ContainerMissingError());

      await expect(service.start(app.id)).rejects.toBeInstanceOf(ContainerMissingError);

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
    });

    it('stop persists ERROR and rethrows ContainerMissingError', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'm2', image: 'nginx', hostPort: 6401, containerPort: 6401 });
      docker.stop.mockRejectedValue(new ContainerMissingError());

      await expect(service.stop(app.id)).rejects.toBeInstanceOf(ContainerMissingError);

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
    });

    it('logs persists ERROR and rethrows ContainerMissingError', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'm3', image: 'nginx', hostPort: 6402, containerPort: 6402 });
      docker.logs.mockRejectedValue(new ContainerMissingError());

      await expect(service.logs(app.id, { tail: 50 })).rejects.toBeInstanceOf(ContainerMissingError);

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('ERROR');
    });

    it('start still rethrows ContainerMissingError when persisting the ERROR status fails', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'm5', image: 'nginx', hostPort: 6404, containerPort: 6404 });
      docker.start.mockRejectedValue(new ContainerMissingError());
      jest.spyOn(prisma.app, 'update').mockRejectedValueOnce(new Error('db down'));

      await expect(service.start(app.id)).rejects.toBeInstanceOf(ContainerMissingError);
    });

    it('remove still deletes the row for an ERROR app with a dangling containerId', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await createInstalled(service, { name: 'm4', image: 'nginx', hostPort: 6403, containerPort: 6403 });
      docker.start.mockRejectedValue(new ContainerMissingError());
      await expect(service.start(app.id)).rejects.toBeInstanceOf(ContainerMissingError);
      const errored = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(errored.status).toBe('ERROR');
      expect(errored.containerId).toBe('container-1');

      await service.remove(app.id);

      expect(docker.remove).toHaveBeenCalledWith('container-1', { force: true });
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });
  });
});
