/**
 * Challenge / bot-protection solver.
 *
 * Attempts to bypass bot-protection challenges using free, in-process methods:
 *  1. Cloudflare JS challenge — render in stealth Playwright, wait for auto-solve
 *  2. hCaptcha — accessibility bypass (TODO: implement if API is confirmed available)
 *
 * Architecture note:
 *  Browser-based solving is CPU/RAM intensive. When the env var BROWSER_WORKER_URL
 *  is set, the solve request is proxied to an external worker (e.g. Hetzner 4GB VM)
 *  instead of running locally. This keeps the main Render container (512 MB) lean.
 *
 * Usage:
 *  const result = await solveChallenge(url, 'cloudflare', html);
 *  if (result.solved) {
 *    // result.html = real page content
 *    // result.cookies = ["cf_clearance=...", ...]
 *  }
 */

import type { ChallengeType } from './challenge-detection.js';
import { cacheCookiesForUrl } from './cookie-cache.js';
import { createLogger } from './logger.js';

const log = createLogger('challenge-solver');

// ── Image CAPTCHA solver constants ────────────────────────────────────────────

const OLLAMA_VISION_URL = 'http://178.156.229.86:11435/api/generate';
const OLLAMA_AUTH_TOKEN = 'c996233de4addb47e4cdec8bc5ff8776397f813ca7bd444e7258e0e2ed251963';
const OLLAMA_VISION_MODEL = 'moondream';
/** moondream on the 4GB Hetzner VPS takes ~30s per image */
const VISION_TIMEOUT_MS = 45_000;
const IMAGE_CAPTCHA_MAX_ROUNDS = 3;

/** Grid element selectors to try (reCAPTCHA, hCaptcha, generic) */
const CAPTCHA_GRID_SELECTORS = [
  '.rc-imageselect-table',
  '.task-grid',
  '.task-image',
  'table.rc-imageselect-table',
  '[class*="grid"]:not(body):not(html)',
  '.captcha-grid',
];

/** Verify/Submit button selectors */
const CAPTCHA_VERIFY_SELECTORS = [
  '#recaptcha-verify-button',
  'button[data-action="verify"]',
  'button[class*="verify"]',
  'button[class*="submit"]',
  '.rc-button-default',
  '[id*="verify"]',
  '[class*="verify"]',
];

/** Instruction text containers to extract the target object from */
const CAPTCHA_INSTRUCTION_SELECTORS = [
  '.rc-imageselect-desc-wrapper',
  '.rc-imageselect-desc',
  '.prompt-text',
  '[class*="prompt"]',
  '[class*="instruction"]',
  '[class*="task-desc"]',
  '[aria-label*="select"]',
  '[aria-label*="click"]',
];

/** Patterns to extract the object name from instruction text */
const CAPTCHA_OBJECT_PATTERNS = [
  /select all (?:images|squares|tiles) (?:with|containing|that (?:have|contain)) (?:a |an )?(.+?)(?:\.|$)/i,
  /click (?:all )?(?:images|squares|tiles) (?:containing|with|that (?:have|contain)) (?:a |an )?(.+?)(?:\.|$)/i,
  /please click each image containing (?:a |an )?(.+?)(?:\.|$)/i,
  /select all (?:the )?(?:image|picture)s? of (?:a |an )?(.+?)(?:\.|$)/i,
  /identify all (?:images|pictures|squares) (?:with|showing|of) (?:a |an )?(.+?)(?:\.|$)/i,
];

// ── Image CAPTCHA result type ─────────────────────────────────────────────────

export interface ImageCaptchaResult {
  solved: boolean;
  rounds: number;
  error?: string;
}

// ── Vision API call ───────────────────────────────────────────────────────────

/**
 * Ask the moondream vision model which grid cells contain the target object.
 * Returns an array of 1-indexed grid positions (1–9), or null if the call fails.
 */
export async function askVisionModel(base64Image: string, targetObject: string): Promise<number[] | null> {
  const prompt = `This is a 3x3 image grid CAPTCHA. Select all squares containing "${targetObject}". Reply with ONLY the grid positions as numbers 1-9 (left to right, top to bottom), separated by commas. Example: 1,3,7`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_VISION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        prompt,
        images: [base64Image],
        stream: false,
        options: { num_predict: 50, temperature: 0.1 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      log.debug(`Vision API returned HTTP ${response.status}`);
      return null;
    }

    const data = await response.json() as { response?: string };
    const text = data.response ?? '';
    log.debug(`Vision model response: "${text}"`);

    // Match whole numbers only (not individual digits from multi-digit numbers like 10, 11)
    const positions = text.match(/\b[1-9]\b/g)?.map(Number) ?? [];

    if (positions.length === 0) {
      log.debug('Vision model returned no valid grid positions');
      return null;
    }

    return positions;
  } catch (err) {
    clearTimeout(timer);
    log.debug('Vision model call failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Target object extraction ──────────────────────────────────────────────────

/**
 * Detect if the page has an image grid CAPTCHA and extract the target object.
 * Returns the object name (e.g. "traffic lights") or null if not detected.
 */
export async function detectImageCaptchaTarget(
  page: import('playwright').Page
): Promise<string | null> {
  for (const selector of CAPTCHA_INSTRUCTION_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      const text = await el.innerText().catch(() => '');
      if (!text) continue;

      const normalized = text.trim().replace(/\s+/g, ' ');

      for (const pattern of CAPTCHA_OBJECT_PATTERNS) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
          const target = match[1].trim().toLowerCase();
          log.debug(`Detected image CAPTCHA target: "${target}" from selector ${selector}`);
          return target;
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  return null;
}

// ── Image CAPTCHA solver ──────────────────────────────────────────────────────

/**
 * Solve an image grid CAPTCHA using the moondream vision model.
 *
 * Flow per round:
 *  1. Screenshot the CAPTCHA grid element
 *  2. Send to moondream → get grid positions
 *  3. Click identified cells
 *  4. Click Verify button
 *  5. Check if solved; if a new round appears, repeat (max 3 rounds)
 */
export async function solveImageCaptcha(
  page: import('playwright').Page,
  targetObject: string
): Promise<ImageCaptchaResult> {
  // Guard: only run when explicitly enabled or remote worker configured
  const enabled = process.env.ENABLE_LOCAL_CHALLENGE_SOLVE === 'true' || !!process.env.BROWSER_WORKER_URL;
  if (!enabled) {
    return { solved: false, rounds: 0, error: 'Image CAPTCHA solving not enabled (set ENABLE_LOCAL_CHALLENGE_SOLVE=true)' };
  }

  let rounds = 0;

  for (let attempt = 0; attempt < IMAGE_CAPTCHA_MAX_ROUNDS; attempt++) {
    rounds++;

    // ── 1. Screenshot the grid element ─────────────────────────────────────
    let base64Screenshot: string | null = null;

    for (const selector of CAPTCHA_GRID_SELECTORS) {
      try {
        const gridEl = await page.$(selector);
        if (!gridEl) continue;

        const screenshot = await gridEl.screenshot({ type: 'png' });
        base64Screenshot = screenshot.toString('base64');
        log.debug(`Captured CAPTCHA grid with selector: ${selector}`);
        break;
      } catch {
        // Try next selector
      }
    }

    if (!base64Screenshot) {
      // Fall back to a viewport screenshot if no grid element found
      try {
        const fullshot = await page.screenshot({ type: 'png' });
        base64Screenshot = fullshot.toString('base64');
        log.debug('Fell back to full-page screenshot for CAPTCHA');
      } catch (err) {
        return {
          solved: false,
          rounds,
          error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ── 2. Ask vision model ────────────────────────────────────────────────
    log.debug(`Round ${rounds}: asking moondream to find "${targetObject}"…`);
    const positions = await askVisionModel(base64Screenshot, targetObject);

    if (!positions || positions.length === 0) {
      log.debug(`Round ${rounds}: vision model returned no positions — stopping`);
      return { solved: false, rounds, error: 'Vision model returned no valid positions' };
    }

    log.debug(`Round ${rounds}: vision model selected positions: ${positions.join(',')}`);

    // ── 3. Click grid cells ────────────────────────────────────────────────
    let clickedCount = 0;
    for (const pos of positions) {
      for (const gridSelector of CAPTCHA_GRID_SELECTORS) {
        try {
          const gridEl = await page.$(gridSelector);
          if (!gridEl) continue;

          // Each grid cell: nth-child or direct child
          const cells = await gridEl.$$('td, div[class*="cell"], div[class*="tile"], div[class*="image"]');
          if (cells.length === 0) {
            // Try direct children
            const children = await gridEl.$$(':scope > *');
            const target = children[pos - 1];
            if (target) {
              await target.click({ timeout: 5000 });
              clickedCount++;
            }
          } else {
            const target = cells[pos - 1];
            if (target) {
              await target.click({ timeout: 5000 });
              clickedCount++;
            }
          }
          break;
        } catch {
          // Try next selector
        }
      }
    }

    log.debug(`Round ${rounds}: clicked ${clickedCount}/${positions.length} cells`);

    // Short delay before verify (let animation/state settle)
    await page.waitForTimeout(500);

    // ── 4. Click Verify button ─────────────────────────────────────────────
    let clicked = false;
    for (const btnSelector of CAPTCHA_VERIFY_SELECTORS) {
      try {
        const btn = await page.$(btnSelector);
        if (btn) {
          await btn.click({ timeout: 3000 });
          clicked = true;
          log.debug(`Round ${rounds}: clicked verify button (${btnSelector})`);
          break;
        }
      } catch {
        // Try next
      }
    }

    if (!clicked) {
      log.debug(`Round ${rounds}: could not find verify button`);
    }

    // ── 5. Check if solved ─────────────────────────────────────────────────
    await page.waitForTimeout(2000);

    // Check for success indicators
    const solved = await checkCaptchaSolved(page);
    if (solved) {
      log.debug(`Round ${rounds}: CAPTCHA solved!`);
      return { solved: true, rounds };
    }

    // Check if a new round appeared (grid refreshed)
    const newTarget = await detectImageCaptchaTarget(page);
    if (!newTarget) {
      // No more instructions — likely solved or error
      log.debug(`Round ${rounds}: no more instruction text — assuming solved`);
      return { solved: true, rounds };
    }

    // Update target object for next round (may change between rounds)
    // eslint-disable-next-line no-param-reassign
    targetObject = newTarget;
    log.debug(`Round ${rounds}: new target for next round: "${targetObject}"`);
  }

  return { solved: false, rounds, error: `Reached max rounds (${IMAGE_CAPTCHA_MAX_ROUNDS}) without solving` };
}

/**
 * Check if the CAPTCHA appears to have been solved (challenge gone, success message, etc.)
 */
async function checkCaptchaSolved(page: import('playwright').Page): Promise<boolean> {
  // Check for reCAPTCHA success state
  try {
    const successEl = await page.$('.recaptcha-checkbox-checked, .rc-anchor-normal-footer, [aria-checked="true"]');
    if (successEl) return true;
  } catch { /* ignore */ }

  // Check if CAPTCHA challenge overlay disappeared (grid gone)
  try {
    const gridEl = await page.$('.rc-imageselect-table, .task-grid');
    // If we were on a CAPTCHA page and the grid is now gone, it was likely solved
    if (!gridEl) {
      // Only count as solved if we're no longer on a CAPTCHA title page
      const title = await page.title().catch(() => '');
      const isCaptchaTitle = title.toLowerCase().includes('captcha') || title.toLowerCase().includes('robot');
      if (!isCaptchaTitle) return true;
    }
  } catch { /* ignore */ }

  // Check page URL changed (successful solve often triggers redirect)
  try {
    const title = await page.title();
    const isCaptchaPage = title.toLowerCase().includes('captcha') || title.toLowerCase().includes('robot');
    if (!isCaptchaPage) return true;
  } catch { /* ignore */ }

  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SolveOptions {
  /** Hard timeout in ms (default: 15 000) */
  timeout?: number;
  /** Optional proxy URL (http://user:pass@host:port) */
  proxy?: string;
}

export interface SolveResult {
  solved: boolean;
  html: string;
  /** Raw Set-Cookie header values extracted after solve */
  cookies?: string[];
  /** How the solve was performed */
  method?: 'local-browser' | 'remote-worker' | 'accessibility';
  /** Error details if solve failed */
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
/** Cloudflare challenge title before it's solved */
const CF_CHALLENGE_TITLES = ['just a moment', 'please wait', 'one moment, please', 'checking your browser'];
/** Cloudflare challenge page markers */
const CF_CHALLENGE_SELECTORS = [
  '#challenge-running',
  '#challenge-form',
  '#cf-challenge-running',
  '.cf-browser-verification',
];

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Attempt to solve a bot-protection challenge.
 *
 * @param url            The page URL (used for proxy routing and cookie caching)
 * @param challengeType  The type of challenge as detected by challenge-detection
 * @param html           The raw challenge HTML (used for context / fallback)
 * @param options        Optional timeout and proxy settings
 * @returns              Solve result with real HTML content and cookies if successful
 */
export async function solveChallenge(
  url: string,
  challengeType: ChallengeType,
  html: string,
  options: SolveOptions = {}
): Promise<SolveResult> {
  const domain = getDomain(url);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  console.log(`[challenge-solver] Attempting ${challengeType} solve for ${domain}`);

  // ── Remote worker proxy (Hetzner) ──────────────────────────────────────────
  const workerUrl = process.env.BROWSER_WORKER_URL;
  if (workerUrl) {
    return solveViaRemoteWorker(url, challengeType, html, { timeout, proxy: options.proxy, workerUrl });
  }

  // ── Local solve ────────────────────────────────────────────────────────────
  switch (challengeType) {
    case 'cloudflare':
      return solveCloudflare(url, html, timeout, options.proxy);

    case 'captcha':
      return solveCaptchaWithVision(url, html, timeout, options.proxy);

    case 'datadome':
      // DataDome can sometimes be bypassed with a stealth browser
      return solveWithStealthBrowser(url, html, timeout, options.proxy, 'datadome');

    case 'akamai':
    case 'perimeterx':
    case 'incapsula':
    case 'generic-block':
      // For other challenges, try stealth browser as a general approach
      return solveWithStealthBrowser(url, html, timeout, options.proxy, challengeType);

    case 'empty-shell':
      // Not really a challenge — just an SPA shell, shouldn't reach here
      return { solved: false, html, error: 'empty-shell is not a challenge to solve' };

    default:
      return { solved: false, html, error: `Unknown challenge type: ${challengeType}` };
  }
}

// ── Image CAPTCHA orchestrator ────────────────────────────────────────────────

/**
 * Solve an image CAPTCHA by opening a stealth browser, detecting the target
 * object from the page instructions, and calling solveImageCaptcha().
 */
async function solveCaptchaWithVision(
  url: string,
  _html: string,
  timeoutMs: number,
  proxy?: string
): Promise<SolveResult> {
  let page: import('playwright').Page | null = null;

  try {
    const { getStealthBrowser, getRandomUserAgent, getRandomViewport, applyStealthScripts } = await import('./browser-pool.js');

    const browser = await getStealthBrowser();
    const vp = getRandomViewport();
    const ctx = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: vp.width, height: vp.height },
      ...(proxy ? { proxy: { server: proxy } } : {}),
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    page = await ctx.newPage();
    await applyStealthScripts(page);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    // Wait for CAPTCHA to render
    await page.waitForTimeout(2000);

    // Detect the target object from the CAPTCHA instructions
    const targetObject = await detectImageCaptchaTarget(page);

    if (!targetObject) {
      const html = await page.content().catch(() => _html);
      await ctx.close().catch(() => {});
      return { solved: false, html, error: 'Could not detect image CAPTCHA target object from page' };
    }

    log.debug(`Image CAPTCHA target: "${targetObject}"`);

    // Solve the CAPTCHA — may take up to VISION_TIMEOUT_MS * IMAGE_CAPTCHA_MAX_ROUNDS
    const captchaResult = await solveImageCaptcha(page, targetObject);

    const html = await page.content().catch(() => _html);
    const cookies = await ctx.cookies();
    const cookieStrings = cookies.map(c => `${c.name}=${c.value}; Path=${c.path || '/'}${c.domain ? `; Domain=${c.domain}` : ''}`);

    if (cookieStrings.length > 0) {
      cacheCookiesForUrl(url, cookieStrings);
    }

    await ctx.close().catch(() => {});

    if (captchaResult.solved) {
      console.log(`[challenge-solver] Image CAPTCHA solved for ${getDomain(url)} in ${captchaResult.rounds} round(s)`);
      return { solved: true, html, cookies: cookieStrings, method: 'local-browser' };
    }

    return {
      solved: false,
      html,
      error: captchaResult.error ?? `Image CAPTCHA not solved after ${captchaResult.rounds} round(s)`,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.debug('Image CAPTCHA solve failed:', error);
    return { solved: false, html: _html, error };
  } finally {
    page = null;
  }
}

// ── Cloudflare solver ─────────────────────────────────────────────────────────

/**
 * Solve Cloudflare JS challenge by rendering the page in a stealth browser.
 *
 * Cloudflare's "Just a moment..." challenge:
 *  - Runs JavaScript fingerprinting in the browser
 *  - If the fingerprint passes (looks like a real browser), auto-redirects to the real page
 *  - No human interaction needed if the browser stealth is good enough
 *
 * Strategy:
 *  1. Open a fresh stealth browser page
 *  2. Navigate to the URL
 *  3. Wait for the challenge to complete (title changes OR challenge element disappears)
 *  4. Extract HTML and cookies
 *  5. Cache cf_clearance cookie for future requests
 */
async function solveCloudflare(
  url: string,
  _html: string,
  timeoutMs: number,
  proxy?: string
): Promise<SolveResult> {
  let browser: import('playwright').Browser | null = null;
  let page: import('playwright').Page | null = null;

  try {
    const { getStealthBrowser, getRandomUserAgent, getRandomViewport, applyStealthScripts } = await import('./browser-pool.js');

    browser = await getStealthBrowser();

    const vp = getRandomViewport();
    const ctx = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: vp.width, height: vp.height },
      ...(proxy ? { proxy: { server: proxy } } : {}),
      // Accept all languages to look more like a real browser
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    page = await ctx.newPage();
    await applyStealthScripts(page);

    // Navigate to the challenge URL
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    // Wait for Cloudflare challenge to resolve
    const solved = await waitForChallengeResolution(page, timeoutMs);

    if (!solved) {
      log.debug('Cloudflare challenge did not resolve within timeout');
      await ctx.close().catch(() => {});
      return { solved: false, html: await page.content().catch(() => _html), error: 'Cloudflare challenge timed out' };
    }

    // Extract real page content
    const realHtml = await page.content();

    // Extract cookies (especially cf_clearance)
    const cookies = await ctx.cookies();
    const cookieStrings = cookies.map(c => {
      let s = `${c.name}=${c.value}`;
      if (c.path) s += `; Path=${c.path}`;
      if (c.domain) s += `; Domain=${c.domain}`;
      if (c.secure) s += '; Secure';
      if (c.httpOnly) s += '; HttpOnly';
      if (c.expires && c.expires > 0) {
        s += `; Expires=${new Date(c.expires * 1000).toUTCString()}`;
      }
      return s;
    });

    // Determine TTL based on cf_clearance expiry (default 30 min)
    const cfClearance = cookies.find(c => c.name === 'cf_clearance');
    const ttlMs = cfClearance?.expires && cfClearance.expires > 0
      ? Math.min((cfClearance.expires * 1000) - Date.now(), 30 * 60 * 1000)
      : 30 * 60 * 1000;

    // Cache cookies for future requests
    if (cookieStrings.length > 0) {
      cacheCookiesForUrl(url, cookieStrings, ttlMs);
      log.debug(`Cached ${cookieStrings.length} cookies for ${getDomain(url)} (TTL: ${Math.round(ttlMs / 60000)}m)`);
    }

    await ctx.close().catch(() => {});

    console.log(`[challenge-solver] Cloudflare challenge solved for ${getDomain(url)}, extracted ${cookieStrings.length} cookies`);

    return {
      solved: true,
      html: realHtml,
      cookies: cookieStrings,
      method: 'local-browser',
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.debug('Cloudflare solve failed:', error);
    return { solved: false, html: _html, error };
  } finally {
    // Don't close shared browser — it's managed by browser-pool
    page = null;
    browser = null;
  }
}

// ── Generic stealth browser solver ───────────────────────────────────────────

/**
 * General-purpose stealth browser solve for challenges that may auto-resolve
 * when rendered in a legitimate-looking browser (DataDome, Akamai, etc.).
 */
async function solveWithStealthBrowser(
  url: string,
  _html: string,
  timeoutMs: number,
  proxy: string | undefined,
  challengeType: ChallengeType
): Promise<SolveResult> {
  let page: import('playwright').Page | null = null;

  try {
    const { getStealthBrowser, getRandomUserAgent, getRandomViewport, applyStealthScripts } = await import('./browser-pool.js');

    const browser = await getStealthBrowser();
    const vp = getRandomViewport();
    const ctx = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: vp.width, height: vp.height },
      ...(proxy ? { proxy: { server: proxy } } : {}),
      locale: 'en-US',
    });

    page = await ctx.newPage();
    await applyStealthScripts(page);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });

    // Wait a bit for any JS-based challenges to execute
    await page.waitForTimeout(2000);

    const html = await page.content();
    const cookies = await ctx.cookies();
    const cookieStrings = cookies.map(c => `${c.name}=${c.value}; Path=${c.path || '/'}${c.domain ? `; Domain=${c.domain}` : ''}`);

    // Check if we got real content (not a challenge page)
    const titleEl = await page.title().catch(() => '');
    const isStillChallenge = CF_CHALLENGE_TITLES.some(t => titleEl.toLowerCase().includes(t))
      || html.includes('cf-browser-verification')
      || html.includes('challenge-form');

    if (isStillChallenge) {
      await ctx.close().catch(() => {});
      return { solved: false, html, error: `${challengeType} challenge did not resolve` };
    }

    if (cookieStrings.length > 0) {
      cacheCookiesForUrl(url, cookieStrings);
    }

    await ctx.close().catch(() => {});

    console.log(`[challenge-solver] ${challengeType} challenge solved for ${getDomain(url)}`);
    return { solved: true, html, cookies: cookieStrings, method: 'local-browser' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { solved: false, html: _html, error };
  } finally {
    page = null;
  }
}

// ── Remote worker proxy ───────────────────────────────────────────────────────

/**
 * Proxy a solve request to a remote browser worker (e.g. Hetzner VPS).
 *
 * The worker endpoint is expected to accept:
 *   POST /solve
 *   { url, challengeType, timeout, proxy? }
 *
 * And return:
 *   { solved: boolean, html: string, cookies?: string[], error?: string }
 *
 * Set BROWSER_WORKER_URL to the worker base URL (e.g. http://hetzner:3001)
 * to route all browser-based challenge solving to the worker.
 */
async function solveViaRemoteWorker(
  url: string,
  challengeType: ChallengeType,
  html: string,
  options: { timeout: number; proxy?: string; workerUrl: string }
): Promise<SolveResult> {
  const { workerUrl, timeout, proxy } = options;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout + 5000); // Add buffer

    const response = await fetch(`${workerUrl}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, challengeType, timeout, ...(proxy ? { proxy } : {}) }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Worker returned HTTP ${response.status}`);
    }

    const result = await response.json() as SolveResult;

    // Cache cookies from remote solve
    if (result.solved && result.cookies?.length) {
      cacheCookiesForUrl(url, result.cookies);
      console.log(`[challenge-solver] Remote ${challengeType} solve for ${getDomain(url)}, cached ${result.cookies.length} cookies`);
    }

    return { ...result, method: 'remote-worker' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.debug('Remote worker solve failed:', error);
    // Fall through to local solve on worker failure
    console.log(`[challenge-solver] Remote worker failed, attempting local ${challengeType} solve for ${getDomain(url)}`);

    switch (challengeType) {
      case 'cloudflare':
        return solveCloudflare(url, html, options.timeout, options.proxy);
      default:
        return solveWithStealthBrowser(url, html, options.timeout, options.proxy, challengeType);
    }
  }
}

// ── Challenge resolution detection ───────────────────────────────────────────

/**
 * Wait for a Cloudflare challenge page to resolve.
 *
 * Cloudflare's challenge works like this:
 *  1. Initial page: title is "Just a moment..." with challenge elements
 *  2. Browser runs JS fingerprinting
 *  3. On pass: redirects to real page (title and content change)
 *  4. On fail: stays on challenge page
 *
 * We detect resolution by watching for:
 *  - Title change (away from challenge titles)
 *  - Challenge element disappearance
 *  - URL change (often redirects after solve)
 */
async function waitForChallengeResolution(
  page: import('playwright').Page,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  const pollInterval = 500;

  // Quick check: is it even a challenge page?
  const initialTitle = await page.title().catch(() => '');
  const isInitiallyChallenge = CF_CHALLENGE_TITLES.some(t => initialTitle.toLowerCase().includes(t));

  if (!isInitiallyChallenge) {
    // Not a challenge page to begin with — treat as solved
    return true;
  }

  // Poll until timeout
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(pollInterval);

    const title = await page.title().catch(() => '');
    const lowerTitle = title.toLowerCase();

    // Title changed away from challenge
    const isChallengeTitle = CF_CHALLENGE_TITLES.some(t => lowerTitle.includes(t));
    if (!isChallengeTitle && title.length > 0) {
      // Give the page a moment to fully render
      await page.waitForTimeout(1000);
      return true;
    }

    // Check if challenge elements are gone
    let challengeElementGone = true;
    for (const selector of CF_CHALLENGE_SELECTORS) {
      try {
        const el = await page.$(selector);
        if (el) {
          challengeElementGone = false;
          break;
        }
      } catch {
        // Selector check failed — continue
      }
    }

    if (challengeElementGone && !isChallengeTitle) {
      await page.waitForTimeout(500);
      return true;
    }

    // Try waiting for network to settle (challenge often triggers fetches)
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(3000, timeoutMs - (Date.now() - start)) });
      const finalTitle = await page.title().catch(() => '');
      if (!CF_CHALLENGE_TITLES.some(t => finalTitle.toLowerCase().includes(t))) {
        return true;
      }
    } catch {
      // Timeout or error — continue polling
    }
  }

  return false;
}

// ── hCaptcha Accessibility Bypass ────────────────────────────────────────────

// TODO: hCaptcha Accessibility Bypass
// hCaptcha has an accessibility service at https://www.hcaptcha.com/accessibility
// that provides a cookie allowing users with accessibility needs to bypass hCaptcha.
//
// Implementation notes:
// - The service used to allow programmatic registration without email verification
// - As of 2025, it requires manual verification (email link) to activate
// - Since this requires human interaction, it cannot be fully automated
//
// When/if implemented:
// 1. Check https://www.hcaptcha.com/accessibility for current API status
// 2. Register with a request to their accessibility API
// 3. If they return a cookie directly (no email verification), cache it
// 4. Attach the cookie to requests to sites using hCaptcha
//
// const HCAPTCHA_ACCESSIBILITY_URL = 'https://accounts.hcaptcha.com/demo?sitekey=bf5558a0-...';
// export async function getHCaptchaAccessibilityCookie(): Promise<string | null> { ... }

// ── Utility ───────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
