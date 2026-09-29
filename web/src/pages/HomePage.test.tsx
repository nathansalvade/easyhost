import { screen, within } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const loggedIn = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } };
const health = { method: 'GET', path: '/health', body: { ok: true, docker: true } };
const catalog = {
  method: 'GET',
  path: '/api/catalog',
  body: ['jellyfin', 'nextcloud', 'home-assistant', 'pihole', 'uptime-kuma'].map((id) => ({
    id, name: id, description: `${id} app`, category: 'Media', iconUrl: `/catalog-icons/${id}.svg`, defaultHostPort: 8000, guide: { afterInstall: [] },
  })),
};

function app(overrides: Record<string, unknown>) {
  return {
    id: 'a1', name: 'jellyfin', image: 'jellyfin/jellyfin:10.10.7', status: 'RUNNING', hostPort: 8096, containerPort: 8096,
    catalogId: 'jellyfin', lastError: null, openPath: '/', fixedPorts: [], dataPath: '/data/apps/a1', volumes: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
  };
}

describe('Home', () => {
  it('shows the empty state with four suggestions', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [] }]);
    renderApp('/');
    expect(await screen.findByText(/you don't have any apps yet/i)).toBeInTheDocument();
    const suggestions = screen.getAllByRole('link', { name: /install/i });
    expect(suggestions.map((a) => a.getAttribute('href'))).toEqual([
      '/add?install=jellyfin', '/add?install=nextcloud', '/add?install=home-assistant', '/add?install=pihole',
    ]);
  });

  it('shows each app with a plain status and its address', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [
      app({}),
      app({ id: 'a2', name: 'pihole', catalogId: 'pihole', status: 'ERROR', hostPort: 8082, openPath: '/admin' }),
    ] }]);
    renderApp('/');
    const jellyfin = (await screen.findByText('jellyfin')).closest('.app-card') as HTMLElement;
    expect(within(jellyfin).getByText('Running')).toBeInTheDocument();
    expect(within(jellyfin).getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8096');
    const pihole = screen.getByText('pihole').closest('.app-card') as HTMLElement;
    expect(within(pihole).getByText('Problem')).toBeInTheDocument();
    expect(within(pihole).getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8082/admin');
  });

  it('refreshes every 5 seconds so an installing app turns into running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [app({ status: 'PENDING' })] }]);
    renderApp('/');
    expect(await screen.findByText('Installing…')).toBeInTheDocument();
    api.handlers.push({ method: 'GET', path: '/api/apps', body: [app({ status: 'RUNNING' })] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await screen.findByText('Running')).toBeInTheDocument();
  });

  it('copies the address without the clipboard API (plain HTTP)', async () => {
    document.execCommand = vi.fn().mockReturnValue(true);
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [app({})] }]);
    const { user } = renderApp('/');
    // After userEvent.setup(), which installs its own clipboard stub.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await user.click(await screen.findByRole('button', { name: /copy/i }));
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('has Home, Add and Settings in the navigation', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [] }]);
    renderApp('/');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Add', 'Settings']);
  });
});
