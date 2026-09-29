import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Creates a throwaway SQLite database file, applies the committed Prisma
 * migrations to it, and returns a `PrismaClient` bound to it. Intended to be
 * called once per test file from `beforeAll`, with `cleanup()` called from
 * `afterAll`.
 */
export function createTempDb(): { prisma: PrismaClient; cleanup: () => Promise<void> } {
  const dbPath = path.join(os.tmpdir(), `easyhost-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const databaseUrl = `file:${dbPath}`;

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxCommand, ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  const cleanup = async (): Promise<void> => {
    await prisma.$disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const filePath = `${dbPath}${suffix}`;
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  };

  return { prisma, cleanup };
}
