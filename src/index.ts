import * as path from 'path';
import Docker from 'dockerode';
import { loadConfig } from './config';
import { getPrismaClient } from './db/client';
import { DockerService } from './docker/docker.service';
import type { DockerodeClient } from './docker/docker.types';
import { AppDataStore } from './apps/app-data';
import { AppService } from './apps/app.service';
import { InstallPlanner, usedHostPorts } from './apps/install-planner';
import { loadCatalog } from './catalog/catalog';
import { PortChecker } from './ports/port-checker';
import { AuthService } from './auth/auth.service';
import { createServer } from './http/server';
import { detectSystem } from './system/system';

/** Loopback ranges: 127.0.0.0/8 (IPv4) and ::1 (IPv6). */
function isLoopbackAddress(address: string): boolean {
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(
    isLoopbackAddress(config.containerBindAddress)
      ? `Deployed apps are published on ${config.containerBindAddress}: reachable only from this machine.`
      : `Deployed apps are published on ${config.containerBindAddress}: reachable from the local network at http://<server-LAN-IP>:<hostPort>.`,
  );

  const docker = config.dockerHost
    ? new Docker({ host: config.dockerHost })
    : new Docker({ socketPath: config.dockerSocketPath });

  // The real `dockerode` client is structurally close to, but not identical
  // to, the minimal `DockerodeClient` slice this project depends on (its
  // methods have overloads with more parameters). The cast is safe: every
  // method DockerService calls exists on the real client with a compatible
  // no-callback, Promise-returning overload.
  const dockerService = new DockerService(docker as unknown as DockerodeClient, {
    maxTail: config.logTailMax,
    bindAddress: config.containerBindAddress,
  });
  const prisma = getPrismaClient();
  const catalogDir = path.resolve(__dirname, '..', 'catalog');
  const catalog = loadCatalog(catalogDir);
  const dataStore = new AppDataStore(config.dataDir);
  const ports = new PortChecker(config.containerBindAddress);
  const appService = new AppService(prisma, dockerService, dataStore);
  const recovered = await appService.recoverInterruptedInstalls();
  if (recovered > 0) console.log(`Marked ${recovered} interrupted installation(s) as failed.`);

  const app = createServer({
    appService,
    dockerService,
    authService: new AuthService(prisma),
    planner: new InstallPlanner(prisma, catalog, ports),
    views: { catalog, dataStore },
    system: () => detectSystem(),
    ports,
    usedPorts: () => usedHostPorts(prisma),
    catalogDir,
    // Resolves to the repo root both from src/ (ts-node) and dist/ (built).
    webDistDir: path.resolve(__dirname, '..', 'web', 'dist'),
    secureCookies: config.trustProxy,
    trustProxy: config.trustProxy,
  });

  app.listen(config.port, config.host, () => {
    console.log(`EasyHost is running at http://${config.host === '0.0.0.0' ? '<server-IP>' : config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
