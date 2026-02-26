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
import { detectChallenge } from './challenge-detection.js';
import {
  getStrategyHooks,
  type StrategyResult,
  type DomainRecommendation,
} from './strategy-hooks.js';

// Re-export StrategyResult so existing consumers don't break.
export type { StrategyResult } from './strategy-hooks.js';

/* ---------- hardcoded domain rules -------------------------------------- */

function shouldForceBrowser(url: string): DomainRecommendation | null {
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
    ];
    for (const domain of stealthDomains) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return { mode: 'stealth' };
      }
    }
  } catch (e) {
    // Ignore URL parsing errors; validation happens inside fetchers.
    if (process.env.DEBUG) console.debug('[webpeel]', 'stealth domain URL parse failed:', e instanceof Error ? e.message : e);
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
    if (process.env.DEBUG) console.debug('[webpeel]', 'DNS prefetch URL parse failed:', e instanceof Error ? e.message : e);
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
  waitUntil?: string;
  waitSelector?: string;
  blockResources?: string[];
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
    waitUntil,
    waitSelector,
    blockResources,
  } = options;

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
      waitUntil,
      waitSelector,
      blockResources,
    });

    return {
      ...result,
      method: effectiveStealth ? 'stealth' : 'browser',
    };
  } catch (error) {
    if (isAbortError(error)) throw error;

    // If browser gets blocked, try stealth as fallback (unless already stealth)
    if (!effectiveStealth && error instanceof BlockedError) {
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
      });
      return { ...result, method: 'stealth' };
    }

    // If Cloudflare detected, retry with extra wait time
    if (
      error instanceof NetworkError &&
      error.message.toLowerCase().includes('cloudflare')
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
      });
      return { ...result, method: effectiveStealth ? 'stealth' : 'browser' };
    }

    // If network error (HTTP/2 protocol, connection refused, etc.), try stealth as fallback
    if (!effectiveStealth && error instanceof NetworkError) {
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
    waitUntil,
    waitSelector,
    blockResources,
    cloaked = false,
    cycle = false,
    tls = false,
  } = options;
  const usePeelTLS = tls || cycle;

  // Build effective proxy list: explicit proxies array, or single proxy, or empty
  const effectiveProxies: (string | undefined)[] =
    proxies?.length ? proxies :
    proxy ? [proxy] :
    [undefined]; // undefined = direct connection (no proxy)
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
      const { cloakFetch, isCloakBrowserAvailable } = await import('./cloak-fetch.js');
      if (!isCloakBrowserAvailable()) {
        throw new Error('CloakBrowser not installed. Run: npm install cloakbrowser playwright-core');
      }
      if (process.env.DEBUG) console.debug('[webpeel]', 'Using CloakBrowser stealth (explicitly requested)');
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
      if (process.env.DEBUG) console.debug('[webpeel]', 'Using PeelTLS fingerprint spoofing (explicitly requested)');
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
            if (process.env.DEBUG) console.debug('[webpeel]', 'background cache revalidation failed:', e instanceof Error ? e.message : e);
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
    waitUntil,
    waitSelector,
    blockResources,
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
      // Check if the content is suspiciously thin or has SPA indicators — escalate to browser if so
      if (shouldEscalateForLowContent(simpleOrTimeout.result) || hasSpaIndicators(simpleOrTimeout.result.html)) {
        shouldUseBrowser = true;
      } else {
        // Check whether the response is a bot-challenge page (e.g. Cloudflare, PerimeterX)
        const challengeCheck = detectChallenge(
          simpleOrTimeout.result.html,
          simpleOrTimeout.result.statusCode,
        );
        if (challengeCheck.isChallenge && challengeCheck.confidence >= 0.7) {
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
      if (!shouldEscalateSimpleError(simpleOrTimeout.error)) {
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
          if (process.env.DEBUG) console.debug('[webpeel]', 'fetch race resolution failed:', e instanceof Error ? e.message : e);
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
          // Check if the content is suspiciously thin or has SPA indicators — escalate to browser if so
          if (shouldEscalateForLowContent(simpleResult.result) || hasSpaIndicators(simpleResult.result.html)) {
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
            if (process.env.DEBUG) console.debug('[webpeel]', 'Escalating to PeelTLS fingerprint spoofing');
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
            if (process.env.DEBUG) console.debug('[webpeel]', 'PeelTLS still challenged, escalating to CloakBrowser');
          }
        } catch (peelError) {
          if (process.env.DEBUG) console.debug('[webpeel]', 'PeelTLS failed:', peelError instanceof Error ? peelError.message : peelError);
          // Fall through to CloakBrowser
        }
      }

      // If still challenged after PeelTLS, try Cloudflare Worker proxy (clean edge IPs)
      if (finalResult.challengeDetected) {
        try {
          const { cfWorkerFetch, isCfWorkerAvailable } = await import('./cf-worker-proxy.js');
          if (isCfWorkerAvailable()) {
            if (process.env.DEBUG) console.debug('[webpeel]', 'Escalating to CF Worker proxy');
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
            if (process.env.DEBUG) console.debug('[webpeel]', 'CF Worker still challenged, escalating to CloakBrowser');
          }
        } catch (cfError) {
          if (process.env.DEBUG) console.debug('[webpeel]', 'CF Worker proxy failed:', cfError instanceof Error ? cfError.message : cfError);
        }
      }

      // If still challenged after CF Worker, try CloakBrowser
      if (finalResult.challengeDetected) {
        try {
          const { cloakFetch, isCloakBrowserAvailable } = await import('./cloak-fetch.js');
          if (isCloakBrowserAvailable()) {
            if (process.env.DEBUG) console.debug('[webpeel]', 'Escalating to CloakBrowser stealth');
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
          if (process.env.DEBUG) console.debug('[webpeel]', 'CloakBrowser failed:', cloakError instanceof Error ? cloakError.message : cloakError);
          // Fall through to Google Cache fallback
        }
      }

      // If still challenged after PeelTLS/CloakBrowser, try Google Cache
      if (finalResult.challengeDetected) {
        try {
          const { fetchGoogleCache } = await import('./google-cache.js');
          const cacheResult = await fetchGoogleCache(url, { timeout: timeoutMs });
          if (cacheResult && cacheResult.html.length > 200) {
            if (process.env.DEBUG) console.debug('[webpeel]', 'Using Google Cache fallback');
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
          if (process.env.DEBUG) console.debug('[webpeel]', 'Google Cache failed:', cacheError);
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
      if (process.env.DEBUG) console.debug('[webpeel]', `proxy ${currentProxy || 'direct'} failed:`, e instanceof Error ? e.message : e);
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
