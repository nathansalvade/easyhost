import type { PrismaClient } from '@prisma/client';
import { createTempDb } from '../../test/helpers/temp-db';
import { AuthService, SESSION_TTL_MS } from './auth.service';
import * as crypto from './crypto';

describe('AuthService', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  let now: Date;
  let auth: AuthService;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    now = new Date('2026-09-29T10:00:00Z');
    auth = new AuthService(prisma, { now: () => now });
  });

  describe('setup', () => {
    it('reports setupRequired until an account exists', async () => {
      await expect(auth.status()).resolves.toEqual({ setupRequired: true, authenticated: false });
      const { sessionToken } = await auth.setup('long enough pw');
      await expect(auth.status(sessionToken)).resolves.toEqual({ setupRequired: false, authenticated: true });
    });

    it('returns a formatted recovery code and a working session', async () => {
      const { recoveryCode, sessionToken } = await auth.setup('long enough pw');
      expect(recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('can only run once', async () => {
      await auth.setup('long enough pw');
      await expect(auth.setup('another long pw')).rejects.toMatchObject({ code: 'SETUP_ALREADY_DONE' });
    });

    it('refuses a repeat setup without hashing, so the public route cannot be used to burn CPU', async () => {
      await auth.setup('long enough pw');
      const hash = jest.spyOn(crypto, 'hashSecret');
      try {
        await expect(auth.setup('another long pw')).rejects.toMatchObject({ code: 'SETUP_ALREADY_DONE' });
        expect(hash).not.toHaveBeenCalled();
      } finally {
        hash.mockRestore();
      }
    });

    it('lets only one of two concurrent setups succeed', async () => {
      const results = await Promise.allSettled([auth.setup('first long pw'), auth.setup('second long pw')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ code: 'SETUP_ALREADY_DONE' }),
      });
    });

    it('rejects passwords shorter than 10 characters', async () => {
      await expect(auth.setup('short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('login and sessions', () => {
    beforeEach(async () => {
      await auth.setup('long enough pw');
    });

    it('logs in with the right password', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      await expect(auth.login('nope nope nope')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects missing, unknown and expired sessions', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.validateSession(undefined)).resolves.toBe(false);
      await expect(auth.validateSession('made-up')).resolves.toBe(false);
      now = new Date(now.getTime() + SESSION_TTL_MS + 1);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(false);
    });

    it('extends a session that is used', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      now = new Date(now.getTime() + SESSION_TTL_MS - 60_000);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
      now = new Date(now.getTime() + 120_000);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('logout ends only that session', async () => {
      const a = await auth.login('long enough pw');
      const b = await auth.login('long enough pw');
      await auth.logout(a.sessionToken);
      await expect(auth.validateSession(a.sessionToken)).resolves.toBe(false);
      await expect(auth.validateSession(b.sessionToken)).resolves.toBe(true);
    });

    it('changing the password ends all other sessions', async () => {
      const current = await auth.login('long enough pw');
      const other = await auth.login('long enough pw');
      await auth.changePassword(current.sessionToken, 'long enough pw', 'brand new password');
      await expect(auth.validateSession(current.sessionToken)).resolves.toBe(true);
      await expect(auth.validateSession(other.sessionToken)).resolves.toBe(false);
      await expect(auth.login('long enough pw')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(auth.login('brand new password')).resolves.toHaveProperty('sessionToken');
    });

    it('refuses a password change with the wrong current password', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.changePassword(sessionToken, 'wrong wrong', 'brand new password')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });
  });

  describe('recovery', () => {
    let firstCode: string;

    beforeEach(async () => {
      ({ recoveryCode: firstCode } = await auth.setup('original password'));
    });

    it('rejects a wrong code without running scrypt, so a flood of attempts stays cheap', async () => {
      const hash = jest.spyOn(crypto, 'hashSecret');
      const verify = jest.spyOn(crypto, 'verifySecret');
      try {
        await expect(auth.recover('AAAAA-AAAAA-AAAAA-AAAAA', 'another password')).rejects.toMatchObject({
          code: 'INVALID_RECOVERY_CODE',
        });
        expect(hash).not.toHaveBeenCalled();
        expect(verify).not.toHaveBeenCalled();
      } finally {
        hash.mockRestore();
        verify.mockRestore();
      }
    });

    it('sets the new password, invalidates the old one and the old code, and returns a new working code', async () => {
      const result = await auth.recover(firstCode, 'recovered password');
      expect(result.recoveryCode).not.toBe(firstCode);
      await expect(auth.validateSession(result.sessionToken)).resolves.toBe(true);
      await expect(auth.login('original password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(auth.login('recovered password')).resolves.toHaveProperty('sessionToken');
      await expect(auth.recover(firstCode, 'another password')).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
      await expect(auth.recover(result.recoveryCode, 'third password!')).resolves.toHaveProperty('recoveryCode');
    });

    it('ends every existing session', async () => {
      const { sessionToken } = await auth.login('original password');
      await auth.recover(firstCode, 'recovered password');
      await expect(auth.validateSession(sessionToken)).resolves.toBe(false);
    });

    it('rejects a wrong code with the same error as a used one', async () => {
      await expect(auth.recover('AAAAA-AAAAA-AAAAA-AAAAA', 'recovered password')).rejects.toMatchObject({
        code: 'INVALID_RECOVERY_CODE',
      });
    });

    it('accepts the code typed in lowercase, without dashes, or with spaces', async () => {
      const typed = firstCode.toLowerCase().replace(/-/g, ' ');
      await expect(auth.recover(typed, 'recovered password')).resolves.toHaveProperty('sessionToken');
    });

    it('lets exactly one of two concurrent recoveries with the same code succeed', async () => {
      const results = await Promise.allSettled([
        auth.recover(firstCode, 'first new password'),
        auth.recover(firstCode, 'second new password'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ code: 'INVALID_RECOVERY_CODE' }),
      });
    });

    it('rejects a new password shorter than 10 characters without consuming the code', async () => {
      await expect(auth.recover(firstCode, 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(auth.recover(firstCode, 'long enough now')).resolves.toHaveProperty('sessionToken');
    });

    it('regenerates the recovery code after confirming the password', async () => {
      const { recoveryCode } = await auth.regenerateRecoveryCode('original password');
      await expect(auth.recover(firstCode, 'recovered password')).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
      await expect(auth.recover(recoveryCode, 'recovered password')).resolves.toHaveProperty('sessionToken');
    });

    it('refuses to regenerate with a wrong password', async () => {
      await expect(auth.regenerateRecoveryCode('wrong wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });
});
