import type { PrismaClient } from '@prisma/client';
import { createTempDb } from '../../test/helpers/temp-db';
import { Catalog, type CatalogEntry } from '../catalog/catalog';
import type { IPortChecker, PortStatus } from '../ports/port-checker';
import { InstallPlanner } from './install-planner';

const pihole: CatalogEntry = {
  id: 'pihole',
  name: 'Pi-hole',
  description: 'Blocks ads.',
  category: 'Network',
  icon: 'icons/pihole.svg',
  image: 'pihole/pihole:2025.03.0',
  containerPort: 80,
  defaultHostPort: 8082,
  openPath: '/admin',
  env: { FTLCONF_dns_listeningMode: 'all' },
  volumes: [{ name: 'config', containerPath: '/etc/pihole' }],
  fixedPorts: [
    { containerPort: 53, hostPort: 53, protocol: 'tcp' },
    { containerPort: 53, hostPort: 53, protocol: 'udp' },
  ],
  generatedSecrets: [{ name: 'adminPassword', label: 'Admin password', env: 'FTLCONF_webserver_api_password' }],
  guide: { afterInstall: [{ text: 'Open it.' }] },
};

function fakePorts(statuses: Record<string, PortStatus> = {}): jest.Mocked<IPortChecker> {
  return {
    check: jest.fn(async (port: number, protocol: 'tcp' | 'udp') => statuses[`${port}/${protocol}`] ?? 'free'),
    suggest: jest.fn(async (preferred: number, used: Set<number>) => {
      let p = preferred;
      while (used.has(p)) p++;
      return p;
    }),
  };
}

describe('InstallPlanner', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());
  beforeEach(async () => {
    await prisma.app.deleteMany();
  });

  it('plans a catalog install with the default name, a suggested port, env and a generated secret', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts());
    const plan = await planner.plan({ catalogId: 'pihole' });
    expect(plan).toMatchObject({
      name: 'pihole',
      image: 'pihole/pihole:2025.03.0',
      hostPort: 8082,
      containerPort: 80,
      catalogId: 'pihole',
      volumes: pihole.volumes,
      fixedPorts: pihole.fixedPorts,
    });
    expect(plan.secrets!.adminPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(plan.env).toEqual({
      FTLCONF_dns_listeningMode: 'all',
      FTLCONF_webserver_api_password: plan.secrets!.adminPassword,
    });
  });

  it('adds a numeric suffix when the default name is taken and skips ports used by apps', async () => {
    await prisma.app.create({ data: { name: 'pihole', image: 'x:1', hostPort: 8082, containerPort: 80, status: 'STOPPED' } });
    const planner = new InstallPlanner(prisma, new Catalog([{ ...pihole, fixedPorts: [] }]), fakePorts());
    const plan = await planner.plan({ catalogId: 'pihole' });
    expect(plan.name).toBe('pihole-2');
    expect(plan.hostPort).toBe(8083);
  });

  it('refuses a fixed port bound on the host with PORT_IN_USE naming it', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '53/udp': 'in-use' }));
    await expect(planner.plan({ catalogId: 'pihole' })).rejects.toMatchObject({
      code: 'PORT_IN_USE',
      details: { port: 53, protocol: 'udp' },
    });
  });

  it('refuses a fixed port already used by another EasyHost app', async () => {
    await prisma.app.create({
      data: {
        name: 'other-dns', image: 'x:1', hostPort: 9000, containerPort: 80, status: 'RUNNING',
        fixedPorts: JSON.stringify([{ containerPort: 53, hostPort: 53, protocol: 'udp' }]),
      },
    });
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts());
    await expect(planner.plan({ catalogId: 'pihole' })).rejects.toMatchObject({ code: 'PORT_IN_USE' });
  });

  it('proceeds when a fixed port status is unknown (non-root below 1024)', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '53/tcp': 'unknown', '53/udp': 'unknown' }));
    await expect(planner.plan({ catalogId: 'pihole' })).resolves.toHaveProperty('name', 'pihole');
  });

  it('passes the image user from the catalog on, so data folders are handed to it', async () => {
    const entry = { ...pihole, fixedPorts: [], generatedSecrets: [], dataOwner: { uid: 1000, gid: 1000 } };
    const planner = new InstallPlanner(prisma, new Catalog([entry]), fakePorts());
    await expect(planner.plan({ catalogId: 'pihole' })).resolves.toMatchObject({ dataOwner: { uid: 1000, gid: 1000 } });
  });

  it('rejects an unknown catalog id', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([]), fakePorts());
    await expect(planner.plan({ catalogId: 'nope' })).rejects.toMatchObject({ code: 'CATALOG_APP_NOT_FOUND' });
  });

  it('refuses a chosen host port that is bound on the host', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '9999/tcp': 'in-use' }));
    await expect(planner.plan({ catalogId: 'pihole', hostPort: 9999 })).rejects.toMatchObject({
      code: 'PORT_IN_USE',
      details: { port: 9999, protocol: 'tcp' },
    });
  });

  it('passes an advanced request through, defaulting containerPort to hostPort', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([]), fakePorts());
    await expect(
      planner.plan({ name: 'custom', image: 'nginx:1.27', hostPort: 8088, env: { A: 'b' } }),
    ).resolves.toEqual({ name: 'custom', image: 'nginx:1.27', hostPort: 8088, containerPort: 8088, env: { A: 'b' }, volumes: [] });
  });
});
