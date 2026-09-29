import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: ['ubuntu'], version: '0.2.0' } },
  { method: 'GET', path: '/api/catalog', body: [{ id: 'pihole', name: 'Pi-hole', description: 'd', category: 'Network', iconUrl: '/catalog-icons/pihole.svg', defaultHostPort: 8082, openPath: '/admin', guide: { afterInstall: [{ text: 'Log in with the Admin password.' }] } }] },
  { method: 'GET', path: /\/api\/apps\/a1\/logs\?tail=200/, body: 'pihole started' },
];

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1', name: 'pihole', image: 'pihole/pihole:2025.03.0', status: 'RUNNING', hostPort: 8082, containerPort: 80,
    catalogId: 'pihole', lastError: null, openPath: '/admin', fixedPorts: [], dataPath: '/data/apps/a1',
    volumes: [{ name: 'config', containerPath: '/etc/pihole', hostPath: '/data/apps/a1/config' }],
    secrets: [{ name: 'adminPassword', label: 'Admin password', value: 'S3cretValue12345678x' }],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
  };
}

describe('App page', () => {
  it('shows the address, the guide, logs and the data folder; the secret is hidden until shown', async () => {
    mockApi([...base, { method: 'GET', path: '/api/apps/a1', body: detail() }]);
    const { user } = renderApp('/apps/a1');
    expect(await screen.findByRole('heading', { name: 'pihole' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8082/admin');
    expect(screen.getByText('Log in with the Admin password.')).toBeInTheDocument();
    expect(await screen.findByText('pihole started')).toBeInTheDocument();
    expect(screen.getByText('/data/apps/a1/config')).toBeInTheDocument();
    expect(screen.queryByText('S3cretValue12345678x')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByText('S3cretValue12345678x')).toBeInTheDocument();
  });

  it('shows the problem message and lets the user try starting again', async () => {
    const api = mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail({ status: 'ERROR', lastError: 'Port 53 is already used by another program on the server.' }) },
      { method: 'POST', path: '/api/apps/a1/start', body: detail() },
    ]);
    const { user } = renderApp('/apps/a1');
    expect(await screen.findByText(/port 53 is already used/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^start$/i }));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/apps/a1/start')).toBe(true);
  });

  it('removes the app keeping its data by default', async () => {
    const api = mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail() },
      { method: 'DELETE', path: '/api/apps/a1?deleteData=false', body: { dataPath: '/data/apps/a1', dataDeleted: false } },
      { method: 'GET', path: '/api/apps', body: [] },
    ]);
    const { user } = renderApp('/apps/a1');
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    expect(screen.getByText(/your data stays in \/data\/apps\/a1/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /delete data too/i })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /remove app/i }));
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/api/apps/a1?deleteData=false')).toBe(true);
    expect(await screen.findByText(/you don't have any apps yet/i)).toBeInTheDocument();
  });

  it('deletes data when asked, and warns if the folder could not be deleted', async () => {
    mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail() },
      { method: 'DELETE', path: '/api/apps/a1?deleteData=true', body: { dataPath: '/data/apps/a1', dataDeleted: false } },
      { method: 'GET', path: '/api/apps', body: [] },
    ]);
    const { user } = renderApp('/apps/a1');
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    await user.click(screen.getByRole('checkbox', { name: /delete data too/i }));
    await user.click(screen.getByRole('button', { name: /remove app/i }));
    expect(await screen.findByText(/couldn't be deleted: \/data\/apps\/a1/i)).toBeInTheDocument();
  });

  it('explains a problem without a stored message, and shows no error for logs of an app without a container', async () => {
    mockApi([
      ...base.filter((h) => !(h.path instanceof RegExp)),
      { method: 'GET', path: '/api/apps/a1', body: detail({ status: 'ERROR', lastError: null }) },
      { method: 'GET', path: /\/api\/apps\/a1\/logs/, status: 409, body: { error: { code: 'NOT_INSTALLED', message: 'x' } } },
    ]);
    renderApp('/apps/a1');
    expect(await screen.findByText(/this app isn't working/i)).toBeInTheDocument();
    expect(await screen.findByText('No log lines yet.')).toBeInTheDocument();
    expect(screen.queryByText(/doesn't exist anymore/i)).not.toBeInTheDocument();
  });

  it('says an app that never finished installing cannot start, instead of calling it deleted', async () => {
    mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail({ status: 'ERROR', lastError: 'The app was downloaded but could not start.' }) },
      { method: 'POST', path: '/api/apps/a1/start', status: 409, body: { error: { code: 'NOT_INSTALLED', message: 'x' } } },
    ]);
    const { user } = renderApp('/apps/a1');
    await user.click(await screen.findByRole('button', { name: /^start$/i }));
    expect(await screen.findByText(/didn't finish installing/i)).toBeInTheDocument();
  });
});
