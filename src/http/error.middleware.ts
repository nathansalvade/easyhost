import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';

/**
 * The only place that formats an error response. `AppError` subclasses are
 * mapped to their declared status and code; anything else becomes a generic
 * 500 so raw internal errors never reach a client.
 */
/** Errors raised by express.json() before a route runs; their `body` is the raw request text. */
const BODY_PARSER_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': { status: 400, code: 'VALIDATION_FAILED', message: 'The request body is not valid JSON' },
  'entity.too.large': { status: 413, code: 'VALIDATION_FAILED', message: 'The request is too large' },
  'charset.unsupported': { status: 415, code: 'JSON_REQUIRED', message: 'Requests must be sent as UTF-8 JSON' },
  'encoding.unsupported': { status: 415, code: 'JSON_REQUIRED', message: 'Requests must be sent as UTF-8 JSON' },
};

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const bodyError = BODY_PARSER_ERRORS[(err as { type?: string } | null)?.type ?? ''];
  if (bodyError) {
    // Not logged: the raw body may hold a password or recovery code.
    res.status(bodyError.status).json({ error: { code: bodyError.code, message: bodyError.message } });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      // Keeps the daemon's own text (err.cause) in the server log.
      console.error(err);
    }
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
