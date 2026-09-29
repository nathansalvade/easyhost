export interface ApiHandler {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
}

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export function mockApi(handlers: ApiHandler[]) {
  const calls: ApiCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let handler: ApiHandler | undefined;
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i];
      if (h.method === method && (typeof h.path === 'string' ? h.path === path : h.path.test(path))) {
        handler = h;
        break;
      }
    }
    const status = handler?.status ?? (handler ? 200 : 404);
    const body = handler ? handler.body : { error: { code: 'APP_NOT_FOUND', message: `unmocked ${method} ${path}` } };
    if (status === 204) return new Response(null, { status });
    const isText = typeof body === 'string';
    return new Response(isText ? body : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': isText ? 'text/plain' : 'application/json' },
    });
  }));
  return { calls, handlers };
}
