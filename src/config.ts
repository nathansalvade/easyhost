import { z } from 'zod';

const configSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DOCKER_SOCKET_PATH: z.string().min(1).optional(),
    DOCKER_HOST: z.string().min(1).optional(),
    LOG_TAIL_MAX: z.coerce.number().int().positive().default(1000),
    // Operator-level only: the HTTP API has no auth, so this must never be
    // settable through it. Defaults to all interfaces so deployed apps are
    // reachable from the home network (e.g. http://<server-LAN-IP>:<hostPort>);
    // set to 127.0.0.1 to restrict them to this machine only.
    CONTAINER_BIND_ADDRESS: z.string().ip().default('0.0.0.0'),
  })
  .refine((val) => Boolean(val.DOCKER_SOCKET_PATH) || Boolean(val.DOCKER_HOST), {
    message: 'Either DOCKER_SOCKET_PATH or DOCKER_HOST must be set',
    path: ['DOCKER_SOCKET_PATH'],
  });

export interface Config {
  port: number;
  databaseUrl: string;
  dockerSocketPath?: string;
  dockerHost?: string;
  logTailMax: number;
  containerBindAddress: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.parse({
    PORT: env.PORT,
    DATABASE_URL: env.DATABASE_URL,
    DOCKER_SOCKET_PATH: env.DOCKER_SOCKET_PATH,
    DOCKER_HOST: env.DOCKER_HOST,
    LOG_TAIL_MAX: env.LOG_TAIL_MAX,
    CONTAINER_BIND_ADDRESS: env.CONTAINER_BIND_ADDRESS,
  });

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    dockerSocketPath: parsed.DOCKER_SOCKET_PATH,
    dockerHost: parsed.DOCKER_HOST,
    logTailMax: parsed.LOG_TAIL_MAX,
    containerBindAddress: parsed.CONTAINER_BIND_ADDRESS,
  };
}
