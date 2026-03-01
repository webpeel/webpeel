/**
 * Browser-based fetching — uses Playwright via the browser pool.
 * Handles browserFetch, browserScreenshot, retryFetch, and scrollAndWait.
 */

import type { Page } from 'playwright';
import type { PageAction } from '../types.js';
import { TimeoutError, BlockedError, NetworkError, WebPeelError } from '../types.js';
import { detectChallenge } from './challenge-detection.js';
import { getRealisticUserAgent } from './user-agents.js';
import {
  getRandomUserAgent,
  applyStealthScripts,
  takePooledPage,
  ensurePagePool,
  recyclePooledPage,
  getBrowser,
  getStealthBrowser,
  getProfileBrowser,
  PAGE_POOL_SIZE,
  MAX_CONCURRENT_PAGES,
  getPooledPagesCount,
} from './browser-pool.js';
import { applyStealthPatches, applyAcceptLanguageHeader } from './stealth-patches.js';
import { validateUrl, validateUserAgent, createAbortError, type FetchResult } from './http-fetch.js';

// ── Concurrency state (owned by this module) ─────────────────────────────────

let activePagesCount = 0;

// ── browserFetch ──────────────────────────────────────────────────────────────

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
    /**
     * Proxy URL for routing browser requests through a proxy server.
     * Supports HTTP, HTTPS, and SOCKS5 proxies.
     * Format: protocol://[user:pass@]host:port
     * Examples: 'http://proxy.example.com:8080', 'socks5://user:pass@host:1080'
     */
    proxy?: string;
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
    proxy,
    device = 'desktop',
    viewportWidth: optViewportWidth,
    viewportHeight: optViewportHeight,
    waitUntil: optWaitUntil,
    waitSelector,
    blockResources,
  } = options;

  // Device emulation profiles
  const deviceProfiles = {
    desktop: { width: 1920, height: 1080, userAgent: undefined as string | undefined },
    mobile: {
      width: 390,
      height: 844,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
    tablet: {
      width: 820,
      height: 1180,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  };
  const deviceProfile = deviceProfiles[device] ?? deviceProfiles.desktop;
  const effectiveViewportWidth = optViewportWidth ?? deviceProfile.width;
  const effectiveViewportHeight = optViewportHeight ?? deviceProfile.height;
  const effectiveWaitUntil = (optWaitUntil as 'domcontentloaded' | 'networkidle' | 'load' | 'commit') || 'domcontentloaded';

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

    // Only use the shared page pool for non-stealth, non-profile, non-keepOpen, non-storageState, non-proxy fetches
    const shouldUsePagePool = !stealth && !userAgent && !keepPageOpen && !usingProfileBrowser && !storageState && !proxy;
    if (shouldUsePagePool) {
      page = takePooledPage();
      usingPooledPage = !!page;
      if (usingPooledPage && getPooledPagesCount() < PAGE_POOL_SIZE) {
        void ensurePagePool(browser).catch(() => {});
      }
    }

    if (!page) {
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

      if (proxy) {
        // Parse proxy URL to extract auth credentials for Playwright
        let playwrightProxy: { server: string; username?: string; password?: string };
        try {
          const proxyUrl = new URL(proxy);
          playwrightProxy = {
            server: `${proxyUrl.protocol}//${proxyUrl.host}`,
            username: proxyUrl.username || undefined,
            password: proxyUrl.password || undefined,
          };
        } catch (e) {
          // Fallback: use proxy string as-is
          if (process.env.DEBUG) console.debug('[webpeel]', 'proxy URL parse failed, using as-is:', e instanceof Error ? e.message : e);
          playwrightProxy = { server: proxy };
        }

        // Create an isolated context with the proxy and optional storageState
        ownedContext = await browser.newContext({
          ...pageOptions,
          proxy: playwrightProxy,
          viewport: { width: effectiveViewportWidth, height: effectiveViewportHeight },
          ...(storageState ? { storageState } : {}),
        });
        page = await ownedContext.newPage();
      } else if (storageState) {
        // Create an isolated context with the injected storage state (cookies + localStorage)
        ownedContext = await browser.newContext({
          ...pageOptions,
          storageState,
          viewport: { width: effectiveViewportWidth, height: effectiveViewportHeight },
        });
        page = await ownedContext.newPage();
      } else {
        page = await browser.newPage(pageOptions);
        // Apply viewport for device emulation or explicit viewport overrides
        if (device !== 'desktop' || optViewportWidth !== undefined || optViewportHeight !== undefined) {
          await page.setViewportSize({ width: effectiveViewportWidth, height: effectiveViewportHeight }).catch(() => {});
        }
      }
      await applyStealthScripts(page);
      // Apply supplemental stealth patches (canvas noise, connection API, battery, etc.)
      // These go beyond what puppeteer-extra-plugin-stealth provides.
      if (stealth) {
        await applyStealthPatches(page);
        await applyAcceptLanguageHeader(page, 'en-US');
      }
      usingPooledPage = false;
    } else {
      await page.setViewportSize({ width: effectiveViewportWidth, height: effectiveViewportHeight }).catch(() => {});
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
    // Apply device user-agent (mobile/tablet) unless caller overrode userAgent
    if (deviceProfile.userAgent && !userAgent) {
      mergedHeaders['User-Agent'] = deviceProfile.userAgent;
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

    // Block resources: custom list takes precedence; otherwise use defaults in non-screenshot/non-stealth mode.
    // In stealth mode, blocking common resources can be a bot-detection signal.
    if (blockResources && blockResources.length > 0) {
      const blockedTypes = new Set(blockResources);
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (blockedTypes.has(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    } else if (!screenshot && !stealth) {
      // Default: block images/fonts/etc for speed in non-stealth mode.
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
      let response;
      try {
        response = await page!.goto(url, {
          waitUntil: effectiveWaitUntil,
          timeout: timeoutMs,
        });
      } catch (gotoError: any) {
        const msg = gotoError?.message || String(gotoError);
        if (/net::ERR_HTTP2_PROTOCOL_ERROR/i.test(msg)) {
          throw new BlockedError(`Site blocked the request (HTTP/2 protocol error). The site likely has anti-bot protection. Try using stealth mode or a proxy.`);
        }
        if (/net::ERR_CONNECTION_REFUSED/i.test(msg)) {
          throw new NetworkError(`Connection refused by the server at ${url}. The server may be down or blocking your IP.`);
        }
        if (/net::ERR_CONNECTION_RESET/i.test(msg)) {
          throw new BlockedError(`Connection was reset by the server. This typically indicates anti-bot protection or IP blocking. Try using stealth mode or a different IP.`);
        }
        if (/net::ERR_SSL/i.test(msg)) {
          throw new NetworkError(`SSL/TLS error connecting to site. URL: ${url}`);
        }
        if (/net::ERR_NAME_NOT_RESOLVED/i.test(msg)) {
          throw new NetworkError(`Domain not found: ${url}`);
        }
        if (/net::ERR_CERT/i.test(msg)) {
          throw new NetworkError(`SSL certificate error for ${url}`);
        }
        if (/NS_ERROR_NET_RESET/i.test(msg)) {
          throw new NetworkError(`Connection reset (Firefox). The site may be blocking automated access. URL: ${url}`);
        }
        if (/timeout/i.test(msg)) {
          throw new TimeoutError(`Page load timed out after ${timeoutMs}ms: ${url}`);
        }
        if (/net::ERR_/i.test(msg)) {
          throw new NetworkError(`Browser network error: ${msg.match(/net::ERR_\w+/i)?.[0] || msg}`);
        }
        throw gotoError;
      }
      throwIfAborted();

      // Wait for a specific CSS selector if requested
      if (waitSelector) {
        await page!.waitForSelector(waitSelector, { timeout: timeoutMs }).catch(() => {
          if (process.env.DEBUG) console.debug('[webpeel]', `waitSelector "${waitSelector}" not found within timeout`);
        });
        throwIfAborted();
      }

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

// ── browserScreenshot ─────────────────────────────────────────────────────────

/**
 * Capture a screenshot of a URL using headless Chromium via Playwright.
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
      to?: 'top' | 'bottom' | number | { x: number; y: number };
      timeout?: number;
    }>;
    scrollThrough?: boolean;
    selector?: string;
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
    scrollThrough = false,
    selector,
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
      if (usingPooledPage && getPooledPagesCount() < PAGE_POOL_SIZE) {
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
      try {
        await page!.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
      } catch (gotoError: any) {
        const msg = gotoError?.message || String(gotoError);
        if (/net::ERR_HTTP2_PROTOCOL_ERROR/i.test(msg)) {
          throw new BlockedError(`Site blocked the request (HTTP/2 protocol error). The site likely has anti-bot protection. Try using stealth mode or a proxy.`);
        }
        if (/net::ERR_CONNECTION_REFUSED/i.test(msg)) {
          throw new NetworkError(`Connection refused by the server at ${url}. The server may be down or blocking your IP.`);
        }
        if (/net::ERR_CONNECTION_RESET/i.test(msg)) {
          throw new BlockedError(`Connection was reset by the server. This typically indicates anti-bot protection or IP blocking. Try using stealth mode or a different IP.`);
        }
        if (/net::ERR_SSL/i.test(msg)) {
          throw new NetworkError(`SSL/TLS error connecting to site. URL: ${url}`);
        }
        if (/net::ERR_NAME_NOT_RESOLVED/i.test(msg)) {
          throw new NetworkError(`Domain not found: ${url}`);
        }
        if (/net::ERR_CERT/i.test(msg)) {
          throw new NetworkError(`SSL certificate error for ${url}`);
        }
        if (/NS_ERROR_NET_RESET/i.test(msg)) {
          throw new NetworkError(`Connection reset (Firefox). The site may be blocking automated access. URL: ${url}`);
        }
        if (/timeout/i.test(msg)) {
          throw new TimeoutError(`Page load timed out after ${timeoutMs}ms: ${url}`);
        }
        if (/net::ERR_/i.test(msg)) {
          throw new NetworkError(`Browser network error: ${msg.match(/net::ERR_\w+/i)?.[0] || msg}`);
        }
        throw gotoError;
      }

      if (waitMs > 0) {
        await page!.waitForTimeout(waitMs);
      }

      // Element-level screenshot (clip to a specific CSS selector)
      if (selector) {
        const count = await page!.locator(selector).count();
        if (count === 0) throw new WebPeelError(`Element not found: ${selector}`);
        const element = await page!.locator(selector).first();
        const buf = await element.screenshot({
          type: format,
          ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
        });
        return { finalUrl: page!.url(), screenshotBuffer: buf };
      }

      // Scroll through the page to trigger IntersectionObservers, lazy loading, animations
      if (scrollThrough) {
        const scrollHeight = await page!.evaluate(() => document.body.scrollHeight);
        const viewportHeight = await page!.evaluate(() => window.innerHeight);
        // Scroll down in viewport-sized chunks
        for (let y = 0; y < scrollHeight; y += Math.round(viewportHeight * 0.75)) {
          await page!.evaluate((sy: number) => window.scrollTo({ top: sy, behavior: 'instant' }), y);
          await page!.waitForTimeout(250);
        }
        // Hit absolute bottom
        await page!.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
        await page!.waitForTimeout(400);
        // Scroll back to top for the final capture
        await page!.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page!.waitForTimeout(600);
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

// ── browserDiff ───────────────────────────────────────────────────────────────

/**
 * Capture screenshots of two URLs and compute a pixel-level visual diff.
 */
export async function browserDiff(
  url1: string,
  url2: string,
  options: {
    width?: number;
    height?: number;
    fullPage?: boolean;
    threshold?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    stealth?: boolean;
    waitMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<{
  diffBuffer: Buffer;
  diffPixels: number;
  totalPixels: number;
  diffPercent: number;
  dimensions: { width: number; height: number };
}> {
  const {
    width = 1280,
    height = 720,
    fullPage = false,
    threshold = 0.1,
    stealth = false,
    waitMs = 0,
    timeoutMs = 30000,
  } = options;

  // Take both screenshots as PNG (required for pixelmatch)
  const [res1, res2] = await Promise.all([
    browserScreenshot(url1, { width, height, fullPage, format: 'png', stealth, waitMs, timeoutMs }),
    browserScreenshot(url2, { width, height, fullPage, format: 'png', stealth, waitMs, timeoutMs }),
  ]);

  // Dynamically import pngjs and pixelmatch (ESM-compatible)
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;

  const img1 = PNG.sync.read(res1.buffer);
  const img2 = PNG.sync.read(res2.buffer);

  // Use the larger of the two dimensions
  const outWidth = Math.max(img1.width, img2.width);
  const outHeight = Math.max(img1.height, img2.height);

  // Pad images to the same size if needed
  function padImage(img: InstanceType<typeof PNG>, targetW: number, targetH: number): Buffer {
    if (img.width === targetW && img.height === targetH) {
      return img.data as unknown as Buffer;
    }
    const padded = Buffer.alloc(targetW * targetH * 4, 0);
    for (let y = 0; y < img.height && y < targetH; y++) {
      for (let x = 0; x < img.width && x < targetW; x++) {
        const srcIdx = (y * img.width + x) * 4;
        const dstIdx = (y * targetW + x) * 4;
        padded[dstIdx] = (img.data as Buffer)[srcIdx];
        padded[dstIdx + 1] = (img.data as Buffer)[srcIdx + 1];
        padded[dstIdx + 2] = (img.data as Buffer)[srcIdx + 2];
        padded[dstIdx + 3] = (img.data as Buffer)[srcIdx + 3];
      }
    }
    return padded;
  }

  const data1 = padImage(img1, outWidth, outHeight);
  const data2 = padImage(img2, outWidth, outHeight);
  const diffData = Buffer.alloc(outWidth * outHeight * 4);

  const diffPixels = pixelmatch(data1, data2, diffData, outWidth, outHeight, { threshold });
  const totalPixels = outWidth * outHeight;
  const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

  const diffPng = new PNG({ width: outWidth, height: outHeight });
  diffPng.data = diffData;
  const diffBuffer = PNG.sync.write(diffPng);

  return {
    diffBuffer,
    diffPixels,
    totalPixels,
    diffPercent,
    dimensions: { width: outWidth, height: outHeight },
  };
}

// ── retryFetch ────────────────────────────────────────────────────────────────

/**
 * Retry a fetch operation with exponential backoff
 */
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

// ── scrollAndWait ─────────────────────────────────────────────────────────────

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
    } catch (e) {
      // networkidle may never fire — fall back to a flat delay.
      if (process.env.DEBUG) console.debug('[webpeel]', 'networkidle timeout, falling back to flat delay:', e instanceof Error ? e.message : e);
      await page.waitForTimeout(1000);
    }
  }

  return page.content();
}

// ── browserFilmstrip ──────────────────────────────────────────────────────────

/**
 * Capture multiple screenshots at evenly distributed scroll positions.
 * Returns an array of Buffers (one per frame).
 */
export async function browserFilmstrip(
  url: string,
  options: {
    frames?: number;
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
  } = {}
): Promise<{ frames: Buffer[]; finalUrl: string }> {
  validateUrl(url);

  const {
    frames: frameCount = 6,
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
  } = options;

  // Clamp frames between 2 and 12
  const numFrames = Math.max(2, Math.min(12, frameCount));

  const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();

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

  try {
    const browser = stealth ? await getStealthBrowser() : await getBrowser();
    page = await browser.newPage({
      userAgent: validatedUserAgent,
      viewport: { width: width || 1280, height: height || 720 },
    });
    await applyStealthScripts(page);

    if (headers) await page.setExtraHTTPHeaders(headers);

    if (cookies && cookies.length > 0) {
      const parsedCookies = cookies.map(cookie => {
        const [nameValue] = cookie.split(';').map(s => s.trim());
        const [name, value] = nameValue.split('=');
        if (!name || value === undefined) {
          throw new WebPeelError(`Invalid cookie format: ${cookie}`);
        }
        return { name: name.trim(), value: value.trim(), url };
      });
      await page.context().addCookies(parsedCookies);
    }

    await page.route('**/*', (route) => route.continue());

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (gotoError: any) {
      const msg = gotoError?.message || String(gotoError);
      if (/timeout/i.test(msg)) {
        throw new TimeoutError(`Page load timed out after ${timeoutMs}ms: ${url}`);
      }
      if (/net::ERR_/i.test(msg)) {
        throw new NetworkError(`Browser network error: ${msg.match(/net::ERR_\w+/i)?.[0] || msg}`);
      }
      throw gotoError;
    }

    if (waitMs > 0) await page.waitForTimeout(waitMs);

    // Wait a bit for initial animations
    await page.waitForTimeout(800);

    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const capturedFrames: Buffer[] = [];

    // Calculate scroll positions (evenly distributed)
    const positions: number[] = [];
    for (let i = 0; i < numFrames; i++) {
      positions.push(Math.round((scrollHeight - viewportHeight) * i / (numFrames - 1)));
    }

    for (const pos of positions) {
      await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'instant' }), pos);
      await page.waitForTimeout(350); // Let animations settle
      const buf = await page.screenshot({
        type: format,
        ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
      });
      capturedFrames.push(buf);
    }

    const finalUrl = page.url();
    return { frames: capturedFrames, finalUrl };
  } catch (error) {
    if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('Timeout')) {
      throw new TimeoutError('Browser filmstrip timed out');
    }
    throw new NetworkError(
      `Browser filmstrip failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    if (page) await page.close().catch(() => {});
    activePagesCount--;
  }
}

// ── withBrowserPage ───────────────────────────────────────────────────────────

/**
 * Shared boilerplate for the 4 new screenshot functions:
 * - Queue concurrency wait
 * - Launch browser (stealth or normal)
 * - Open a new page with viewport + userAgent
 * - Apply stealth scripts
 * - Set custom headers and cookies
 * - Navigate to the URL (with error normalisation)
 * - Wait optional extra time
 * - Call `fn(page)` for the unique per-function logic
 * - Always close the page and decrement the counter
 *
 * NOTE: Do NOT touch browserFetch / browserScreenshot / browserFilmstrip —
 * they have slightly different pooling / keep-open logic.
 */
async function withBrowserPage<T>(
  url: string,
  opts: {
    width?: number;
    height?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    waitMs?: number;
    timeoutMs?: number;
  },
  fn: (page: Page) => Promise<T>
): Promise<{ result: T; finalUrl: string }> {
  validateUrl(url);

  const {
    width = 1440,
    height = 900,
    userAgent,
    headers,
    cookies,
    stealth = false,
    waitMs = 0,
    timeoutMs = 60000,
  } = opts;

  const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();

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

  try {
    const browser = stealth ? await getStealthBrowser() : await getBrowser();
    page = await browser.newPage({
      userAgent: validatedUserAgent,
      viewport: { width, height },
    });
    await applyStealthScripts(page);

    if (headers) await page.setExtraHTTPHeaders(headers);

    if (cookies && cookies.length > 0) {
      const parsedCookies = cookies.map(cookie => {
        const [nameValue] = cookie.split(';').map((s: string) => s.trim());
        const [name, value] = nameValue.split('=');
        if (!name || value === undefined) throw new WebPeelError(`Invalid cookie format: ${cookie}`);
        return { name: name.trim(), value: value.trim(), url };
      });
      await page.context().addCookies(parsedCookies);
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (gotoError: any) {
      const msg = gotoError?.message || String(gotoError);
      if (/timeout/i.test(msg)) throw new TimeoutError(`Page load timed out after ${timeoutMs}ms: ${url}`);
      if (/net::ERR_/i.test(msg)) throw new NetworkError(`Browser network error: ${msg.match(/net::ERR_\w+/i)?.[0] || msg}`);
      throw gotoError;
    }

    if (waitMs > 0) await page.waitForTimeout(waitMs);

    const result = await fn(page);
    const finalUrl = page.url();
    return { result, finalUrl };
  } catch (error) {
    if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) throw error;
    if (error instanceof Error && error.message.includes('Timeout')) throw new TimeoutError('Browser operation timed out');
    throw new NetworkError(`Browser operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    if (page) await page.close().catch(() => {});
    activePagesCount--;
  }
}

// ── browserAudit ──────────────────────────────────────────────────────────────

/**
 * Section-aware audit screenshots.
 * Finds all elements matching a CSS selector and captures a viewport screenshot
 * scrolled to each one.  Returns one image buffer per matching element.
 */
export async function browserAudit(
  url: string,
  options: {
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    selector?: string;
    waitMs?: number;
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    scrollThrough?: boolean;
  } = {}
): Promise<{
  frames: { index: number; tag: string; id: string; className: string; top: number; height: number; buffer: Buffer }[];
  finalUrl: string;
}> {
  const {
    width = 1440,
    height = 900,
    format = 'jpeg',
    quality = 80,
    selector = 'section',
    waitMs = 0,
    timeoutMs = 60000,
    userAgent,
    headers,
    cookies,
    stealth = false,
    scrollThrough = false,
  } = options;

  const { result: frames, finalUrl } = await withBrowserPage(
    url,
    { width, height, userAgent, headers, cookies, stealth, waitMs, timeoutMs },
    async (page) => {
      // Scroll through to trigger lazy content
      if (scrollThrough) {
        const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
        const vh = await page.evaluate(() => window.innerHeight);
        for (let y = 0; y < scrollHeight; y += Math.round(vh * 0.75)) {
          await page.evaluate((sy: number) => window.scrollTo({ top: sy, behavior: 'instant' }), y);
          await page.waitForTimeout(200);
        }
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(400);
      }

      // Get metadata for all matching elements
      type ElemMeta = { tag: string; id: string; className: string; top: number; height: number };
      const elements: ElemMeta[] = await page.evaluate((sel: string) => {
        const nodes = Array.from(document.querySelectorAll(sel)) as Element[];
        return nodes.map(el => {
          const rect = el.getBoundingClientRect();
          const scrollY = window.scrollY || document.documentElement.scrollTop;
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: el.className || '',
            top: rect.top + scrollY,
            height: rect.height,
          };
        });
      }, selector);

      const capturedFrames: { index: number; tag: string; id: string; className: string; top: number; height: number; buffer: Buffer }[] = [];

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'instant' }), el.top);
        await page.waitForTimeout(200);
        const buf = await page.screenshot({
          type: format,
          ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
        });
        capturedFrames.push({ index: i, ...el, buffer: buf });
      }

      return capturedFrames;
    }
  );

  return { frames, finalUrl };
}

// ── browserAnimationCapture ───────────────────────────────────────────────────

/**
 * Capture N viewport screenshots at fixed intervals to record CSS animation states.
 */
export async function browserAnimationCapture(
  url: string,
  options: {
    frames?: number;
    intervalMs?: number;
    scrollTo?: number;
    selector?: string;
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
  } = {}
): Promise<{ frames: { index: number; timestampMs: number; buffer: Buffer }[]; finalUrl: string }> {
  const {
    frames: frameCount = 6,
    intervalMs = 500,
    scrollTo,
    selector,
    width = 1440,
    height = 900,
    format = 'jpeg',
    quality = 80,
    waitMs = 0,
    timeoutMs = 60000,
    userAgent,
    headers,
    cookies,
    stealth = false,
  } = options;

  const numFrames = Math.max(1, Math.min(30, frameCount));

  const { result: frames, finalUrl } = await withBrowserPage(
    url,
    { width, height, userAgent, headers, cookies, stealth, waitMs, timeoutMs },
    async (page) => {
      // Position the viewport
      if (selector) {
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
        }, selector);
        await page.waitForTimeout(300);
      } else if (typeof scrollTo === 'number') {
        await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'instant' }), scrollTo);
        await page.waitForTimeout(300);
      }

      const capturedFrames: { index: number; timestampMs: number; buffer: Buffer }[] = [];
      const startTime = Date.now();

      for (let i = 0; i < numFrames; i++) {
        const buf = await page.screenshot({
          type: format,
          ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
        });
        capturedFrames.push({ index: i, timestampMs: Date.now() - startTime, buffer: buf });

        if (i < numFrames - 1) {
          await page.waitForTimeout(intervalMs);
        }
      }

      return capturedFrames;
    }
  );

  return { frames, finalUrl };
}

// ── browserViewports ──────────────────────────────────────────────────────────

/**
 * Capture screenshots at multiple viewport widths in a single browser session.
 * Resizes the viewport between each capture.
 */
export async function browserViewports(
  url: string,
  options: {
    viewports: { width: number; height: number; label?: string }[];
    fullPage?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
    waitMs?: number;
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    scrollThrough?: boolean;
  }
): Promise<{ frames: { width: number; height: number; label: string; buffer: Buffer }[]; finalUrl: string }> {
  const {
    viewports,
    fullPage = false,
    format = 'jpeg',
    quality = 80,
    waitMs = 0,
    timeoutMs = 90000,
    userAgent,
    headers,
    cookies,
    stealth = false,
    scrollThrough = false,
  } = options;

  if (!viewports || viewports.length === 0) {
    throw new WebPeelError('At least one viewport is required');
  }

  // Use first viewport dimensions for initial page setup
  const firstVp = viewports[0];

  const { result: frames, finalUrl } = await withBrowserPage(
    url,
    { width: firstVp.width, height: firstVp.height, userAgent, headers, cookies, stealth, waitMs, timeoutMs },
    async (page) => {
      const capturedFrames: { width: number; height: number; label: string; buffer: Buffer }[] = [];

      for (const vp of viewports) {
        const label = vp.label || `${vp.width}x${vp.height}`;

        // Resize viewport
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500); // Wait for reflow

        if (scrollThrough) {
          const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
          const vh = await page.evaluate(() => window.innerHeight);
          for (let y = 0; y < scrollHeight; y += Math.round(vh * 0.75)) {
            await page.evaluate((sy: number) => window.scrollTo({ top: sy, behavior: 'instant' }), y);
            await page.waitForTimeout(150);
          }
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await page.waitForTimeout(300);
        }

        const buf = await page.screenshot({
          fullPage,
          type: format,
          ...(format === 'jpeg' && typeof quality === 'number' ? { quality } : {}),
        });

        capturedFrames.push({ width: vp.width, height: vp.height, label, buffer: buf });
      }

      return capturedFrames;
    }
  );

  return { frames, finalUrl };
}

// ── browserDesignAudit ────────────────────────────────────────────────────────

export interface DesignAuditResult {
  score: number;
  colorScheme: 'light' | 'dark' | 'unknown';
  spacingViolations: { element: string; property: string; value: number; nearestGridValue: number }[];
  touchTargetViolations: { element: string; width: number; height: number; minRequired: number }[];
  contrastViolations: { element: string; textColor: string; bgColor: string; ratio: number; required: number; bgResolved?: boolean }[];
  typography: { fontSizes: string[]; lineHeights: string[]; letterSpacings: string[] };
  spacingScale: number[];
  accessibilityViolations: {
    type: 'missing-alt' | 'missing-label' | 'missing-aria' | 'heading-skip' | 'empty-link' | 'empty-button';
    element: string;
    details: string;
  }[];
  headingStructure: string[];
  summary: string;
}

/**
 * Extract computed CSS values and validate against design rules.
 * Returns structured JSON instead of pixel images.
 */
export async function browserDesignAudit(
  url: string,
  options: {
    rules?: {
      spacingGrid?: number;
      minTouchTarget?: number;
      minContrast?: number;
    };
    selector?: string;
    width?: number;
    height?: number;
    waitMs?: number;
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
  } = {}
): Promise<{ audit: DesignAuditResult; finalUrl: string }> {
  const {
    rules = {},
    selector = 'body',
    width = 1440,
    height = 900,
    waitMs = 0,
    timeoutMs = 60000,
    userAgent,
    headers,
    cookies,
    stealth = false,
  } = options;

  const spacingGrid = rules.spacingGrid ?? 8;
  const minTouchTarget = rules.minTouchTarget ?? 44;
  const minContrast = rules.minContrast ?? 4.5;

  const { result: auditData, finalUrl } = await withBrowserPage(
    url,
    { width, height, userAgent, headers, cookies, stealth, waitMs, timeoutMs },
    async (page) => {
      // Run design audit inside the browser
      return page.evaluate((params: { sel: string; spacingGrid: number; minTouchTarget: number; minContrast: number }) => {
        const { sel, spacingGrid, minTouchTarget, minContrast } = params;

        // --- Helpers ---
        function parsePixels(val: string): number {
          const n = parseFloat(val);
          return isNaN(n) ? 0 : n;
        }

        function parseRgb(color: string): [number, number, number] | null {
          const m = color.match(/rgba?\(([0-9]+),\s*([0-9]+),\s*([0-9]+)/);
          if (!m) return null;
          return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
        }

        function parseRgba(color: string): [number, number, number, number] | null {
          const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (!m) return null;
          return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
        }

        function getEffectiveBackground(el: Element): [number, number, number] {
          let current: Element | null = el;
          while (current && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const bg = style.backgroundColor;
            const parsed = parseRgba(bg);
            if (parsed && parsed[3] > 0.5) {
              return [parsed[0], parsed[1], parsed[2]];
            }
            current = current.parentElement;
          }

          // Check html element
          const htmlStyle = window.getComputedStyle(document.documentElement);
          const htmlBg = parseRgba(htmlStyle.backgroundColor);
          if (htmlBg && htmlBg[3] > 0.5) {
            return [htmlBg[0], htmlBg[1], htmlBg[2]];
          }

          // Check body element
          const bodyStyle = window.getComputedStyle(document.body);
          const bodyBg = parseRgba(bodyStyle.backgroundColor);
          if (bodyBg && bodyBg[3] > 0.5) {
            return [bodyBg[0], bodyBg[1], bodyBg[2]];
          }

          // Check color-scheme CSS property or meta tag
          const colorScheme = (htmlStyle as any).colorScheme as string | undefined ||
            document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '';
          if (colorScheme.includes('dark')) {
            return [0, 0, 0]; // Dark scheme default
          }

          // Ultimate fallback: white (standard web default)
          return [255, 255, 255];
        }

        function hasBackdropFilter(el: Element): boolean {
          let current: Element | null = el;
          while (current) {
            const style = window.getComputedStyle(current);
            const bf = (style as any).backdropFilter as string | undefined;
            if (bf && bf !== 'none' && bf !== '') return true;
            current = current.parentElement;
          }
          return false;
        }

        function detectPageColorScheme(): 'light' | 'dark' | 'unknown' {
          const htmlStyle = window.getComputedStyle(document.documentElement);
          const htmlBg = parseRgba(htmlStyle.backgroundColor);
          if (htmlBg && htmlBg[3] > 0.5) {
            const lum = luminance(htmlBg[0], htmlBg[1], htmlBg[2]);
            return lum < 0.18 ? 'dark' : 'light';
          }
          const bodyStyle = window.getComputedStyle(document.body);
          const bodyBg = parseRgba(bodyStyle.backgroundColor);
          if (bodyBg && bodyBg[3] > 0.5) {
            const lum = luminance(bodyBg[0], bodyBg[1], bodyBg[2]);
            return lum < 0.18 ? 'dark' : 'light';
          }
          const colorScheme = (htmlStyle as any).colorScheme as string | undefined ||
            document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '';
          if (colorScheme.includes('dark')) return 'dark';
          if (colorScheme.includes('light')) return 'light';
          return 'unknown';
        }

        function luminance(r: number, g: number, b: number): number {
          const [rs, gs, bs] = [r, g, b].map(c => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function contrastRatio(c1: [number, number, number], c2: [number, number, number]): number {
          const l1 = luminance(...c1);
          const l2 = luminance(...c2);
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        function elementLabel(el: Element): string {
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
          return `${el.tagName.toLowerCase()}${id}${cls}`;
        }

        function nearestMultiple(val: number, grid: number): number {
          if (grid <= 0) return val;
          return Math.round(val / grid) * grid;
        }

        const root = document.querySelector(sel) || document.body;
        const allElements = Array.from(root.querySelectorAll('*')) as HTMLElement[];

        const spacingViolations: any[] = [];
        const touchTargetViolations: any[] = [];
        const contrastViolations: any[] = [];
        const fontSizesSet = new Set<string>();
        const lineHeightsSet = new Set<string>();
        const letterSpacingsSet = new Set<string>();
        const spacingValuesSet = new Set<number>();

        const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'label']);

        for (const el of allElements) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();

          // Skip invisible elements
          if (rect.width === 0 && rect.height === 0) continue;

          const label = elementLabel(el);

          // Spacing
          const spacingProps = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'rowGap', 'columnGap'];
          for (const prop of spacingProps) {
            const raw = (style as any)[prop];
            if (!raw || raw === 'normal' || raw === 'auto') continue;
            const px = parsePixels(raw);
            if (px <= 0) continue;
            spacingValuesSet.add(px);
            if (spacingGrid > 0 && Math.round(px) % spacingGrid !== 0) {
              spacingViolations.push({
                element: label,
                property: prop,
                value: Math.round(px),
                nearestGridValue: nearestMultiple(px, spacingGrid),
              });
            }
          }

          // Typography
          const fs = style.fontSize;
          const lh = style.lineHeight;
          const ls = style.letterSpacing;
          if (fs) fontSizesSet.add(fs);
          if (lh && lh !== 'normal') lineHeightsSet.add(lh);
          if (ls && ls !== 'normal') letterSpacingsSet.add(ls);

          // Touch targets
          const tag = el.tagName.toLowerCase();
          if (interactiveTags.has(tag)) {
            const w = rect.width;
            const h = rect.height;
            if (w > 0 && h > 0 && (w < minTouchTarget || h < minTouchTarget)) {
              touchTargetViolations.push({ element: label, width: Math.round(w), height: Math.round(h), minRequired: minTouchTarget });
            }
          }

          // Contrast — Walk up DOM tree to find effective opaque background
          const textColor = style.color;
          if (textColor) {
            const fg = parseRgb(textColor);
            if (fg) {
              if (hasBackdropFilter(el)) {
                // Background can't be determined from CSS alone — mark as unresolvable
                // and exclude from scoring (bgResolved: false)
                const text = el.textContent?.trim() || '';
                if (text.length > 0 && text.length < 200) {
                  contrastViolations.push({
                    element: label,
                    textColor,
                    bgColor: 'unknown (backdrop-filter)',
                    ratio: 0,
                    required: minContrast,
                    bgResolved: false,
                  });
                }
              } else {
                const effectiveBg = getEffectiveBackground(el);
                // bgResolved: true — background was successfully determined via DOM traversal
                const ratio = contrastRatio(fg, effectiveBg);
                if (ratio > 1.05 && ratio < minContrast) {
                  // Only flag elements with visible text content
                  const text = el.textContent?.trim() || '';
                  if (text.length > 0 && text.length < 200) {
                    contrastViolations.push({
                      element: label,
                      textColor,
                      bgColor: `rgb(${effectiveBg.join(',')})`,
                      ratio: Math.round(ratio * 100) / 100,
                      required: minContrast,
                      bgResolved: true,
                    });
                  }
                }
              }
            }
          }
        }

        const spacingScale = Array.from(spacingValuesSet).sort((a, b) => a - b).map(v => Math.round(v));

        // ── WCAG Accessibility Audit ──────────────────────────────────────
        const a11yViolations: any[] = [];
        const headingStructure: string[] = [];

        // 1. Images without alt text
        const images = root.querySelectorAll('img');
        for (const img of Array.from(images)) {
          if (!img.getAttribute('alt') && !img.getAttribute('aria-label') && !img.getAttribute('role')?.includes('presentation')) {
            a11yViolations.push({ type: 'missing-alt', element: elementLabel(img), details: `src: ${(img.getAttribute('src') || '').slice(0, 80)}` });
          }
        }

        // 2. Form inputs without labels
        const inputs = root.querySelectorAll('input, select, textarea');
        for (const input of Array.from(inputs) as HTMLInputElement[]) {
          const id = input.getAttribute('id');
          const hasLabel = id && document.querySelector(`label[for="${id}"]`);
          const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
          const hasTitle = input.getAttribute('title');
          if (!hasLabel && !hasAria && !hasTitle && input.getAttribute('type') !== 'hidden') {
            a11yViolations.push({ type: 'missing-label', element: elementLabel(input), details: `type: ${input.getAttribute('type') || 'text'}` });
          }
        }

        // 3. Heading hierarchy
        const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let prevLevel = 0;
        for (const h of Array.from(headings)) {
          const level = parseInt(h.tagName[1]);
          headingStructure.push(h.tagName.toLowerCase());
          if (prevLevel > 0 && level > prevLevel + 1) {
            a11yViolations.push({ type: 'heading-skip', element: elementLabel(h), details: `Jumped from h${prevLevel} to h${level}` });
          }
          prevLevel = level;
        }

        // 4. Empty links
        const links = root.querySelectorAll('a');
        for (const link of Array.from(links)) {
          const text = (link.textContent || '').trim();
          const aria = link.getAttribute('aria-label');
          const title = link.getAttribute('title');
          const hasImg = link.querySelector('img[alt]');
          if (!text && !aria && !title && !hasImg) {
            a11yViolations.push({ type: 'empty-link', element: elementLabel(link), details: `href: ${(link.getAttribute('href') || '').slice(0, 60)}` });
          }
        }

        // 5. Empty buttons
        const buttons = root.querySelectorAll('button');
        for (const btn of Array.from(buttons)) {
          const text = (btn.textContent || '').trim();
          const aria = btn.getAttribute('aria-label');
          if (!text && !aria) {
            a11yViolations.push({ type: 'empty-button', element: elementLabel(btn), details: '' });
          }
        }

        return {
          colorScheme: detectPageColorScheme(),
          spacingViolations: spacingViolations.slice(0, 50),
          touchTargetViolations: touchTargetViolations.slice(0, 50),
          contrastViolations: contrastViolations.slice(0, 50),
          typography: {
            fontSizes: Array.from(fontSizesSet).slice(0, 20),
            lineHeights: Array.from(lineHeightsSet).slice(0, 20),
            letterSpacings: Array.from(letterSpacingsSet).slice(0, 20),
          },
          spacingScale: [...new Set(spacingScale)].slice(0, 30),
          accessibilityViolations: a11yViolations.slice(0, 50),
          headingStructure,
        };
      }, { sel: selector, spacingGrid, minTouchTarget, minContrast });
    }
  );

  // Weighted scoring: contrast failures are most serious (accessibility),
  // touch target issues affect usability, spacing is cosmetic, a11y is significant.
  // Only count contrast violations where we could resolve the background (bgResolved: true).
  // Violations with unresolvable backgrounds (backdrop-filter etc.) are excluded from scoring.
  const resolvedContrastViolations = auditData.contrastViolations.filter(v => v.bgResolved !== false);
  const unresolvedContrastViolations = auditData.contrastViolations.filter(v => v.bgResolved === false);
  const contrastPenalty = Math.min(40, resolvedContrastViolations.length * 5); // cap at 40pts
  const touchPenalty = Math.min(30, auditData.touchTargetViolations.length * 3); // cap at 30pts
  const spacingPenalty = Math.min(20, auditData.spacingViolations.length * 1);
  const a11yPenalty = Math.min(30, auditData.accessibilityViolations.length * 4);

  // Bonus for zero violations in a category (up to 5 pts total)
  let bonus = 0;
  if (resolvedContrastViolations.length === 0) bonus += 2;
  if (auditData.touchTargetViolations.length === 0) bonus += 1;
  if (auditData.accessibilityViolations.length === 0) bonus += 2;

  const totalPenalty = contrastPenalty + touchPenalty + spacingPenalty + a11yPenalty;
  const score = Math.min(100, Math.max(0, Math.round(100 - totalPenalty + bonus)));

  const parts: string[] = [];
  if (auditData.spacingViolations.length > 0) parts.push(`${auditData.spacingViolations.length} spacing violation(s)`);
  if (auditData.touchTargetViolations.length > 0) parts.push(`${auditData.touchTargetViolations.length} touch target violation(s)`);
  if (resolvedContrastViolations.length > 0) parts.push(`${resolvedContrastViolations.length} contrast violation(s)`);
  if (unresolvedContrastViolations.length > 0) parts.push(`${unresolvedContrastViolations.length} unresolvable contrast check(s)`);
  if (auditData.accessibilityViolations.length > 0) parts.push(`${auditData.accessibilityViolations.length} accessibility violation(s)`);
  const summary = parts.length === 0
    ? 'No design violations found.'
    : `Found: ${parts.join(', ')}.`;

  const audit: DesignAuditResult = { score, summary, ...auditData };
  return { audit, finalUrl };
}

// ── browserDesignAnalysis ──────────────────────────────────────────────────────

/**
 * Extract structured visual design intelligence from a URL using a browser.
 * Returns a DesignAnalysis object with effects, palette, layout, type scale,
 * and quality signals.
 */
export async function browserDesignAnalysis(
  url: string,
  options: {
    selector?: string;
    width?: number;
    height?: number;
    waitMs?: number;
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
  } = {}
): Promise<{ analysis: import('./design-analysis.js').DesignAnalysis; finalUrl: string }> {
  const {
    width = 1440,
    height = 900,
    waitMs = 0,
    timeoutMs = 60000,
    userAgent,
    headers,
    cookies,
    stealth = false,
  } = options;

  const { extractDesignAnalysis } = await import('./design-analysis.js');

  const { result: analysis, finalUrl } = await withBrowserPage(
    url,
    { width, height, userAgent, headers, cookies, stealth, waitMs, timeoutMs },
    async (page) => {
      return extractDesignAnalysis(page);
    }
  );

  return { analysis, finalUrl };
}
