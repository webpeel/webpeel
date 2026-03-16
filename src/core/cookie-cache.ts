/**
 * In-memory cookie cache with TTL.
 *
 * Stores session cookies (especially cf_clearance, __cf_bm) keyed by domain.
 * Cookies from challenge solves are cached here so future requests to the same
 * domain skip the challenge entirely.
 *
 * Design goals:
 *  - Zero dependencies (plain Map + setTimeout)
 *  - In-memory only — no disk/DB persistence
 *  - TTL per entry (default 30 min, matching cf_clearance lifetime)
 *  - Thread-safe for single-process Node.js (event loop is single-threaded)
 */

export interface CachedCookies {
  /** Raw "Cookie: ..." header value (semicolon-separated) */
  cookieHeader: string;
  /** Individual cookie strings (e.g. ["cf_clearance=abc; Path=/", ...]) */
  cookies: string[];
  /** Unix timestamp (ms) when this cache entry expires */
  expiresAt: number;
  /** The domain these cookies are for */
  domain: string;
}

// ── Internal store ────────────────────────────────────────────────────────────

const store = new Map<string, CachedCookies>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Default TTL: 30 minutes (cf_clearance lasts 30 min) */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Store cookies for a domain.
 *
 * @param domain   Hostname (e.g. "example.com" or "sub.example.com")
 * @param cookies  Array of Set-Cookie header values or cookie strings
 * @param ttlMs    Time-to-live in ms (default: 30 min)
 */
export function cacheCookies(
  domain: string,
  cookies: string[],
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (!cookies.length) return;

  const normalizedDomain = normalizeDomain(domain);
  const cookieHeader = buildCookieHeader(cookies);
  const expiresAt = Date.now() + ttlMs;

  store.set(normalizedDomain, {
    cookieHeader,
    cookies,
    expiresAt,
    domain: normalizedDomain,
  });

  // Start periodic cleanup if not already running
  startCleanup();
}

/**
 * Retrieve cached cookies for a domain (or its parent domain).
 * Returns null if no valid (non-expired) entry exists.
 *
 * @param domain  Hostname to look up
 */
export function getCachedCookies(domain: string): CachedCookies | null {
  const normalizedDomain = normalizeDomain(domain);

  // Try exact match first, then parent domain
  const candidates = [normalizedDomain, getParentDomain(normalizedDomain)].filter(Boolean);

  for (const candidate of candidates) {
    const entry = store.get(candidate!);
    if (entry && entry.expiresAt > Date.now()) {
      return entry;
    }
    // Remove expired entry
    if (entry) {
      store.delete(candidate!);
    }
  }

  return null;
}

/**
 * Build a Cookie request header value from a URL.
 * Returns undefined if no cached cookies exist.
 */
export function getCookieHeader(url: string): string | undefined {
  try {
    const domain = new URL(url).hostname;
    const cached = getCachedCookies(domain);
    return cached?.cookieHeader;
  } catch {
    return undefined;
  }
}

/**
 * Cache cookies from a URL's perspective.
 * Extracts domain from URL automatically.
 */
export function cacheCookiesForUrl(
  url: string,
  cookies: string[],
  ttlMs: number = DEFAULT_TTL_MS
): void {
  try {
    const domain = new URL(url).hostname;
    cacheCookies(domain, cookies, ttlMs);
  } catch {
    // Invalid URL — ignore
  }
}

/**
 * Invalidate (remove) cached cookies for a domain.
 */
export function invalidateCookies(domain: string): void {
  const normalizedDomain = normalizeDomain(domain);
  store.delete(normalizedDomain);
}

/**
 * Return the number of cached domains (for diagnostics).
 */
export function getCacheSize(): number {
  return store.size;
}

/**
 * Clear ALL cached cookies. Mainly for tests.
 */
export function clearCookieCache(): void {
  store.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize domain: lowercase, strip www. prefix */
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

/** Get parent domain (strip first subdomain label) */
function getParentDomain(domain: string): string | null {
  const parts = domain.split('.');
  if (parts.length <= 2) return null; // Already a root domain
  return parts.slice(1).join('.');
}

/**
 * Convert an array of Set-Cookie values or raw cookie strings into a single
 * "Cookie: name=value; name2=value2" header value.
 */
function buildCookieHeader(cookies: string[]): string {
  const pairs: string[] = [];
  for (const cookie of cookies) {
    // Set-Cookie format: "name=value; Path=/; Secure; HttpOnly; ..."
    // We only want the first "name=value" pair
    const firstPart = cookie.split(';')[0]?.trim();
    if (firstPart) {
      pairs.push(firstPart);
    }
  }
  return pairs.join('; ');
}

/** Periodically remove expired entries to prevent memory leaks. */
function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [domain, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(domain);
      }
    }
    // Stop the timer if the cache is empty
    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  // Don't block Node.js process exit
  if (cleanupTimer && typeof (cleanupTimer as any).unref === 'function') {
    (cleanupTimer as any).unref();
  }
}
