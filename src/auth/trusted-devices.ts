import { createHash, randomBytes } from 'crypto';

export const DEVICE_COOKIE = 'easyhost_device';
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Browsers that logged in successfully recently. They skip the limits shared
 * with other clients (per IPv6 /64 and global), so an attacker who saturates
 * those can slow strangers down but never lock the owner out. Kept in memory:
 * after a restart, devices are trusted again on their next login. Only
 * hashes are stored, and the list is capped so it cannot grow without bound.
 */
export class TrustedDevices {
  private readonly expiresAt = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxDevices = 100,
  ) {}

  issue(): string {
    const token = randomBytes(32).toString('base64url');
    if (this.expiresAt.size >= this.maxDevices) {
      const oldest = this.expiresAt.keys().next().value as string;
      this.expiresAt.delete(oldest);
    }
    this.expiresAt.set(hash(token), this.now() + DEVICE_TTL_MS);
    return token;
  }

  has(token: string | undefined): boolean {
    if (!token) return false;
    const key = hash(token);
    const expiry = this.expiresAt.get(key);
    if (expiry === undefined) return false;
    if (expiry <= this.now()) {
      this.expiresAt.delete(key);
      return false;
    }
    return true;
  }
}
