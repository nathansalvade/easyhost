import type { IAuthService } from '../../src/auth/auth.service';

export const AUTH_COOKIE = 'easyhost_session=test-token';

export function makeAuthServiceMock(authenticated = true): jest.Mocked<IAuthService> {
  return {
    status: jest.fn().mockResolvedValue({ setupRequired: false, authenticated }),
    setup: jest.fn(),
    login: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    validateSession: jest.fn(async (token: string | undefined) => authenticated && token === 'test-token'),
    recover: jest.fn(),
    changePassword: jest.fn().mockResolvedValue(undefined),
    regenerateRecoveryCode: jest.fn(),
  };
}
