import request from 'supertest';
import { createServer } from './server';
import { RateLimiter } from '../auth/rate-limiter';
import { InvalidCredentialsError } from '../errors';
import { AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth';
import { makeSystemDeps, makeViewContext } from '../../test/helpers/views';
import type { IAppService } from '../apps/app.service';
import type { IDockerService } from '../docker/docker.service';

function build(
  options: { authenticated?: boolean; secureCookies?: boolean; trustProxy?: boolean; loginLimiter?: RateLimiter } = {},
) {
  const authService = makeAuthServiceMock(options.authenticated ?? true);
  const appService = { list: jest.fn().mockResolvedValue([]) } as unknown as IAppService;
  const dockerService = { ping: jest.fn().mockResolvedValue(true) } as unknown as IDockerService;
  const loginLimiter = options.loginLimiter ?? new RateLimiter();
  const recoveryLimiter = new RateLimiter();
  const app = createServer({
    appService,
    dockerService,
    authService,
    planner: { plan: jest.fn() },
    views: makeViewContext(),
    ...makeSystemDeps(),
    loginLimiter,
    recoveryLimiter,
    secureCookies: options.secureCookies ?? false,
    trustProxy: options.trustProxy ?? false,
  });
  return { app, authService, loginLimiter };
}

describe('auth routes', () => {
  it('GET /api/auth/status is public', async () => {
    const { app } = build({ authenticated: false });
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupRequired: false, authenticated: false });
  });

  it('POST /api/auth/setup sets an HttpOnly SameSite=Strict cookie without Secure on plain HTTP', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.setup.mockResolvedValue({ recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD', sessionToken: 'tok' });
    const res = await request(app).post('/api/auth/setup').send({ password: 'long enough pw' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD' });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^easyhost_session=tok;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('scopes the session cookie to /api so apps on other ports of the same host do not receive it', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockResolvedValue({ sessionToken: 'tok' });
    const res = await request(app).post('/api/auth/login').send({ password: 'long enough pw' });
    expect(res.headers['set-cookie'][0]).toMatch(/; Path=\/api;/);
  });

  it('marks the cookie Secure when secureCookies is on', async () => {
    const { app, authService } = build({ authenticated: false, secureCookies: true });
    authService.login.mockResolvedValue({ sessionToken: 'tok' });
    const res = await request(app).post('/api/auth/login').send({ password: 'long enough pw' });
    expect(res.headers['set-cookie'][0]).toMatch(/Secure/);
  });

  it('rate-limits failed logins and answers 429 with retryAfterSeconds', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 30 });
    expect(blocked.headers['retry-after']).toBe('30');
    expect(authService.login).toHaveBeenCalledTimes(5);
  });

  it('serializes concurrent attempts so parallel wrong passwords cannot all slip past the limiter', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new InvalidCredentialsError();
    });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/api/auth/login').send({ password: 'wrong wrong' })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    expect(authService.login).toHaveBeenCalledTimes(5);
  });

  it('with TRUST_PROXY, rate-limits by the address the proxy saw, not one the client forged', async () => {
    const { app, authService } = build({ authenticated: false, trustProxy: true });
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    const attempt = (i: number) =>
      request(app)
        .post('/api/auth/login')
        // The client forges the first entry; the proxy appends the real address.
        .set('X-Forwarded-For', `203.0.113.${i}, 192.168.1.50`)
        .send({ password: 'wrong wrong' });
    for (let i = 0; i < 5; i++) {
      expect((await attempt(i)).status).toBe(401);
    }
    expect((await attempt(99)).status).toBe(429);
  });

  it('with TRUST_PROXY, trusts X-Forwarded-For only from a proxy on this machine', () => {
    // supertest always connects from loopback, so check the compiled trust
    // function directly for a LAN device reaching the port without the proxy.
    const { app } = build({ trustProxy: true });
    const trusts: (addr: string, hop: number) => boolean = app.get('trust proxy fn');
    expect(trusts('127.0.0.1', 0)).toBe(true);
    expect(trusts('::1', 0)).toBe(true);
    expect(trusts('192.168.1.60', 0)).toBe(false);
    expect(trusts('10.0.0.7', 0)).toBe(false);
  });

  it('counts recovery attempts separately from logins', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    authService.recover.mockResolvedValue({ recoveryCode: 'NEW', sessionToken: 'tok' });
    for (let i = 0; i < 6; i++) {
      await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
    }
    const res = await request(app).post('/api/auth/recover').send({ recoveryCode: 'x', newPassword: 'long enough pw' });
    expect(res.status).toBe(200);
  });

  it('POST /api/auth/logout clears the cookie', async () => {
    const { app, authService } = build();
    const res = await request(app).post('/api/auth/logout').set('Cookie', AUTH_COOKIE).send({});
    expect(res.status).toBe(204);
    expect(authService.logout).toHaveBeenCalledWith('test-token');
    // Must match the path the cookie was set with, or the browser keeps it.
    expect(
      (res.headers['set-cookie'] as unknown as string[]).some((c) => /^easyhost_session=;.*Path=\/api;/.test(c)),
    ).toBe(true);
  });

  it('POST /api/auth/password passes the current session token', async () => {
    const { app, authService } = build();
    const res = await request(app)
      .post('/api/auth/password')
      .set('Cookie', AUTH_COOKIE)
      .send({ currentPassword: 'old password!', newPassword: 'new password!!' });
    expect(res.status).toBe(204);
    expect(authService.changePassword).toHaveBeenCalledWith('test-token', 'old password!', 'new password!!');
  });

  it('rejects a body with missing fields as VALIDATION_FAILED', async () => {
    const { app } = build({ authenticated: false });
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an over-long password as VALIDATION_FAILED without running the service', async () => {
    const { app, authService } = build({ authenticated: false });
    const res = await request(app).post('/api/auth/login').send({ password: 'x'.repeat(1025) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(authService.login).not.toHaveBeenCalled();
  });
});

describe('route protection', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/api/apps'],
    ['get', '/api/apps/some-id'],
    ['post', '/api/apps'],
    ['post', '/api/apps/some-id/start'],
    ['post', '/api/apps/some-id/start'],
    ['post', '/api/apps/some-id/stop'],
    ['delete', '/api/apps/some-id'],
    ['get', '/api/apps/some-id/logs'],
    ['post', '/api/auth/logout'],
    ['post', '/api/auth/password'],
    ['post', '/api/auth/recovery-code'],
    ['get', '/api/catalog'],
    ['get', '/api/system'],
    ['get', '/api/ports/suggest'],
    ['get', '/api/a-route-added-in-the-future'],
  ];

  it.each(protectedRoutes)('%s %s requires a session', async (method, path) => {
    const { app } = build({ authenticated: false });
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('re-issues the session cookie on authenticated requests so an active session never expires in the browser', async () => {
    const { app } = build();
    const res = await request(app).get('/api/apps').set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^easyhost_session=test-token;.*Max-Age=2592000/);
  });

  it('keeps /health public', async () => {
    const { app } = build({ authenticated: false });
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('rejects a non-JSON POST with 415 JSON_REQUIRED', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/apps/some-id/start')
      .set('Cookie', AUTH_COOKIE)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=b');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('JSON_REQUIRED');
  });
});
