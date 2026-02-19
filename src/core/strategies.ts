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
  } catch {
    // Ignore URL parsing errors; validation happens inside fetchers.
  }

  return null;
}

/* ---------- helpers ------------------------------------------------------ */

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
  } catch {
    // Ignore invalid URL.
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
      });
      return { ...result, method: effectiveStealth ? 'stealth' : 'browser' };
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
  } = options;

  const hooks = getStrategyHooks();
  const fetchStartMs = Date.now();

  const recordMethod = (method: StrategyResult['method']): void => {
    if (method === 'cached') return;
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
    !userAgent;

  /* ---- hook-based cache check (premium) -------------------------------- */

  if (canUseCache && hooks.checkCache) {
    const cached = hooks.checkCache(url);
    if (cached) {
      if (cached.stale && hooks.markRevalidating?.(url)) {
        // Background revalidation — fire-and-forget
        void (async () => {
          try {
            const fresh = await simpleFetch(url, userAgent, timeoutMs);
            if (!looksLikeShellPage(fresh)) {
              hooks.setCache?.(url, { ...fresh, method: 'simple' as const });
            }
          } catch {
            // Stale entry continues serving.
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
        ),
      3,
    ).then((result) => {
      if (looksLikeShellPage(result)) {
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
      // Check if the content is suspiciously thin — escalate to browser if so
      if (shouldEscalateForLowContent(simpleOrTimeout.result)) {
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
        } catch {
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
          // Check if the content is suspiciously thin — escalate to browser if so
          if (shouldEscalateForLowContent(simpleResult.result)) {
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

  // Attempt 1: browser (or stealth, if already forced)
  let finalResult = await fetchWithBrowserStrategy(url, browserOptions);

  // Check if the browser result is itself a bot-challenge page
  const browserChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);

  if (browserChallengeCheck.isChallenge && browserChallengeCheck.confidence >= 0.7) {
    if (!browserOptions.effectiveStealth) {
      // Attempt 2: escalate to stealth
      const stealthOptions: BrowserStrategyOptions = {
        ...browserOptions,
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
          // Give up — return with warning flag
          finalResult = { ...finalResult, challengeDetected: true };
        }
      }
    } else {
      // Already in stealth mode; retry with 5s extra wait
      const stealthExtraOptions: BrowserStrategyOptions = {
        ...browserOptions,
        waitMs: browserOptions.waitMs + 5000,
      };
      finalResult = await fetchWithBrowserStrategy(url, stealthExtraOptions);

      const finalChallengeCheck = detectChallenge(finalResult.html, finalResult.statusCode);
      if (finalChallengeCheck.isChallenge && finalChallengeCheck.confidence >= 0.7) {
        // Give up — return with warning flag
        finalResult = { ...finalResult, challengeDetected: true };
      }
    }
  }

  if (canUseCache && !finalResult.challengeDetected) {
    hooks.setCache?.(url, finalResult) ?? setBasicCache(url, finalResult);
  }
  recordMethod(finalResult.method);
  return finalResult;
}

/* ---------- legacy export for tests ------------------------------------- */

/**
 * @deprecated Use `clearStrategyHooks()` from strategy-hooks.ts instead.
 */
export { clearStrategyHooks as clearDomainIntel } from './strategy-hooks.js';
