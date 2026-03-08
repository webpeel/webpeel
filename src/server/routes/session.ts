/**
 * Browser Session API — stateful Playwright sessions
 *
 * POST   /v1/session                → create session, returns { sessionId, expiresAt }
 * GET    /v1/session/:id            → get current page content (Readability text)
 * POST   /v1/session/:id/navigate   → navigate to URL { url }
 * POST   /v1/session/:id/act        → execute PageActions array
 * GET    /v1/session/:id/screenshot → take screenshot (image/png)
 * GET    /v1/session/:id/cookies    → export cookies from session context
 * POST   /v1/session/:id/cookies    → inject cookies into session context
 * DELETE /v1/session/:id            → close session
 *
 * Use cases: login flows, multi-step automation, UI testing, cookie persistence.
 * This is what Browserbase charges $500/mo for — built into WebPeel.
 */

import { Router, Request, Response } from 'express';
import type { Browser, BrowserContext, Page } from 'playwright';
import { randomUUID } from 'crypto';
import { normalizeActions, executeActions } from '../../core/actions.js';
import {
  ANTI_DETECTION_ARGS,
  getRandomViewport,
  getRandomUserAgent,
  applyStealthScripts,
} from '../../core/browser-pool.js';
import { extractReadableContent } from '../../core/readability.js';

// ── Session store ─────────────────────────────────────────────────────────────

interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** API key accountId or JWT userId — whichever was present at creation */
  ownerId: string;
  createdAt: number;
  lastUsedAt: number;
  currentUrl: string;
  /** Per-session idle TTL in milliseconds (1–60 min, default 5 min) */
  ttlMs: number;
}

const sessions = new Map<string, BrowserSession>();
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;   // 5 minutes idle TTL (default)
const MAX_SESSION_TTL_MS     = 60 * 60 * 1000;  // 60 minutes (persist / max)
const MIN_SESSION_TTL_MS     = 1 * 60 * 1000;   // 1 minute minimum
const MAX_SESSIONS_PER_USER  = 3;               // prevent abuse

// Cleanup expired sessions every minute
const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > session.ttlMs) {
      session.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60_000);

// Don't keep the Node process alive just for the cleanup timer
if (_cleanupInterval.unref) _cleanupInterval.unref();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the owner ID from the request — supports both API key and JWT auth. */
function getOwnerId(req: Request): string | null {
  return req.auth?.keyInfo?.accountId
    || (req as any).user?.userId
    || null;
}

/**
 * Look up a session by id and verify it belongs to the requesting owner.
 * Returns null if not found, expired, or owned by someone else.
 */
function getSession(id: string, ownerId: string | null): BrowserSession | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (ownerId && session.ownerId !== ownerId) return null; // ownership check
  return session;
}

/** Launch a fresh Chromium browser for a session (separate instance per session). */
async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  const vp = getRandomViewport();
  return chromium.launch({
    headless: true,
    args: [...ANTI_DETECTION_ARGS, `--window-size=${vp.width},${vp.height}`],
  });
}

/** Extract readable text from an HTML string using WebPeel's built-in Readability engine. */
function extractReadableText(html: string, url: string): string {
  try {
    const result = extractReadableContent(html, url);
    return result.content?.trim() || result.excerpt?.trim() || '';
  } catch {
    return '';
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createSessionRouter(): Router {
  const router = Router();

  /**
   * POST /v1/session — create a stateful browser session
   *
   * Body params:
   *   url?     {string}  Initial URL to navigate to (optional).
   *   ttl?     {number}  Session idle TTL in minutes (1–60, default 5).
   *                      Timer resets on every request that touches the session.
   *   persist? {boolean} Shorthand for ttl=60. Enables long-lived sessions
   *                      for login flows where cookies must persist.
   *
   * Returns: { sessionId, currentUrl, expiresAt, ttlMinutes }
   */
  router.post('/v1/session', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ success: false, error: { type: 'auth_required', message: 'Valid API key or session required.', docs: 'https://webpeel.dev/docs/authentication' }, requestId: req.requestId });
      return;
    }

    // Enforce per-user session cap
    const userSessions = [...sessions.values()].filter(s => s.ownerId === ownerId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      res.status(429).json({
        success: false,
        error: {
          type: 'session_limit',
          message: `Maximum ${MAX_SESSIONS_PER_USER} concurrent sessions per user. Delete an existing session first.`,
          hint: 'Delete an existing session via DELETE /v1/session/:id before creating a new one.',
          docs: 'https://webpeel.dev/docs/errors#session-limit',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    const { url, ttl, persist } = req.body as { url?: string; ttl?: number; persist?: boolean };

    // Resolve TTL: persist=true → 60 min max, ttl overrides default, clamp to [1, 60] min
    let ttlMs = DEFAULT_SESSION_TTL_MS;
    if (persist) {
      ttlMs = MAX_SESSION_TTL_MS;
    } else if (typeof ttl === 'number') {
      ttlMs = Math.min(MAX_SESSION_TTL_MS, Math.max(MIN_SESSION_TTL_MS, ttl * 60 * 1000));
    }

    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await applyStealthScripts(page);

      if (url) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (navErr) {
          // Navigation failed — still return the session, caller can retry
          const errMsg = navErr instanceof Error ? navErr.message : String(navErr);
          await browser.close().catch(() => {});
          res.status(502).json({
            success: false,
            error: {
              type: 'navigation_failed',
              message: errMsg,
              hint: 'Check that the URL is accessible and try again.',
              docs: 'https://webpeel.dev/docs/errors#navigation-failed',
            },
            requestId: req.requestId || randomUUID(),
          });
          return;
        }
      }

      const id = randomUUID();
      const now = Date.now();
      sessions.set(id, {
        id,
        browser,
        context,
        page,
        ownerId,
        createdAt: now,
        lastUsedAt: now,
        currentUrl: page.url(),
        ttlMs,
      });

      res.status(201).json({
        sessionId: id,
        currentUrl: page.url(),
        expiresAt: new Date(now + ttlMs).toISOString(),
        ttlMinutes: ttlMs / 60_000,
      });
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: {
          type: 'session_create_failed',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#session-create-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  // ── GET /v1/session/:id — get page content ───────────────────────────────────
  router.get('/v1/session/:id', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params['id'] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    try {
      const [html, title] = await Promise.all([
        session.page.content(),
        session.page.title(),
      ]);

      const content = await extractReadableText(html, session.page.url());
      session.lastUsedAt = Date.now();

      res.json({
        sessionId: session.id,
        currentUrl: session.page.url(),
        title,
        content,
        expiresAt: new Date(session.lastUsedAt + session.ttlMs).toISOString(),
        ttlMinutes: session.ttlMs / 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: {
          type: 'session_error',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#session-error',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  // ── POST /v1/session/:id/navigate ────────────────────────────────────────────
  router.post('/v1/session/:id/navigate', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({
        success: false,
        error: {
          type: 'bad_request',
          message: '`url` is required.',
          hint: 'Pass a URL in the request body: { "url": "https://example.com" }',
          docs: 'https://webpeel.dev/docs/errors#bad-request',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    try {
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      session.lastUsedAt = Date.now();
      session.currentUrl = session.page.url();

      res.json({
        currentUrl: session.page.url(),
        title: await session.page.title(),
        expiresAt: new Date(session.lastUsedAt + session.ttlMs).toISOString(),
        ttlMinutes: session.ttlMs / 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        success: false,
        error: {
          type: 'navigation_failed',
          message: msg,
          hint: 'Check that the URL is accessible and try again.',
          docs: 'https://webpeel.dev/docs/errors#navigation-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  // ── POST /v1/session/:id/act — execute actions ───────────────────────────────
  router.post('/v1/session/:id/act', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    const { actions, screenshot: takeScreenshot } = req.body as {
      actions?: unknown;
      screenshot?: boolean;
    };

    let normalized: ReturnType<typeof normalizeActions> | undefined;
    try {
      normalized = normalizeActions(actions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_actions',
          message: msg,
          hint: 'Pass a valid actions array: [{ "type": "click", "selector": "#btn" }]',
          docs: 'https://webpeel.dev/docs/errors#invalid-actions',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    if (!normalized?.length) {
      res.status(400).json({
        success: false,
        error: {
          type: 'bad_request',
          message: '`actions` must be a non-empty array.',
          hint: 'Pass a valid actions array: [{ "type": "click", "selector": "#btn" }]',
          docs: 'https://webpeel.dev/docs/errors#bad-request',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    const normalizedActions = normalized;

    try {
      await executeActions(session.page, normalizedActions);
      session.lastUsedAt = Date.now();
      session.currentUrl = session.page.url();

      let screenshot: string | undefined;
      if (takeScreenshot) {
        const buf = await session.page.screenshot({ type: 'png' });
        screenshot = buf.toString('base64');
      }

      const [title, currentUrl] = await Promise.all([
        session.page.title(),
        Promise.resolve(session.page.url()),
      ]);

      res.json({
        currentUrl,
        title,
        screenshot,
        actionsExecuted: normalizedActions.length,
        expiresAt: new Date(session.lastUsedAt + session.ttlMs).toISOString(),
        ttlMinutes: session.ttlMs / 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        success: false,
        error: {
          type: 'action_failed',
          message: msg,
          hint: 'Check your action selectors and ensure the page is loaded.',
          docs: 'https://webpeel.dev/docs/errors#action-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  // ── GET /v1/session/:id/screenshot ───────────────────────────────────────────
  router.get('/v1/session/:id/screenshot', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    try {
      const fullPage = req.query.fullPage === 'true';
      const buf = await session.page.screenshot({ type: 'png', fullPage });
      session.lastUsedAt = Date.now();

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Session-Expires-At', new Date(session.lastUsedAt + session.ttlMs).toISOString());
      res.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: {
          type: 'screenshot_failed',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#screenshot-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  /**
   * GET /v1/session/:id/cookies — export all cookies from the session's browser context
   *
   * Returns: { sessionId, cookies: Cookie[], count: number, expiresAt: string }
   *
   * Each cookie follows the Playwright Cookie shape:
   *   { name, value, domain, path, expires, httpOnly, secure, sameSite }
   *
   * Use this to snapshot cookies after a login flow, then re-inject them later
   * via POST /v1/session/:id/cookies to skip re-authentication.
   */
  router.get('/v1/session/:id/cookies', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params['id'] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    try {
      // Playwright context.cookies() returns all cookies for all URLs by default
      const cookies = await session.context.cookies();
      session.lastUsedAt = Date.now();

      res.json({
        sessionId: session.id,
        cookies,
        count: cookies.length,
        expiresAt: new Date(session.lastUsedAt + session.ttlMs).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: {
          type: 'cookie_export_failed',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#cookie-export-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  /**
   * POST /v1/session/:id/cookies — inject cookies into the session's browser context
   *
   * Body params:
   *   cookies {Cookie[]} Array of Playwright-compatible cookie objects.
   *                      Required fields: name, value, domain (or url).
   *                      Optional: path, expires, httpOnly, secure, sameSite.
   *
   * Returns: { sessionId, injected: number, expiresAt: string }
   *
   * Typical cookie-persistence workflow:
   *   1. POST /v1/session { url: "https://example.com", persist: true }
   *   2. POST /v1/session/:id/act  (complete login flow)
   *   3. GET  /v1/session/:id/cookies  → save cookies array to your storage
   *   4. Later: POST /v1/session/:id/cookies { cookies: [...] }
   *   5. GET  /v1/session/:id  → page loads authenticated (no re-login needed)
   */
  router.post('/v1/session/:id/cookies', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params['id'] as string, ownerId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: {
          type: 'session_not_found',
          message: 'Session not found or has expired.',
          hint: 'Create a new session via POST /v1/session.',
          docs: 'https://webpeel.dev/docs/errors#session-not-found',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    const { cookies } = req.body as { cookies?: unknown[] };
    if (!Array.isArray(cookies) || cookies.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          type: 'bad_request',
          message: '`cookies` must be a non-empty array of cookie objects.',
          hint: 'Pass cookies exported from GET /v1/session/:id/cookies or a compatible Cookie[] array.',
          docs: 'https://webpeel.dev/docs/errors#bad-request',
        },
        requestId: req.requestId || randomUUID(),
      });
      return;
    }

    try {
      // Playwright's addCookies validates the shape internally; invalid cookies will throw
      await session.context.addCookies(cookies as Parameters<BrowserContext['addCookies']>[0]);
      session.lastUsedAt = Date.now();

      res.json({
        sessionId: session.id,
        injected: cookies.length,
        expiresAt: new Date(session.lastUsedAt + session.ttlMs).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({
        success: false,
        error: {
          type: 'cookie_inject_failed',
          message: msg,
          hint: 'Ensure each cookie has at minimum: name, value, and domain (or url).',
          docs: 'https://webpeel.dev/docs/errors#cookie-inject-failed',
        },
        requestId: req.requestId || randomUUID(),
      });
    }
  });

  // ── DELETE /v1/session/:id ───────────────────────────────────────────────────
  router.delete('/v1/session/:id', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);

    if (session) {
      sessions.delete(req.params["id"] as string);
      await session.browser.close().catch(() => {});
    }

    // Always return 200 (idempotent delete)
    res.json({ closed: true });
  });

  return router;
}
