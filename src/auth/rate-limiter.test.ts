import { RateLimiter } from './rate-limiter';

function makeLimiter() {
  let now = 1_000_000;
  const limiter = new RateLimiter({ now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('allows the first five failures without delay', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('ip')).toEqual({ allowed: true });
      limiter.recordFailure('ip');
    }
    expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it('doubles the delay after each further failure and caps it at 15 minutes', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    const expected = [30, 60, 120, 240, 480, 900, 900];
    for (const seconds of expected) {
      expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: seconds });
      advance(seconds * 1000);
      expect(limiter.check('ip')).toEqual({ allowed: true });
      limiter.recordFailure('ip');
    }
  });

  it('reports the remaining seconds, rounded up', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    advance(29_500);
    expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('resets after a success', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    limiter.reset('ip');
    expect(limiter.check('ip')).toEqual({ allowed: true });
  });

  it('keeps keys independent', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.check('b')).toEqual({ allowed: true });
  });

  it('forgets entries idle for more than 24 hours', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 30 });
    // Advance 24 hours + 1 ms
    advance(24 * 60 * 60 * 1000 + 1);
    // Entry should be treated as fresh now
    expect(limiter.check('ip')).toEqual({ allowed: true });
    limiter.recordFailure('ip');
    // After one new failure, check should still allow (first 5 are free)
    expect(limiter.check('ip')).toEqual({ allowed: true });
  });

  it('evicts least-recently-failed entry when maxKeys cap is hit', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({ now: () => now, maxKeys: 2 });

    // Record 5 failures for key 'a'
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    // Record 5 failures for key 'b' (without advancing time)
    for (let i = 0; i < 5; i++) limiter.recordFailure('b');
    expect(limiter.check('b')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    // At capacity (2 keys); adding 'c' should evict 'a' (least recently failed)
    limiter.recordFailure('c');

    // 'a' should be gone (treated as fresh)
    expect(limiter.check('a')).toEqual({ allowed: true });

    // 'b' should still be tracked and blocked
    expect(limiter.check('b')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    // 'c' should have 1 failure (within free attempts)
    expect(limiter.check('c')).toEqual({ allowed: true });
  });

  it('preserves failure counts for most recent keys when evicting', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({ now: () => now, maxKeys: 2 });

    // Record 5 failures for 'a'
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');

    // Record 3 failures for 'b'
    for (let i = 0; i < 3; i++) limiter.recordFailure('b');

    // Add 'c', which evicts 'a' (oldest)
    limiter.recordFailure('c');

    // Now we have 'b' (3 failures) and 'c' (1 failure)
    // Update 'b' twice more (making it most recent with 5 failures)
    limiter.recordFailure('b');
    limiter.recordFailure('b');

    // 'c' should have 1 failure (within free attempts)
    expect(limiter.check('c')).toEqual({ allowed: true });

    // 'b' should have 5 failures (blocked at 30s retry)
    expect(limiter.check('b')).toEqual({ allowed: false, retryAfterSeconds: 30 });

    // 'a' should be gone
    expect(limiter.check('a')).toEqual({ allowed: true });
  });
});
