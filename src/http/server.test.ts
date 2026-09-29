import request from 'supertest';
import { createServer } from './server';
import { ConflictError, ContainerMissingError, DockerUnavailableError, NotFoundError } from '../errors';
import { AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth';
import type { IAppService } from '../apps/app.service';
import type { IDockerService } from '../docker/docker.service';
import type { IInstallPlanner, InstallRequest } from '../apps/install-planner';
import { makeSystemDeps, makeViewContext } from '../../test/helpers/views';

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app1',
    name: 'my-app',
    image: 'nginx:latest',
    hostPort: 8080,
    containerPort: 80,
    containerId: 'container-1',
    status: 'RUNNING',
    catalogId: null,
    volumes: '[]',
    fixedPorts: '[]',
    secrets: '{}',
    lastError: null,
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

/** Passes custom-image requests straight through, like the real planner's advanced branch. */
function makePlannerMock(): jest.Mocked<IInstallPlanner> {
  return {
    plan: jest.fn(async (r: InstallRequest) => {
      if ('catalogId' in r) throw new Error('catalog requests need an explicit mock');
      return { name: r.name, image: r.image, hostPort: r.hostPort, containerPort: r.containerPort ?? r.hostPort, env: r.env, volumes: r.volumes ?? [] };
    }),
  };
}

function build() {
  const appService = makeAppServiceMock();
  const planner = makePlannerMock();
  const dockerService = makeDockerServiceMock();
  const app = createServer({ appService, dockerService, authService: makeAuthServiceMock(), planner, views: makeViewContext(), ...makeSystemDeps() });
  return { app, appService, planner, dockerService };
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
      const app = createServer({ appService, dockerService, authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, docker: true });
    });

    it('reports docker: false when the daemon is unreachable', async () => {
      const appService = makeAppServiceMock();
      const dockerService = makeDockerServiceMock();
      dockerService.ping.mockResolvedValue(false);
      const app = createServer({ appService, dockerService, authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, docker: false });
    });
  });

  describe('GET /api/apps', () => {
    it('returns the list of apps', async () => {
      const appService = makeAppServiceMock();
      appService.list.mockResolvedValue([makeApp()] as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/api/apps').set('Cookie', AUTH_COOKIE);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('my-app');
    });
  });

  describe('GET /api/apps/:id', () => {
    it('returns a single app', async () => {
      const appService = makeAppServiceMock();
      appService.get.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/api/apps/app1').set('Cookie', AUTH_COOKIE);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('app1');
      expect(appService.get).toHaveBeenCalledWith('app1');
    });

    it('returns 404 with the error shape when the app does not exist', async () => {
      const appService = makeAppServiceMock();
      appService.get.mockRejectedValue(new NotFoundError('App app1 not found'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/api/apps/app1').set('Cookie', AUTH_COOKIE);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'APP_NOT_FOUND', message: 'App app1 not found' },
      });
    });
  });

  describe('POST /api/apps', () => {
    it('plans a custom-image install and answers 202', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'my-app', image: 'nginx:latest', hostPort: 8080 });

      expect(res.status).toBe(202);
      expect(appService.create).toHaveBeenCalledWith({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 8080,
        env: undefined,
        volumes: [],
      });
    });

    it('defaults containerPort to hostPort when omitted, and passes containerPort through when given', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockResolvedValue(makeApp() as never);
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'my-app', image: 'nginx:latest', hostPort: 8080, containerPort: 3000 });

      expect(appService.create).toHaveBeenCalledWith(
        expect.objectContaining({ hostPort: 8080, containerPort: 3000 }),
      );
    });

    it('returns 400 with VALIDATION_FAILED and never calls the service when the body is missing required fields', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE).send({ image: 'nginx' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when hostPort is not a positive int <= 65535', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'my-app', image: 'nginx', hostPort: 70000 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when hostPort is not an integer', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'my-app', image: 'nginx', hostPort: 80.5 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when containerPort is not positive', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'my-app', image: 'nginx', hostPort: 8080, containerPort: -1 });

      expect(res.status).toBe(400);
      expect(appService.create).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when an env key is invalid', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
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
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({
          name: 'my-app',
          image: 'nginx',
          hostPort: 8080,
          env: { FOO_BAR: 'baz', _leading: '1' },
        });

      expect(res.status).toBe(202);
      expect(appService.create).toHaveBeenCalledWith(
        expect.objectContaining({ env: { FOO_BAR: 'baz', _leading: '1' } }),
      );
    });

    it('maps a ConflictError from the service to 409 with the error shape', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockRejectedValue(new ConflictError('name taken', 'NAME_TAKEN'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
        .send({ name: 'dup', image: 'nginx', hostPort: 8080 });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'NAME_TAKEN', message: 'name taken' } });
    });

    it('maps an unrecognised error to 500 with a generic message', async () => {
      const appService = makeAppServiceMock();
      appService.create.mockRejectedValue(new Error('raw internal failure'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app)
        .post('/api/apps')
        .set('Cookie', AUTH_COOKIE)
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
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).post('/api/apps/app1/start').set('Cookie', AUTH_COOKIE).send({});

      expect(res.status).toBe(200);
      expect(appService.start).toHaveBeenCalledWith('app1');
    });

    it('maps DockerUnavailableError to 503', async () => {
      const appService = makeAppServiceMock();
      appService.start.mockRejectedValue(new DockerUnavailableError('daemon down'));
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).post('/api/apps/app1/start').set('Cookie', AUTH_COOKIE).send({});

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DOCKER_UNAVAILABLE');
    });

    it('maps ContainerMissingError to 409 when the container was deleted outside EasyHost', async () => {
      const appService = makeAppServiceMock();
      appService.start.mockRejectedValue(new ContainerMissingError());
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).post('/api/apps/app1/start').set('Cookie', AUTH_COOKIE).send({});

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
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).post('/api/apps/app1/stop').set('Cookie', AUTH_COOKIE).send({});

      expect(res.status).toBe(200);
      expect(appService.stop).toHaveBeenCalledWith('app1');
    });
  });

  describe('POST /api/apps (catalog installs and names)', () => {
    it('plans a catalog install and answers 202 with the pending app', async () => {
      const { app, appService, planner } = build();
      planner.plan.mockResolvedValue({ name: 'jellyfin', image: 'jellyfin/jellyfin:10.10.7', hostPort: 8096, containerPort: 8096 });
      appService.create.mockResolvedValue(makeApp({ status: 'PENDING', name: 'jellyfin' }) as never);
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE).send({ catalogId: 'jellyfin' });
      expect(res.status).toBe(202);
      expect(planner.plan).toHaveBeenCalledWith({ catalogId: 'jellyfin' });
      expect(res.body).toMatchObject({ name: 'jellyfin', status: 'PENDING' });
      expect(res.body).not.toHaveProperty('containerId');
      expect(res.body).not.toHaveProperty('secrets');
    });

    it('refuses a name with spaces with a friendly message', async () => {
      const { app, planner } = build();
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE)
        .send({ name: 'My Movies', image: 'nginx:1.27', hostPort: 8088 });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('no spaces');
      expect(planner.plan).not.toHaveBeenCalled();
    });

    it('refuses unknown fields in a catalog request', async () => {
      const { app } = build();
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE)
        .send({ catalogId: 'jellyfin', image: 'evil:1' });
      expect(res.status).toBe(400);
    });
  });

  describe('secrets and container ids', () => {
    it('lists apps without secrets or container ids', async () => {
      const { app, appService } = build();
      appService.list.mockResolvedValue([makeApp({ secrets: JSON.stringify({ adminPassword: 's3cret' }) })] as never);
      const res = await request(app).get('/api/apps').set('Cookie', AUTH_COOKIE);
      expect(JSON.stringify(res.body)).not.toContain('s3cret');
      expect(res.body[0]).not.toHaveProperty('containerId');
      expect(res.body[0]).not.toHaveProperty('secrets');
    });

    it('returns secrets on the single-app route', async () => {
      const { app, appService } = build();
      appService.get.mockResolvedValue(makeApp({ secrets: JSON.stringify({ adminPassword: 's3cret' }) }) as never);
      const res = await request(app).get('/api/apps/app1').set('Cookie', AUTH_COOKIE);
      expect(res.body.secrets).toEqual([{ name: 'adminPassword', label: 'adminPassword', value: 's3cret' }]);
    });
  });

  describe('DELETE /api/apps/:id', () => {
    it('keeps data by default and reports where it is', async () => {
      const { app, appService } = build();
      appService.remove.mockResolvedValue({ dataPath: '/data/apps/app1', dataDeleted: false });
      const res = await request(app).delete('/api/apps/app1').set('Cookie', AUTH_COOKIE);
      expect(res.status).toBe(200);
      expect(appService.remove).toHaveBeenCalledWith('app1', { deleteData: false });
      expect(res.body).toEqual({ dataPath: '/data/apps/app1', dataDeleted: false });
    });

    it('deletes data with ?deleteData=true', async () => {
      const { app, appService } = build();
      appService.remove.mockResolvedValue({ dataPath: '/data/apps/app1', dataDeleted: true });
      await request(app).delete('/api/apps/app1?deleteData=true').set('Cookie', AUTH_COOKIE);
      expect(appService.remove).toHaveBeenCalledWith('app1', { deleteData: true });
    });
  });

  describe('GET /api/apps/:id/logs', () => {
    it('returns logs as text/plain with the default tail of 200', async () => {
      const appService = makeAppServiceMock();
      appService.logs.mockResolvedValue('line1\nline2\n');
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/api/apps/app1/logs').set('Cookie', AUTH_COOKIE);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('line1\nline2\n');
      expect(appService.logs).toHaveBeenCalledWith('app1', { tail: 200 });
    });

    it('forwards a custom tail query parameter', async () => {
      const appService = makeAppServiceMock();
      appService.logs.mockResolvedValue('log');
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      await request(app).get('/api/apps/app1/logs?tail=50').set('Cookie', AUTH_COOKIE);

      expect(appService.logs).toHaveBeenCalledWith('app1', { tail: 50 });
    });

    it('returns 400 for a non-numeric tail', async () => {
      const appService = makeAppServiceMock();
      const app = createServer({ appService, dockerService: makeDockerServiceMock(), authService: makeAuthServiceMock(), planner: makePlannerMock(), views: makeViewContext(), ...makeSystemDeps() });

      const res = await request(app).get('/api/apps/app1/logs?tail=abc').set('Cookie', AUTH_COOKIE);

      expect(res.status).toBe(400);
      expect(appService.logs).not.toHaveBeenCalled();
    });
  });

  describe('malformed request bodies', () => {
    it('answers 400 for invalid JSON and never logs the body (it may hold a password)', async () => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { app } = build();
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"password":"hunter2-secret');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(log.mock.calls)).not.toContain('hunter2-secret');
      log.mockRestore();
    });

    it('answers 413 for an oversized body', async () => {
      const { app } = build();
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ password: 'x'.repeat(200_000) }));
      expect(res.status).toBe(413);
    });
  });
});

