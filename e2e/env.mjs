import os from 'node:os';
import path from 'node:path';

export const E2E_DIR = path.join(os.tmpdir(), 'easyhost-e2e');
export const E2E_PORT = 3999;
export const E2E_ENV = {
  DATABASE_URL: `file:${path.join(E2E_DIR, 'e2e.db')}`,
  DATA_DIR: path.join(E2E_DIR, 'data'),
  // No daemon on purpose: the tests cover what users see when Docker is off.
  DOCKER_SOCKET_PATH: path.join(E2E_DIR, 'no-docker.sock'),
  PORT: String(E2E_PORT),
  HOST: '127.0.0.1',
};
