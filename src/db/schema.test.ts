import { createTempDb } from '../../test/helpers/temp-db';
import type { PrismaClient } from '@prisma/client';

describe('Step 2 schema', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());

  it('stores a single account with id 1 by default', async () => {
    const account = await prisma.account.create({
      data: { passwordHash: 'p', recoveryCodeHash: 'r' },
    });
    expect(account.id).toBe(1);
    await expect(
      prisma.account.create({ data: { passwordHash: 'p2', recoveryCodeHash: 'r2' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores sessions', async () => {
    const expiresAt = new Date(Date.now() + 1000);
    const session = await prisma.session.create({ data: { id: 'hash', expiresAt } });
    expect(session.lastUsedAt).toBeInstanceOf(Date);
  });

  it('gives apps JSON defaults for volumes, fixed ports and secrets', async () => {
    const app = await prisma.app.create({
      data: { name: 'a', image: 'nginx:1.27', hostPort: 8080, containerPort: 80, status: 'PENDING' },
    });
    expect(app.volumes).toBe('[]');
    expect(app.fixedPorts).toBe('[]');
    expect(app.secrets).toBe('{}');
    expect(app.catalogId).toBeNull();
    expect(app.lastError).toBeNull();
  });
});
