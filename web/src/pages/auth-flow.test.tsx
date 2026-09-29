import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';
import { safeNext } from './LoginPage';

const loggedOut = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: false } };
const loggedIn = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } };

describe('first run', () => {
  it('creates the password, shows the recovery code with a strong recommendation, and continues without a checkbox', async () => {
    const api = mockApi([
      { method: 'GET', path: '/api/auth/status', body: { setupRequired: true, authenticated: false } },
      { method: 'POST', path: '/api/auth/setup', status: 201, body: { recoveryCode: 'K7QX2-ABCDE-FGHJK-MNPQR' } },
    ]);
    const { user } = renderApp('/');

    expect(await screen.findByRole('heading', { name: /welcome to easyhost/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^password$/i), 'long enough pw');
    await user.type(screen.getByLabelText(/confirm password/i), 'long enough pw');
    api.handlers.push(loggedIn);
    await user.click(screen.getByRole('button', { name: /create password/i }));

    expect(await screen.findByText('K7QX2-ABCDE-FGHJK-MNPQR')).toBeInTheDocument();
    expect(screen.getByText(/strongly recommend/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeEnabled();
    api.handlers.push({ method: 'GET', path: '/api/apps', body: [] }, { method: 'GET', path: '/api/catalog', body: [] });
    await user.click(cont);
    expect(await screen.findByText(/you don't have any apps yet/i)).toBeInTheDocument();
  });

  it('checks the passwords match and are long enough before sending', async () => {
    const api = mockApi([{ method: 'GET', path: '/api/auth/status', body: { setupRequired: true, authenticated: false } }]);
    const { user } = renderApp('/');
    await screen.findByRole('heading', { name: /welcome/i });
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.type(screen.getByLabelText(/confirm password/i), 'short');
    await user.click(screen.getByRole('button', { name: /create password/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 10 characters/i);
    expect(api.calls.some((c) => c.path === '/api/auth/setup')).toBe(false);

    await user.clear(screen.getByLabelText(/^password$/i));
    await user.type(screen.getByLabelText(/^password$/i), 'long enough pw');
    await user.clear(screen.getByLabelText(/confirm password/i));
    await user.type(screen.getByLabelText(/confirm password/i), 'long enough pX');
    await user.click(screen.getByRole('button', { name: /create password/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/don't match/i);
    expect(api.calls.some((c) => c.path === '/api/auth/setup')).toBe(false);
  });
});

describe('login', () => {
  it('sends a deep link to login and returns there afterwards', async () => {
    const api = mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 204 }]);
    const { user } = renderApp('/settings');
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/password/i), 'long enough pw');
    api.handlers.push(loggedIn, { method: 'GET', path: '/api/system', body: { os: 'linux', distros: [], version: '0.2.0' } });
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows "Wrong password." for a wrong password', async () => {
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } } }]);
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText(/password/i), 'nope nope nope');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
  });

  it('counts down after too many attempts and re-enables the button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 429, body: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x', retryAfterSeconds: 3 } } }]);
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText(/password/i), 'nope nope nope');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    const button = await screen.findByRole('button', { name: /try again in 0:03/i });
    expect(button).toBeDisabled();
    await vi.advanceTimersByTimeAsync(3100);
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeEnabled();
  });
});

describe('forgot password', () => {
  it('resets the password with the recovery code and shows the new code', async () => {
    const api = mockApi([loggedOut, { method: 'POST', path: '/api/auth/recover', body: { recoveryCode: 'NEWCO-DENEW-CODEN-EWCOD' } }]);
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('link', { name: /forgot password/i }));
    await user.type(screen.getByLabelText(/recovery code/i), 'k7qx2 abcde fghjk mnpqr');
    await user.type(screen.getByLabelText(/^new password$/i), 'recovered password');
    await user.type(screen.getByLabelText(/confirm new password/i), 'recovered password');
    api.handlers.push(loggedIn);
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText('NEWCO-DENEW-CODEN-EWCOD')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/auth/recover')?.body).toEqual({
      recoveryCode: 'k7qx2 abcde fghjk mnpqr',
      newPassword: 'recovered password',
    });
  });

  it('shows the invalid-code message', async () => {
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/recover', status: 401, body: { error: { code: 'INVALID_RECOVERY_CODE', message: 'x' } } }]);
    const { user } = renderApp('/recover');
    await user.type(await screen.findByLabelText(/recovery code/i), 'AAAAA');
    await user.type(screen.getByLabelText(/^new password$/i), 'recovered password');
    await user.type(screen.getByLabelText(/confirm new password/i), 'recovered password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it.each([
    ['/settings', '/settings'],
    ['/apps/abc?tab=logs', '/apps/abc?tab=logs'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['settings', '/'],
  ])('%s -> %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});
