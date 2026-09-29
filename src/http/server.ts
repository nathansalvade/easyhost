import express, { Application } from 'express';
import { asyncHandler } from './async-handler';
import { createAppsRouter } from './apps.router';
import { errorMiddleware } from './error.middleware';
import type { IAppService } from '../apps/app.service';
import type { IDockerService } from '../docker/docker.service';

export interface ServerDeps {
  appService: IAppService;
  dockerService: IDockerService;
}

export function createServer(deps: ServerDeps): Application {
  const app = express();
  app.use(express.json());

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const docker = await deps.dockerService.ping();
      res.json({ ok: true, docker });
    }),
  );

  app.use('/api/apps', createAppsRouter(deps.appService));

  app.use(errorMiddleware);

  return app;
}
