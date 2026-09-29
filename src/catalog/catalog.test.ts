import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isPinnedImage, loadCatalog } from './catalog';

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    description: 'A demo app.',
    category: 'Media',
    icon: 'icons/demo.svg',
    image: 'demo/demo:1.2.3',
    containerPort: 80,
    defaultHostPort: 8080,
    guide: { afterInstall: [{ text: 'Open it.' }] },
    ...overrides,
  };
}

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function writeCatalog(entries: Array<Record<string, unknown>>, icons: string[] = ['demo']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-catalog-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'icons'));
  for (const icon of icons) fs.writeFileSync(path.join(dir, 'icons', `${icon}.svg`), '<svg/>');
  for (const entry of entries) fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry));
  return dir;
}

describe('isPinnedImage', () => {
  it.each([
    ['nginx:1.27.2', true],
    ['ghcr.io/home-assistant/home-assistant:2025.3.4', true],
    ['localhost:5000/app:v2', true],
    ['nginx', false],
    ['nginx:latest', false],
    ['nginx:stable', false],
    ['localhost:5000/app', false],
  ])('%s → %s', (image, expected) => {
    expect(isPinnedImage(image)).toBe(expected);
  });
});

describe('loadCatalog', () => {
  it('loads valid entries with defaults for optional fields', () => {
    const catalog = loadCatalog(writeCatalog([validEntry()]));
    const entry = catalog.get('demo');
    expect(entry).toMatchObject({ id: 'demo', env: {}, volumes: [], fixedPorts: [], generatedSecrets: [] });
    expect(catalog.entries).toHaveLength(1);
  });

  it('accepts per-OS guides with distro variants', () => {
    const guide = {
      afterInstall: [{ text: 'Open it.' }],
      server: { linux: { default: [{ text: 'Nothing to do.' }], ubuntu: [{ text: 'Run:', command: 'sudo true' }] } },
      devices: { router: [{ text: 'Set DNS to {serverAddress}.' }], ios: [{ text: 'Settings.' }] },
    };
    expect(() => loadCatalog(writeCatalog([validEntry({ guide })]))).not.toThrow();
  });

  it.each([
    ['an unpinned image', { image: 'demo/demo:latest' }],
    ['a missing description', { description: undefined }],
    ['an empty afterInstall guide', { guide: { afterInstall: [] } }],
    ['an unknown category', { category: 'Games' }],
    ['a bad volume name', { volumes: [{ name: '../x', containerPath: '/data' }] }],
    ['an unknown field', { surprise: true }],
  ])('rejects %s, naming the file', (_label, overrides) => {
    const dir = writeCatalog([validEntry(overrides)]);
    expect(() => loadCatalog(dir)).toThrow(/demo\.json/);
  });

  it('rejects an entry whose icon file is missing', () => {
    expect(() => loadCatalog(writeCatalog([validEntry()], []))).toThrow(/icon/);
  });

  it('rejects a file name that does not match the id', () => {
    const dir = writeCatalog([validEntry()]);
    fs.renameSync(path.join(dir, 'demo.json'), path.join(dir, 'other.json'));
    expect(() => loadCatalog(dir)).toThrow(/other\.json/);
  });
});
