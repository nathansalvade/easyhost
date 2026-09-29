import * as os from 'os';
import * as path from 'path';
import { Catalog } from '../../src/catalog/catalog';
import { AppDataStore } from '../../src/apps/app-data';
import type { ViewContext } from '../../src/apps/app.view';

/** Views only compute data paths, so the data dir is never created on disk. */
export function makeViewContext(catalog = new Catalog([])): ViewContext {
  return { catalog, dataStore: new AppDataStore(path.join(os.tmpdir(), 'easyhost-views-unused')) };
}
