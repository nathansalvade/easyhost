import { isIPv4, isIPv6 } from 'net';

/** The client's own address; IPv4-mapped IPv6 counts as the IPv4 address. */
export function clientAddress(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const address = ip.split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mapped ? mapped[1] : address.toLowerCase();
}

/**
 * The /64 an IPv6 client sits in (it can usually pick any address there), or
 * undefined for IPv4. A home LAN shares one /64, so this key is only ever
 * used to slow attempts down, never to lock anyone out.
 */
export function ipv6Prefix(address: string): string | undefined {
  if (isIPv4(address) || !isIPv6(address)) return undefined;
  const [head, tail = ''] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = address.includes('::') && tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/**
 * For keys shared by many clients (a /64, or everyone): past the free
 * failures within an hour, one attempt per 5 seconds. The wait is always a
 * few seconds, and trusted devices skip these limits entirely.
 */
export const SHARED_LIMIT: RateLimiterOptions = { baseDelayMs: 5_000, maxDelayMs: 5_000, idleWindowMs: 3_600_000 };
export const PREFIX_LIMIT: RateLimiterOptions = { ...SHARED_LIMIT, freeAttempts: 20 };
export const GLOBAL_LIMIT: RateLimiterOptions = { ...SHARED_LIMIT, freeAttempts: 50 };
export const GLOBAL_KEY = 'all';

interface Entry {
  failures: number;
  lastFailureAt: number;
}

export interface RateLimiterOptions {
  freeAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  idleWindowMs?: number;
  maxKeys?: number;
  now?: () => number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly idleWindowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor({ freeAttempts = 5, baseDelayMs = 30_000, maxDelayMs = 900_000, idleWindowMs = 86_400_000, maxKeys = 10_000, now = Date.now }: RateLimiterOptions = {}) {
    this.freeAttempts = freeAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.idleWindowMs = idleWindowMs;
    this.maxKeys = maxKeys;
    this.now = now;
  }

  private isIdle(entry: Entry): boolean {
    return this.now() - entry.lastFailureAt > this.idleWindowMs;
  }

  private sweepStale(): void {
    const now = this.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastFailureAt > this.idleWindowMs) {
        this.entries.delete(key);
      }
    }
  }

  check(key: string): RateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry || entry.failures < this.freeAttempts || this.isIdle(entry)) {
      return { allowed: true };
    }
    const delay = Math.min(this.baseDelayMs * 2 ** (entry.failures - this.freeAttempts), this.maxDelayMs);
    const remaining = entry.lastFailureAt + delay - this.now();
    if (remaining <= 0) {
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  recordFailure(key: string): void {
    const entry = this.entries.get(key);
    const isNewKey = !entry || this.isIdle(entry);

    // If adding a new key would exceed the cap, manage space
    if (isNewKey && this.entries.size >= this.maxKeys) {
      this.sweepStale();
      // If still at cap, evict least-recently-failed entry
      if (this.entries.size >= this.maxKeys) {
        const firstKey = this.entries.keys().next().value as string | undefined;
        if (firstKey) {
          this.entries.delete(firstKey);
        }
      }
    }

    // Delete then re-insert to update Map's insertion order (tracks recency)
    if (entry && !this.isIdle(entry)) {
      this.entries.delete(key);
    }
    // If entry was idle or doesn't exist, reset failures to 0; otherwise preserve and increment
    const newFailures = isNewKey ? 1 : (entry?.failures ?? 0) + 1;
    this.entries.set(key, { failures: newFailures, lastFailureAt: this.now() });
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
