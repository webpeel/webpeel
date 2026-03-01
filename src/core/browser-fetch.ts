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
