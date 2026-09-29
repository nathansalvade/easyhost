import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.middleware';
import type { IAuthService } from '../auth/auth.service';
import type { RateLimiter } from '../auth/rate-limiter';
import { AppError, TooManyAttemptsError, ValidationError } from '../errors';

export interface AuthRouterDeps {
  auth: IAuthService;
  loginLimiter: RateLimiter;
  recoveryLimiter: RateLimiter;
  secureCookies: boolean;
}

// Cap on secret length so scrypt is never run on arbitrarily large input.
const secret = z.string().min(1).max(1024);
const passwordBody = z.object({ password: secret });
const recoverBody = z.object({ recoveryCode: secret, newPassword: secret });
const changeBody = z.object({ currentPassword: secret, newPassword: secret });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

export function createAuthRouter({ auth, loginLimiter, recoveryLimiter, secureCookies }: AuthRouterDeps): Router {
  const router = Router();
  const cookieOptions: CookieOptions = sessionCookieOptions(secureCookies);
  const setSession = (res: Response, token: string) => res.cookie(SESSION_COOKIE, token, cookieOptions);
  const tokenOf = (req: Request): string => req.cookies[SESSION_COOKIE];

  // One in-process queue per router: check -> verify -> recordFailure/reset runs
  // atomically with respect to other attempts, so parallel guesses cannot all
  // pass `check` while a slow scrypt verification is pending.
  let queue: Promise<unknown> = Promise.resolve();

  function limited<T>(limiter: RateLimiter, req: Request, attempt: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const key = req.ip ?? 'unknown';
      const decision = limiter.check(key);
      if (!decision.allowed) {
        throw new TooManyAttemptsError(decision.retryAfterSeconds);
      }
      try {
        const result = await attempt();
        limiter.reset(key);
        return result;
      } catch (err) {
        if (err instanceof AppError && (err.code === 'INVALID_CREDENTIALS' || err.code === 'INVALID_RECOVERY_CODE')) {
          limiter.recordFailure(key);
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
    res.status(201).json({ recoveryCode });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    const { sessionToken } = await limited(loginLimiter, req, () => auth.login(password));
    setSession(res, sessionToken);
    res.status(204).send();
  }));

  router.post('/recover', asyncHandler(async (req, res) => {
    const { recoveryCode, newPassword } = parse(recoverBody, req.body);
    const result = await limited(recoveryLimiter, req, () => auth.recover(recoveryCode, newPassword));
    setSession(res, result.sessionToken);
    res.json({ recoveryCode: result.recoveryCode });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    await auth.logout(tokenOf(req));
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).send();
  }));

  router.post('/password', asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changeBody, req.body);
    await limited(loginLimiter, req, () => auth.changePassword(tokenOf(req), currentPassword, newPassword));
    res.status(204).send();
  }));

  router.post('/recovery-code', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    res.json(await limited(loginLimiter, req, () => auth.regenerateRecoveryCode(password)));
  }));

  return router;
}
