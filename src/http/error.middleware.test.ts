import type { Request, Response } from 'express';
import { errorMiddleware } from './error.middleware';
import { NotFoundError, ValidationError } from '../errors';

function makeRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorMiddleware', () => {
  it('maps an AppError to its status and { error: { code, message } } body', () => {
    const res = makeRes();
    const err = new NotFoundError('App xyz not found');

    errorMiddleware(err, {} as Request, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'APP_NOT_FOUND', message: 'App xyz not found' },
    });
  });

  it('maps a ValidationError to 400 with VALIDATION_FAILED', () => {
    const res = makeRes();
    const err = new ValidationError('name is required');

    errorMiddleware(err, {} as Request, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_FAILED', message: 'name is required' },
    });
  });

  it('maps an unrecognised error to 500 with a generic message, and logs the raw error server-side', () => {
    const res = makeRes();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = new Error('some internal secret detail');

    errorMiddleware(raw, {} as Request, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('some internal secret detail');
    expect(consoleSpy).toHaveBeenCalledWith(raw);

    consoleSpy.mockRestore();
  });
});
