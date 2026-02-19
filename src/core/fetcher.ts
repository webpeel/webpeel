/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */

// Force IPv4-first DNS resolution globally.
// Prevents IPv6 connection failures (TLS errors, timeouts) on hosts that
// advertise AAAA records but can't actually route IPv6 (e.g. Render containers).
// Must run before any network library is used.
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { chromium, type Browser, type Page } from 'playwright';
import { chromium as stealthChromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getRealisticUserAgent, getSecCHUA, getSecCHUAPlatform } from './user-agents.js';
import { fetch as undiciFetch, Agent, type Response } from 'undici';
import { TimeoutError, BlockedError, NetworkError, WebPeelError } from '../types.js';
import type { PageAction } from '../types.js';
import { getCached } from './cache.js';
import { cachedLookup, resolveAndCache, startDnsWarmup } from './dns-cache.js';
import { detectChallenge } from './challenge-detection.js';

// Add stealth plugin to playwright-extra
stealthChromium.use(StealthPlugin());

/**
 * Returns a realistic Chrome user agent.
 * Delegates to the curated user-agents module so stealth mode never exposes
 * the default "Chrome for Testing" UA which is a reliable bot-detection signal.
 */
function getRandomUserAgent(): string {
  return getRealisticUserAgent();
}

/**
 * Common Chromium launch arguments for anti-bot-detection.
 * Applied to BOTH regular and stealth browser instances.
 * NOTE: --window-size is intentionally omitted here; it is added dynamically
 * per browser launch using a random realistic viewport (see getRandomViewport()).
 */
const ANTI_DETECTION_ARGS: readonly string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--start-maximized',
  // Chrome branding / stealth hardening
  '--disable-features=ChromeUserAgentDataBranding',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

/**
 * Returns a random realistic viewport weighted by real-world market share.
 * Used to avoid the telltale Playwright default of 1280×720.
 */
function getRandomViewport(): { width: number; height: number } {
  // Common real-world resolutions weighted by market share
  const viewports = [
    { width: 1920, height: 1080, weight: 35 }, // Full HD
    { width: 1366, height: 768,  weight: 20 }, // Laptop
    { width: 1536, height: 864,  weight: 15 }, // Scaled laptop
    { width: 1440, height: 900,  weight: 10 }, // MacBook
    { width: 1680, height: 1050, weight: 8  }, // Large laptop
    { width: 2560, height: 1440, weight: 7  }, // QHD
    { width: 1280, height: 800,  weight: 5  }, // Older laptop
  ];
  const total = viewports.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of viewports) {
    r -= v.weight;
    if (r <= 0) return { width: v.width, height: v.height };
  }
  return { width: 1920, height: 1080 };
}

/**
 * Apply stealth init scripts to a page to reduce bot-detection signals:
 * 1. Hides the `window.__pwInitScripts` Playwright leak.
 * 2. Patches `navigator.userAgentData.brands` to include "Google Chrome"
 *    (Chrome for Testing only ships "Chromium" which is a known detection signal).
 */
async function applyStealthScripts(page: Page): Promise<void> {
  // 1. Hide Playwright's __pwInitScripts marker
  // Uses string form to avoid TypeScript DOM-lib requirements (tsconfig has no DOM lib).
  await page.addInitScript(`
    Object.defineProperty(window, '__pwInitScripts', {
      get: () => undefined,
      set: () => {},
      configurable: true,
    });
  `);

  // 2. Patch userAgentData brands to include "Google Chrome"
  // Chrome for Testing only ships "Chromium" — a well-known bot-detection signal.
  await page.addInitScript(`
    (function () {
      var uad = navigator.userAgentData;
      if (!uad) return;
      var originalBrands = uad.brands || [];
      var hasChromeEntry = originalBrands.some(function(b) { return b.brand === 'Google Chrome'; });
      if (hasChromeEntry) return;

      var chromiumEntry = originalBrands.find(function(b) { return b.brand === 'Chromium'; });
      var version = (chromiumEntry && chromiumEntry.version) || '136';
      var patchedBrands = [
        { brand: 'Chromium', version: version },
        { brand: 'Google Chrome', version: version },
        { brand: 'Not=A?Brand', version: '99' },
      ];

      Object.defineProperty(navigator, 'userAgentData', {
        get: function() {
          return {
            brands: patchedBrands,
            mobile: false,
            platform: uad.platform || 'Windows',
            getHighEntropyValues: uad.getHighEntropyValues ? uad.getHighEntropyValues.bind(uad) : undefined,
            toJSON: function() {
              return {
                brands: patchedBrands,
                mobile: false,
                platform: uad.platform || 'Windows',
              };
            },
          };
        },
        configurable: true,
      });
    })();
  `);
}

function createHttpPool(): Agent {
  return new Agent({
    connections: 20,
    pipelining: 6,
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 60000,
    allowH2: true,
    connect: {
      lookup: cachedLookup as never,
    },
  });
}

let httpPool = createHttpPool();
startDnsWarmup();

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
  } catch {
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

function createAbortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * SECURITY: Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, link-local, and various bypass techniques
 */
function validateUrl(urlString: string): void {
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
function validateUserAgent(userAgent: string): string {
  if (userAgent.length > 500) {
    throw new WebPeelError('User agent too long (max 500 characters)');
  }
  // Allow only printable ASCII characters
  if (!/^[\x20-\x7E]*$/.test(userAgent)) {
    throw new WebPeelError('User agent contains invalid characters');
  }
  return userAgent;
}

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
  /** Playwright page object (only available in browser/stealth mode, must be closed by caller) */
  page?: import('playwright').Page;
  /** Playwright browser object (only available in browser/stealth mode, must be closed by caller) */
  browser?: import('playwright').Browser;
}

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
  abortSignal?: AbortSignal
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
  const validatedUserAgent = isSecGov
    ? 'WebPeel/1.0 (support@webpeel.dev)'
    : (userAgent ? validateUserAgent(userAgent) : getRandomUserAgent());

  // SECURITY: Merge custom headers with defaults, block Host header override
  const defaultHeaders: Record<string, string> = {
    'User-Agent': validatedUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'br, gzip, deflate',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-CH-UA': getSecCHUA(validatedUserAgent),
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': getSecCHUAPlatform(validatedUserAgent),
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Priority': 'u=0, i',
  };

  const mergedHeaders = { ...defaultHeaders };
  
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      // SECURITY: Block Host header override
      if (key.toLowerCase() === 'host') {
        throw new WebPeelError('Custom Host header is not allowed');
      }
      mergedHeaders[key] = value;
    }
  }

  const MAX_REDIRECTS = 10;
  let redirectCount = 0;
  let currentUrl = url;
  const seenUrls = new Set<string>();

  try {
    const hostname = new URL(url).hostname;
    void resolveAndCache(hostname).catch(() => {
      // Best-effort optimization only.
    });
  } catch {
    // Ignore URL parsing errors here; validation handles invalid input below.
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
      if (validators?.etag && !hasHeader(requestHeaders, 'if-none-match')) {
        requestHeaders['If-None-Match'] = validators.etag;
      }
      if (validators?.lastModified && !hasHeader(requestHeaders, 'if-modified-since')) {
        requestHeaders['If-Modified-Since'] = validators.lastModified;
      }

      const response = await undiciFetch(currentUrl, {
        headers: requestHeaders,
        signal,
        dispatcher: httpPool,
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
        } catch {
          // Ignore URL parsing errors here; validation handles invalid input below.
        }
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        if (response.status === 403 || response.status === 503) {
          throw new BlockedError(
            `HTTP ${response.status}: Site may be blocking requests. Try --render for browser mode.`
          );
        }
        throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
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

      return {
        html,
        buffer: isBinaryDoc ? buffer : undefined,
        url: currentUrl,
        statusCode: response.status,
        contentType,
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

export async function closePool(): Promise<void> {
  const oldPool = httpPool;
  httpPool = createHttpPool();
  await oldPool.close().catch(() => {});
}

let sharedBrowser: Browser | null = null;
let sharedStealthBrowser: Browser | null = null;
let activePagesCount = 0;
const MAX_CONCURRENT_PAGES = 5;
const PAGE_POOL_SIZE = 3;
const pooledPages = new Set<Page>();
const idlePagePool: Page[] = [];
let pagePoolFillPromise: Promise<void> | null = null;

function removePooledPage(page: Page): void {
  pooledPages.delete(page);
  const idleIndex = idlePagePool.indexOf(page);
  if (idleIndex >= 0) {
    idlePagePool.splice(idleIndex, 1);
  }
}

function takePooledPage(): Page | null {
  while (idlePagePool.length > 0) {
    const page = idlePagePool.shift()!;
    if (page.isClosed()) {
      removePooledPage(page);
      continue;
    }
    return page;
  }

  return null;
}

async function ensurePagePool(browser?: Browser): Promise<void> {
  const activeBrowser = browser ?? sharedBrowser;
  if (!activeBrowser || !activeBrowser.isConnected()) {
    return;
  }

  if (pagePoolFillPromise) {
    await pagePoolFillPromise;
    return;
  }

  pagePoolFillPromise = (async () => {
    while (pooledPages.size < PAGE_POOL_SIZE) {
      const pooledPage = await activeBrowser.newPage({
        userAgent: getRandomUserAgent(),
        viewport: null, // Use browser window size (set via --window-size at launch)
      });
      await applyStealthScripts(pooledPage);
      pooledPages.add(pooledPage);
      idlePagePool.push(pooledPage);
    }
  })().finally(() => {
    pagePoolFillPromise = null;
  });

  await pagePoolFillPromise;
}

async function recyclePooledPage(page: Page): Promise<void> {
  if (!pooledPages.has(page)) {
    await page.close().catch(() => {});
    return;
  }

  if (page.isClosed()) {
    removePooledPage(page);
    if (sharedBrowser?.isConnected()) {
      void ensurePagePool(sharedBrowser).catch(() => {});
    }
    return;
  }

  try {
    await page.unroute('**/*').catch(() => {});
    await page.context().clearCookies().catch(() => {});
    await page.setExtraHTTPHeaders({});
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});

    if (!idlePagePool.includes(page)) {
      idlePagePool.push(page);
    }
  } catch {
    removePooledPage(page);
    await page.close().catch(() => {});
  }

  if (sharedBrowser?.isConnected() && pooledPages.size < PAGE_POOL_SIZE) {
    void ensurePagePool(sharedBrowser).catch(() => {});
  }
}

export async function warmup(): Promise<void> {
  startDnsWarmup();
  const browser = await getBrowser();
  await ensurePagePool(browser);
}

async function getBrowser(): Promise<Browser> {
  // SECURITY: Check if browser is still connected and healthy
  if (sharedBrowser) {
    try {
      if (sharedBrowser.isConnected()) {
        if (pooledPages.size < PAGE_POOL_SIZE) {
          void ensurePagePool(sharedBrowser).catch(() => {});
        }
        return sharedBrowser;
      }
    } catch {
      // Browser is dead, recreate
      sharedBrowser = null;
    }
  }

  pooledPages.clear();
  idlePagePool.length = 0;
  pagePoolFillPromise = null;

  const vp = getRandomViewport();
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [...ANTI_DETECTION_ARGS, `--window-size=${vp.width},${vp.height}`],
  });
  void ensurePagePool(sharedBrowser).catch(() => {});
  return sharedBrowser;
}

async function getStealthBrowser(): Promise<Browser> {
  // SECURITY: Check if stealth browser is still connected and healthy
  if (sharedStealthBrowser) {
    try {
      if (sharedStealthBrowser.isConnected()) {
        return sharedStealthBrowser;
      }
    } catch {
      // Browser is dead, recreate
      sharedStealthBrowser = null;
    }
  }

  const stealthVp = getRandomViewport();
  const stealthBrowser = await stealthChromium.launch({
    headless: true,
    args: [...ANTI_DETECTION_ARGS, `--window-size=${stealthVp.width},${stealthVp.height}`],
  });
  if (!stealthBrowser) throw new Error('Failed to launch stealth browser');
  sharedStealthBrowser = stealthBrowser;
  return stealthBrowser;
}

// ── Persistent profile browser instances ─────────────────────────────────────
// Profile browsers are NOT shared — each profileDir gets its own instance.
// These are keyed by profile path and kept alive between fetches in the same process.
const profileBrowsers = new Map<string, Browser>();

/**
 * Get or create a browser instance with a persistent user data directory.
 * Profile browsers bypass the shared browser pool so cookies/sessions survive
 * between fetch calls.
 *
 * @param profileDir Absolute path to the Chrome user-data-dir directory
 * @param headed     Whether to launch in headed (visible) mode
 * @param stealth    Whether to use playwright-extra stealth instead of plain chromium
 */
async function getProfileBrowser(
  profileDir: string,
  headed: boolean = false,
  stealth: boolean = false,
): Promise<Browser> {
  const existing = profileBrowsers.get(profileDir);
  if (existing) {
    try {
      if (existing.isConnected()) return existing;
    } catch { /* dead, recreate */ }
    profileBrowsers.delete(profileDir);
  }

  const profileVp = getRandomViewport();
  const launchOptions = {
    headless: !headed,
    args: [
      ...ANTI_DETECTION_ARGS,
      `--window-size=${profileVp.width},${profileVp.height}`,
      `--user-data-dir=${profileDir}`,
    ],
  };

  const launched = stealth
    ? await stealthChromium.launch(launchOptions)
    : await chromium.launch(launchOptions);
  if (!launched) throw new Error('Failed to launch profile browser');

  profileBrowsers.set(profileDir, launched);
  return launched;
}

/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export async function browserFetch(
  url: string,
  options: {
    userAgent?: string;
    waitMs?: number;
    timeoutMs?: number;
    screenshot?: boolean;
    screenshotFullPage?: boolean;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    actions?: PageAction[];
    /** Keep the browser page open after fetch (caller must close page + browser) */
    keepPageOpen?: boolean;
    /** Abort signal for internal races/cancellation */
    signal?: AbortSignal;
    /**
     * Path to a persistent Chrome user-data-dir.
     * When set, bypasses the shared browser pool and keeps the browser alive
     * between fetches so cookies / session data persist.
     */
    profileDir?: string;
    /** Launch browser in headed (visible) mode. Only meaningful with profileDir or for debugging. */
    headed?: boolean;
    /**
     * Playwright storage state (cookies + localStorage) to inject into the browser context.
     * When provided, a new BrowserContext is created with this state, which is more reliable
     * than --user-data-dir for session injection.
     */
    storageState?: any;
  } = {}
): Promise<FetchResult> {
  // SECURITY: Validate URL to prevent SSRF
  validateUrl(url);

  const { 
    userAgent, 
    waitMs = 0, 
    timeoutMs = 30000, 
    screenshot = false, 
    screenshotFullPage = false,
    headers,
    cookies,
    stealth = false,
    actions,
    keepPageOpen = false,
    signal,
    profileDir,
    headed = false,
    storageState,
  } = options;

  // Validate user agent if provided
  // In stealth mode with no custom UA, always use a realistic Chrome UA
  const validatedUserAgent = userAgent
    ? validateUserAgent(userAgent)
    : (stealth ? getRealisticUserAgent() : getRandomUserAgent());

  // Validate wait time
  if (waitMs < 0 || waitMs > 60000) {
    throw new WebPeelError('Wait time must be between 0 and 60000ms');
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  // SECURITY: Validate custom headers if provided
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      // Block Host header override
      if (key.toLowerCase() === 'host') {
        throw new WebPeelError('Custom Host header is not allowed');
      }
      if (typeof value !== 'string' || value.length > 500) {
        throw new WebPeelError('Invalid header value');
      }
    }
  }

  // SECURITY: Limit concurrent browser pages with timeout
  const queueStartTime = Date.now();
  const QUEUE_TIMEOUT_MS = 30000; // 30 second max wait

  while (activePagesCount >= MAX_CONCURRENT_PAGES) {
    if (Date.now() - queueStartTime > QUEUE_TIMEOUT_MS) {
      throw new TimeoutError('Browser page queue timeout - too many concurrent requests');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activePagesCount++;
  let page: Page | null = null;
  let usingPooledPage = false;
  let abortHandler: (() => void) | undefined;
  // Declared here (outside try) so the finally block can reference it
  const usingProfileBrowser = !!profileDir;
  // Owned context created when storageState injection is requested
  let ownedContext: import('playwright').BrowserContext | undefined;

  try {
    const browser = usingProfileBrowser
      ? await getProfileBrowser(profileDir!, headed, stealth)
      : stealth
        ? await getStealthBrowser()
        : await getBrowser();

    // Only use the shared page pool for non-stealth, non-profile, non-keepOpen, non-storageState fetches
    const shouldUsePagePool = !stealth && !userAgent && !keepPageOpen && !usingProfileBrowser && !storageState;
    if (shouldUsePagePool) {
      page = takePooledPage();
      usingPooledPage = !!page;
      if (usingPooledPage && pooledPages.size < PAGE_POOL_SIZE) {
        void ensurePagePool(browser).catch(() => {});
      }
    }

    if (!page) {
      const fetchVp = getRandomViewport();
      const pageOptions = {
        userAgent: validatedUserAgent,
        // viewport: null lets the browser use its natural window size (set via --window-size),
        // avoiding the telltale Playwright default of 1280×720.
        viewport: null as null,
        ...(stealth
          ? {
              locale: 'en-US',
              timezoneId: 'America/New_York',
              javaScriptEnabled: true,
            }
          : {}),
      };

      if (storageState) {
        // Create an isolated context with the injected storage state (cookies + localStorage)
        ownedContext = await browser.newContext({
          ...pageOptions,
          storageState,
          viewport: { width: fetchVp.width, height: fetchVp.height },
        });
        page = await ownedContext.newPage();
      } else {
        page = await browser.newPage(pageOptions);
      }
      await applyStealthScripts(page);
      usingPooledPage = false;
    } else {
      await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    }

    if (signal) {
      abortHandler = () => {
        if (page && !page.isClosed()) {
          void page.close().catch(() => {});
        }
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    await page.unroute('**/*').catch(() => {});

    const mergedHeaders: Record<string, string> = { ...(headers || {}) };
    if (usingPooledPage) {
      mergedHeaders['User-Agent'] = validatedUserAgent;
    }
    if (usingPooledPage || Object.keys(mergedHeaders).length > 0) {
      await page.setExtraHTTPHeaders(mergedHeaders);
    }

    // Set cookies if provided
    if (cookies && cookies.length > 0) {
      const parsedCookies = cookies.map(cookie => {
        const [nameValue] = cookie.split(';').map(s => s.trim());
        const [name, value] = nameValue.split('=');

        if (!name || value === undefined) {
          throw new WebPeelError(`Invalid cookie format: ${cookie}`);
        }

        return {
          name: name.trim(),
          value: value.trim(),
          url,
        };
      });

      await page.context().addCookies(parsedCookies);
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    // Block images/fonts/etc for speed in non-stealth mode.
    // In stealth mode, blocking common resources can be a bot-detection signal.
    if (!screenshot && !stealth) {
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    } else {
      // For screenshots and stealth mode, allow all resources
      await page.route('**/*', (route) => route.continue());
    }

    // SECURITY: Wrap entire operation in timeout
    let screenshotBuffer: Buffer | undefined;
    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw createAbortError();
      }
    };

    const fetchPromise = (async () => {
      const response = await page!.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      throwIfAborted();

      // Quick check: if body text is very thin, wait for JS to render more content.
      // Only adds latency when the page clearly hasn't loaded yet.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const bodyTextLength = await page!.evaluate('document.body?.innerText?.trim().length || 0').catch(() => 0) as number;
      if (bodyTextLength < 500) {
        await page!.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
        throwIfAborted();
      }

      // DOM stability check: wait for SPA hydration to settle.
      // Polls innerText length every 500ms — if still growing, keep waiting (max 3s extra).
      {
        const stabilityStart = Date.now();
        const MAX_STABILITY_WAIT_MS = 3000;
        const POLL_INTERVAL_MS = 500;
        let prevLength = await page!.evaluate('document.body?.innerText?.length || 0').catch(() => 0) as number;
        let stableCount = 0;

        while (Date.now() - stabilityStart < MAX_STABILITY_WAIT_MS) {
          throwIfAborted();
          await page!.waitForTimeout(POLL_INTERVAL_MS);
          const curLength = await page!.evaluate('document.body?.innerText?.length || 0').catch(() => 0) as number;
          if (curLength === prevLength) {
            stableCount++;
            if (stableCount >= 2) break; // stable for 2 consecutive checks (~1s)
          } else {
            stableCount = 0;
          }
          prevLength = curLength;
        }
      }

      const finalUrl = page!.url();
      const contentType = response?.headers()?.['content-type'] || '';
      const contentTypeLower = contentType.toLowerCase();
      const urlLower = finalUrl.toLowerCase();

      const isPdf = contentTypeLower.includes('application/pdf') || urlLower.endsWith('.pdf');
      const isDocx = contentTypeLower.includes('wordprocessingml.document') || urlLower.endsWith('.docx');
      const isBinaryDoc = !!response && (isPdf || isDocx);

      // Small randomized delay in stealth mode (simulate human behavior)
      // Keep it short — enough to look human, not enough to kill latency
      if (stealth) {
        const extraDelayMs = 200 + Math.floor(Math.random() * 601);
        await page!.waitForTimeout(extraDelayMs);
        throwIfAborted();
      }

      // Wait for additional time if requested (for dynamic content / screenshots)
      if (waitMs > 0) {
        await page!.waitForTimeout(waitMs);
        throwIfAborted();
      }

      // Execute page actions if provided
      if (actions && actions.length > 0) {
        const { executeActions } = await import('./actions.js');
        const actionScreenshot = await executeActions(page!, actions);
        if (actionScreenshot) {
          screenshotBuffer = actionScreenshot;
        }
        throwIfAborted();
      }

      // If the navigation returned a binary document (PDF/DOCX), grab the raw body.
      if (isBinaryDoc) {
        const buffer = await response!.body();
        throwIfAborted();

        // Capture screenshot if requested (and not already captured by actions)
        if (screenshot && !screenshotBuffer) {
          screenshotBuffer = await page!.screenshot({
            fullPage: screenshotFullPage,
            type: 'png',
          });
        }

        return {
          html: '',
          finalUrl,
          buffer,
          contentType,
          statusCode: response!.status(),
        };
      }

      const html = await page!.content();
      throwIfAborted();

      return {
        html,
        finalUrl,
        contentType,
        statusCode: response?.status(),
      };
    })();

    let operationTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      operationTimeout = setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const fetchData = await Promise.race([fetchPromise, timeoutPromise]);
    if (operationTimeout) {
      clearTimeout(operationTimeout);
    }
    const { html, finalUrl } = fetchData;
    const fetchBuffer = 'buffer' in fetchData ? (fetchData as any).buffer as Buffer | undefined : undefined;
    const fetchContentType = 'contentType' in fetchData ? (fetchData as any).contentType as string | undefined : undefined;
    const fetchStatusCode = 'statusCode' in fetchData ? (fetchData as any).statusCode as number | undefined : undefined;
    const isBinaryDoc = !!fetchBuffer;

    // SECURITY: Limit HTML size (skip for binary documents where html is empty)
    if (!isBinaryDoc) {
      if (html.length > 10 * 1024 * 1024) { // 10MB limit
        throw new WebPeelError('Response too large (max 10MB)');
      }

      if (!html || html.length < 100) {
        throw new BlockedError('Empty or suspiciously small response from browser.');
      }

      // Run challenge detection on browser-fetched HTML (covers both regular and stealth modes)
      // Note: skip empty-shell type — that's a rendering quality issue (SPA needs more JS time),
      // not a bot challenge. The caller's escalation logic handles empty-shell separately.
      const browserChallengeResult = detectChallenge(html, fetchStatusCode);
      if (browserChallengeResult.isChallenge && browserChallengeResult.type !== 'empty-shell') {
        throw new BlockedError(
          `Challenge page detected (${browserChallengeResult.type || 'unknown'}, confidence: ${browserChallengeResult.confidence.toFixed(2)}). ` +
          `Site requires human verification. Try a different approach or use a CAPTCHA solving service.`
        );
      }
    }

    // Capture screenshot if requested (and not already captured by actions or document handler)
    if (screenshot && !screenshotBuffer) {
      screenshotBuffer = await page!.screenshot({ 
        fullPage: screenshotFullPage, 
        type: 'png' 
      });
    }

    // If keepPageOpen, return page/browser for caller to use (e.g., branding extraction)
    if (keepPageOpen && page) {
      return {
        html,
        buffer: fetchBuffer,
        url: finalUrl,
        statusCode: fetchStatusCode,
        contentType: fetchContentType,
        screenshot: screenshotBuffer,
        page,
        browser,
      };
    }

    return {
      html,
      buffer: fetchBuffer,
      url: finalUrl,
      statusCode: fetchStatusCode,
      contentType: fetchContentType,
      screenshot: screenshotBuffer,
    };
  } catch (error) {
    if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    if (error instanceof Error && error.message.includes('Timeout')) {
      throw new TimeoutError(`Browser navigation timed out`);
    }

    throw new NetworkError(
      `Browser fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }

    // CRITICAL: Always release/close page and decrement counter (unless keepPageOpen and no error)
    if (page && !keepPageOpen) {
      if (usingPooledPage) {
        await recyclePooledPage(page);
      } else if (ownedContext) {
        // Close the owned context (also closes the page)
        await ownedContext.close().catch(() => {});
      } else if (!usingProfileBrowser) {
        // Profile browser pages are NOT closed — the profile browser stays alive
        // so that the next fetch in the same process reuses the session.
        await page.close().catch(() => {});
      }
    }
    activePagesCount--;
  }
}

/**
 * Retry a fetch operation with exponential backoff
 */
export async function browserScreenshot(
  url: string,
  options: {
    fullPage?: boolean;
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    waitMs?: number;
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    actions?: Array<{
      type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
      selector?: string;
      value?: string;
      key?: string;
      ms?: number;
      to?: 'top' | 'bottom' | number;
      timeout?: number;
    }>;
  } = {}
): Promise<{ buffer: Buffer; finalUrl: string }> {
  // SECURITY: Validate URL to prevent SSRF
  validateUrl(url);

  const {
    fullPage = false,
    width,
    height,
    format = 'png',
    quality,
    waitMs = 0,
    timeoutMs = 30000,
    userAgent,
    headers,
    cookies,
    stealth = false,
    actions,
  } = options;

  const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();

  // Basic validation
  if (waitMs < 0 || waitMs > 60000) {
    throw new WebPeelError('Wait time must be between 0 and 60000ms');
  }
  if (timeoutMs < 1000 || timeoutMs > 120000) {
    throw new WebPeelError('Timeout must be between 1000 and 120000ms');
  }

  if (width !== undefined && (!Number.isFinite(width) || width < 100 || width > 5000)) {
    throw new WebPeelError('Width must be between 100 and 5000');
  }
  if (height !== undefined && (!Number.isFinite(height) || height < 100 || height > 5000)) {
    throw new WebPeelError('Height must be between 100 and 5000');
  }

  if (format !== 'png' && format !== 'jpeg') {
    throw new WebPeelError('Format must be png or jpeg');
  }
  if (format === 'jpeg' && quality !== undefined) {
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new WebPeelError('JPEG quality must be between 1 and 100');
    }
  }

  // SECURITY: Validate custom headers if provided
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'host') {
        throw new WebPeelError('Custom Host header is not allowed');
      }
      if (typeof value !== 'string' || value.length > 500) {
        throw new WebPeelError('Invalid header value');
      }
    }
  }

  // SECURITY: Limit concurrent browser pages with timeout
  const queueStartTime = Date.now();
  const QUEUE_TIMEOUT_MS = 30000;

  while (activePagesCount >= MAX_CONCURRENT_PAGES) {
    if (Date.now() - queueStartTime > QUEUE_TIMEOUT_MS) {
      throw new TimeoutError('Browser page queue timeout - too many concurrent requests');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  activePagesCount++;
  let page: Page | null = null;
  let usingPooledPage = false;

  try {
    const browser = stealth ? await getStealthBrowser() : await getBrowser();

    const shouldUsePagePool = !stealth && !userAgent;
    if (shouldUsePagePool) {
      page = takePooledPage();
      usingPooledPage = !!page;
      if (usingPooledPage && pooledPages.size < PAGE_POOL_SIZE) {
        void ensurePagePool(browser).catch(() => {});
      }
    }

    if (!page) {
      page = await browser.newPage({
        userAgent: validatedUserAgent,
        viewport: width || height ? {
          width: width || 1280,
          height: height || 720,
        } : null, // Use browser window size when no explicit dimensions requested
      });
      await applyStealthScripts(page);
      usingPooledPage = false;
    } else {
      await page.setViewportSize({
        width: width || 1280,
        height: height || 720,
      }).catch(() => {});
    }

    await page.unroute('**/*').catch(() => {});

    const mergedHeaders: Record<string, string> = { ...(headers || {}) };
    if (usingPooledPage) {
      mergedHeaders['User-Agent'] = validatedUserAgent;
    }
    if (usingPooledPage || Object.keys(mergedHeaders).length > 0) {
      await page.setExtraHTTPHeaders(mergedHeaders);
    }

    if (cookies && cookies.length > 0) {
      const parsedCookies = cookies.map(cookie => {
        const [nameValue] = cookie.split(';').map(s => s.trim());
        const [name, value] = nameValue.split('=');

        if (!name || value === undefined) {
          throw new WebPeelError(`Invalid cookie format: ${cookie}`);
        }

        return {
          name: name.trim(),
          value: value.trim(),
          url,
        };
      });

      await page.context().addCookies(parsedCookies);
    }

    // For screenshots, allow all resources
    await page.route('**/*', (route) => route.continue());

    let screenshotBuffer: Buffer | undefined;

    const doWork = (async () => {
      await page!.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      if (waitMs > 0) {
        await page!.waitForTimeout(waitMs);
      }

      if (actions && actions.length > 0) {
        const { executeActions } = await import('./actions.js');
        const actionScreenshot = await executeActions(page!, actions, {
          fullPage,
          type: format,
          quality,
        });
        if (actionScreenshot) {
          screenshotBuffer = actionScreenshot;
        }
      }

      const finalUrl = page!.url();

      // Capture screenshot if not captured via actions
      if (!screenshotBuffer) {
        screenshotBuffer = await page!.screenshot({
          fullPage,
          type: format,
          ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
        });
      }

      return { finalUrl, screenshotBuffer: screenshotBuffer! };
    })();

    let operationTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      operationTimeout = setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const { finalUrl, screenshotBuffer: buf } = await Promise.race([doWork, timeoutPromise]);
    if (operationTimeout) {
      clearTimeout(operationTimeout);
    }

    return { buffer: buf, finalUrl };
  } catch (error) {
    if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) {
      throw error;
    }

    if (error instanceof Error && error.message.includes('Timeout')) {
      throw new TimeoutError('Browser screenshot timed out');
    }

    throw new NetworkError(
      `Browser screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    if (page) {
      if (usingPooledPage) {
        await recyclePooledPage(page);
      } else {
        await page.close().catch(() => {});
      }
    }
    activePagesCount--;
  }
}

export async function retryFetch<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Don't retry on blocked errors or timeouts
      if (error instanceof BlockedError || error instanceof TimeoutError) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new NetworkError('Retry failed');
}

/**
 * Scroll to the bottom of the page N times, waiting for the network to
 * settle between each scroll.  Useful for triggering lazy-loaded content
 * (infinite scroll, deferred images, etc.).
 *
 * @param page   - Playwright Page instance.
 * @param times  - Number of scroll-and-wait cycles (default: 3).
 * @returns        The final page HTML after all scrolls complete.
 */
export async function scrollAndWait(page: Page, times = 3): Promise<string> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');

    // Wait for network to settle (500 ms of no new requests) or 2 s max.
    try {
      await page.waitForLoadState('networkidle', { timeout: 2000 });
    } catch {
      // networkidle may never fire — fall back to a flat delay.
      await page.waitForTimeout(1000);
    }
  }

  return page.content();
}

/**
 * Clean up browser resources (shared pool, stealth browser, and all profile browsers).
 */
export async function cleanup(): Promise<void> {
  const pagesToClose = Array.from(pooledPages);
  pooledPages.clear();
  idlePagePool.length = 0;
  pagePoolFillPromise = null;

  await Promise.all(pagesToClose.map((page) => page.close().catch(() => {})));

  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
  if (sharedStealthBrowser) {
    await sharedStealthBrowser.close();
    sharedStealthBrowser = null;
  }

  // Close all persistent profile browsers
  const profileBrowserList = Array.from(profileBrowsers.values());
  profileBrowsers.clear();
  await Promise.all(profileBrowserList.map(b => b.close().catch(() => {})));

  await closePool().catch(() => {});
}

/**
 * Close a specific persistent profile browser (e.g. when done with a session).
 * Safe to call even if the browser has already been closed.
 *
 * @param profileDir Path to the profile directory used when launching
 */
export async function closeProfileBrowser(profileDir: string): Promise<void> {
  const browser = profileBrowsers.get(profileDir);
  if (browser) {
    profileBrowsers.delete(profileDir);
    await browser.close().catch(() => {});
  }
}
