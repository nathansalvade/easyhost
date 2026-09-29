import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { ValidationError } from '../errors';
import type { IAppService } from '../apps/app.service';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TAIL = 200;

const portSchema = z.number().int().positive().max(65535);

const envSchema = z.record(z.string(), z.string()).refine(
  (env) => Object.keys(env).every((key) => ENV_KEY_PATTERN.test(key)),
  { message: 'Environment variable names must match /^[A-Za-z_][A-Za-z0-9_]*$/' },
);

const createAppSchema = z.object({
  name: z.string().min(1, 'name is required'),
  image: z.string().min(1, 'image is required'),
  hostPort: portSchema,
  containerPort: portSchema.optional(),
  env: envSchema.optional(),
});

const tailQuerySchema = z.coerce.number().int().positive().optional();

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ');
}

export function createAppsRouter(appService: IAppService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const apps = await appService.list();
      res.json(apps);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const app = await appService.get(req.params.id);
      res.json(app);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = createAppSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(formatZodError(parsed.error));
      }

      const input = parsed.data;
      const app = await appService.create({
        name: input.name,
        image: input.image,
        hostPort: input.hostPort,
        containerPort: input.containerPort ?? input.hostPort,
        env: input.env,
      });
      res.status(201).json(app);
    }),
  );

  router.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      const app = await appService.start(req.params.id);
      res.json(app);
    }),
  );

  router.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      const app = await appService.stop(req.params.id);
      res.json(app);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await appService.remove(req.params.id);
      res.status(204).send();
    }),
  );

  router.get(
    '/:id/logs',
    asyncHandler(async (req, res) => {
      const parsedTail = tailQuerySchema.safeParse(req.query.tail);
      if (!parsedTail.success) {
        throw new ValidationError('tail must be a positive integer');
      }

      const tail = parsedTail.data ?? DEFAULT_TAIL;
      const logs = await appService.logs(req.params.id, { tail });
      res.type('text/plain').send(logs);
    }),
  );

  return router;
}
