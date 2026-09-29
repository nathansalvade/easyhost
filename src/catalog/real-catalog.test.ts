import * as path from 'path';
import { loadCatalog } from './catalog';

const catalog = loadCatalog(path.resolve(__dirname, '..', '..', 'catalog'));

describe('shipped catalog', () => {
  it('contains the seven launch apps', () => {
    expect(catalog.entries.map((e) => e.id).sort()).toEqual(
      ['audiobookshelf', 'filebrowser', 'home-assistant', 'jellyfin', 'nextcloud', 'pihole', 'uptime-kuma'],
    );
  });

  it('gives every app a description and an after-install guide', () => {
    for (const entry of catalog.entries) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.guide.afterInstall.length).toBeGreaterThan(0);
    }
  });

  it('uses distinct default host ports', () => {
    const ports = catalog.entries.map((e) => e.defaultHostPort);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('hands File Browser its data folders, since the image runs as user 1000', () => {
    expect(catalog.get('filebrowser')!.dataOwner).toEqual({ uid: 1000, gid: 1000 });
  });

  it('configures Pi-hole as DNS-only with port 53, a generated password and OS guides', () => {
    const pihole = catalog.get('pihole')!;
    expect(pihole.fixedPorts).toEqual([
      { containerPort: 53, hostPort: 53, protocol: 'tcp' },
      { containerPort: 53, hostPort: 53, protocol: 'udp' },
    ]);
    expect(pihole.generatedSecrets).toEqual([
      { name: 'adminPassword', label: 'Admin password', env: 'FTLCONF_webserver_api_password' },
    ]);
    expect(Object.keys(pihole.guide.server!.linux!)).toEqual(expect.arrayContaining(['default', 'ubuntu', 'fedora']));
    expect(pihole.guide.server!.windows).toBeDefined();
    expect(pihole.guide.server!.macos).toBeDefined();
    expect(Object.keys(pihole.guide.devices!)).toEqual(['router', 'windows', 'macos', 'linux', 'android', 'ios']);
  });
});
