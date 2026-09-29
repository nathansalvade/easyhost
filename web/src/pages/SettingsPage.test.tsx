import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: [], version: '0.2.0' } },
];

describe('Settings', () => {
  it('shows the version', async () => {
    mockApi(base);
    renderApp('/settings');
    expect(await screen.findByText(/version 0\.2\.0/i)).toBeInTheDocument();
  });

  it('changes the password', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/auth/password', status: 204 }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/current password/i), 'old password!!');
    await user.type(screen.getByLabelText(/^new password$/i), 'new password!!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new password!!');
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/auth/password')?.body).toEqual({
      currentPassword: 'old password!!',
      newPassword: 'new password!!',
    });
  });

  it('explains a wrong current password', async () => {
    mockApi([...base, { method: 'POST', path: '/api/auth/password', status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } } }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/current password/i), 'wrong wrong!!');
    await user.type(screen.getByLabelText(/^new password$/i), 'new password!!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new password!!');
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
  });

  it('creates a new recovery code after confirming the password', async () => {
    mockApi([...base, { method: 'POST', path: '/api/auth/recovery-code', body: { recoveryCode: 'ZZZZZ-YYYYY-XXXXX-WWWWW' } }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/confirm with your password/i), 'my password!!');
    await user.click(screen.getByRole('button', { name: /new recovery code/i }));
    expect(await screen.findByText('ZZZZZ-YYYYY-XXXXX-WWWWW')).toBeInTheDocument();
  });

  it('logs out', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/auth/logout', status: 204 }]);
    const { user } = renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /log out/i }));
    api.handlers.push({ method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: false } });
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
  });
});
