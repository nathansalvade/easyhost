import type { ErrorCode } from '../../../src/errors';
import { ApiError } from './client';

type Message = (err: ApiError) => string;

export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fixed = (text: string): Message => () => text;

export const ERROR_MESSAGES: Record<ErrorCode | 'NETWORK' | 'INTERNAL_ERROR', Message> = {
  VALIDATION_FAILED: (e) => e.message || 'Some details are not valid.',
  APP_NOT_FOUND: fixed("This app doesn't exist anymore. It may have been removed."),
  NAME_TAKEN: fixed('Another app already uses this name. Pick a different one.'),
  PORT_TAKEN: fixed('Another app already uses this port. Pick a different one in Advanced.'),
  DOCKER_UNAVAILABLE: fixed("Docker isn't running on the server, so apps can't start."),
  DOCKER_OPERATION_FAILED: fixed("The server couldn't complete this action. Try again in a moment."),
  CONTAINER_MISSING: fixed("This app was removed from the server outside EasyHost. Remove it here and install it again."),
  UNAUTHENTICATED: fixed('Please log in again.'),
  INVALID_CREDENTIALS: fixed('Wrong password.'),
  INVALID_RECOVERY_CODE: fixed("This recovery code isn't valid. Check it and try again."),
  TOO_MANY_ATTEMPTS: (e) => `Too many attempts. Try again in ${formatWait(Number(e.details.retryAfterSeconds ?? 0))}.`,
  SETUP_ALREADY_DONE: fixed('EasyHost is already set up. Log in instead.'),
  CATALOG_APP_NOT_FOUND: fixed('This app is no longer in the catalog.'),
  PORT_IN_USE: (e) =>
    `Port ${String(e.details.port)} is already used by another program on the server. Pick another port in Advanced, or see the app's guide.`,
  NOT_INSTALLED: fixed("This app didn't finish installing. Remove it and install it again."),
  JSON_REQUIRED: fixed('Something went wrong sending the request. Reload the page and try again.'),
  NETWORK: fixed("Can't reach EasyHost. Check that the server is on."),
  INTERNAL_ERROR: fixed('Something went wrong on the server. Try again in a moment.'),
};

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const message = ERROR_MESSAGES[err.code as keyof typeof ERROR_MESSAGES] ?? ERROR_MESSAGES.INTERNAL_ERROR;
    return message(err);
  }
  return ERROR_MESSAGES.INTERNAL_ERROR(new ApiError('INTERNAL_ERROR', '', 500));
}
