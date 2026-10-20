export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: any;
  public readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: any, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('opsflow_token') : null;

  const headers: Record<string, string> = {
    'X-Request-Id': crypto.randomUUID(),
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const url = path.startsWith('/api') ? path : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;

  const execute = async (): Promise<T> => {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: options.signal,
    });

    const requestId = res.headers.get('x-request-id') || undefined;

    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('opsflow_token');
        window.dispatchEvent(new CustomEvent('opsflow:unauthorized'));
      }
    }

    if (!res.ok) {
      let errorBody: any;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { error: { code: 'internal', message: res.statusText } };
      }

      const err = errorBody?.error || {};
      throw new ApiError(
        res.status,
        err.code || 'error',
        err.message || 'Request failed',
        err.details,
        err.request_id || requestId
      );
    }

    if (res.status === 204) {
      return undefined as any;
    }

    return await res.json();
  };

  // Automatic retry ONLY for GET on network error or 5xx
  if (method === 'GET') {
    let attempts = 0;
    while (attempts < 3) {
      try {
        return await execute();
      } catch (err: any) {
        attempts++;
        if (attempts >= 3 || (err instanceof ApiError && err.status < 500)) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempts) * 100));
      }
    }
  }

  return await execute();
}
