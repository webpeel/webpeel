/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed.
 *
 * Premium server-side optimisations (SWR cache, domain intelligence, parallel
 * race) are injected via the hook system in `strategy-hooks.ts`.  When no hooks
 * are registered the strategy degrades gracefully to a simple escalation path
 * that works great for CLI / npm library usage.
 */

import { simpleFetch, browserFetch, retryFetch, type FetchResult } from './fetcher.js';
import { getCached, setCached as setBasicCache } from './cache.js';
import { resolveAndCache } from './dns-cache.js';
import { BlockedError, NetworkError } from '../types.js';
import { getWebshareProxyUrl } from './proxy-config.js';
import { detectChallenge } from './challenge-detection.js';
import { browserCircuitBreaker } from './circuit-breaker.js';
import { markProxyExhausted } from './proxy-config.js';
import {
  getStrategyHooks,
  type StrategyResult,
  type DomainRecommendation,
} from './strategy-hooks.js';

// Re-export StrategyResult so existing consumers don't break.
export type { StrategyResult } from './strategy-hooks.js';
import { createLogger } from './logger.js';

const log = createLogger('fetch');

/* ---------- hardcoded domain rules -------------------------------------- */

/**
 * Domains that require a residential proxy to bypass datacenter IP blocks.
 * These sites don't just need stealth — they fingerprint the IP itself and
 * block all cloud/datacenter ranges. Webshare residential proxy bypasses this.
 *
 * When no explicit proxy is set and Webshare is configured, requests to these
 * domains skip the direct (datacenter) attempt and go straight to residential proxy.
 */
const RESIDENTIAL_PROXY_DOMAINS = [
  'zillow.com',
  'yelp.com',
  'pinterest.com',
  'ticketmaster.com',
  'stubhub.com',
  'cargurus.com',
  'realtor.com',
  'redfin.com',
  'apartments.com',
  'trulia.com',
  'homefinder.com',
];

/**
 * Check if a URL matches a domain that requires residential proxy.
 * Returns true if no explicit proxy is set and Webshare env vars are available.
 */
function requiresResidentialProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return RESIDENTIAL_PROXY_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export function shouldForceBrowser(url: string): DomainRecommendation | null {
  // Hashbang URLs (#!) are always JS-routed SPAs — browser rendering required
  if (url.includes('#!')) {
    return { mode: 'browser' };
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Sites that return HTML shells / need JS rendering (browser mode)
    const browserDomains = [
      'reddit.com',       // HTML shell via simple fetch
      'npmjs.com',        // 403 on simple fetch
      'x.com',            // SPA, login wall
      'twitter.com',      // SPA, login wall
      'instagram.com',    // SPA, login wall
      'facebook.com',     // SPA, heavy JS
      'tiktok.com',       // SPA, JS-rendered
      'pinterest.com',    // SPA, JS-rendered
      'airbnb.com',       // heavy SPA
      'medium.com',       // JS-rendered, sometimes login wall
      'substack.com',     // JS-rendered
      'notion.so',        // SPA
      'figma.com',        // SPA
      'canva.com',        // SPA
      'vercel.app',       // Could be any SPA
    ];
    for (const domain of browserDomains) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return { mode: 'browser' };
      }
    }

    // These are known to aggressively block automation — stealth mode required
    const stealthDomains = [
      'glassdoor.com',
      'bloomberg.com',
      'indeed.com',
      'yelp.com',              // aggressive bot detection
      'amazon.com',       // captcha wall on simple/browser fetch
      'zillow.com',       // aggressive bot detection
      'ticketmaster.com', // Distil Networks / PerimeterX
      'stubhub.com',      // PerimeterX / CAPTCHA
      'walmart.com',      // Akamai Bot Manager
      'target.com',       // Akamai Bot Manager
      'bestbuy.com',      // Akamai Bot Manager
      'homedepot.com',    // Akamai Bot Manager
      'lowes.com',        // Akamai Bot Manager
      'costco.com',       // Akamai Bot Manager
      'nike.com',         // Akamai / Shape Security
      'footlocker.com',   // PerimeterX / DataDome
      'realtor.com',      // aggressive bot detection
      'redfin.com',       // aggressive bot detection
      'cloudflare.com',   // Cloudflare challenge pages
      'ebay.com',         // challenge page on simple fetch
      'linkedin.com',     // aggressive bot detection + login walls
      'craigslist.org',   // occasionally blocks automated access
      'etsy.com',         // Akamai protection
      'wayfair.com',      // Akamai protection
      'newegg.com',       // bot detection
      'zappos.com',       // Amazon subsidiary, same protection
      'chewy.com',        // Amazon subsidiary
      'aliexpress.com',   // anti-bot
      'wish.com',         // anti-bot
      'cargurus.com',     // aggressive bot detection
    ];
    for (const domain of stealthDomains) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return { mode: 'stealth' };
      }
    }
  } catch (e) {
    // Ignore URL parsing errors; validation happens inside fetchers.
    log.debug('stealth domain URL parse failed:', e instanceof Error ? e.message : e);
  }

  return null;
}

/* ---------- helpers ------------------------------------------------------ */

/**
 * Detect strong SPA indicators in fetched HTML that suggest browser rendering is required.
 *
 * These patterns indicate a JS-rendered SPA shell page: the server returns a
 * barebones HTML document with an empty root mount point that only gets
 * populated after JavaScript runs in the browser.
 *
 * Auto-render detection complements the domain-list approach in shouldForceBrowser():
 * it catches unknown SPAs that aren't in the hardcoded list.
 */
function hasSpaIndicators(html: string): boolean {
  // Empty SPA root mount points — definitive SPA shell indicators
  const emptyRootPatterns = [
    '<div id="root"></div>',
    '<div id="root"> </div>',
    '<div id="app"></div>',
    '<div id="app"> </div>',
    '<div id="__next"></div>',
    '<div id="__next"> </div>',
    '<div id="___gatsby"></div>',
    '<div id="gatsby-focus-wrapper"></div>',
  ];
  for (const pattern of emptyRootPatterns) {
    if (html.includes(pattern)) return true;
  }

  // <noscript> blocks with "enable JavaScript" messages
  // These are canonical SPA signals — React, Vue, Angular all emit them
  const noscriptMatch = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
  if (noscriptMatch) {
    const noscriptContent = noscriptMatch[1]!.toLowerCase();
    if (
      noscriptContent.includes('enable javascript') ||
      noscriptContent.includes('javascript is required') ||
      noscriptContent.includes('javascript must be enabled') ||
      noscriptContent.includes('requires javascript') ||
      noscriptContent.includes('javascript to run this app') ||
      noscriptContent.includes('you need to enable javascript')
    ) {
      return true;
    }
  }

  // Many script tags + very little visible text = almost certainly an SPA shell.
  // This catches SPAs not matched by the root-div patterns above.
  // Note: shouldEscalateForLowContent() guards html.length > 1500; this fills the gap
  // for smaller pages (e.g. minimal webpack bundles with few/no meta tags).
  const scriptTagCount = (html.match(/<script/gi) || []).length;
  if (scriptTagCount >= 5) {
    // Strip scripts/styles then measure visible text
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Many scripts but almost no readable text → render it
    if (stripped.length < 150) {
      return true;
    }
  }

  return false;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function shouldEscalateSimpleError(error: unknown): boolean {
  if (error instanceof BlockedError) return true;
  return error instanceof NetworkError && error.message.includes('TLS/SSL');
}

function looksLikeShellPage(result: FetchResult): boolean {
  const ct = (result.contentType || '').toLowerCase();
  if (!ct.includes('html')) return false;
  const text = result.html.replace(/<[^>]*>/g, '').trim();
  return text.length < 500 && result.html.length > 1000;
}

/**
 * Detect pages that returned HTML but have very little actual text content.
 * This catches JS-rendered SPAs that return a shell page with a big HTML payload
 * (scripts, styles, framework boilerplate) but minimal visible text.
 */
function shouldEscalateForLowContent(result: FetchResult): boolean {
  const ct = (result.contentType || '').toLowerCase();
  if (!ct.includes('html')) return false;
  if (result.html.length <= 1500) return false;

  // Strip script/style blocks and their contents first, then strip remaining tags
  const withoutScripts = result.html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  const visibleText = withoutScripts.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return visibleText.length < 200;
}

function prefetchDns(url: string): void {
  try {
    const hostname = new URL(url).hostname;
    void resolveAndCache(hostname).catch(() => {});
  } catch (e) {
    // Ignore invalid URL.
    log.debug('DNS prefetch URL parse failed:', e instanceof Error ? e.message : e);
  }
}

/* ---------- public option / result types -------------------------------- */

export interface StrategyOptions {
  forceBrowser?: boolean;
  stealth?: boolean;
  waitMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  screenshot?: boolean;
  screenshotFullPage?: boolean;
  headers?: Record<string, string>;
  cookies?: string[];
  actions?: Array<{
    type:
      | 'wait'
      | 'click'
      | 'scroll'
      | 'type'
      | 'fill'
      | 'select'
      | 'press'
      | 'hover'
      | 'waitForSelector'
      | 'screenshot';
    selector?: string;
    value?: string;
    key?: string;
    ms?: number;
    to?: 'top' | 'bottom' | number;
    timeout?: number;
  }>;
  keepPageOpen?: boolean;
  noCache?: boolean;
  raceTimeoutMs?: number;
  location?: {
    country?: string;
    languages?: string[];
  };
  /**
   * Path to a persistent Chrome user-data-dir.
   * When set, bypasses the shared browser pool so cookies/sessions survive
   * between fetch calls in the same process.
   */
  profileDir?: string;
  /** Launch browser in headed (visible) mode — useful for debugging and profile setup. */
  headed?: boolean;
  /**
   * Playwright storage state (cookies + localStorage) to inject into the browser context.
   * Loaded from a named profile by the CLI profile system.
   */
  storageState?: any;
  /**
   * Proxy URL for routing requests through a proxy server.
   * Supports HTTP, HTTPS, and SOCKS5 proxies.
   * Format: protocol://[user:pass@]host:port
   */
  proxy?: string;
  /** Array of proxy URLs for rotation on failure */
  proxies?: string[];
  /** Device emulation: 'desktop' (default), 'mobile', 'tablet' */
  device?: 'desktop' | 'mobile' | 'tablet';
  /** Browser viewport width in pixels */
  viewportWidth?: number;
  /** Browser viewport height in pixels */
  viewportHeight?: number;
  /** Device scale factor (pixel density) for screenshots */
  deviceScaleFactor?: number;
  /** Wait condition: 'domcontentloaded' (default), 'networkidle', 'load', 'commit' */
  waitUntil?: string;
  /** CSS selector to wait for before extracting content */
  waitSelector?: string;
  /** Block resource types for faster loading: 'image', 'stylesheet', 'font', 'media', 'script' */
  blockResources?: string[];
  /** Use CloakBrowser patched Chromium for maximum stealth */
  cloaked?: boolean;
  /** Use PeelTLS TLS fingerprint spoofing */
  cycle?: boolean; // @deprecated — use tls instead
  /** Use PeelTLS TLS fingerprint spoofing */
  tls?: boolean;
  /**
   * Skip browser escalation on thin/shell content.
   * When true, the simple HTTP result is returned as-is without escalating to browser.
   * Use for Q&A/search workloads where speed matters more than JS-rendered content.
   */
  noEscalate?: boolean;
}

/* ---------- browser-level fetch helper ---------------------------------- */

interface BrowserStrategyOptions {
  userAgent?: string;
  waitMs: number;
  timeoutMs: number;
  screenshot: boolean;
  screenshotFullPage: boolean;
  headers?: Record<string, string>;
  cookies?: string[];
  actions?: StrategyOptions['actions'];
  keepPageOpen: boolean;
  effectiveStealth: boolean;
  signal?: AbortSignal;
  profileDir?: string;
  headed?: boolean;
  storageState?: any;
  proxy?: string;
  device?: 'desktop' | 'mobile' | 'tablet';
  viewportWidth?: number;
  viewportHeight?: number;
  deviceScaleFactor?: number;
  waitUntil?: string;
  waitSelector?: string;
  blockResources?: string[];
  /** Whether the target is a known SPA — enables longer DOM stability wait */
  isSPA?: boolean;
  /** Language preferences to pass to browser (navigator.languages + locale) */
  languages?: string[];
}

async function fetchWithBrowserStrategy(
  url: string,
  options: BrowserStrategyOptions,
): Promise<StrategyResult> {
  const {
    userAgent,
    waitMs,
    timeoutMs,
    screenshot,
    screenshotFullPage,
    headers,
    cookies,
    actions,
    keepPageOpen,
    effectiveStealth,
    signal,
    profileDir,
    headed,
    storageState,
    proxy,
    device,
    viewportWidth,
    viewportHeight,
    deviceScaleFactor,
    waitUntil,
    waitSelector,
    blockResources,
    isSPA,
    languages,
  } = options;

  // Check circuit breaker before attempting any browser launch
  if (!browserCircuitBreaker.canExecute()) {
    throw new Error('Browser circuit breaker OPEN — Chromium unavailable, using HTTP fallback');
  }

  try {
    const result = await browserFetch(url, {
      userAgent,
      waitMs,
      timeoutMs,
      screenshot,
      screenshotFullPage,
      headers,
      cookies,
      stealth: effectiveStealth,
      actions,
      keepPageOpen,
      signal,
      profileDir,
      headed,
      proxy,
      storageState,
      device,
      viewportWidth,
      viewportHeight,
      deviceScaleFactor,
      waitUntil,
      waitSelector,
      blockResources,
      isSPA,
      languages,
    });

    browserCircuitBreaker.recordSuccess();
    return {
      ...result,
      method: effectiveStealth ? 'stealth' : 'browser',
    };
  } catch (error) {
    if (isAbortError(error)) throw error;

    // Trip the circuit breaker on infrastructure errors (not page-level errors)
    const errMsg = (error as Error).message || '';
    const isInfraError =
      errMsg.includes('ERR_TUNNEL') ||
      errMsg.includes('ECONNREFUSED') ||
      errMsg.includes('browser has been closed') ||
      errMsg.includes('Target closed') ||
      errMsg.includes('Protocol error') ||
      errMsg.includes('Session closed') ||
      errMsg.includes('Browser.close') ||
      errMsg.includes('crashed');
    if (isInfraError) {
      // ERR_TUNNEL specifically means proxy is dead (402 bandwidth, connection refused)
      // Disable proxy for 5 minutes so subsequent requests go direct instead of failing.
      // Don't trip the circuit breaker for proxy-only failures — the browser itself is fine,
      // it just needs to run without a proxy.
      if (errMsg.includes('ERR_TUNNEL')) {
        markProxyExhausted('ERR_TUNNEL_CONNECTION_FAILED — proxy bandwidth likely exhausted');
        // Don't count this as a browser infrastructure failure
      } else {
        browserCircuitBreaker.recordFailure(error as Error);
      }
    }

    // If browser gets blocked, try stealth as fallback (unless already stealth)
    if (!effectiveStealth && error instanceof BlockedError && browserCircuitBreaker.canExecute()) {
      const result = await browserFetch(url, {
        userAgent,
        waitMs,
        timeoutMs,
        screenshot,
        screenshotFullPage,
        headers,
        cookies,
        stealth: true,
        actions,
        keepPageOpen,
        signal,
        profileDir,
        headed,
        storageState,
        proxy,
        device,
        viewportWidth,
        viewportHeight,
        deviceScaleFactor,
      });
      return { ...result, method: 'stealth' };
    }

    // If Cloudflare detected, retry with extra wait time
    if (
      error instanceof NetworkError &&
      error.message.toLowerCase().includes('cloudflare') &&
      browserCircuitBreaker.canExecute()
    ) {
      const result = await browserFetch(url, {
        userAgent,
        waitMs: 5000,
        timeoutMs,
        screenshot,
        screenshotFullPage,
        headers,
        cookies,
        stealth: effectiveStealth,
        actions,
        keepPageOpen,
        signal,
        profileDir,
        headed,
        proxy,
        device,
        viewportWidth,
        viewportHeight,
        deviceScaleFactor,
      });
      return { ...result, method: effectiveStealth ? 'stealth' : 'browser' };
    }

    // If network error (HTTP/2 protocol, connection refused, etc.), try stealth as fallback
    if (!effectiveStealth && error instanceof NetworkError && browserCircuitBreaker.canExecute()) {
      try {
        const result = await browserFetch(url, {
          userAgent,
          waitMs,
          timeoutMs,
          screenshot,
          screenshotFullPage,
          headers,
          cookies,
          stealth: true,
          actions,
          keepPageOpen,
          signal,
          profileDir,
          headed,
          storageState,
          proxy,
          device,
          viewportWidth,
          viewportHeight,
          deviceScaleFactor,
        });
        return { ...result, method: 'stealth' };
      } catch (stealthError) {
        // Stealth also failed — throw original error with helpful message
        throw error;
      }
    }

    throw error;
  }
}

/* ---------- main entry point -------------------------------------------- */

/**
 * Smart fetch with automatic escalation.
 *
 * Without hooks: simple fetch → browser → stealth escalation.
 * With premium hooks: SWR cache → domain intel → parallel race → escalation.
 */
export async function smartFetch(
  url: string,
  options: StrategyOptions = {},
): Promise<StrategyResult> {
  const {
    forceBrowser = false,
    stealth = false,
    waitMs = 0,
    userAgent,
    timeoutMs = 30000,
    screenshot = false,
    screenshotFullPage = false,
    headers,
    cookies,
    actions,
    keepPageOpen = false,
    noCache = false,
    raceTimeoutMs = 2000,
    profileDir,
    headed = false,
    storageState,
    proxy,
    proxies,
    device,
    viewportWidth,
    viewportHeight,
    deviceScaleFactor,
    waitUntil,
    waitSelector,
    blockResources,
    cloaked = false,
    cycle = false,
    tls = false,
    noEscalate = false,
    location,
  } = options;
  const usePeelTLS = tls || cycle;

  // Build effective proxy list: explicit proxies array, or single proxy, or empty.
  // For domains that require residential proxies (Zillow, Yelp, Pinterest, etc.),
  // skip the direct datacenter connection entirely and go straight to Webshare.
  // For all other domains, try direct first (fast), then Webshare as fallback.
  const effectiveProxies: (string | undefined)[] =
    proxies?.length ? proxies :
    proxy ? [proxy] :
    (() => {
      const wsUrl = getWebshareProxyUrl();
      if (!wsUrl) return [undefined];
      // Skip datacenter IP for known residential-proxy-required domains
      if (requiresResidentialProxy(url)) {
        log.debug('Residential proxy domain detected — skipping datacenter IP, using Webshare directly');
        return [wsUrl];
      }
      return [undefined, wsUrl];
    })();
  const firstProxy = effectiveProxies[0];

  const hooks = getStrategyHooks();
  const fetchStartMs = Date.now();

  const recordMethod = (method: StrategyResult['method']): void => {
    if (method === 'cached' || method === 'cloaked' || method === 'cycle' || method === 'peeltls' || method === 'cf-worker' || method === 'google-cache') return;
    hooks.recordDomainResult?.(url, method, Date.now() - fetchStartMs);
  };

  /* ---- determine effective mode ---------------------------------------- */

  // Hardcoded rules always take priority, then hook-based domain intelligence.
  const forced = shouldForceBrowser(url);
  const recommended = hooks.getDomainRecommendation?.(url) ?? null;
  const selected = forced ?? recommended;

  let effectiveForceBrowser = forceBrowser;
  let effectiveStealth = stealth;

  if (selected) {
    effectiveForceBrowser = true;
    if (selected.mode === 'stealth') effectiveStealth = true;
  }

  prefetchDns(url);

  /* ---- cache eligibility ----------------------------------------------- */

  const canUseCache =
    !noCache &&
    !effectiveForceBrowser &&
    !effectiveStealth &&
    !screenshot &&
    !keepPageOpen &&
    !actions?.length &&
    !headers &&
    !cookies &&
    waitMs === 0 &&
    !userAgent &&
    !proxy &&
    !proxies?.length;

  /* ---- CloakBrowser direct path (if explicitly requested) -------------- */

  if (cloaked) {
    try {
      // @ts-ignore — proprietary module, gitignored
      const { cloakFetch, isCloakBrowserAvailable } = await import('./cloak-fetch.js');
      if (!isCloakBrowserAvailable()) {
        throw new Error('CloakBrowser not installed. Run: npm install cloakbrowser playwright-core');
      }
      log.debug('Using CloakBrowser stealth (explicitly requested)');
      const result = await cloakFetch({
        url,
        proxy: effectiveProxies[0],
        userAgent,
        viewportWidth,
        viewportHeight,
        waitMs,
        waitSelector,
        waitUntil,
        timeoutMs,
        screenshot,
        screenshotFullPage,
        actions,
        headers,
        headed,
      });
      if (canUseCache && !result.challengeDetected) {
        hooks.setCache?.(url, result) ?? setBasicCache(url, result);
      }
      recordMethod(result.method);
      return result;
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw e; // Don't fall back — user explicitly requested cloaked mode
    }
  }

  /* ---- PeelTLS direct path (if explicitly requested via --tls or --cycle) */

  if (usePeelTLS) {
    try {
      const { peelTLSFetch, isPeelTLSAvailable } = await import('./peel-tls.js');
      if (!isPeelTLSAvailable()) {
        throw new Error('PeelTLS binary not found. Build it with: cd peeltls && bash build.sh');
      }
      log.debug('Using PeelTLS fingerprint spoofing (explicitly requested)');
      const result = await peelTLSFetch(url, {
        proxy: firstProxy,
        headers,
        timeout: timeoutMs,
      });
      const peelResult: StrategyResult = { ...result, method: 'peeltls' };
      if (canUseCache) {
        hooks.setCache?.(url, peelResult) ?? setBasicCache(url, peelResult);
      }
      recordMethod('peeltls');
      return peelResult;
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw e; // Don't fall back — user explicitly requested tls mode
    }
  }

  /* ---- hook-based cache check (premium) -------------------------------- */

  if (canUseCache && hooks.checkCache) {
    const cached = hooks.checkCache(url);
    if (cached) {
      if (cached.stale && hooks.markRevalidating?.(url)) {
        // Background revalidation — fire-and-forget
        void (async () => {
          try {
            const fresh = await simpleFetch(url, userAgent, timeoutMs, undefined, undefined, firstProxy);
            if (!looksLikeShellPage(fresh)) {
              hooks.setCache?.(url, { ...fresh, method: 'simple' as const });
            }
          } catch (e) {
            // Non-fatal: background revalidation failed, stale entry continues serving.
            log.debug('background cache revalidation failed:', e instanceof Error ? e.message : e);
          }
        })();
      }
      return { ...cached.value, method: 'cached' };
    }
  }

  /* ---- basic cache check (non-premium fallback) ------------------------ */

  if (canUseCache && !hooks.checkCache) {
    const basicCached = getCached<StrategyResult>(url);
    if (basicCached) {
      return { ...basicCached, method: 'cached' };
    }
  }

  /* ---- browser-level options ------------------------------------------- */

  let shouldUseBrowser =
    effectiveForceBrowser || screenshot || effectiveStealth;

  // A profileDir always forces browser mode (profile sessions need a real browser)
  if (profileDir) {
    effectiveForceBrowser = true;
  }

  // storageState injection requires a browser context
  if (storageState) {
    effectiveForceBrowser = true;
  }

  // Detect SPA for smarter DOM stability wait
  const SPA_FETCH_DOMAINS = new Set([
    'www.google.com', 'flights.google.com', 'www.airbnb.com', 'www.booking.com',
    'www.expedia.com', 'www.kayak.com', 'www.skyscanner.com', 'www.tripadvisor.com',
    'www.indeed.com', 'www.glassdoor.com', 'www.zillow.com', 'app.webpeel.dev',
  ]);
  const SPA_FETCH_URL_PATTERNS = [
    /google\.com\/travel/, /google\.com\/maps/, /google\.com\/shopping/,
  ];
  let isSPAUrl = false;
  try {
    const parsedHostname = new URL(url).hostname;
    isSPAUrl = SPA_FETCH_DOMAINS.has(parsedHostname) || SPA_FETCH_URL_PATTERNS.some(p => p.test(url));
  } catch { /* invalid URL — ignore */ }

  const browserOptions: BrowserStrategyOptions = {
    userAgent,
    waitMs,
    timeoutMs,
    screenshot,
    screenshotFullPage,
    headers,
    cookies,
    actions,
    keepPageOpen,
    effectiveStealth,
    profileDir,
    headed,
    storageState,
    proxy: firstProxy,
    device,
    viewportWidth,
    viewportHeight,
    deviceScaleFactor,
    waitUntil,
    waitSelector,
    blockResources,
    isSPA: isSPAUrl,
    languages: location?.languages,
  };

  /* ---- Strategy: simple fetch (with optional race) --------------------- */

  if (!shouldUseBrowser) {
    const simpleAbortController = new AbortController();

    const simplePromise = retryFetch(
      () =>
        simpleFetch(
          url,
          userAgent,
          timeoutMs,
          headers,
          simpleAbortController.signal,
          firstProxy,
        ),
      3,
    ).then((result) => {
      if (looksLikeShellPage(result) || hasSpaIndicators(result.html)) {
        throw new BlockedError(
          'Shell page detected. Browser rendering required.',
        );
      }
      return result;
    });

    // Determine race timeout — hooks can override
    const useRace = hooks.shouldRace?.() ?? false;
    const effectiveRaceTimeout = useRace
      ? (hooks.getRaceTimeoutMs?.() ?? raceTimeoutMs)
      : raceTimeoutMs;

    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    const simpleOrTimeout = await Promise.race([
      simplePromise
        .then(
          (result) => ({ type: 'simple-success' as const, result }),
        )
        .catch((error) => ({ type: 'simple-error' as const, error })),
      new Promise<{ type: 'race-timeout' }>((resolve) => {
        raceTimer = setTimeout(
          () => resolve({ type: 'race-timeout' }),
          Math.max(effectiveRaceTimeout, 0),
        );
      }),
    ]);

    if (raceTimer) clearTimeout(raceTimer);

    if (simpleOrTimeout.type === 'simple-success') {
      // Skip escalation when noEscalate=true (Q&A workloads that prefer speed over JS rendering)
      if (!noEscalate && (shouldEscalateForLowContent(simpleOrTimeout.result) || hasSpaIndicators(simpleOrTimeout.result.html))) {
        shouldUseBrowser = true;
      } else {
        // Check whether the response is a bot-challenge page (e.g. Cloudflare, PerimeterX)
        // Skip challenge detection when noEscalate=true (can't fix it with browser anyway)
        const challengeCheck = noEscalate ? null : detectChallenge(
          simpleOrTimeout.result.html,
          simpleOrTimeout.result.statusCode,
        );
        if (challengeCheck && challengeCheck.isChallenge && challengeCheck.confidence >= 0.7) {
          // Escalate — the browser/stealth path will handle it below
          shouldUseBrowser = true;
        } else {
          const strategyResult: StrategyResult = {
            ...simpleOrTimeout.result,
            method: 'simple',
          };
          if (canUseCache) {
            hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
          }
          recordMethod('simple');
          return strategyResult;
        }
      }
    }

    if (simpleOrTimeout.type === 'simple-error') {
      // When noEscalate=true, don't try browser on simple fetch error — just throw
      if (noEscalate || !shouldEscalateSimpleError(simpleOrTimeout.error)) {
        throw simpleOrTimeout.error;
      }
      shouldUseBrowser = true;
    } else {
      // Race timeout — only start parallel browser if hooks say to race
      if (useRace) {
        // Parallel race: simple still running, start browser too
        const browserAbortController = new AbortController();
        let simpleError: unknown;
        let browserError: unknown;

        const simpleCandidate = simplePromise
          .then((result) => ({ source: 'simple' as const, result }))
          .catch((error) => {
            simpleError = error;
            throw error;
          });

        const browserCandidate = fetchWithBrowserStrategy(url, {
          ...browserOptions,
          signal: browserAbortController.signal,
        })
          .then((result) => ({ source: 'browser' as const, result }))
          .catch((error) => {
            browserError = error;
            throw error;
          });

        try {
          const winner = await Promise.any([
            simpleCandidate,
            browserCandidate,
          ]);

          if (winner.source === 'simple') {
            browserAbortController.abort();
            const strategyResult: StrategyResult = {
              ...winner.result,
              method: 'simple',
            };
            if (canUseCache) {
              hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
            }
            recordMethod('simple');
            return strategyResult;
          }

          simpleAbortController.abort();
          if (canUseCache) {
            hooks.setCache?.(url, winner.result) ?? setBasicCache(url, winner.result);
          }
          recordMethod(winner.result.method);
          return winner.result;
        } catch (e) {
          // Race resolution failed — determine which error to propagate
          log.debug('fetch race resolution failed:', e instanceof Error ? e.message : e);
          if (
            simpleError &&
            !shouldEscalateSimpleError(simpleError) &&
            !isAbortError(simpleError)
          ) {
            throw simpleError;
          }
          if (browserError) throw browserError;
          if (simpleError) throw simpleError;
          throw new Error(
            'Both simple and browser fetch attempts failed',
          );
        }
      } else {
        // No race — just wait for the simple fetch to finish
        const simpleResult = await simplePromise
          .then(
            (result) => ({ type: 'simple-success' as const, result }),
          )
          .catch((error) => ({ type: 'simple-error' as const, error }));

        if (simpleResult.type === 'simple-success') {
          // Check if the content is suspiciously thin, looks like an SPA shell, or is a shell page
          // (looksLikeShellPage catches partial renders with 200-500 visible chars that
          // shouldEscalateForLowContent misses — improves consistency on sites like China Daily)
          if (
            shouldEscalateForLowContent(simpleResult.result) ||
            hasSpaIndicators(simpleResult.result.html) ||
            looksLikeShellPage(simpleResult.result)
          ) {
            shouldUseBrowser = true;
          } else {
            // Check whether the response is a bot-challenge page
            const challengeCheck = detectChallenge(
              simpleResult.result.html,
              simpleResult.result.statusCode,
            );
            if (challengeCheck.isChallenge && challengeCheck.confidence >= 0.7) {
              shouldUseBrowser = true;
            } else {
              const strategyResult: StrategyResult = {
                ...simpleResult.result,
                method: 'simple',
              };
              if (canUseCache) {
                hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
              }
              recordMethod('simple');
              return strategyResult;
            }
          }
        } else {
          if (!shouldEscalateSimpleError(simpleResult.error)) {
            throw simpleResult.error;
          }
          shouldUseBrowser = true;
        }
      }
    }
  }

  /* ---- simple-with-headers: intermediate step before browser ----------- */
  // Before escalating to the headless browser, retry simple fetch with Googlebot UA
  // and a Google Referer. This catches sites that block generic UAs but return full
  // content to search-engine crawlers without needing JS rendering.
  // Only fires when: we escalated from simple (not forced by domain rules), noEscalate=false.

  if (shouldUseBrowser && !noEscalate && !effectiveForceBrowser && !effectiveStealth && !screenshot) {
    const t0Headers = Date.now();
    log.debug('Escalating: simple → simple-with-headers (Googlebot UA + Google Referer)');
    try {
      const headersResult = await simpleFetch(
        url,
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        timeoutMs,
        {
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://www.google.com/',
        },
        undefined,
        firstProxy,
      );

      const headersChallengeCheck = detectChallenge(headersResult.html, headersResult.statusCode);
      const headersOk =
        !looksLikeShellPage(headersResult) &&
        !hasSpaIndicators(headersResult.html) &&
        !shouldEscalateForLowContent(headersResult) &&
        (!headersChallengeCheck.isChallenge || headersChallengeCheck.confidence < 0.7);

      if (headersOk) {
        log.debug(`simple-with-headers succeeded in ${Date.now() - t0Headers}ms`);
        const strategyResult: StrategyResult = { ...headersResult, method: 'simple' };
        if (canUseCache) {
          hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
        }
        recordMethod('simple');
        return strategyResult;
      }
      log.debug(`simple-with-headers produced thin/blocked content in ${Date.now() - t0Headers}ms, continuing to browser`);
    } catch (e) {
      if (isAbortError(e)) throw e;
      log.debug('simple-with-headers failed:', e instanceof Error ? e.message : e);
    }
  }

  /* ---- browser / stealth fallback with challenge-detection cascade ----- */

  // Try each proxy in sequence until one succeeds
  let lastError: unknown;
  for (let proxyIdx = 0; proxyIdx < effectiveProxies.length; proxyIdx++) {
    const currentProxy = effectiveProxies[proxyIdx];
    const isLastProxy = proxyIdx === effectiveProxies.length - 1;

    try {
      const currentBrowserOptions: BrowserStrategyOptions = { ...browserOptions, proxy: currentProxy };

      // Attempt 1: browser (or stealth, if already forced)
      let finalResult = await fetchWithBrowserStrategy(url, currentBrowserOptions);

      // browser-with-wait: if browser returned thin content (SPA may not have fully loaded),
      // retry with a 3-second networkidle wait before escalating to stealth mode.
      // This handles dynamic SPAs where the initial browser fetch catches a partial render.
      if (!currentBrowserOptions.effectiveStealth && shouldEscalateForLowContent(finalResult)) {
        const t0Wait = Date.now();
        log.debug('browser returned thin content, escalating to browser-with-wait (3s networkidle)');
        try {
          const browserWaitResult = await fetchWithBrowserStrategy(url, {
            ...currentBrowserOptions,
            waitMs: Math.max(currentBrowserOptions.waitMs, 3000),
            waitUntil: 'networkidle',
          });
          log.debug(`browser-with-wait done in ${Date.now() - t0Wait}ms`);
          // Accept the wait result if it has more content (even if still thin — it's better than nothing)
          if (
            !shouldEscalateForLowContent(browserWaitResult) ||
            browserWaitResult.html.length > finalResult.html.length
          ) {
            finalResult = browserWaitResult;
          }
        } catch (e) {
          log.debug('browser-with-wait failed:', e instanceof Error ? e.message : e);
        }
      }

      // Check if the browser result is itself a bot-challenge page
      const browserChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);

      if (browserChallengeCheck.isChallenge && browserChallengeCheck.confidence >= 0.7) {
        if (!currentBrowserOptions.effectiveStealth) {
          // Attempt 2: escalate to stealth
          const stealthOptions: BrowserStrategyOptions = {
            ...currentBrowserOptions,
            effectiveStealth: true,
          };
          finalResult = await fetchWithBrowserStrategy(url, stealthOptions);

          const stealthChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);

          if (stealthChallengeCheck.isChallenge && stealthChallengeCheck.confidence >= 0.7) {
            // Attempt 3: stealth + 5s extra wait
            const stealthExtraOptions: BrowserStrategyOptions = {
              ...stealthOptions,
              waitMs: stealthOptions.waitMs + 5000,
            };
            finalResult = await fetchWithBrowserStrategy(url, stealthExtraOptions);

            const finalChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);
            if (finalChallengeCheck.isChallenge && finalChallengeCheck.confidence >= 0.7) {
              if (!isLastProxy) {
                // More proxies to try — move on to the next one
                lastError = new BlockedError(`Challenge detected with proxy ${currentProxy || 'direct'}`);
                continue;
              }
              // Last proxy: give up and return with warning flag (preserve original behaviour)
              finalResult = { ...finalResult, challengeDetected: true };
            }
          }
        } else {
          // Already in stealth mode; retry with 5s extra wait
          const stealthExtraOptions: BrowserStrategyOptions = {
            ...currentBrowserOptions,
            waitMs: currentBrowserOptions.waitMs + 5000,
          };
          finalResult = await fetchWithBrowserStrategy(url, stealthExtraOptions);

          const finalChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);
          if (finalChallengeCheck.isChallenge && finalChallengeCheck.confidence >= 0.7) {
            if (!isLastProxy) {
              // More proxies to try — move on to the next one
              lastError = new BlockedError(`Challenge detected with proxy ${currentProxy || 'direct'}`);
              continue;
            }
            // Last proxy: give up and return with warning flag (preserve original behaviour)
            finalResult = { ...finalResult, challengeDetected: true };
          }
        }
      }

      // If still challenged after stealth+wait, try PeelTLS (TLS fingerprint spoofing)
      if (finalResult.challengeDetected) {
        try {
          const { peelTLSFetch, isPeelTLSAvailable } = await import('./peel-tls.js');
          if (isPeelTLSAvailable()) {
            log.debug('Escalating to PeelTLS fingerprint spoofing');
            const peelResult = await peelTLSFetch(url, {
              proxy: currentProxy,
              headers,
              timeout: timeoutMs,
            });
            const peelStrategyResult: StrategyResult = { ...peelResult, method: 'peeltls' };
            const peelChallengeCheck = detectChallenge(peelResult.html, peelResult.statusCode);
            if (!peelChallengeCheck.isChallenge || peelChallengeCheck.confidence < 0.7) {
              // PeelTLS succeeded
              if (canUseCache) {
                hooks.setCache?.(url, peelStrategyResult) ?? setBasicCache(url, peelStrategyResult);
              }
              recordMethod('peeltls');
              return peelStrategyResult;
            }
            // PeelTLS still challenged — fall through to CloakBrowser
            log.debug('PeelTLS still challenged, escalating to CloakBrowser');
          }
        } catch (peelError) {
          log.debug('PeelTLS failed:', peelError instanceof Error ? peelError.message : peelError);
          // Fall through to CloakBrowser
        }
      }

      // If still challenged after PeelTLS, try Cloudflare Worker proxy (clean edge IPs)
      if (finalResult.challengeDetected) {
        try {
          const { cfWorkerFetch, isCfWorkerAvailable } = await import('./cf-worker-proxy.js');
          if (isCfWorkerAvailable()) {
            log.debug('Escalating to CF Worker proxy');
            const cfResult = await cfWorkerFetch(url, {
              headers,
              timeout: timeoutMs,
            });
            const cfStrategyResult: StrategyResult = { ...cfResult, method: 'cf-worker' as any };
            const cfChallengeCheck = detectChallenge(cfResult.html, cfResult.statusCode);
            if (!cfChallengeCheck.isChallenge || cfChallengeCheck.confidence < 0.7) {
              // CF Worker succeeded
              if (canUseCache) {
                hooks.setCache?.(url, cfStrategyResult) ?? setBasicCache(url, cfStrategyResult);
              }
              recordMethod('cf-worker' as any);
              return cfStrategyResult;
            }
            log.debug('CF Worker still challenged, escalating to CloakBrowser');
          }
        } catch (cfError) {
          log.debug('CF Worker proxy failed:', cfError instanceof Error ? cfError.message : cfError);
        }
      }

      // If still challenged after CF Worker, try CloakBrowser
      if (finalResult.challengeDetected) {
        try {
          // @ts-ignore — proprietary module, gitignored
      const { cloakFetch, isCloakBrowserAvailable } = await import('./cloak-fetch.js');
          if (isCloakBrowserAvailable()) {
            log.debug('Escalating to CloakBrowser stealth');
            const cloakResult = await cloakFetch({
              url,
              proxy: currentProxy,
              userAgent,
              viewportWidth,
              viewportHeight,
              waitMs,
              waitSelector,
              waitUntil,
              timeoutMs,
              screenshot,
              screenshotFullPage,
              actions,
              headers,
              headed,
            });
            if (canUseCache && !cloakResult.challengeDetected) {
              hooks.setCache?.(url, cloakResult) ?? setBasicCache(url, cloakResult);
            }
            recordMethod(cloakResult.method);
            return cloakResult;
          }
        } catch (cloakError) {
          log.debug('CloakBrowser failed:', cloakError instanceof Error ? cloakError.message : cloakError);
          // Fall through to Google Cache fallback
        }
      }

      // If still challenged after PeelTLS/CloakBrowser, try Google Cache
      if (finalResult.challengeDetected) {
        try {
          const { fetchGoogleCache } = await import('./google-cache.js');
          const cacheResult = await fetchGoogleCache(url, { timeout: timeoutMs });
          if (cacheResult && cacheResult.html.length > 200) {
            log.debug('Using Google Cache fallback');
            const cacheStrategyResult: StrategyResult = {
              html: cacheResult.html,
              url: cacheResult.url,
              statusCode: cacheResult.statusCode,
              contentType: 'text/html',
              method: 'google-cache' as any,
            };
            return cacheStrategyResult;
          }
        } catch (cacheError) {
          log.debug('Google Cache failed:', cacheError);
        }
      }

      // Success (or gave up with challengeDetected=true on the last proxy)
      if (canUseCache && !finalResult.challengeDetected) {
        hooks.setCache?.(url, finalResult) ?? setBasicCache(url, finalResult);
      }
      recordMethod(finalResult.method);
      return finalResult;
    } catch (e) {
      lastError = e;
      if (isAbortError(e)) throw e; // Don't retry on abort
      // Log and try next proxy
      log.debug(`proxy ${currentProxy || 'direct'} failed:`, e instanceof Error ? e.message : e);
      // If last proxy, throw below; otherwise continue loop
    }
  }

  // All proxies exhausted — throw the last error
  throw lastError;
}

/* ---------- legacy export for tests ------------------------------------- */

/**
 * @deprecated Use `clearStrategyHooks()` from strategy-hooks.ts instead.
 */
export { clearStrategyHooks as clearDomainIntel } from './strategy-hooks.js';
