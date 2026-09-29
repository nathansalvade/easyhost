import { Prisma, PrismaClient } from '@prisma/client';
import { AppService } from './app.service';
import { DockerOperationError, NotFoundError } from '../errors';
import { createTempDb } from '../../test/helpers/temp-db';
import type { IDockerService } from '../docker/docker.service';

function makeDockerMock(): jest.Mocked<IDockerService> {
  return {
    pullImage: jest.fn().mockResolvedValue(undefined),
    createAndStart: jest.fn().mockResolvedValue('container-1'),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    logs: jest.fn().mockResolvedValue('log output'),
    inspectState: jest.fn().mockResolvedValue({ running: true }),
    ping: jest.fn().mockResolvedValue(true),
  };
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

  afterEach(async () => {
    await prisma.app.deleteMany();
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('deploys the app: pulls, creates+starts, and persists RUNNING with the containerId', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);

      const app = await service.create({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 80,
        env: { FOO: 'bar' },
      });

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
      expect(app.status).toBe('RUNNING');
      expect(app.containerId).toBe('container-1');

      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('RUNNING');
      expect(persisted.containerId).toBe('container-1');
    });

    it('rejects with ConflictError NAME_TAKEN before any daemon call when the name is already used', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await service.create({ name: 'dup', image: 'nginx', hostPort: 1000, containerPort: 1000 });
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
      await service.create({ name: 'a', image: 'nginx', hostPort: 3000, containerPort: 3000 });
      docker.pullImage.mockClear();
      docker.createAndStart.mockClear();

      await expect(
        service.create({ name: 'b', image: 'nginx', hostPort: 3000, containerPort: 3000 }),
      ).rejects.toMatchObject({ code: 'PORT_TAKEN' });

      expect(docker.pullImage).not.toHaveBeenCalled();
      expect(docker.createAndStart).not.toHaveBeenCalled();
    });

    it('sets status ERROR and keeps the row (without a containerId) when the pull fails', async () => {
      const docker = makeDockerMock();
      docker.pullImage.mockRejectedValue(new DockerOperationError('pull failed'));
      const service = new AppService(prisma, docker);

      await expect(
        service.create({ name: 'fails', image: 'bad-image', hostPort: 4000, containerPort: 4000 }),
      ).rejects.toBeInstanceOf(DockerOperationError);

      const persisted = await prisma.app.findUniqueOrThrow({ where: { name: 'fails' } });
      expect(persisted.status).toBe('ERROR');
      expect(persisted.containerId).toBeNull();
    });

    it('sets status ERROR and keeps the row when createAndStart fails', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('create failed'));
      const service = new AppService(prisma, docker);

      await expect(
        service.create({ name: 'fails2', image: 'nginx', hostPort: 4001, containerPort: 4001 }),
      ).rejects.toBeInstanceOf(DockerOperationError);

      const persisted = await prisma.app.findUniqueOrThrow({ where: { name: 'fails2' } });
      expect(persisted.status).toBe('ERROR');
      expect(persisted.containerId).toBeNull();
    });

    it('keeps the containerId on the ERROR row when the container was created but finalizing the row failed', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockResolvedValue('container-known');
      const service = new AppService(prisma, docker);

      jest.spyOn(prisma.app, 'update').mockRejectedValueOnce(new Error('db hiccup'));

      await expect(
        service.create({ name: 'fails3', image: 'nginx', hostPort: 4002, containerPort: 4002 }),
      ).rejects.toThrow('db hiccup');

      const persisted = await prisma.app.findUniqueOrThrow({ where: { name: 'fails3' } });
      expect(persisted.status).toBe('ERROR');
      expect(persisted.containerId).toBe('container-known');
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

  describe('start', () => {
    it('starts the container and persists RUNNING', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await service.create({ name: 's1', image: 'nginx', hostPort: 6000, containerPort: 6000 });
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

      await expect(
        service.create({ name: 'no-container', image: 'nginx', hostPort: 6001, containerPort: 6001 }),
      ).rejects.toThrow();
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
      const app = await service.create({ name: 's2', image: 'nginx', hostPort: 6002, containerPort: 6002 });

      const updated = await service.stop(app.id);

      expect(docker.stop).toHaveBeenCalledWith('container-1');
      expect(updated.status).toBe('STOPPED');
    });

    it('throws NotFoundError and never calls docker when the app has no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await expect(
        service.create({ name: 'no-container2', image: 'nginx', hostPort: 6003, containerPort: 6003 }),
      ).rejects.toThrow();
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
      const app = await service.create({ name: 'r1', image: 'nginx', hostPort: 6100, containerPort: 6100 });

      await service.remove(app.id);

      expect(docker.remove).toHaveBeenCalledWith('container-1', { force: true });
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('deletes the row without calling docker.remove when there is no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await expect(
        service.create({ name: 'r2', image: 'nginx', hostPort: 6101, containerPort: 6101 }),
      ).rejects.toThrow();
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'r2' } });
      docker.remove.mockClear();

      await service.remove(app.id);

      expect(docker.remove).not.toHaveBeenCalled();
      await expect(prisma.app.findUnique({ where: { id: app.id } })).resolves.toBeNull();
    });

    it('still deletes the row when the container is already gone', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await service.create({ name: 'r3', image: 'nginx', hostPort: 6102, containerPort: 6102 });
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
      const app = await service.create({ name: 'l1', image: 'nginx', hostPort: 6200, containerPort: 6200 });

      const logs = await service.logs(app.id, { tail: 50 });

      expect(docker.logs).toHaveBeenCalledWith('container-1', { tail: 50 });
      expect(logs).toBe('line1\nline2\n');
    });

    it('throws NotFoundError when the app has no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await expect(
        service.create({ name: 'l2', image: 'nginx', hostPort: 6201, containerPort: 6201 }),
      ).rejects.toThrow();
      const app = await prisma.app.findUniqueOrThrow({ where: { name: 'l2' } });

      await expect(service.logs(app.id, { tail: 50 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list / get reconciliation', () => {
    it('reconciles a RUNNING row to STOPPED when the container is no longer running, and persists it', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await service.create({ name: 'g1', image: 'nginx', hostPort: 6300, containerPort: 6300 });
      docker.inspectState.mockResolvedValue({ running: false });

      const fetched = await service.get(app.id);

      expect(fetched.status).toBe('STOPPED');
      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('STOPPED');
    });

    it('reconciles a STOPPED row to RUNNING when the container is running again, and persists it', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      const app = await service.create({ name: 'g2', image: 'nginx', hostPort: 6301, containerPort: 6301 });
      await service.stop(app.id);
      docker.inspectState.mockResolvedValue({ running: true });

      const fetched = await service.get(app.id);

      expect(fetched.status).toBe('RUNNING');
      const persisted = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(persisted.status).toBe('RUNNING');
    });

    it('reconciles every app in list()', async () => {
      const docker = makeDockerMock();
      const service = new AppService(prisma, docker);
      await service.create({ name: 'g3', image: 'nginx', hostPort: 6302, containerPort: 6302 });
      docker.inspectState.mockResolvedValue({ running: false });

      const apps = await service.list();

      expect(apps.every((a) => a.status === 'STOPPED')).toBe(true);
    });

    it('does not call inspectState for apps with no containerId', async () => {
      const docker = makeDockerMock();
      docker.createAndStart.mockRejectedValue(new DockerOperationError('boom'));
      const service = new AppService(prisma, docker);
      await expect(
        service.create({ name: 'g4', image: 'nginx', hostPort: 6303, containerPort: 6303 }),
      ).rejects.toThrow();
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
  });
});
