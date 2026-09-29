import { randomInt } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Catalog, FixedPort, Volume } from '../catalog/catalog';
import { CatalogAppNotFoundError, PortInUseError } from '../errors';
import type { IPortChecker } from '../ports/port-checker';
import type { CreateAppInput } from './app.types';

export const APP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;
export const APP_NAME_MESSAGE =
  'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (no spaces).';

export type InstallRequest =
  | { catalogId: string; name?: string; hostPort?: number }
  | { name: string; image: string; hostPort: number; containerPort?: number; env?: Record<string, string>; volumes?: Volume[] };

export interface IInstallPlanner {
  plan(request: InstallRequest): Promise<CreateAppInput>;
}

/** Host ports held by EasyHost apps: their web ports and their fixed ports. */
export async function usedHostPorts(prisma: PrismaClient): Promise<Set<number>> {
  const apps = await prisma.app.findMany({ select: { hostPort: true, fixedPorts: true } });
  return new Set(
    apps.flatMap((a) => [a.hostPort, ...(JSON.parse(a.fixedPorts) as FixedPort[]).map((f) => f.hostPort)]),
  );
}

const SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomSecret(length = 20): string {
  return Array.from({ length }, () => SECRET_ALPHABET[randomInt(SECRET_ALPHABET.length)]).join('');
}

export class InstallPlanner implements IInstallPlanner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly catalog: Catalog,
    private readonly ports: IPortChecker,
  ) {}

  async plan(request: InstallRequest): Promise<CreateAppInput> {
    if (!('catalogId' in request)) {
      await this.assertHostPortFree(request.hostPort);
      return {
        name: request.name,
        image: request.image,
        hostPort: request.hostPort,
        containerPort: request.containerPort ?? request.hostPort,
        env: request.env,
        volumes: request.volumes ?? [],
      };
    }

    const entry = this.catalog.get(request.catalogId);
    if (!entry) throw new CatalogAppNotFoundError(request.catalogId);

    const apps = await this.prisma.app.findMany({ select: { name: true, hostPort: true, fixedPorts: true } });
    const usedFixed = apps.flatMap((a) => JSON.parse(a.fixedPorts) as FixedPort[]);
    for (const fixed of entry.fixedPorts) {
      const clash = usedFixed.some((u) => u.hostPort === fixed.hostPort && u.protocol === fixed.protocol);
      if (clash || (await this.ports.check(fixed.hostPort, fixed.protocol)) === 'in-use') {
        throw new PortInUseError(fixed.hostPort, fixed.protocol);
      }
    }

    let hostPort = request.hostPort;
    if (hostPort === undefined) {
      const used = new Set([...apps.map((a) => a.hostPort), ...usedFixed.map((u) => u.hostPort)]);
      hostPort = await this.ports.suggest(entry.defaultHostPort, used);
    } else {
      await this.assertHostPortFree(hostPort);
    }

    const names = new Set(apps.map((a) => a.name));
    let name = request.name ?? entry.id;
    for (let n = 2; request.name === undefined && names.has(name); n++) name = `${entry.id}-${n}`;

    const secrets = Object.fromEntries(entry.generatedSecrets.map((s) => [s.name, randomSecret()]));
    const secretEnv = Object.fromEntries(entry.generatedSecrets.map((s) => [s.env, secrets[s.name]]));

    return {
      name,
      image: entry.image,
      hostPort,
      containerPort: entry.containerPort,
      env: { ...entry.env, ...secretEnv },
      catalogId: entry.id,
      volumes: entry.volumes,
      fixedPorts: entry.fixedPorts,
      dataOwner: entry.dataOwner,
      secrets,
    };
  }

  private async assertHostPortFree(port: number): Promise<void> {
    if ((await this.ports.check(port, 'tcp')) === 'in-use') {
      throw new PortInUseError(port, 'tcp');
    }
  }
}
