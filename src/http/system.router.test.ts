import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createServer, type ServerDeps } from './server';
import { Catalog, type CatalogEntry } from '../catalog/catalog';
import { AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth';
import { makeViewContext } from '../../test/helpers/views';

const entry = {
  id: 'demo', name: 'Demo', description: 'Demo app.', category: 'Media', icon: 'icons/demo.svg',
  image: 'demo/demo:1.0.0', containerPort: 80, defaultHostPort: 8080, env: {}, volumes: [], fixedPorts: [],
  generatedSecrets: [], guide: { afterInstall: [{ text: 'Open it.' }] },
} as CatalogEntry;

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function build(overrides: Partial<ServerDeps> = {}) {
  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-cat-'));
  tempDirs.push(catalogDir);
  fs.mkdirSync(path.join(catalogDir, 'icons'));
  fs.writeFileSync(path.join(catalogDir, 'icons', 'demo.svg'), '<svg/>');
  const ports = { check: jest.fn(), suggest: jest.fn().mockResolvedValue(8081) };
  const deps: ServerDeps = {
    appService: {} as ServerDeps['appService'],
    dockerService: { ping: jest.fn().mockResolvedValue(true) } as unknown as ServerDeps['dockerService'],
    authService: makeAuthServiceMock(),
    planner: { plan: jest.fn() },
    views: makeViewContext(new Catalog([entry])),
    system: () => ({ os: 'linux', distros: ['ubuntu', 'debian'], version: '0.2.0' }),
    ports,
    usedPorts: async () => new Set([8080]),
    catalogDir,
    ...overrides,
  };
  return { app: createServer(deps), ports };
}

describe('system routes', () => {
  it('GET /api/system reports the server OS and version', async () => {
    const res = await request(build().app).get('/api/system').set('Cookie', AUTH_COOKIE);
    expect(res.body).toEqual({ os: 'linux', distros: ['ubuntu', 'debian'], version: '0.2.0' });
  });

  it('GET /api/catalog adds icon URLs', async () => {
    const res = await request(build().app).get('/api/catalog').set('Cookie', AUTH_COOKIE);
    expect(res.body[0]).toMatchObject({ id: 'demo', iconUrl: '/catalog-icons/demo.svg' });
  });

  it('serves catalog icons without a session', async () => {
    const res = await request(build().app).get('/catalog-icons/demo.svg');
    expect(res.status).toBe(200);
  });

  it('GET /api/ports/suggest skips ports used by apps', async () => {
    const { app, ports } = build();
    const res = await request(app).get('/api/ports/suggest?preferred=8080').set('Cookie', AUTH_COOKIE);
    expect(res.body).toEqual({ port: 8081 });
    expect(ports.suggest).toHaveBeenCalledWith(8080, new Set([8080]));
  });

  it('requires a session for the system, catalog and port routes', async () => {
    const app = build({ authService: makeAuthServiceMock(false) }).app;
    for (const route of ['/api/system', '/api/catalog', '/api/ports/suggest?preferred=8080']) {
      expect((await request(app).get(route)).status).toBe(401);
    }
  });

  it('rejects a non-numeric preferred port', async () => {
    const res = await request(build().app).get('/api/ports/suggest?preferred=abc').set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(400);
  });
});

describe('web interface', () => {
  function withWebDist() {
    const webDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-web-'));
    tempDirs.push(webDistDir);
    fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>EasyHost</title>');
    return build({ webDistDir }).app;
  }

  it('serves index.html for app routes like /apps/123', async () => {
    const res = await request(withWebDist()).get('/apps/123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>EasyHost</title>');
  });

  it('does not serve index.html for /health', async () => {
    const res = await request(withWebDist()).get('/health');
    expect(res.body).toEqual({ ok: true, docker: true });
  });

  it('serves nothing extra when the web interface has not been built', async () => {
    const res = await request(build().app).get('/apps/123');
    expect(res.status).toBe(404);
  });

  it('does not serve index.html for unknown /api routes', async () => {
    const res = await request(withWebDist()).get('/api/nope');
    expect(res.status).toBe(401);
  });
});
