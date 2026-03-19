/**
 * Pure HTTP fetching — no browser dependencies.
 * Handles connection pooling, conditional caching, SSRF validation, and simpleFetch.
 */

// Force IPv4-first DNS resolution globally.
// Prevents IPv6 connection failures (TLS errors, timeouts) on hosts that
// advertise AAAA records but can't actually route IPv6 (e.g. Render containers).
// Must run before any network library is used.
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { getHttpUA, getSecCHUA, getSecCHUAPlatform } from './user-agents.js';
import { getWebshareProxyUrl } from './proxy-config.js';
import { fetch as undiciFetch, Agent, ProxyAgent, type Response } from 'undici';
import { TimeoutError, BlockedError, NetworkError, WebPeelError } from '../types.js';
import { getCached } from './cache.js';
import { cachedLookup, resolveAndCache, startDnsWarmup } from './dns-cache.js';
import { detectChallenge } from './challenge-detection.js';
import { getCookieHeader } from './cookie-cache.js';
import { createLogger } from './logger.js';

const log = createLogger('http');

// ── HTTP status text fallbacks (HTTP/2 omits reason phrases) ──────────────────

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  410: 'Gone',
  429: 'Too Many Requests',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  520: 'Unknown Error (Cloudflare)',
  521: 'Web Server Is Down (Cloudflare)',
  522: 'Connection Timed Out (Cloudflare)',
  523: 'Origin Is Unreachable (Cloudflare)',
  524: 'A Timeout Occurred (Cloudflare)',
  525: 'SSL Handshake Failed (Cloudflare)',
};

// ── HTTP connection pool ──────────────────────────────────────────────────────

function createHttpPool(): Agent {
  return new Agent({
    connections: 50,
    pipelining: 10,
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 60000,
    allowH2: true,
    headersTimeout: 10000,
    bodyTimeout: 30000,
    connect: {
      lookup: cachedLookup as never,
    },
  });
}

let httpPool = createHttpPool();
startDnsWarmup();

export async function closePool(): Promise<void> {
  const oldPool = httpPool;
  httpPool = createHttpPool();
  await oldPool.close().catch(() => {});
}

// ── Conditional request cache (ETag / Last-Modified) ─────────────────────────

interface ConditionalValidators {
  etag?: string;
  lastModified?: string;
}

const CONDITIONAL_CACHE_MAX_ENTRIES = 2000;
const conditionalValidatorsByUrl = new Map<string, ConditionalValidators>();

function normalizeUrlForConditionalCache(url: string): string {
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    normalized.hostname = normalized.hostname.toLowerCase();

    if ((normalized.protocol === 'http:' && normalized.port === '80') ||
        (normalized.protocol === 'https:' && normalized.port === '443')) {
      normalized.port = '';
    }

    if (!normalized.pathname) {
      normalized.pathname = '/';
    }

    const sortedParams = [...normalized.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b));
    normalized.search = '';
    for (const [key, value] of sortedParams) {
      normalized.searchParams.append(key, value);
    }

    return normalized.toString();
  } catch (e) {
    // Non-fatal: URL normalization failed, returning raw trimmed URL
    log.debug('URL normalization:', e instanceof Error ? e.message : e);
    return url.trim();
  }
}

function getConditionalValidators(url: string): ConditionalValidators | null {
  const key = normalizeUrlForConditionalCache(url);
  const existing = conditionalValidatorsByUrl.get(key);
  if (!existing) {
    return null;
  }

  // LRU touch
  conditionalValidatorsByUrl.delete(key);
  conditionalValidatorsByUrl.set(key, existing);
  return existing;
}

function setConditionalValidators(url: string, validators: ConditionalValidators): void {
  const key = normalizeUrlForConditionalCache(url);

  if (conditionalValidatorsByUrl.has(key)) {
    conditionalValidatorsByUrl.delete(key);
  }

  conditionalValidatorsByUrl.set(key, validators);

  while (conditionalValidatorsByUrl.size > CONDITIONAL_CACHE_MAX_ENTRIES) {
    const oldestKey = conditionalValidatorsByUrl.keys().next().value;
    if (!oldestKey) {
      break;
    }
    conditionalValidatorsByUrl.delete(oldestKey);
  }
}

function rememberConditionalValidators(url: string, response: Response): void {
  const etag = response.headers.get('etag') || undefined;
  const lastModified = response.headers.get('last-modified') || undefined;

  if (!etag && !lastModified) {
    return;
  }

  setConditionalValidators(url, { etag, lastModified });
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowered = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === lowered);
}

function getCachedResultFor304(url: string, fallbackUrl?: string): FetchResult | null {
  const cached = getCached<FetchResult>(url) || (fallbackUrl ? getCached<FetchResult>(fallbackUrl) : null);
  if (!cached) {
    return null;
  }

  return {
    html: cached.html,
    buffer: cached.buffer,
    url: cached.url || url,
    statusCode: 304,
    contentType: cached.contentType,
    screenshot: cached.screenshot,
  };
}

export function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

// ── Stealth headers & proxy routing ──────────────────────────────────────────

/**
 * Domains known to aggressively block datacenter IPs.
 * Requests to these domains automatically route through the Webshare residential
 * proxy when proxy credentials are configured (WEBSHARE_PROXY_* env vars).
 */
export const PROXY_PREFERRED_DOMAINS: readonly string[] = [
  // Social / content
  'reddit.com',
  'old.reddit.com',
  'forbes.com',
  'fortune.com',
  // Auto / cars
  'cargurus.com',
  'edmunds.com',
  'cars.com',
  'truecar.com',
  'autotrader.com',
  'carfax.com',
  'tesla.com',
  'motortrend.com',
  'jdpower.com',
  // Finance / home
  'nerdwallet.com',
  'bankrate.com',
  'homeadvisor.com',
  'angi.com',
  // EV / auto news
  'insideevs.com',
  'electrek.co',
  // Restaurants / food
  'yelp.com',
  // Travel
  'kayak.com',
  'booking.com',
  'expedia.com',
  'tripadvisor.com',
  'hotels.com',
  // Shopping / products
  'amazon.com',
  'bestbuy.com',
  'walmart.com',
  'target.com',
];

/**
 * Returns true if the URL's domain is on the proxy-preferred blocklist.
 * Matches exact hostname (sans www.) and all subdomains.
 *
 * @example
 * shouldUseProxy('https://www.reddit.com/r/news') // true
 * shouldUseProxy('https://example.com')           // false
 */
export function shouldUseProxy(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return PROXY_PREFERRED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Generate browser-like request headers tailored to the User-Agent type.
 *
 * - Chrome/Edge:  full Sec-CH-UA + Sec-Fetch-* header set
 * - Firefox:      adjusted Accept, TE header, partial Sec-Fetch-* (no Sec-CH-UA)
 * - Safari:       minimal headers, no Sec-Fetch-* or Sec-CH-UA
 * - Other:        basic headers only
 *
 * Automatically adds a Google referer for domains where it helps bypass blocks.
 *
 * @param url        - Target URL (used for domain-specific header additions)
 * @param userAgent  - User-Agent string (determines which header set is applied)
 */
export function getStealthHeaders(url: string, userAgent: string): Record<string, string> {
  const isFirefox = userAgent.includes('Firefox');
  const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
  const isChrome = !isFirefox && !isSafari && (userAgent.includes('Chrome') || userAgent.includes('Chromium'));
  const isMobile = userAgent.includes('Mobile') || userAgent.includes('Android');

  // Base headers all browsers send
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
  };

  if (isFirefox) {
    // Firefox: different Accept, TE, and partial Sec-Fetch (no Sec-CH-UA)
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    headers['Accept-Language'] = 'en-US,en;q=0.5';
    headers['TE'] = 'trailers';
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'none';
    // Firefox omits Sec-Fetch-User in many navigations
  } else if (isSafari) {
    // Safari: minimal headers, no Sec-Fetch-* or Sec-CH-UA
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    // Safari does not send Sec-Fetch headers at all
  } else if (isChrome) {
    // Chrome/Edge: full set of Sec-Fetch-* and Sec-CH-UA headers
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'none';
    headers['Sec-Fetch-User'] = '?1';
    headers['Sec-CH-UA'] = getSecCHUA(userAgent);
    headers['Sec-CH-UA-Mobile'] = isMobile ? '?1' : '?0';
    headers['Sec-CH-UA-Platform'] = getSecCHUAPlatform(userAgent);
    headers['Connection'] = 'keep-alive';
    headers['Priority'] = 'u=0, i';
  }
  // else: custom/API UAs (e.g. "WebPeel/1.0") — basic headers only, no browser fingerprints

  // Add Google Referer for domains where it's known to help bypass blocks
  try {
    const domain = new URL(url).hostname;
    const referrerDomains = [
      'reddit.com', 'forbes.com', 'cargurus.com', 'edmunds.com',
      'cars.com', 'truecar.com', 'nerdwallet.com', 'homeadvisor.com',
      'angi.com', 'motortrend.com', 'jdpower.com', 'electrek.co', 'insideevs.com',
    ];
    if (referrerDomains.some(d => domain.includes(d))) {
      headers['Referer'] = 'https://www.google.com/';
    }
  } catch {
    // Non-fatal: URL parsing failed, skip Referer
  }

  return headers;
}

/** Pick a different UA than the one currently in use (for 403/503 retries). */
function getDifferentUA(current: string): string {
  for (let i = 0; i < 10; i++) {
    const ua = getHttpUA();
    if (ua !== current) return ua;
  }
  return getHttpUA();
}

/**
 * Build the merged request headers: stealth defaults + caller custom headers.
 * Throws WebPeelError if customHeaders attempts to override the Host header.
 */
function buildMergedHeaders(
  url: string,
  userAgent: string,
  customHeaders?: Record<string, string>,
): Record<string, string> {
  const merged = { ...getStealthHeaders(url, userAgent) };
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      // SECURITY: Block Host header override
      if (key.toLowerCase() === 'host') {
        throw new WebPeelError('Custom Host header is not allowed');
      }
      merged[key] = value;
    }
  }
  return merged;
}

// ── SSRF / URL validation ─────────────────────────────────────────────────────

/**
 * SECURITY: Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, link-local, and various bypass techniques
 */
export function validateUrl(urlString: string): void {
  // Length check
  if (urlString.length > 2048) {
    throw new WebPeelError('URL too long (max 2048 characters)');
  }

  // Check for control characters and suspicious encoding
  if (/[\x00-\x1F\x7F]/.test(urlString)) {
    throw new WebPeelError('URL contains invalid control characters');
  }

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new WebPeelError('Invalid URL format');
  }

  // Only allow HTTP(S)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebPeelError('Only HTTP and HTTPS protocols are allowed');
  }

  // Validate hostname is not empty
  if (!url.hostname) {
    throw new WebPeelError('Invalid hostname');
  }

  const hostname = url.hostname.toLowerCase();

  // Block localhost patterns
  const localhostPatterns = ['localhost', '0.0.0.0'];
  if (localhostPatterns.some(pattern => hostname === pattern || hostname.endsWith('.' + pattern))) {
    throw new WebPeelError('Access to localhost is not allowed');
  }

  // ENHANCED: Parse and validate IP addresses (handles hex, octal, decimal, mixed)
  const ipv4Info = parseAndValidateIPv4(hostname);
  if (ipv4Info) {
    validateIPv4Address(ipv4Info);
  }

  // ENHANCED: Comprehensive IPv6 validation
  if (hostname.includes(':')) {
    validateIPv6Address(hostname);
  }
}

/**
 * Parse IPv4 address in any format (dotted, hex, octal, decimal, mixed)
 * Returns null if not an IPv4 address
 */
function parseAndValidateIPv4(hostname: string): number[] | null {
  // Remove brackets if present
  const cleaned = hostname.replace(/^\[|\]$/g, '');

  // Standard dotted notation: 192.168.1.1
  const dottedRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const dottedMatch = cleaned.match(dottedRegex);
  if (dottedMatch) {
    const octets = dottedMatch.slice(1).map(Number);
    if (octets.every(o => o >= 0 && o <= 255)) {
      return octets;
    }
    throw new WebPeelError('Invalid IPv4 address');
  }

  // Hex notation: 0x7f000001
  if (/^0x[0-9a-fA-F]+$/.test(cleaned)) {
    const num = parseInt(cleaned, 16);
    return [
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff,
    ];
  }

  // Octal notation: 0177.0.0.1 or full octal 017700000001
  if (/^0[0-7]/.test(cleaned)) {
    // Full octal (all digits)
    if (/^0[0-7]+$/.test(cleaned)) {
      const num = parseInt(cleaned, 8);
      if (num <= 0xffffffff) {
        return [
          (num >>> 24) & 0xff,
          (num >>> 16) & 0xff,
          (num >>> 8) & 0xff,
          num & 0xff,
        ];
      }
    }
    // Mixed octal-decimal: 0177.0.0.1
    const parts = cleaned.split('.');
    if (parts.length === 4) {
      const octets = parts.map(p => parseInt(p, /^0[0-7]/.test(p) ? 8 : 10));
      if (octets.every(o => o >= 0 && o <= 255)) {
        return octets;
      }
    }
  }

  // Decimal notation: 2130706433
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    if (num <= 0xffffffff) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ];
    }
  }

  return null;
}

/**
 * Validate IPv4 address against private/reserved ranges
 */
function validateIPv4Address(octets: number[]): void {
  const [a, b, c, d] = octets;

  // Loopback: 127.0.0.0/8
  if (a === 127) {
    throw new WebPeelError('Access to loopback addresses is not allowed');
  }

  // Private: 10.0.0.0/8
  if (a === 10) {
    throw new WebPeelError('Access to private IP addresses is not allowed');
  }

  // Private: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {
    throw new WebPeelError('Access to private IP addresses is not allowed');
  }

  // Private: 192.168.0.0/16
  if (a === 192 && b === 168) {
    throw new WebPeelError('Access to private IP addresses is not allowed');
  }

  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) {
    throw new WebPeelError('Access to link-local addresses is not allowed');
  }

  // Broadcast: 255.255.255.255
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    throw new WebPeelError('Access to broadcast address is not allowed');
  }

  // This network: 0.0.0.0/8
  if (a === 0) {
    throw new WebPeelError('Access to "this network" addresses is not allowed');
  }
}

/**
 * Validate IPv6 address against private/reserved ranges
 */
function validateIPv6Address(hostname: string): void {
  // Remove brackets
  const addr = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // Loopback: ::1
  if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') {
    throw new WebPeelError('Access to loopback addresses is not allowed');
  }

  // IPv6 mapped IPv4: ::ffff:192.168.1.1 or ::ffff:c0a8:0101
  if (addr.startsWith('::ffff:')) {
    // Extract the IPv4 part
    const ipv4Part = addr.substring(7);
    
    // Could be dotted (::ffff:192.168.1.1) or hex (::ffff:c0a8:0101)
    if (ipv4Part.includes('.')) {
      // Parse dotted IPv4
      const parts = ipv4Part.split('.');
      if (parts.length === 4) {
        const octets = parts.map(p => parseInt(p, 10));
        if (octets.every(o => !isNaN(o) && o >= 0 && o <= 255)) {
          validateIPv4Address(octets);
        }
      }
    } else {
      // Parse hex IPv4 (e.g., c0a80101 = 192.168.1.1)
      const hexStr = ipv4Part.replace(/:/g, '');
      if (/^[0-9a-f]{1,8}$/.test(hexStr)) {
        const num = parseInt(hexStr, 16);
        const octets = [
          (num >>> 24) & 0xff,
          (num >>> 16) & 0xff,
          (num >>> 8) & 0xff,
          num & 0xff,
        ];
        validateIPv4Address(octets);
      }
    }
    throw new WebPeelError('Access to IPv6-mapped IPv4 addresses is not allowed');
  }

  // Unique local addresses: fc00::/7 (fc00:: to fdff::)
  if (addr.startsWith('fc') || addr.startsWith('fd')) {
    throw new WebPeelError('Access to unique local IPv6 addresses is not allowed');
  }

  // Link-local: fe80::/10
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || 
      addr.startsWith('fea') || addr.startsWith('feb')) {
    throw new WebPeelError('Access to link-local IPv6 addresses is not allowed');
  }
}

/**
 * Validate and sanitize user agent string
 */
export function validateUserAgent(userAgent: string): string {
  if (userAgent.length > 500) {
    throw new WebPeelError('User agent too long (max 500 characters)');
  }
  // Allow only printable ASCII characters
  if (!/^[\x20-\x7E]*$/.test(userAgent)) {
    throw new WebPeelError('User agent contains invalid characters');
  }
  return userAgent;
}

// ── FetchResult interface ─────────────────────────────────────────────────────

export interface FetchResult {
  /** Text content (HTML/JSON/XML/plain text). For binary documents, this may be an empty string. */
  html: string;
  /** Raw response body (used for binary documents like PDFs/DOCX). */
  buffer?: Buffer;
  url: string;
  statusCode?: number;
  screenshot?: Buffer;
  /** Raw Content-Type header from the response (may include charset). */
  contentType?: string;
  /** Selected response headers for freshness metadata (last-modified, etag, cache-control). */
  responseHeaders?: Record<string, string>;
  /** Playwright page object (only available in browser/stealth mode, must be closed by caller) */
  page?: import('playwright').Page;
  /** Playwright browser object (only available in browser/stealth mode, must be closed by caller) */
  browser?: import('playwright').Browser;
  /** Auto-interact result: what cookie banners / overlays were dismissed before extraction */
  autoInteract?: import('./auto-interact.js').AutoInteractResult;
}

// ── simpleFetch ───────────────────────────────────────────────────────────────

/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 * SECURITY: Manual redirect handling with SSRF re-validation
 */
export async function simpleFetch(
  url: string,
  userAgent?: string,
  timeoutMs: number = 30000,
  customHeaders?: Record<string, string>,
  abortSignal?: AbortSignal,
  proxy?: string
): Promise<FetchResult> {
  // SECURITY: Validate URL to prevent SSRF
  validateUrl(url);

  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  // Validate user agent if provided
  // SEC.gov requires a User-Agent with contact info (their documented automated access policy)
  const hostname = new URL(url).hostname.toLowerCase();
  const isSecGov = hostname === 'sec.gov' || hostname.endsWith('.sec.gov');
  let activeUserAgent = isSecGov
    ? 'WebPeel/1.0 (support@webpeel.dev)'
    : (userAgent ? validateUserAgent(userAgent) : getHttpUA());

  // Inject cached challenge-solve cookies (e.g. cf_clearance) if available.
  // These are merged into customHeaders so they ride along on every request
  // to this domain, skipping repeated challenge pages.
  const cachedCookieHeader = getCookieHeader(url);
  const effectiveCustomHeaders = cachedCookieHeader
    ? { Cookie: cachedCookieHeader, ...(customHeaders || {}) }
    : customHeaders;

  // Build stealth headers merged with any caller-supplied custom headers
  let mergedHeaders = buildMergedHeaders(url, activeUserAgent, effectiveCustomHeaders);

  // Auto-route through residential proxy for sites known to block datacenter IPs.
  // The explicit `proxy` param always wins; auto-proxy only kicks in when unset.
  const effectiveProxy: string | undefined =
    proxy ?? (shouldUseProxy(url) ? (getWebshareProxyUrl() ?? undefined) : undefined);

  const MAX_REDIRECTS = 10;
  let redirectCount = 0;
  let currentUrl = url;
  const seenUrls = new Set<string>();
  let retried = false; // track whether we've already retried with a different UA

  try {
    const hostname = new URL(url).hostname;
    void resolveAndCache(hostname).catch(() => {
      // Best-effort optimization only.
    });
  } catch (e) {
    // Ignore URL parsing errors here; validation handles invalid input below.
    log.debug('DNS prefetch (initial URL):', e instanceof Error ? e.message : e);
  }

  while (redirectCount <= MAX_REDIRECTS) {
    // Detect redirect loops
    if (seenUrls.has(currentUrl)) {
      throw new WebPeelError('Redirect loop detected');
    }
    seenUrls.add(currentUrl);

    // Re-validate on each redirect
    validateUrl(currentUrl);

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = abortSignal
      ? AbortSignal.any([timeoutController.signal, abortSignal])
      : timeoutController.signal;

    try {
      const requestHeaders: Record<string, string> = { ...mergedHeaders };
      const validators = getConditionalValidators(currentUrl);
      // Only send conditional headers if we actually have the cached body
      // In server/worker mode, the in-memory cache may have been cleared (pod restart)
      // and sending If-None-Match without a cached body would cause a 304 crash
      const cachedBody = getCachedResultFor304(currentUrl, url);
      if (validators?.etag && cachedBody && !hasHeader(requestHeaders, 'if-none-match')) {
        requestHeaders['If-None-Match'] = validators.etag;
      }
      if (validators?.lastModified && cachedBody && !hasHeader(requestHeaders, 'if-modified-since')) {
        requestHeaders['If-Modified-Since'] = validators.lastModified;
      }

      // Use proxy if provided or auto-selected, otherwise use shared connection pool
      const dispatcher = effectiveProxy ? new ProxyAgent(effectiveProxy) : httpPool;

      const response = await undiciFetch(currentUrl, {
        headers: requestHeaders,
        signal,
        dispatcher,
        redirect: 'manual', // SECURITY: Manual redirect handling
      });

      clearTimeout(timer);

      if (response.status === 304) {
        const cachedResult = getCachedResultFor304(currentUrl, url);
        if (cachedResult) {
          return cachedResult;
        }

        throw new NetworkError('HTTP 304 received but no cached response is available');
      }

      // Handle redirects manually
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new NetworkError('Redirect response missing Location header');
        }

        // Resolve relative URLs
        currentUrl = new URL(location, currentUrl).href;
        try {
          const hostname = new URL(currentUrl).hostname;
          void resolveAndCache(hostname).catch(() => {
            // Best-effort optimization only.
          });
        } catch (e) {
          // Ignore URL parsing errors here; validation handles invalid input below.
          log.debug('DNS prefetch (redirect URL):', e instanceof Error ? e.message : e);
        }
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        if (response.status === 403 || response.status === 503) {
          // Retry once with a different UA — cheap and catches UA-based blocks
          if (!retried && !userAgent) {
            retried = true;
            activeUserAgent = getDifferentUA(activeUserAgent);
            mergedHeaders = buildMergedHeaders(currentUrl, activeUserAgent, customHeaders);
            // Allow the retry to re-visit the same URL (not a redirect loop)
            seenUrls.delete(currentUrl);
            log.debug(`HTTP ${response.status} on first attempt; retrying with different UA`);
            continue;
          }
          throw new BlockedError(
            `HTTP ${response.status}: Site may be blocking requests. Try --render for browser mode.`
          );
        }
        const statusText = response.statusText || HTTP_STATUS_TEXT[response.status] || 'Unknown Error';
        throw new NetworkError(`HTTP ${response.status}: ${statusText}`);
      }

      rememberConditionalValidators(currentUrl, response);

      // Content-Type detection
      const contentType = response.headers.get('content-type') || '';
      const contentTypeLower = contentType.toLowerCase();
      const urlLower = currentUrl.toLowerCase();

      // Support binary documents (PDF/DOCX) in the simple HTTP path.
      const isPdf = contentTypeLower.includes('application/pdf') || urlLower.endsWith('.pdf');
      const isDocx = contentTypeLower.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || urlLower.endsWith('.docx');
      const isBinaryDoc = isPdf || isDocx;

      // Accept a wide range of text-based content, plus supported binary documents.
      const ALLOWED_TYPES = [
        'text/html', 'application/xhtml+xml',
        'text/plain', 'text/markdown', 'text/csv',
        'application/json', 'text/json',
        'text/xml', 'application/xml', 'application/rss+xml', 'application/atom+xml',
        'application/javascript', 'text/javascript', 'text/css',
        // Documents
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];

      const isAllowed =
        !contentTypeLower ||
        ALLOWED_TYPES.some(t => contentTypeLower.includes(t)) ||
        // Many servers mislabel docs as octet-stream; allow when URL implies a supported document.
        (contentTypeLower.includes('application/octet-stream') && isBinaryDoc);

      if (!isAllowed) {
        // Check if it's at least text-based
        const isTexty =
          contentTypeLower.startsWith('text/') ||
          contentTypeLower.includes('json') ||
          contentTypeLower.includes('xml');

        if (!isTexty) {
          throw new WebPeelError(`Binary content type: ${contentType}. WebPeel handles text-based content and PDF/DOCX documents only.`);
        }
      }

      // SECURITY: Stream response with size limit (prevent memory exhaustion)
      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB

      const reader = response.body?.getReader();
      if (!reader) {
        throw new NetworkError('Response body is not readable');
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > MAX_SIZE) {
            reader.cancel();
            throw new WebPeelError('Response too large (max 10MB)');
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine chunks
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const buffer = Buffer.from(combined);
      const html = isBinaryDoc ? '' : new TextDecoder().decode(combined);

      // For HTML content, check for suspiciously small responses (bot blocks)
      // Non-HTML content (JSON, text, XML) can legitimately be short
      const isHtmlContent = !isBinaryDoc && (contentTypeLower.includes('html') || contentTypeLower.includes('xhtml'));
      if (isHtmlContent && (!html || html.length < 100)) {
        throw new BlockedError('Empty or suspiciously small response. Site may require JavaScript.');
      }

      if (!isBinaryDoc && !html) {
        throw new NetworkError('Empty response body');
      }

      if (isBinaryDoc && buffer.length === 0) {
        throw new NetworkError('Empty response body');
      }

      // Check for Cloudflare challenge (only relevant for HTML)
      if (isHtmlContent && (html.includes('cf-browser-verification') || html.includes('Just a moment...'))) {
        throw new BlockedError('Cloudflare challenge detected. Try --render for browser mode.');
      }

      // Run full challenge detection for HTML content
      // Note: skip empty-shell type — in simple HTTP mode, SPA shells are expected and
      // the caller's escalation logic upgrades to browser/stealth rendering.
      if (isHtmlContent) {
        const challengeResult = detectChallenge(html, response.status);
        if (challengeResult.isChallenge && challengeResult.type !== 'empty-shell') {
          throw new BlockedError(
            `Challenge page detected (${challengeResult.type || 'unknown'}, confidence: ${challengeResult.confidence.toFixed(2)}). ` +
            `Site requires human verification. Try a different approach or use a CAPTCHA solving service.`
          );
        }
      }

      // Capture selected response headers for freshness metadata
      const responseHeaders: Record<string, string> = {};
      const lastModified = response.headers.get('last-modified');
      if (lastModified) responseHeaders['last-modified'] = lastModified;
      const etag = response.headers.get('etag');
      if (etag) responseHeaders['etag'] = etag;
      const cacheControl = response.headers.get('cache-control');
      if (cacheControl) responseHeaders['cache-control'] = cacheControl;

      return {
        html,
        buffer: isBinaryDoc ? buffer : undefined,
        url: currentUrl,
        statusCode: response.status,
        contentType,
        responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
      };
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof BlockedError || error instanceof NetworkError || error instanceof WebPeelError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        if (abortSignal?.aborted && !timeoutController.signal.aborted) {
          throw createAbortError();
        }
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      }

      // Provide specific error messages based on the actual cause
      const cause = error instanceof Error && (error as any).cause;
      const causeMsg = cause?.message || cause?.code || '';
      
      if (causeMsg.includes('certificate') || causeMsg.includes('CERT') || causeMsg.includes('SSL') || causeMsg.includes('TLS')) {
        throw new NetworkError(`TLS/SSL certificate error for ${new URL(currentUrl).hostname}. The site's certificate may be expired, self-signed, or untrusted.`);
      }
      if (causeMsg.includes('ENOTFOUND') || causeMsg.includes('getaddrinfo')) {
        throw new NetworkError(`DNS resolution failed: ${new URL(currentUrl).hostname} not found. Check the URL or your network connection.`);
      }
      if (causeMsg.includes('ECONNREFUSED')) {
        throw new NetworkError(`Connection refused by ${new URL(currentUrl).hostname}. The server may be down.`);
      }
      if (causeMsg.includes('ECONNRESET') || causeMsg.includes('EPIPE')) {
        throw new NetworkError(`Connection reset by ${new URL(currentUrl).hostname}. Try again or use --render.`);
      }
      if (causeMsg.includes('ETIMEDOUT') || causeMsg.includes('ENETUNREACH')) {
        throw new TimeoutError(`Network unreachable or connection timed out for ${new URL(currentUrl).hostname}.`);
      }
      
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const causeDetail = causeMsg ? ` (${causeMsg})` : '';
      throw new NetworkError(`Failed to fetch: ${msg}${causeDetail}`);
    }
  }

  throw new WebPeelError(`Too many redirects (max ${MAX_REDIRECTS})`);
}
