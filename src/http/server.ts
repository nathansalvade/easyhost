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
import type { IDockerService } from '../docker/docker.service';

export interface ServerDeps {
  appService: IAppService;
  dockerService: IDockerService;
  authService: IAuthService;
  secureCookies?: boolean;
  trustProxy?: boolean;
  loginLimiter?: RateLimiter;
  recoveryLimiter?: RateLimiter;
}

export function createServer(deps: ServerDeps): Application {
  const app = express();
  if (deps.trustProxy) {
    app.set('trust proxy', true);
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
  app.use('/api/apps', createAppsRouter(deps.appService));

  app.use(errorMiddleware);

  return app;
}
