interface Entry {
  failures: number;
  lastFailureAt: number;
}

export interface RateLimiterOptions {
  freeAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;

  constructor({ freeAttempts = 5, baseDelayMs = 30_000, maxDelayMs = 900_000, now = Date.now }: RateLimiterOptions = {}) {
    this.freeAttempts = freeAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.now = now;
  }

  check(key: string): RateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry || entry.failures < this.freeAttempts) {
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
    this.entries.set(key, { failures: (entry?.failures ?? 0) + 1, lastFailureAt: this.now() });
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
