import { screen, within } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

function entry(id: string, category: string, extra: Record<string, unknown> = {}) {
  return { id, name: id.replace(/^./, (c) => c.toUpperCase()), description: `${id} description`, category, iconUrl: `/catalog-icons/${id}.svg`, defaultHostPort: 8096, guide: { afterInstall: [{ text: 'Open it.' }] }, ...extra };
}

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: ['ubuntu'], version: '0.2.0' } },
  { method: 'GET', path: '/api/catalog', body: [
    entry('jellyfin', 'Media'),
    entry('nextcloud', 'Files'),
    entry('pihole', 'Network', { guide: { afterInstall: [{ text: 'Open it.' }], server: { linux: { default: [{ text: 'Nothing.' }], ubuntu: [{ text: 'Turn off the Ubuntu DNS helper.' }] } } } }),
  ] },
  { method: 'GET', path: /\/api\/ports\/suggest\?preferred=\d+/, body: { port: 8097 } },
  { method: 'GET', path: '/api/apps', body: [] },
];

describe('Add', () => {
  it('filters by search and by category', async () => {
    mockApi(base);
    const { user } = renderApp('/add');
    await screen.findByText('Jellyfin');
    await user.type(screen.getByRole('searchbox'), 'cloud');
    expect(screen.queryByText('Jellyfin')).not.toBeInTheDocument();
    expect(screen.getByText('Nextcloud')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: 'Network' }));
    expect(screen.getByText('Pihole')).toBeInTheDocument();
    expect(screen.queryByText('Nextcloud')).not.toBeInTheDocument();
  });

  it('installs with the prefilled name and one click, then goes Home', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    const { user } = renderApp('/add');
    const card = (await screen.findByText('Jellyfin')).closest('.card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /install/i }));
    expect(screen.getByLabelText(/name/i)).toHaveValue('jellyfin');
    await user.click(screen.getByRole('button', { name: /^install jellyfin$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ catalogId: 'jellyfin', name: 'jellyfin' });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('suggests a valid name when the user types one with spaces', async () => {
    mockApi(base);
    const { user } = renderApp('/add?install=jellyfin');
    const name = await screen.findByLabelText(/name/i);
    await user.clear(name);
    await user.type(name, 'My Movies');
    expect(screen.getByText(/no spaces/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install jellyfin$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /use my-movies/i }));
    expect(name).toHaveValue('my-movies');
    expect(screen.getByRole('button', { name: /^install jellyfin$/i })).toBeEnabled();
  });

  it('sends the port only when changed in Advanced', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    const { user } = renderApp('/add?install=jellyfin');
    await user.click(await screen.findByText(/advanced/i));
    const port = screen.getByLabelText(/port/i);
    expect(port).toHaveValue(8097);
    await user.clear(port);
    await user.type(port, '9000');
    await user.click(screen.getByRole('button', { name: /^install jellyfin$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ catalogId: 'jellyfin', name: 'jellyfin', hostPort: 9000 });
  });

  it('opens Pi-hole with "Before you install" steps for the server and shows port errors plainly', async () => {
    mockApi([...base, { method: 'POST', path: '/api/apps', status: 409, body: { error: { code: 'PORT_IN_USE', message: 'x', port: 53, protocol: 'udp' } } }]);
    const { user } = renderApp('/add?install=pihole');
    expect(await screen.findByText(/before you install/i)).toBeInTheDocument();
    expect(screen.getByText('Turn off the Ubuntu DNS helper.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^install pihole$/i }));
    expect(await screen.findByText(/port 53 is already used/i)).toBeInTheDocument();
  });

  it('installs a custom image through the advanced form', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a9' } }]);
    const { user } = renderApp('/add');
    await user.click(await screen.findByRole('button', { name: /install a custom image/i }));
    await user.type(screen.getByLabelText(/^app name$/i), 'whoami');
    await user.type(screen.getByLabelText(/^image$/i), 'traefik/whoami:v1.10');
    await user.clear(screen.getByLabelText(/port on the server/i));
    await user.type(screen.getByLabelText(/port on the server/i), '8095');
    await user.type(screen.getByLabelText(/port inside the app/i), '80');
    await user.click(screen.getByRole('button', { name: /add setting/i }));
    await user.type(screen.getByLabelText(/setting 1 name/i), 'TZ');
    await user.type(screen.getByLabelText(/setting 1 value/i), 'Europe/Rome');
    await user.click(screen.getByRole('button', { name: /add folder/i }));
    await user.type(screen.getByLabelText(/folder 1/i), '/app/data');
    await user.click(screen.getByRole('button', { name: /^install image$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'whoami',
      image: 'traefik/whoami:v1.10',
      hostPort: 8095,
      containerPort: 80,
      env: { TZ: 'Europe/Rome' },
      volumes: [{ name: 'app-data', containerPath: '/app/data' }],
    });
  });

  it('explains a folder path that does not start with /', async () => {
    const api = mockApi(base);
    const { user } = renderApp('/add');
    await user.click(await screen.findByRole('button', { name: /install a custom image/i }));
    await user.type(screen.getByLabelText(/^app name$/i), 'whoami');
    await user.type(screen.getByLabelText(/^image$/i), 'traefik/whoami:v1.10');
    await user.click(screen.getByRole('button', { name: /add folder/i }));
    await user.type(screen.getByLabelText(/folder 1/i), 'data');
    await user.click(screen.getByRole('button', { name: /^install image$/i }));
    expect(screen.getByText(/start with \//i)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    await user.type(screen.getByLabelText(/folder 1/i), 'x');
    expect(screen.queryByText(/start with \//i)).not.toBeInTheDocument();
  });

  it('prefills a name no installed app uses yet', async () => {
    mockApi([...base, { method: 'GET', path: '/api/apps', body: [{ name: 'jellyfin' }, { name: 'jellyfin-2' }] }]);
    renderApp('/add?install=jellyfin');
    expect(await screen.findByDisplayValue('jellyfin-3')).toBeInTheDocument();
  });
});
