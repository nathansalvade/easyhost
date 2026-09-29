import * as os from 'os';
import * as path from 'path';
import { Catalog } from '../../src/catalog/catalog';
import { AppDataStore } from '../../src/apps/app-data';
import type { ViewContext } from '../../src/apps/app.view';

/** Views only compute data paths, so the data dir is never created on disk. */
export function makeViewContext(catalog = new Catalog([])): ViewContext {
  return { catalog, dataStore: new AppDataStore(path.join(os.tmpdir(), 'easyhost-views-unused')) };
}

/** The server deps added for system, catalog and port routes, with harmless defaults. */
export function makeSystemDeps() {
  return {
    system: () => ({ os: 'linux' as const, distros: [], version: '0.0.0' }),
    ports: { check: jest.fn(), suggest: jest.fn() },
    usedPorts: async () => new Set<number>(),
    catalogDir: path.resolve(__dirname, '..', '..', 'catalog'),
  };
}
