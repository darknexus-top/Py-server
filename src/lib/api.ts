let currentCsrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  currentCsrfToken = token;
}

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Record<string, string>;
  latencyMs: number;
}

export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    apiKey?: string;
  } = {}
): Promise<ApiResponse<T>> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (currentCsrfToken && method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = currentCsrfToken;
  }
  if (options.apiKey) {
    headers['X-API-Key'] = options.apiKey;
  }

  const start = performance.now();
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - start));

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    resHeaders[k] = v;
  });

  let parsed: T;
  const text = await res.text();
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    parsed = { raw: text } as T;
  }

  return {
    status: res.status,
    ok: res.ok,
    data: parsed,
    headers: resHeaders,
    latencyMs,
  };
}
