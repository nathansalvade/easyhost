import type { CookieOptions, RequestHandler } from 'express';
import { SESSION_TTL_MS, type IAuthService } from '../auth/auth.service';
import { JsonRequiredError, UnauthenticatedError } from '../errors';

export const SESSION_COOKIE = 'easyhost_session';

const PUBLIC_ROUTES = new Set([
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/recover',
]);

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export const requireJson: RequestHandler = (req, _res, next) => {
  if (BODY_METHODS.has(req.method) && !req.is('application/json')) {
    next(new JsonRequiredError());
    return;
  }
  next();
};

/**
 * The server extends a session on use; the cookie is re-issued on every
 * authenticated request so the browser's copy is extended too (otherwise it
 * would expire 30 days after login even for someone using EasyHost daily).
 */
export function requireSession(auth: IAuthService, cookieOptions: CookieOptions): RequestHandler {
  return (req, res, next) => {
    if (PUBLIC_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`)) {
      next();
      return;
    }
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    auth
      .validateSession(token)
      .then((ok) => {
        if (!ok) return next(new UnauthenticatedError());
        res.cookie(SESSION_COOKIE, token!, cookieOptions);
        next();
      })
      .catch(next);
  };
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: SESSION_TTL_MS };
}
