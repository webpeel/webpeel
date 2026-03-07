/**
 * Playground endpoint — GET /v1/playground?url=<encoded_url>
 *                       GET /v1/playground/search?q=<query>
 *
 * Unauthenticated endpoints for the WebPeel playground page.
 * Lets visitors try the product without signing up.
 *
 * Security:
 * - CORS-locked to webpeel.dev and localhost
 * - IP-based rate limit: 10 requests per 15 minutes (shared across /fetch and /search)
 * - Simple HTTP-only fetch (no browser rendering)
 * - 5-second timeout
 * - Content truncated to 5,000 chars
 * - No screenshots
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
import { createLogger } from '../logger.js';

const log = createLogger('playground');

// ── IP-based rate limiter ─────────────────────────────────────────────────────

const MAX_PER_WINDOW = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipHits = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = ipHits.get(ip);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + WINDOW_MS;
    ipHits.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: MAX_PER_WINDOW - 1, resetAt };
  }

  if (entry.count >= MAX_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: MAX_PER_WINDOW - entry.count, resetAt: entry.resetAt };
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now > entry.resetAt) ipHits.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ── CORS helper ───────────────────────────────────────────────────────────────

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin || '';
  if (
    origin === 'https://webpeel.dev' ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // Allow curl and server-to-server (no Origin header)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── IP extraction ─────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  const firstForwardedIp = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : Array.isArray(forwardedFor) ? forwardedFor[0] : undefined;

  return (req.headers['cf-connecting-ip'] as string)
    || firstForwardedIp
    || (req.headers['x-real-ip'] as string)
    || req.ip
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── CORS origin check ─────────────────────────────────────────────────────────

function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return true; // Allow curl / server-to-server (no Origin header)

  return (
    origin === 'https://webpeel.dev' ||
    origin.startsWith('https://webpeel.dev/') ||
    /^http:\/\/localhost(:\d+)?/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?/.test(origin)
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

const MAX_CONTENT_LENGTH = 5000;
const FETCH_TIMEOUT_MS = 5000;
const SIGN_UP_URL = 'https://app.webpeel.dev';

export function createPlaygroundRouter(): Router {
  const router = Router();

  // ── CORS preflight ─────────────────────────────────────────────────────────
  router.options('/', (req: Request, res: Response) => {
    setCorsHeaders(req, res);
    res.status(204).end();
  });

  router.options('/search', (req: Request, res: Response) => {
    setCorsHeaders(req, res);
    res.status(204).end();
  });

  // ── GET /v1/playground?url=... ─────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    setCorsHeaders(req, res);

    // CORS check
    if (!isAllowedOrigin(req)) {
      res.status(403).json({
        success: false,
        error: {
          type: 'cors_denied',
          message: 'Playground is only available from webpeel.dev',
          hint: `Sign up at ${SIGN_UP_URL} for full API access.`,
        },
      });
      return;
    }

    const url = (req.query.url as string || '').trim();
    if (!url) {
      res.status(400).json({
        success: false,
        error: {
          type: 'missing_url',
          message: 'URL parameter is required',
          hint: 'GET /v1/playground?url=https://example.com',
        },
      });
      return;
    }

    // Basic URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_url',
          message: 'Invalid URL format',
          hint: 'Ensure the URL is well-formed: https://example.com',
        },
      });
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_url',
          message: 'Only HTTP and HTTPS URLs are allowed',
        },
      });
      return;
    }

    // Rate limit by IP
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);

    res.setHeader('X-RateLimit-Limit', String(MAX_PER_WINDOW));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));

    if (!rl.allowed) {
      res.status(429).json({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'Playground limit reached (10 requests per 15 minutes)',
          hint: `Sign up for a free API key for unlimited access: ${SIGN_UP_URL}`,
        },
        playground: true,
      });
      return;
    }

    try {
      log.info('Playground fetch', { url, ip });
      const startMs = Date.now();

      const result = await peel(url, {
        timeout: FETCH_TIMEOUT_MS,
        render: false,
        noEscalate: true,
      });

      const fullContent = result.content || '';
      const content = fullContent.slice(0, MAX_CONTENT_LENGTH);
      const truncated = fullContent.length > MAX_CONTENT_LENGTH;

      res.json({
        success: true,
        url: result.url,
        title: result.title,
        content,
        tokens: result.tokens,
        method: result.method,
        elapsed: Date.now() - startMs,
        truncated,
        ...(truncated && {
          upgrade: `Full content available with a free API key → ${SIGN_UP_URL}`,
        }),
        playground: true,
        rateLimitRemaining: rl.remaining,
      });
    } catch (err: any) {
      log.warn('Playground fetch error', { url, error: err?.message });
      res.status(502).json({
        success: false,
        error: {
          type: 'fetch_failed',
          message: err?.message || 'Failed to fetch URL',
          hint: 'Check that the URL is publicly accessible.',
        },
        playground: true,
      });
    }
  });

  // ── GET /v1/playground/search?q=... ───────────────────────────────────────
  router.get('/search', async (req: Request, res: Response) => {
    setCorsHeaders(req, res);

    // CORS check
    if (!isAllowedOrigin(req)) {
      res.status(403).json({
        success: false,
        error: {
          type: 'cors_denied',
          message: 'Playground is only available from webpeel.dev',
        },
      });
      return;
    }

    const q = (req.query.q as string || '').trim();
    if (!q) {
      res.status(400).json({
        success: false,
        error: {
          type: 'missing_query',
          message: 'Query parameter is required',
          hint: 'GET /v1/playground/search?q=your+query',
        },
      });
      return;
    }

    // Rate limit by IP (shared counter with fetch)
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);

    res.setHeader('X-RateLimit-Limit', String(MAX_PER_WINDOW));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));

    if (!rl.allowed) {
      res.status(429).json({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'Playground limit reached (10 requests per 15 minutes)',
          hint: `Sign up for a free API key for unlimited access: ${SIGN_UP_URL}`,
        },
        playground: true,
      });
      return;
    }

    try {
      log.info('Playground search', { q, ip });
      const startMs = Date.now();

      const { provider, apiKey } = getBestSearchProvider();
      const results = await provider.searchWeb(q, { count: 5, apiKey });

      res.json({
        success: true,
        query: q,
        results,
        elapsed: Date.now() - startMs,
        playground: true,
        rateLimitRemaining: rl.remaining,
      });
    } catch (err: any) {
      log.warn('Playground search error', { q, error: err?.message });
      res.status(502).json({
        success: false,
        error: {
          type: 'search_failed',
          message: err?.message || 'Search failed',
        },
        playground: true,
      });
    }
  });

  return router;
}
