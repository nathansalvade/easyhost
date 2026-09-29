import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { ValidationError } from '../errors';
import type { Catalog } from '../catalog/catalog';
import type { IPortChecker } from '../ports/port-checker';
import type { SystemInfo } from '../system/system';

export interface SystemRouterDeps {
  system: () => SystemInfo;
  catalog: Catalog;
  ports: IPortChecker;
  usedPorts: () => Promise<Set<number>>;
}

const preferredSchema = z.coerce.number().int().min(1).max(65535);

export function createSystemRouter({ system, catalog, ports, usedPorts }: SystemRouterDeps): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system());
  });

  router.get('/catalog', (_req, res) => {
    // entry.icon is "icons/<id>.svg", served under /catalog-icons/.
    res.json(catalog.entries.map((entry) => ({ ...entry, iconUrl: `/catalog-${entry.icon}` })));
  });

  router.get('/ports/suggest', asyncHandler(async (req, res) => {
    const preferred = preferredSchema.safeParse(req.query.preferred);
    if (!preferred.success) {
      throw new ValidationError('preferred must be a port number');
    }
    res.json({ port: await ports.suggest(preferred.data, await usedPorts()) });
  }));

  return router;
}
