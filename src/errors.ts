export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'APP_NOT_FOUND',
  'NAME_TAKEN',
  'PORT_TAKEN',
  'DOCKER_UNAVAILABLE',
  'DOCKER_OPERATION_FAILED',
  'CONTAINER_MISSING',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVALID_RECOVERY_CODE',
  'TOO_MANY_ATTEMPTS',
  'SETUP_ALREADY_DONE',
  'CATALOG_APP_NOT_FOUND',
  'PORT_IN_USE',
  'JSON_REQUIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  /**
   * Set only for the narrow case of a Docker container that was created (and
   * possibly started) but could not be cleaned up after a failure, so its id
   * would otherwise be lost. Never included in the response body sent to
   * clients (see `error.middleware.ts`) — it is for server-side recovery only.
   */
  public containerId?: string;
  /** Extra, client-safe fields merged into the error body. */
  public details?: Record<string, unknown>;

  constructor(message: string, status: number, code: ErrorCode) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400, 'VALIDATION_FAILED');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'App not found') {
    super(message, 404, 'APP_NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: Extract<ErrorCode, 'NAME_TAKEN' | 'PORT_TAKEN'>) {
    super(message, 409, code);
  }
}

export class DockerUnavailableError extends AppError {
  constructor(message = 'Docker daemon is unavailable') {
    super(message, 503, 'DOCKER_UNAVAILABLE');
  }
}

export class DockerOperationError extends AppError {
  constructor(message = 'Docker operation failed') {
    super(message, 502, 'DOCKER_OPERATION_FAILED');
  }
}

export class ContainerMissingError extends AppError {
  constructor(
    message = 'The container for this app no longer exists; remove the app and create it again',
  ) {
    super(message, 409, 'CONTAINER_MISSING');
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Please log in') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Wrong password') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

export class InvalidRecoveryCodeError extends AppError {
  constructor(message = 'This recovery code is not valid') {
    super(message, 401, 'INVALID_RECOVERY_CODE');
  }
}

export class TooManyAttemptsError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('Too many attempts, try again later', 429, 'TOO_MANY_ATTEMPTS');
    this.details = { retryAfterSeconds };
  }
}

export class SetupAlreadyDoneError extends AppError {
  constructor(message = 'EasyHost is already set up') {
    super(message, 409, 'SETUP_ALREADY_DONE');
  }
}

export class CatalogAppNotFoundError extends AppError {
  constructor(catalogId: string) {
    super(`No catalog app called "${catalogId}"`, 404, 'CATALOG_APP_NOT_FOUND');
  }
}

export class PortInUseError extends AppError {
  constructor(port: number, protocol: 'tcp' | 'udp') {
    super(`Port ${port} is already used by another program on the server`, 409, 'PORT_IN_USE');
    this.details = { port, protocol };
  }
}

export class JsonRequiredError extends AppError {
  constructor() {
    super('Requests must be sent as JSON', 415, 'JSON_REQUIRED');
  }
}
