import { Prisma, PrismaClient } from '@prisma/client';
import {
  InvalidCredentialsError,
  InvalidRecoveryCodeError,
  SetupAlreadyDoneError,
  UnauthenticatedError,
  ValidationError,
} from '../errors';
import {
  generateRecoveryCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  normalizeRecoveryCode,
  verifySecret,
} from './crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 10;
const ACCOUNT_ID = 1;

export interface IAuthService {
  status(token?: string): Promise<{ setupRequired: boolean; authenticated: boolean }>;
  setup(password: string): Promise<{ recoveryCode: string; sessionToken: string }>;
  login(password: string): Promise<{ sessionToken: string }>;
  logout(token: string): Promise<void>;
  validateSession(token: string | undefined): Promise<boolean>;
  recover(recoveryCode: string, newPassword: string): Promise<{ recoveryCode: string; sessionToken: string }>;
  changePassword(token: string, currentPassword: string, newPassword: string): Promise<void>;
  regenerateRecoveryCode(password: string): Promise<{ recoveryCode: string }>;
}

function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export class AuthService implements IAuthService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    { now = () => new Date() }: { now?: () => Date } = {},
  ) {
    this.now = now;
  }

  async status(token?: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    return { setupRequired: !account, authenticated: account ? await this.validateSession(token) : false };
  }

  async setup(password: string) {
    assertPasswordLength(password);
    // Cheap check first: the route stays public after setup, and without it
    // every call would cost two scrypt hashes. The unique-key catch below
    // still settles concurrent first-time setups.
    if (await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID }, select: { id: true } })) {
      throw new SetupAlreadyDoneError();
    }
    const recoveryCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      hashSecret(password),
      hashSecret(normalizeRecoveryCode(recoveryCode)),
    ]);
    try {
      await this.prisma.account.create({ data: { id: ACCOUNT_ID, passwordHash, recoveryCodeHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new SetupAlreadyDoneError();
      }
      throw err;
    }
    return { recoveryCode, sessionToken: await this.createSession(this.prisma) };
  }

  async login(password: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    return { sessionToken: await this.createSession(this.prisma) };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }

  async validateSession(token: string | undefined) {
    if (!token) return false;
    const id = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { id } });
    const now = this.now();
    if (!session || session.expiresAt <= now) {
      return false;
    }
    if (now.getTime() - session.lastUsedAt.getTime() >= SESSION_REFRESH_MS) {
      await this.prisma.session.updateMany({
        where: { id },
        data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      });
    }
    return true;
  }

  async recover(recoveryCode: string, newPassword: string) {
    assertPasswordLength(newPassword);
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(normalizeRecoveryCode(recoveryCode), account.recoveryCodeHash))) {
      throw new InvalidRecoveryCodeError();
    }
    const newCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      hashSecret(newPassword),
      hashSecret(normalizeRecoveryCode(newCode)),
    ]);
    // Compare-and-swap on the verified code hash: a concurrent recovery that
    // already consumed this code changed the hash, so this update matches 0 rows.
    const sessionToken = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { id: ACCOUNT_ID, recoveryCodeHash: account.recoveryCodeHash },
        data: { passwordHash, recoveryCodeHash },
      });
      if (count !== 1) {
        throw new InvalidRecoveryCodeError();
      }
      await tx.session.deleteMany();
      return this.createSession(tx);
    });
    return { recoveryCode: newCode, sessionToken };
  }

  async changePassword(token: string, currentPassword: string, newPassword: string) {
    if (!(await this.validateSession(token))) {
      throw new UnauthenticatedError();
    }
    assertPasswordLength(newPassword);
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    if (!(await verifySecret(currentPassword, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    const passwordHash = await hashSecret(newPassword);
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: ACCOUNT_ID }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { id: { not: hashToken(token) } } }),
    ]);
  }

  async regenerateRecoveryCode(password: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    const recoveryCode = generateRecoveryCode();
    await this.prisma.account.update({
      where: { id: ACCOUNT_ID },
      data: { recoveryCodeHash: await hashSecret(normalizeRecoveryCode(recoveryCode)) },
    });
    return { recoveryCode };
  }

  private async createSession(db: Pick<PrismaClient, 'session'> | Prisma.TransactionClient): Promise<string> {
    const token = generateSessionToken();
    const now = this.now();
    await db.session.create({
      data: { id: hashToken(token), createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
    });
    return token;
  }
}
