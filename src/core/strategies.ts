/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */

import { simpleFetch, browserFetch, retryFetch, type FetchResult } from './fetcher.js';
import { getCachedAsync, setCached } from './cache.js';
import { BlockedError, NetworkError } from '../types.js';

type ForcedRecommendation = { mode: 'browser' | 'stealth' };

function shouldForceBrowser(url: string): ForcedRecommendation | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Reddit often returns an HTML shell via simple fetch; browser rendering is needed for real content
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
      return { mode: 'browser' };
    }

    // npmjs blocks simple fetch with 403 frequently
    if (
      hostname === 'npmjs.com' ||
      hostname === 'www.npmjs.com' ||
      hostname.endsWith('.npmjs.com')
    ) {
      return { mode: 'browser' };
    }

    // StackOverflow commonly serves shell-like content to simple fetch clients
    // Note: NOT forced — let the shell-page detector escalate naturally
    // since SO needs extra wait time that the escalation path handles better

    // These are known to aggressively block automation; go straight to stealth
    if (hostname === 'glassdoor.com' || hostname.endsWith('.glassdoor.com')) {
      return { mode: 'stealth' };
    }

    if (hostname === 'bloomberg.com' || hostname.endsWith('.bloomberg.com')) {
      return { mode: 'stealth' };
    }

    // Indeed uses Cloudflare aggressively on job detail pages
    if (hostname === 'indeed.com' || hostname.endsWith('.indeed.com')) {
      return { mode: 'stealth' };
    }
  } catch {
    // Ignore URL parsing errors here; validation happens inside fetchers
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function shouldEscalateSimpleError(error: unknown): boolean {
  if (error instanceof BlockedError) {
    return true;
  }

  return error instanceof NetworkError && error.message.includes('TLS/SSL');
}

function looksLikeShellPage(result: FetchResult): boolean {
  const contentTypeLower = (result.contentType || '').toLowerCase();
  if (!contentTypeLower.includes('html')) {
    return false;
  }

  const textContent = result.html.replace(/<[^>]*>/g, '').trim();
  return textContent.length < 500 && result.html.length > 1000;
}

export interface StrategyOptions {
  /** Force browser mode (skip simple fetch) */
  forceBrowser?: boolean;
  /** Use stealth mode to bypass bot detection */
  stealth?: boolean;
  /** Wait time after page load in browser mode (ms) */
  waitMs?: number;
  /** Custom user agent */
  userAgent?: string;
  /** Request timeout (ms) */
  timeoutMs?: number;
  /** Capture a screenshot of the page */
  screenshot?: boolean;
  /** Full-page screenshot (default: viewport only) */
  screenshotFullPage?: boolean;
  /** Custom HTTP headers to send */
  headers?: Record<string, string>;
  /** Cookies to set (key=value pairs) */
  cookies?: string[];
  /** Page actions to execute before extraction */
  actions?: Array<{
    type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
    selector?: string;
    value?: string;
    key?: string;
    ms?: number;
    to?: 'top' | 'bottom' | number;
    timeout?: number;
  }>;
  /** Keep browser page open for reuse (caller must close) */
  keepPageOpen?: boolean;
  /** Disable response cache for this request */
  noCache?: boolean;
  /** Time to wait before launching browser in parallel with simple fetch */
  raceTimeoutMs?: number;
  /** Location/language for geo-targeted scraping */
  location?: {
    country?: string;
    languages?: string[];
  };
}

export interface StrategyResult extends FetchResult {
  /** Which strategy succeeded: 'simple' | 'browser' | 'stealth' | 'cached' */
  method: 'simple' | 'browser' | 'stealth' | 'cached';
}

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
}

async function fetchWithBrowserStrategy(url: string, options: BrowserStrategyOptions): Promise<StrategyResult> {
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
    });

    return {
      ...result,
      method: effectiveStealth ? 'stealth' : 'browser',
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    // Strategy 3: If browser gets blocked, try stealth mode as fallback (unless already using stealth)
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
      });

      return {
        ...result,
        method: 'stealth',
      };
    }

    // If browser encounters Cloudflare, retry with extra wait time
    if (error instanceof NetworkError && error.message.toLowerCase().includes('cloudflare')) {
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
      });

      return {
        ...result,
        method: effectiveStealth ? 'stealth' : 'browser',
      };
    }

    throw error;
  }
}

/**
 * Smart fetch with automatic escalation
 */
export async function smartFetch(url: string, options: StrategyOptions = {}): Promise<StrategyResult> {
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
    raceTimeoutMs = 3000,
  } = options;

  // Site-specific escalation overrides
  const forced = shouldForceBrowser(url);
  let effectiveForceBrowser = forceBrowser;
  let effectiveStealth = stealth;

  if (forced) {
    effectiveForceBrowser = true;
    if (forced.mode === 'stealth') {
      effectiveStealth = true;
    }
  }

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

  if (canUseCache) {
    const cached = await getCachedAsync<StrategyResult>(url);
    if (cached) {
      return {
        ...cached,
        method: 'cached',
      };
    }
  }

  // If stealth is requested, force browser mode (stealth requires browser)
  let shouldUseBrowser = effectiveForceBrowser || screenshot || effectiveStealth;

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
  };

  // Strategy 1: Simple fetch (unless browser is forced or screenshot is requested)
  if (!shouldUseBrowser) {
    const simpleAbortController = new AbortController();

    const simplePromise = retryFetch(
      () => simpleFetch(url, userAgent, timeoutMs, headers, simpleAbortController.signal),
      3
    ).then((result) => {
      if (looksLikeShellPage(result)) {
        throw new BlockedError('Shell page detected. Browser rendering required.');
      }
      return result;
    });

    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    const simpleOrTimeout = await Promise.race([
      simplePromise
        .then((result) => ({ type: 'simple-success' as const, result }))
        .catch((error) => ({ type: 'simple-error' as const, error })),
      new Promise<{ type: 'race-timeout' }>((resolve) => {
        raceTimer = setTimeout(() => resolve({ type: 'race-timeout' }), Math.max(raceTimeoutMs, 0));
      }),
    ]);

    if (raceTimer) {
      clearTimeout(raceTimer);
    }

    if (simpleOrTimeout.type === 'simple-success') {
      const strategyResult: StrategyResult = {
        ...simpleOrTimeout.result,
        method: 'simple',
      };
      if (canUseCache) {
        setCached(url, strategyResult);
      }
      return strategyResult;
    }

    if (simpleOrTimeout.type === 'simple-error') {
      if (!shouldEscalateSimpleError(simpleOrTimeout.error)) {
        throw simpleOrTimeout.error;
      }
      shouldUseBrowser = true;
    } else {
      // Simple fetch is slow - start browser in parallel and return whichever succeeds first.
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
        const winner = await Promise.any([simpleCandidate, browserCandidate]);

        if (winner.source === 'simple') {
          browserAbortController.abort();
          const strategyResult: StrategyResult = {
            ...winner.result,
            method: 'simple',
          };
          if (canUseCache) {
            setCached(url, strategyResult);
          }
          return strategyResult;
        }

        simpleAbortController.abort();
        if (canUseCache) {
          setCached(url, winner.result);
        }
        return winner.result;
      } catch {
        // Both failed: prefer non-escalation simple errors, otherwise return browser-side error.
        if (simpleError && !shouldEscalateSimpleError(simpleError) && !isAbortError(simpleError)) {
          throw simpleError;
        }

        if (browserError) {
          throw browserError;
        }

        if (simpleError) {
          throw simpleError;
        }

        throw new Error('Both simple and browser fetch attempts failed');
      }
    }
  }

  const browserResult = await fetchWithBrowserStrategy(url, browserOptions);
  if (canUseCache) {
    setCached(url, browserResult);
  }
  return browserResult;
}
