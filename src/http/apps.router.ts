import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { ValidationError } from '../errors';
import type { IAppService } from '../apps/app.service';
import { APP_NAME_MESSAGE, APP_NAME_PATTERN, type IInstallPlanner } from '../apps/install-planner';
import { toAppDetailView, toAppView, type ViewContext } from '../apps/app.view';
import { volumeSchema } from '../catalog/catalog.schema';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TAIL = 200;

const portSchema = z.number().int().positive().max(65535);
const nameSchema = z.string().regex(APP_NAME_PATTERN, APP_NAME_MESSAGE);
const envSchema = z.record(z.string(), z.string()).refine(
  (env) => Object.keys(env).every((key) => ENV_KEY_PATTERN.test(key)),
  { message: 'Environment variable names must match /^[A-Za-z_][A-Za-z0-9_]*$/' },
);

const catalogInstallSchema = z
  .object({ catalogId: z.string().min(1), name: nameSchema.optional(), hostPort: portSchema.optional() })
  .strict();

const advancedInstallSchema = z
  .object({
    name: nameSchema,
    image: z.string().min(1, 'image is required'),
    hostPort: portSchema,
    containerPort: portSchema.optional(),
    env: envSchema.optional(),
    volumes: z.array(volumeSchema).optional(),
  })
  .strict();

const tailQuerySchema = z.coerce.number().int().positive().optional();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

export interface AppsRouterDeps {
  appService: IAppService;
  planner: IInstallPlanner;
  views: ViewContext;
}

export function createAppsRouter({ appService, planner, views }: AppsRouterDeps): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json((await appService.list()).map((app) => toAppView(app, views)));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(toAppDetailView(await appService.get(req.params.id), views));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const request =
      body && typeof body === 'object' && 'catalogId' in body
        ? parse(catalogInstallSchema, body)
        : parse(advancedInstallSchema, body);
    const app = await appService.create(await planner.plan(request));
    // Secrets are only returned by GET /api/apps/:id (spec).
    res.status(202).json(toAppView(app, views));
  }));

  router.post('/:id/start', asyncHandler(async (req, res) => {
    res.json(toAppView(await appService.start(req.params.id), views));
  }));

  router.post('/:id/stop', asyncHandler(async (req, res) => {
    res.json(toAppView(await appService.stop(req.params.id), views));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await appService.remove(req.params.id, { deleteData: req.query.deleteData === 'true' }));
  }));

  router.get('/:id/logs', asyncHandler(async (req, res) => {
    const parsedTail = tailQuerySchema.safeParse(req.query.tail);
    if (!parsedTail.success) {
      throw new ValidationError('tail must be a positive integer');
    }
    const logs = await appService.logs(req.params.id, { tail: parsedTail.data ?? DEFAULT_TAIL });
    res.type('text/plain').send(logs);
  }));

  return router;
}
