const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Retry + timeout internals
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1000, 2000, 4000] as const;

/**
 * Fetch with retry (exponential back-off) and a per-attempt timeout.
 *
 * Retries on:
 *   - Network / abort errors
 *   - HTTP 5xx
 *   - HTTP 429 (rate-limit)
 *
 * Does NOT retry on HTTP 4xx (except 429) — those are client errors that
 * won't be fixed by retrying.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  maxRetries: number
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response | null = null;

    try {
      res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
    }

    if (res) {
      // 2xx/3xx → success; 4xx (non-429) → client error, surface immediately
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }
      // 5xx or 429 on the last attempt — surface the response as-is
      if (attempt >= maxRetries) {
        return res;
      }
    } else if (attempt >= maxRetries) {
      // Last attempt was a network error
      break;
    }

    // Wait before next attempt
    const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError('Request failed after retries');
}

// ---------------------------------------------------------------------------
// Public API client
// ---------------------------------------------------------------------------

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const existingHeaders =
    fetchOptions.headers instanceof Headers
      ? Object.fromEntries(fetchOptions.headers.entries())
      : ((fetchOptions.headers as Record<string, string> | undefined) ?? {});

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...existingHeaders,
  };

  const res = await fetchWithRetry(
    `${API_URL}${path}`,
    { ...fetchOptions, headers },
    /* timeoutMs */ 15000,
    /* maxRetries */ 3
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' })) as {
      message?: string;
      code?: string;
    };
    throw new ApiError(
      error.message || `API error: ${res.status}`,
      res.status,
      error.code
    );
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Ping the API health endpoint with a 5 s timeout.
 * Safe to call fire-and-forget; never throws.
 */
export async function checkApiHealth(): Promise<{ healthy: boolean; version?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return { healthy: false };
    const data = await res.json().catch(() => ({})) as { version?: string };
    return { healthy: true, version: data.version };
  } catch {
    clearTimeout(timeoutId);
    return { healthy: false };
  }
}

// ---------------------------------------------------------------------------
// Type definitions for API responses
// ---------------------------------------------------------------------------

export interface Usage {
  plan: {
    tier: string;
    weeklyLimit: number;
    burstLimit: number;
  };
  session: {
    burstUsed: number;
    burstLimit: number;
    resetsIn: string;
    percentUsed: number;
  };
  weekly: {
    week: string;
    basicUsed: number;
    stealthUsed: number;
    searchUsed: number;
    totalUsed: number;
    totalAvailable: number;
    rolloverCredits: number;
    remaining: number;
    percentUsed: number;
    resetsAt: string;
  };
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string | null;
  isExpired?: boolean;
  expiresIn?: string | null;
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro' | 'max';
  created_at: string;
}
