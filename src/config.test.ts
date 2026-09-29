import { loadConfig } from './config';

describe('loadConfig', () => {
  it('parses valid env vars, applying PORT and LOG_TAIL_MAX defaults', () => {
    const config = loadConfig({
      DATABASE_URL: 'file:./dev.db',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
    });

    expect(config).toEqual({
      port: 3000,
      databaseUrl: 'file:./dev.db',
      dockerSocketPath: '/var/run/docker.sock',
      dockerHost: undefined,
      logTailMax: 1000,
    });
  });

  it('honours an explicit PORT and LOG_TAIL_MAX', () => {
    const config = loadConfig({
      PORT: '4000',
      DATABASE_URL: 'file:./dev.db',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
      LOG_TAIL_MAX: '500',
    });

    expect(config.port).toBe(4000);
    expect(config.logTailMax).toBe(500);
  });

  it('accepts DOCKER_HOST in place of DOCKER_SOCKET_PATH', () => {
    const config = loadConfig({
      DATABASE_URL: 'file:./dev.db',
      DOCKER_HOST: 'tcp://localhost:2375',
    });

    expect(config.dockerHost).toBe('tcp://localhost:2375');
    expect(config.dockerSocketPath).toBeUndefined();
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      loadConfig({ DOCKER_SOCKET_PATH: '/var/run/docker.sock' }),
    ).toThrow();
  });

  it('throws when neither DOCKER_SOCKET_PATH nor DOCKER_HOST is set', () => {
    expect(() => loadConfig({ DATABASE_URL: 'file:./dev.db' })).toThrow();
  });
});
