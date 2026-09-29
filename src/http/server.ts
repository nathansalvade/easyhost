import * as fs from 'fs';
import * as path from 'path';
import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import { asyncHandler } from './async-handler';
import { createAppsRouter } from './apps.router';
import { createAuthRouter } from './auth.router';
import { requireJson, requireSession, sessionCookieOptions } from './auth.middleware';
import { errorMiddleware } from './error.middleware';
import { createSystemRouter } from './system.router';
import { RateLimiter } from '../auth/rate-limiter';
import type { IAppService } from '../apps/app.service';
import type { IAuthService } from '../auth/auth.service';
import type { IInstallPlanner } from '../apps/install-planner';
import type { ViewContext } from '../apps/app.view';
import type { IDockerService } from '../docker/docker.service';
import type { IPortChecker } from '../ports/port-checker';
import type { SystemInfo } from '../system/system';

export interface ServerDeps {
  appService: IAppService;
  dockerService: IDockerService;
  authService: IAuthService;
  planner: IInstallPlanner;
  views: ViewContext;
  system: () => SystemInfo;
  ports: IPortChecker;
  /** Host ports held by EasyHost apps, fixed ports included. */
  usedPorts: () => Promise<Set<number>>;
  /** Folder holding the catalog; its `icons/` are served publicly. */
  catalogDir: string;
  /** Built web interface; served when it contains an index.html. */
  webDistDir?: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
  loginLimiter?: RateLimiter;
  recoveryLimiter?: RateLimiter;
  globalLoginLimiter?: RateLimiter;
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

  // Public: the login screen may show icons before a session exists.
  app.use('/catalog-icons', express.static(path.join(deps.catalogDir, 'icons')));

  app.use('/api', requireJson);
  app.use('/api', requireSession(deps.authService, sessionCookieOptions(deps.secureCookies ?? false)));
  app.use(
    '/api/auth',
    createAuthRouter({
      auth: deps.authService,
      loginLimiter: deps.loginLimiter ?? new RateLimiter(),
      recoveryLimiter: deps.recoveryLimiter ?? new RateLimiter(),
      globalLoginLimiter: deps.globalLoginLimiter,
      secureCookies: deps.secureCookies ?? false,
    }),
  );
  app.use('/api/apps', createAppsRouter({ appService: deps.appService, planner: deps.planner, views: deps.views }));

  app.use(
    '/api',
    createSystemRouter({
      system: deps.system,
      catalog: deps.views.catalog,
      ports: deps.ports,
      usedPorts: deps.usedPorts,
    }),
  );

  if (deps.webDistDir && fs.existsSync(path.join(deps.webDistDir, 'index.html'))) {
    const indexHtml = path.join(deps.webDistDir, 'index.html');
    app.use(express.static(deps.webDistDir));
    // Client-side routes such as /apps/123 load the app shell; /api and
    // /health keep their own answers (401/404), never HTML.
    app.get(/^(?!\/api\/|\/api$|\/health$|\/catalog-icons\/).*/, (_req, res) => res.sendFile(indexHtml));
  }

  app.use(errorMiddleware);

  return app;
}
