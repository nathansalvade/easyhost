import Docker from 'dockerode';
import { loadConfig } from './config';
import { getPrismaClient } from './db/client';
import { DockerService } from './docker/docker.service';
import type { DockerodeClient } from './docker/docker.types';
import { AppService } from './apps/app.service';
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
  const appService = new AppService(prisma, dockerService);

  const app = createServer({ appService, dockerService });

  // The server only ever binds to localhost: this step ships with no
  // authentication, so it must not be reachable from outside the host.
  app.listen(config.port, '127.0.0.1', () => {
    console.log(`EasyHost backend listening on http://127.0.0.1:${config.port}`);
  });
}

main();
