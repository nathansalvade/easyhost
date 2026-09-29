import * as path from 'path';
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
      containerBindAddress: '0.0.0.0',
      host: '0.0.0.0',
      trustProxy: false,
      dataDir: path.resolve('./data'),
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

  it('defaults CONTAINER_BIND_ADDRESS to all interfaces (0.0.0.0) when unset', () => {
    const config = loadConfig({
      DATABASE_URL: 'file:./dev.db',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
    });

    expect(config.containerBindAddress).toBe('0.0.0.0');
  });

  it('honours an explicit CONTAINER_BIND_ADDRESS', () => {
    const config = loadConfig({
      DATABASE_URL: 'file:./dev.db',
      DOCKER_SOCKET_PATH: '/var/run/docker.sock',
      CONTAINER_BIND_ADDRESS: '127.0.0.1',
    });

    expect(config.containerBindAddress).toBe('127.0.0.1');
  });

  it('throws when CONTAINER_BIND_ADDRESS is not a valid IP address', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'file:./dev.db',
        DOCKER_SOCKET_PATH: '/var/run/docker.sock',
        CONTAINER_BIND_ADDRESS: 'not-an-ip',
      }),
    ).toThrow();
  });

  describe('Step 2 settings', () => {
    const base = { DATABASE_URL: 'file:./dev.db', DOCKER_SOCKET_PATH: '/var/run/docker.sock' };

    it('defaults HOST to 0.0.0.0, TRUST_PROXY to false and DATA_DIR to ./data resolved absolute', () => {
      const config = loadConfig({ ...base });
      expect(config.host).toBe('0.0.0.0');
      expect(config.trustProxy).toBe(false);
      expect(path.isAbsolute(config.dataDir)).toBe(true);
      expect(config.dataDir).toBe(path.resolve('./data'));
    });

    it('accepts TRUST_PROXY=true and a custom HOST', () => {
      const config = loadConfig({ ...base, TRUST_PROXY: 'true', HOST: '127.0.0.1' });
      expect(config.trustProxy).toBe(true);
      expect(config.host).toBe('127.0.0.1');
    });

    it('resolves a DATA_DIR containing spaces and accents to an absolute path', () => {
      const config = loadConfig({ ...base, DATA_DIR: './Raoul Salvadé data' });
      expect(config.dataDir).toBe(path.resolve('./Raoul Salvadé data'));
    });

    it('rejects a HOST that is not an IP address', () => {
      expect(() => loadConfig({ ...base, HOST: 'not-an-ip' })).toThrow();
    });

    it('rejects a TRUST_PROXY value other than true/false', () => {
      expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow();
    });
  });
});
