import { ApiError, api, setUnauthenticatedHandler } from './client';
import { mockApi } from '../test/fetch-mock';

describe('api', () => {
  it('sends JSON with the content type on POST and parses JSON back', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    await expect(api('POST', '/api/apps', { catalogId: 'jellyfin' })).resolves.toEqual({ id: 'a1' });
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/apps', body: { catalogId: 'jellyfin' } });
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends {} for POSTs without a body', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/api/apps/a1/start', body: {} }]);
    await api('POST', '/api/apps/a1/start');
    expect(calls[0].body).toEqual({});
  });

  it('returns text for text/plain and undefined for 204', async () => {
    mockApi([
      { method: 'GET', path: '/api/apps/a1/logs?tail=200', body: 'line 1\nline 2' },
      { method: 'POST', path: '/api/auth/logout', status: 204 },
    ]);
    await expect(api('GET', '/api/apps/a1/logs?tail=200')).resolves.toBe('line 1\nline 2');
    await expect(api('POST', '/api/auth/logout')).resolves.toBeUndefined();
  });

  it('throws ApiError with code, status and extra details', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/login', status: 429, body: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x', retryAfterSeconds: 30 } } }]);
    await expect(api('POST', '/api/auth/login', { password: 'p' })).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
      status: 429,
      details: { retryAfterSeconds: 30 },
    });
  });

  it('calls the unauthenticated handler on 401 UNAUTHENTICATED', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    mockApi([{ method: 'GET', path: '/api/apps', status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }]);
    await expect(api('GET', '/api/apps')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalled();
  });

  it('turns a network failure into a NETWORK error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('GET', '/api/apps')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
