import request from 'supertest';
import { createServer } from './server';
import { ConflictError, ContainerMissingError, DockerUnavailableError, NotFoundError } from '../errors';
import type { IAppService } from '../apps/app.service';
import type { IDockerService } from '../docker/docker.service';

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    name: 'my-app',
    image: 'nginx:latest',
    hostPort: 8080,
    containerPort: 80,
    containerId: 'container-1',
    status: 'RUNNING',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeAppServiceMock(): jest.Mocked<IAppService> {
  return {
    create: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn(),
    logs: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
  };
}

function makeDockerServiceMock(): jest.Mocked<IDockerService> {
  return {
    pullImage: jest.fn(),
    createAndStart: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn(),
    logs: jest.fn(),
    inspectState: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
  };
}

describe('createServer', () => {
  describe('GET /health', () => {
    it('returns ok: true and the daemon reachability', async () => {
      const appService = makeAppServiceMock();
      const dockerService = makeDockerServiceMock();
      dockerService.ping.mockResolvedValue(true);
      const app = createServer({ appService, dockerService });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, docker: true });
    });

    it('reports docker: false when the daemon is unreachable', async () => {
      const appService = makeAppServiceMock();
      const dockerService = makeDockerServiceMock();
      dockerService.ping.mockResolvedValue(false);
      const app = createServer({ appService, dockerService });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, docker: false });
    });
  });

  describe('GET /api/apps', () => {
    it('returns the list of apps', async () => {
      const appService = makeAppServiceMock();
      appService.list.mockResolvedValue([makeApp()] as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).get('/api/apps');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('my-app');
    });
  });

  describe('GET /api/apps/:id', () => {
    it('returns a single app', async () => {
      const appService = makeAppServiceMock();
      appService.get.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).get('/api/apps/app-1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('app-1');
      expect(appService.get).toHaveBeenCalledWith('app-1');
    });

    it('returns 404 with the error shape when the app does not exist', async () => {
      const appService = makeAppServiceMock();
      appService.get.mockRejectedValue(new NotFoundError('App app-1 not found'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).get('/api/apps/app-1');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'APP_NOT_FOUND', message: 'App app-1 not found' },
      });
    });
  });

  describe('POST /api/apps', () => {
    it('deploys the app and returns 201', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx:latest', hostPort: 8080 });

      expect(res.status).toBe(201);
      expect(appService.create).toHaveBeenCalledWith({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 8080,
        env: undefined,
      });
    });

    it('defaults containerPort to hostPort when omitted, and passes containerPort through when given', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx:latest', hostPort: 8080, containerPort: 3000 });

      expect(appService.create).toHaveBeenCalledWith(
        expect.objectContaining({ hostPort: 8080, containerPort: 3000 }),
      );
    });

    it('returns 400 with VALIDATION_FAILED and never calls the service when the body is missing required fields', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).post('/api/apps').send({ image: 'nginx' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when hostPort is not a positive int <= 65535', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx', hostPort: 70000 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when hostPort is not an integer', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx', hostPort: 80.5 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when containerPort is not positive', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx', hostPort: 8080, containerPort: -1 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when an env key is invalid', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({
          name: 'my-app',
          image: 'nginx',
          hostPort: 8080,
          env: { 'A=B': 'x' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('accepts valid env keys', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({
          name: 'my-app',
          image: 'nginx',
          hostPort: 8080,
          env: { FOO_BAR: 'baz', _leading: '1' },
        });

      expect(res.status).toBe(201);
      expect(appService.create).toHaveBeenCalledWith(
        expect.objectContaining({ env: { FOO_BAR: 'baz', _leading: '1' } }),
      );
    });

    it('maps a ConflictError from the service to 409 with the error shape', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockRejectedValue(new ConflictError('name taken', 'NAME_TAKEN'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'dup', image: 'nginx', hostPort: 8080 });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'NAME_TAKEN', message: 'name taken' } });
    });

    it('maps an unrecognised error to 500 with a generic message', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockRejectedValue(new Error('raw internal failure'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app)
        .post('/api/apps')
        .send({ name: 'my-app', image: 'nginx', hostPort: 8080 });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('raw internal failure');
    });
  });

  describe('POST /api/apps/:id/start', () => {
    it('starts the app', async () => {
      const appService = makeAppServiceMock();
      appService.start.mockResolvedValue(makeApp({ status: 'RUNNING' }) as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).post('/api/apps/app-1/start');

      expect(res.status).toBe(200);
      expect(appService.start).toHaveBeenCalledWith('app-1');
    });

    it('maps DockerUnavailableError to 503', async () => {
      const appService = makeAppServiceMock();
      appService.start.mockRejectedValue(new DockerUnavailableError('daemon down'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).post('/api/apps/app-1/start');

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DOCKER_UNAVAILABLE');
    });

    it('maps ContainerMissingError to 409 when the container was deleted outside EasyHost', async () => {
      const appService = makeAppServiceMock();
      appService.start.mockRejectedValue(new ContainerMissingError());
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).post('/api/apps/app-1/start');

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'CONTAINER_MISSING', message: expect.any(String) },
      });
    });
  });

  describe('POST /api/apps/:id/stop', () => {
    it('stops the app', async () => {
      const appService = makeAppServiceMock();
      appService.stop.mockResolvedValue(makeApp({ status: 'STOPPED' }) as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).post('/api/apps/app-1/stop');

      expect(res.status).toBe(200);
      expect(appService.stop).toHaveBeenCalledWith('app-1');
    });
  });

  describe('DELETE /api/apps/:id', () => {
    it('removes the app and returns 204', async () => {
      const appService = makeAppServiceMock();
      appService.remove.mockResolvedValue(undefined);
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).delete('/api/apps/app-1');

      expect(res.status).toBe(204);
      expect(appService.remove).toHaveBeenCalledWith('app-1');
    });
  });

  describe('GET /api/apps/:id/logs', () => {
    it('returns logs as text/plain with the default tail of 200', async () => {
      const appService = makeAppServiceMock();
      appService.logs.mockResolvedValue('line1\nline2\n');
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).get('/api/apps/app-1/logs');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('line1\nline2\n');
      expect(appService.logs).toHaveBeenCalledWith('app-1', { tail: 200 });
    });

    it('forwards a custom tail query parameter', async () => {
      const appService = makeAppServiceMock();
      appService.logs.mockResolvedValue('log');
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      await request(app).get('/api/apps/app-1/logs?tail=50');

      expect(appService.logs).toHaveBeenCalledWith('app-1', { tail: 50 });
    });

    it('returns 400 for a non-numeric tail', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock() });

      const res = await request(app).get('/api/apps/app-1/logs?tail=abc');

      expect(res.status).toBe(400);
      expect(appService.logs).not.toHaveBeenCalled();
    });
  });
});
