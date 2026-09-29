import { ERROR_CODES } from '../../../src/errors';
import { ApiError } from './client';
import { ERROR_MESSAGES, formatWait, messageFor } from './messages';

describe('messages', () => {
  it.each(ERROR_CODES)('has a plain-English message for %s', (code) => {
    expect(ERROR_MESSAGES[code]).toBeDefined();
  });

  it('formats waits as m:ss', () => {
    expect(formatWait(30)).toBe('0:30');
    expect(formatWait(120)).toBe('2:00');
    expect(formatWait(900)).toBe('15:00');
  });

  it('uses details in messages', () => {
    expect(messageFor(new ApiError('PORT_IN_USE', 'x', 409, { port: 53, protocol: 'udp' }))).toContain('Port 53');
    expect(messageFor(new ApiError('TOO_MANY_ATTEMPTS', 'x', 429, { retryAfterSeconds: 90 }))).toContain('1:30');
  });

  it('shows our own validation text as is', () => {
    expect(messageFor(new ApiError('VALIDATION_FAILED', 'Use letters (no spaces).', 400))).toBe('Use letters (no spaces).');
  });

  it('never shows raw text for unknown errors', () => {
    expect(messageFor(new Error('ECONNRESET at socket.js:12'))).toBe(ERROR_MESSAGES.INTERNAL_ERROR(new ApiError('INTERNAL_ERROR', '', 500)));
  });
});
