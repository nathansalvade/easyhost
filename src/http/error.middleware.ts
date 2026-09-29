import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';

/**
 * The only place that formats an error response. `AppError` subclasses are
 * mapped to their declared status and code; anything else becomes a generic
 * 500 so raw internal errors never reach a client.
 */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const retryAfter = err.details?.retryAfterSeconds;
    if (typeof retryAfter === 'number') {
      res.set('Retry-After', String(retryAfter));
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
