import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.middleware';
import type { IAuthService } from '../auth/auth.service';
import {
  GLOBAL_KEY,
  GLOBAL_LIMIT,
  PREFIX_LIMIT,
  RateLimiter,
  clientAddress,
  ipv6Prefix,
} from '../auth/rate-limiter';
import { DEVICE_COOKIE, DEVICE_TTL_MS, TrustedDevices } from '../auth/trusted-devices';
import { AppError, TooManyAttemptsError, ValidationError } from '../errors';

export interface AuthRouterDeps {
  auth: IAuthService;
  loginLimiter: RateLimiter;
  recoveryLimiter: RateLimiter;
  /** Failed logins from all clients together; defaults to GLOBAL_LIMIT. */
  globalLoginLimiter?: RateLimiter;
  trustedDevices?: TrustedDevices;
  secureCookies: boolean;
}

// Cap on secret length so scrypt is never run on arbitrarily large input.
const secret = z.string().min(1).max(1024);
const passwordBody = z.object({ password: secret });
const recoverBody = z.object({ recoveryCode: secret, newPassword: secret });
const changeBody = z.object({ currentPassword: secret, newPassword: secret });

interface Limits {
  /** The exact address: 5 free failures, then 30 s doubling up to 15 min. */
  client: RateLimiter;
  /** The IPv6 /64 and all clients together: slow down only (PREFIX_LIMIT, GLOBAL_LIMIT). */
  prefix?: RateLimiter;
  global?: RateLimiter;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

export function createAuthRouter({
  auth,
  loginLimiter,
  recoveryLimiter,
  globalLoginLimiter = new RateLimiter(GLOBAL_LIMIT),
  trustedDevices = new TrustedDevices(),
  secureCookies,
}: AuthRouterDeps): Router {
  const router = Router();
  const loginLimits: Limits = { client: loginLimiter, prefix: new RateLimiter(PREFIX_LIMIT), global: globalLoginLimiter };
  // No shared limits for the recovery code: at ~99 bits it cannot be guessed
  // anyway, and this keeps it the way back in for an owner whose browser is
  // not trusted while an attacker saturates the shared login limits.
  const recoveryLimits: Limits = { client: recoveryLimiter };
  const deviceCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies,
    path: '/api/auth',
    maxAge: DEVICE_TTL_MS,
  };
  /** Marks this browser as known, keeping a still-valid token unless all devices were just revoked. */
  const trustDevice = (req: Request, res: Response, { revokeOthers = false } = {}) => {
    if (revokeOthers) trustedDevices.clear();
    else if (trustedDevices.has(req.cookies?.[DEVICE_COOKIE])) return;
    res.cookie(DEVICE_COOKIE, trustedDevices.issue(), deviceCookieOptions);
  };
  const cookieOptions: CookieOptions = sessionCookieOptions(secureCookies);
  const setSession = (res: Response, token: string) => res.cookie(SESSION_COOKIE, token, cookieOptions);
  const tokenOf = (req: Request): string => req.cookies[SESSION_COOKIE];

  // One in-process queue per router: check -> verify -> recordFailure/reset runs
  // atomically with respect to other attempts, so parallel guesses cannot all
  // pass `check` while a slow scrypt verification is pending.
  let queue: Promise<unknown> = Promise.resolve();

  function limited<T>({ client, prefix, global }: Limits, req: Request, attempt: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const key = clientAddress(req.ip);
      const prefixKey = ipv6Prefix(key);
      // Shared keys, skipped by trusted devices so they can never lock the owner out.
      const shared: Array<[RateLimiter, string]> = [];
      if (!trustedDevices.has(req.cookies?.[DEVICE_COOKIE])) {
        if (prefix && prefixKey) shared.push([prefix, prefixKey]);
        if (global) shared.push([global, GLOBAL_KEY]);
      }
      for (const decision of [client.check(key), ...shared.map(([limiter, k]) => limiter.check(k))]) {
        if (!decision.allowed) {
          throw new TooManyAttemptsError(decision.retryAfterSeconds);
        }
      }
      try {
        const result = await attempt();
        // Only this client's counter: one success must not reset the shared ones.
        client.reset(key);
        return result;
      } catch (err) {
        if (err instanceof AppError && (err.code === 'INVALID_CREDENTIALS' || err.code === 'INVALID_RECOVERY_CODE')) {
          client.recordFailure(key);
          if (prefix && prefixKey) prefix.recordFailure(prefixKey);
          global?.recordFailure(GLOBAL_KEY);
        }
        throw err;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  router.get('/status', asyncHandler(async (req, res) => {
    res.json(await auth.status(req.cookies?.[SESSION_COOKIE]));
  }));

  router.post('/setup', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    const { recoveryCode, sessionToken } = await auth.setup(password);
    setSession(res, sessionToken);
    trustDevice(req, res);
    res.status(201).json({ recoveryCode });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    const { sessionToken } = await limited(loginLimits, req, () => auth.login(password));
    setSession(res, sessionToken);
    trustDevice(req, res);
    res.status(204).send();
  }));

  router.post('/recover', asyncHandler(async (req, res) => {
    const { recoveryCode, newPassword } = parse(recoverBody, req.body);
    const result = await limited(recoveryLimits, req, () => auth.recover(recoveryCode, newPassword));
    setSession(res, result.sessionToken);
    // A new password: devices that knew the old one are no longer trusted.
    trustDevice(req, res, { revokeOthers: true });
    res.json({ recoveryCode: result.recoveryCode });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    await auth.logout(tokenOf(req));
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).send();
  }));

  router.post('/password', asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changeBody, req.body);
    await limited(loginLimits, req, () => auth.changePassword(tokenOf(req), currentPassword, newPassword));
    trustDevice(req, res, { revokeOthers: true });
    res.status(204).send();
  }));

  router.post('/recovery-code', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    res.json(await limited(loginLimits, req, () => auth.regenerateRecoveryCode(password)));
  }));

  return router;
}
