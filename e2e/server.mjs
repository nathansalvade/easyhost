// Starts the built EasyHost the way a user would, on a fresh database and
// data folder, with no Docker daemon reachable. Used by playwright.config.ts.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { E2E_DIR, E2E_ENV } from './env.mjs';

rmSync(E2E_DIR, { recursive: true, force: true });
mkdirSync(E2E_DIR, { recursive: true });
const env = { ...process.env, ...E2E_ENV };
execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
const server = spawn(process.execPath, ['dist/index.js'], { env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
