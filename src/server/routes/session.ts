/**
 * Browser Session API — stateful Playwright sessions
 *
 * POST   /v1/session                → create session, returns { sessionId, expiresAt }
 * GET    /v1/session/:id            → get current page content (Readability text)
 * POST   /v1/session/:id/navigate   → navigate to URL { url }
 * POST   /v1/session/:id/act        → execute PageActions array
 * GET    /v1/session/:id/screenshot → take screenshot (image/png)
 * DELETE /v1/session/:id            → close session
 *
 * Use cases: login flows, multi-step automation, UI testing.
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
// extractReadableContent imported dynamically in extractReadableText()

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
}

const sessions = new Map<string, BrowserSession>();
const SESSION_TTL_MS = 5 * 60 * 1000;   // 5 minutes idle TTL
const MAX_SESSIONS_PER_USER = 3;         // prevent abuse

// Cleanup expired sessions every minute
const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_TTL_MS) {
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
async function extractReadableText(html: string, url: string): Promise<string> {
  try {
    const { extractReadableContent } = await import('../../core/readability.js');
    const result = extractReadableContent(html, url);
    return result.content?.trim() || result.excerpt?.trim() || '';
  } catch {
    return '';
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createSessionRouter(): Router {
  const router = Router();

  // ── POST /v1/session — create session ────────────────────────────────────────
  router.post('/v1/session', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: 'auth_required', message: 'Valid API key or session required.' });
      return;
    }

    // Enforce per-user session cap
    const userSessions = [...sessions.values()].filter(s => s.ownerId === ownerId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      res.status(429).json({
        error: 'session_limit',
        message: `Maximum ${MAX_SESSIONS_PER_USER} concurrent sessions per user. Delete an existing session first.`,
      });
      return;
    }

    const { url } = req.body as { url?: string };

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
          res.status(502).json({ error: 'navigation_failed', message: errMsg });
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
      });

      res.status(201).json({
        sessionId: id,
        currentUrl: page.url(),
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'session_create_failed', message: msg });
    }
  });

  // ── GET /v1/session/:id — get page content ───────────────────────────────────
  router.get('/v1/session/:id', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params['id'] as string, ownerId);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }

    try {
      const [html, title] = await Promise.all([
        session.page.content(),
        session.page.title(),
      ]);

      const content = extractReadableText(html, session.page.url());
      session.lastUsedAt = Date.now();

      res.json({
        sessionId: session.id,
        currentUrl: session.page.url(),
        title,
        content,
        expiresAt: new Date(session.lastUsedAt + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'session_error', message: msg });
    }
  });

  // ── POST /v1/session/:id/navigate ────────────────────────────────────────────
  router.post('/v1/session/:id/navigate', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }

    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'bad_request', message: '`url` is required.' });
      return;
    }

    try {
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      session.lastUsedAt = Date.now();
      session.currentUrl = session.page.url();

      res.json({
        currentUrl: session.page.url(),
        title: await session.page.title(),
        expiresAt: new Date(session.lastUsedAt + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: 'navigation_failed', message: msg });
    }
  });

  // ── POST /v1/session/:id/act — execute actions ───────────────────────────────
  router.post('/v1/session/:id/act', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
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
      res.status(400).json({ error: 'invalid_actions', message: msg });
      return;
    }

    if (!normalized?.length) {
      res.status(400).json({ error: 'bad_request', message: '`actions` must be a non-empty array.' });
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
        expiresAt: new Date(session.lastUsedAt + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: 'action_failed', message: msg });
    }
  });

  // ── GET /v1/session/:id/screenshot ───────────────────────────────────────────
  router.get('/v1/session/:id/screenshot', async (req: Request, res: Response) => {
    const ownerId = getOwnerId(req);
    const session = getSession(req.params["id"] as string, ownerId);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }

    try {
      const fullPage = req.query.fullPage === 'true';
      const buf = await session.page.screenshot({ type: 'png', fullPage });
      session.lastUsedAt = Date.now();

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'screenshot_failed', message: msg });
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
