import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/**
 * Production singleton. Test suites build their own `PrismaClient` pointed
 * at a temporary SQLite database instead of using this module.
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
