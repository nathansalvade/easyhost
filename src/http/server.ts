import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import { asyncHandler } from './async-handler';
import { createAppsRouter } from './apps.router';
import { createAuthRouter } from './auth.router';
import { requireJson, requireSession, sessionCookieOptions } from './auth.middleware';
import { errorMiddleware } from './error.middleware';
import { RateLimiter } from '../auth/rate-limiter';
import type { IAppService } from '../apps/app.service';
import type { IAuthService } from '../auth/auth.service';
import type { IInstallPlanner } from '../apps/install-planner';
import type { ViewContext } from '../apps/app.view';
import type { IDockerService } from '../docker/docker.service';

export interface ServerDeps {
  appService: IAppService;
  dockerService: IDockerService;
  authService: IAuthService;
  planner: IInstallPlanner;
  views: ViewContext;
  secureCookies?: boolean;
  trustProxy?: boolean;
  loginLimiter?: RateLimiter;
  recoveryLimiter?: RateLimiter;
}

export function createServer(deps: ServerDeps): Application {
  const app = express();
  if (deps.trustProxy) {
    // Only a proxy on this machine may set the client address. `true` would
    // take the client-controlled left-most X-Forwarded-For entry, and a hop
    // count would trust anyone on the LAN connecting to HOST directly; either
    // lets an attacker pick a fresh IP per request and bypass the login rate
    // limiter. A proxy elsewhere is not trusted, so its clients share one
    // limit (a lockout risk, never a bypass).
    app.set('trust proxy', 'loopback');
  }
  app.use(express.json());
  app.use(cookieParser());

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const docker = await deps.dockerService.ping();
      res.json({ ok: true, docker });
    }),
  );

  app.use('/api', requireJson);
  app.use('/api', requireSession(deps.authService, sessionCookieOptions(deps.secureCookies ?? false)));
  app.use(
    '/api/auth',
    createAuthRouter({
      auth: deps.authService,
      loginLimiter: deps.loginLimiter ?? new RateLimiter(),
      recoveryLimiter: deps.recoveryLimiter ?? new RateLimiter(),
      secureCookies: deps.secureCookies ?? false,
    }),
  );
  app.use('/api/apps', createAppsRouter({ appService: deps.appService, planner: deps.planner, views: deps.views }));

  app.use(errorMiddleware);

  return app;
}
