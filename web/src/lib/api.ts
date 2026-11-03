/** An error from the API, with its stable code and any per-field messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fields?: Record<string, string>; checks?: unknown[]; [k: string]: unknown },
  ) {
    super(message);
  }
  field(name: string) {
    return this.details?.fields?.[name];
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('session-ended'));
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Please try again.', data.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: Body) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
