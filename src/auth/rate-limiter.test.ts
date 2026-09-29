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
});
