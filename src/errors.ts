export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'APP_NOT_FOUND'
  | 'NAME_TAKEN'
  | 'PORT_TAKEN'
  | 'DOCKER_UNAVAILABLE'
  | 'DOCKER_OPERATION_FAILED'
  | 'CONTAINER_MISSING';

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
