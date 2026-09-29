export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onUnauthenticated: () => void = () => {};

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('NETWORK', "Can't reach EasyHost", 0);
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('Content-Type')?.includes('application/json');
  const data: unknown = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const { code = 'INTERNAL_ERROR', message = '', ...details } =
      (data as { error?: Record<string, unknown> } | undefined)?.error ?? {};
    if (res.status === 401 && code === 'UNAUTHENTICATED') onUnauthenticated();
    throw new ApiError(String(code), String(message), res.status, details);
  }
  return data as T;
}
