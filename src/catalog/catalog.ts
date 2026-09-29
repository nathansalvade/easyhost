import * as fs from 'fs';
import * as path from 'path';
import { catalogEntrySchema, type CatalogEntry } from './catalog.schema';

export * from './catalog.schema';

export class Catalog {
  private readonly byId: Map<string, CatalogEntry>;

  constructor(readonly entries: CatalogEntry[]) {
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
  }

  get(id: string): CatalogEntry | undefined {
    return this.byId.get(id);
  }
}

export function loadCatalog(dir: string): Catalog {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  const entries = files.map((file) => {
    const fail = (reason: string): never => {
      throw new Error(`Invalid catalog entry ${file}: ${reason}`);
    };
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      fail('not valid JSON');
    }
    const parsed = catalogEntrySchema.safeParse(raw);
    if (!parsed.success) {
      fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const entry = parsed.data as CatalogEntry;
    if (`${entry.id}.json` !== file) fail(`file name must be ${entry.id}.json`);
    if (!fs.existsSync(path.join(dir, entry.icon))) fail(`icon ${entry.icon} not found`);
    return entry;
  });
  return new Catalog(entries);
}
