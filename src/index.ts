import * as path from 'path';
import Docker from 'dockerode';
import { loadConfig } from './config';
import { getPrismaClient } from './db/client';
import { DockerService } from './docker/docker.service';
import type { DockerodeClient } from './docker/docker.types';
import { AppDataStore } from './apps/app-data';
import { AppService } from './apps/app.service';
import { InstallPlanner } from './apps/install-planner';
import { loadCatalog } from './catalog/catalog';
import { PortChecker } from './ports/port-checker';
import { AuthService } from './auth/auth.service';
import { createServer } from './http/server';

/** Loopback ranges: 127.0.0.0/8 (IPv4) and ::1 (IPv6). */
function isLoopbackAddress(address: string): boolean {
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

function main(): void {
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
  const catalog = loadCatalog(path.resolve(__dirname, '..', 'catalog'));
  const dataStore = new AppDataStore(config.dataDir);
  const appService = new AppService(prisma, dockerService, dataStore);
  const planner = new InstallPlanner(prisma, catalog, new PortChecker(config.containerBindAddress));

  const authService = new AuthService(prisma);
  const app = createServer({
    appService,
    dockerService,
    authService,
    planner,
    views: { catalog, dataStore },
    secureCookies: config.trustProxy,
    trustProxy: config.trustProxy,
  });

  app.listen(config.port, config.host, () => {
    console.log(`EasyHost is running at http://${config.host === '0.0.0.0' ? '<server-IP>' : config.host}:${config.port}`);
  });
}

main();
