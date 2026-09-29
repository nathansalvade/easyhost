import type { Request, Response } from 'express';
import { errorMiddleware } from './error.middleware';
import { ERROR_CODES, NotFoundError, PortInUseError, TooManyAttemptsError, ValidationError } from '../errors';

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

function mockRes() {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorMiddleware details', () => {
  it('adds details to the body and a Retry-After header for TOO_MANY_ATTEMPTS', () => {
    const res = mockRes();
    errorMiddleware(new TooManyAttemptsError(42), {} as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '42');
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'TOO_MANY_ATTEMPTS', message: expect.any(String), retryAfterSeconds: 42 },
    });
  });

  it('adds port and protocol for PORT_IN_USE', () => {
    const res = mockRes();
    errorMiddleware(new PortInUseError(53, 'udp'), {} as never, res as never, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'PORT_IN_USE', message: expect.any(String), port: 53, protocol: 'udp' },
    });
  });

  it('never serializes containerId', () => {
    const res = mockRes();
    const err = new PortInUseError(80, 'tcp');
    err.containerId = 'secret-id';
    errorMiddleware(err, {} as never, res as never, jest.fn());
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret-id');
  });

  it('exports every error code', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining(['UNAUTHENTICATED', 'PORT_IN_USE', 'CONTAINER_MISSING', 'JSON_REQUIRED']),
    );
  });
});
