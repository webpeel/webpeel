/**
 * Demo endpoint — GET /v1/demo?url=<encoded_url>
 *
 * Unauthenticated endpoint for the WebPeel landing page hero demo.
 * Returns a truncated fetch result for allowed domains only.
 *
 * Security:
 * - Domain allowlist (no arbitrary URLs)
 * - Separate rate limiter: 3 req/min, 30 req/day per IP
 * - SSRF validation via validateUrl()
 * - HTTP-only fetch (no Puppeteer/browser rendering)
 * - 5s timeout, 2000 char content truncation
 * - CORS: only webpeel.dev + localhost
 * - In-memory cache: 10 min per URL
 */

import { Router, Request, Response } from 'express';
import { RateLimiter } from '../middleware/rate-limit.js';
import { simpleFetch } from '../../core/http-fetch.js';
import { validateUrl } from '../../core/http-fetch.js';
import { htmlToMarkdown, detectMainContent } from '../../core/markdown.js';
import { extractMetadata } from '../../core/metadata.js';

// ── Domain allowlist ──────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = new Set([
  'stripe.com',
  'wikipedia.org',
  'en.wikipedia.org',
  'news.ycombinator.com',
  'github.com',
  'reddit.com',
  'www.reddit.com',
  'bbc.com',
  'www.bbc.com',
  'nytimes.com',
  'www.nytimes.com',
  'techcrunch.com',
  'arxiv.org',
  'stackoverflow.com',
  'producthunt.com',
  'www.producthunt.com',
  'theverge.com',
  'www.theverge.com',
  'arstechnica.com',
  'www.arstechnica.com',
  'docs.python.org',
  'developer.mozilla.org',
]);

// ── Rate limiters (demo-specific, separate from main API) ─────────────────────

// 3 requests per minute per IP
const perMinuteLimiter = new RateLimiter(60_000);

// 30 requests per day per IP
const perDayLimiter = new RateLimiter(24 * 60 * 60 * 1000);

// Cleanup every 10 minutes
setInterval(() => {
  perMinuteLimiter.cleanup();
  perDayLimiter.cleanup();
}, 10 * 60 * 1000);

// ── In-memory result cache (10 min TTL) ───────────────────────────────────────

interface CacheEntry {
  result: DemoResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const demoCache = new Map<string, CacheEntry>();

// ── Response shape ────────────────────────────────────────────────────────────

interface DemoResponse {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  fetchTimeMs: number;
  truncated: boolean;
  demo: true;
  signUpUrl: string;
}

const MAX_CONTENT_LENGTH = 2000;
const FETCH_TIMEOUT_MS = 5000;
const SIGN_UP_URL = 'https://app.webpeel.dev';

// ── CORS helper ───────────────────────────────────────────────────────────────

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin || '';
  // Allow webpeel.dev or any localhost:* origin
  if (
    origin === 'https://webpeel.dev' ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
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
    || 'unknown';
}

// ── Router ────────────────────────────────────────────────────────────────────

export interface DemoRouterOptions {
  /** Inject custom per-minute rate limiter (useful for testing) */
  perMinute?: RateLimiter;
  /** Inject custom per-day rate limiter (useful for testing) */
  perDay?: RateLimiter;
}

export function createDemoRouter(options: DemoRouterOptions = {}): Router {
  const minuteLimiter = options.perMinute ?? perMinuteLimiter;
  const dayLimiter = options.perDay ?? perDayLimiter;
  const router = Router();

  // Handle CORS preflight
  router.options('/v1/demo', (req: Request, res: Response) => {
    setCorsHeaders(req, res);
    res.status(204).end();
  });

  router.get('/v1/demo', async (req: Request, res: Response) => {
    // Always set CORS headers
    setCorsHeaders(req, res);

    try {
      // ── 1. Validate URL parameter ────────────────────────────────────────────
      const { url } = req.query;

      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Missing required query parameter: url' });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({ error: 'URL too long (max 2048 characters)' });
        return;
      }

      // Parse URL to extract hostname
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.status(400).json({ error: 'Invalid URL format' });
        return;
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        res.status(400).json({ error: 'Only HTTP and HTTPS URLs are allowed' });
        return;
      }

      // ── 2. Domain allowlist check ────────────────────────────────────────────
      const hostname = parsedUrl.hostname.toLowerCase();
      if (!ALLOWED_DOMAINS.has(hostname)) {
        res.status(403).json({
          error: 'Domain not allowed for demo. Sign up for full API access.',
          signUpUrl: SIGN_UP_URL,
        });
        return;
      }

      // ── 3. SSRF validation ───────────────────────────────────────────────────
      try {
        validateUrl(url);
      } catch {
        res.status(400).json({ error: 'URL blocked for security reasons' });
        return;
      }

      // ── 4. Rate limiting ─────────────────────────────────────────────────────
      const clientIp = getClientIp(req);

      const minuteResult = minuteLimiter.checkLimit(clientIp, 3);
      if (!minuteResult.allowed) {
        res.setHeader('Retry-After', String(minuteResult.retryAfter || 60));
        res.setHeader('X-RateLimit-Limit', '3');
        res.setHeader('X-RateLimit-Remaining', '0');
        res.status(429).json({
          error: 'Rate limit exceeded. Demo allows 3 requests per minute.',
          retryAfter: minuteResult.retryAfter,
          signUpUrl: SIGN_UP_URL,
        });
        return;
      }

      const dayResult = dayLimiter.checkLimit(clientIp, 30);
      if (!dayResult.allowed) {
        res.setHeader('Retry-After', String(dayResult.retryAfter || 86400));
        res.setHeader('X-RateLimit-Limit', '30');
        res.setHeader('X-RateLimit-Remaining', '0');
        res.status(429).json({
          error: 'Daily rate limit exceeded. Demo allows 30 requests per day.',
          retryAfter: dayResult.retryAfter,
          signUpUrl: SIGN_UP_URL,
        });
        return;
      }

      // ── 5. Cache lookup ──────────────────────────────────────────────────────
      const cacheKey = url;
      const cached = demoCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        res.setHeader('X-Cache', 'HIT');
        res.json(cached.result);
        return;
      }

      // ── 6. Fetch the page (HTTP-only, 5s timeout) ────────────────────────────
      const startTime = Date.now();

      let fetchResult: Awaited<ReturnType<typeof simpleFetch>>;
      try {
        const abortController = new AbortController();
        const timeoutHandle = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

        try {
          fetchResult = await simpleFetch(
            url,
            undefined,       // default user agent
            FETCH_TIMEOUT_MS,
            undefined,       // no custom headers
            abortController.signal,
          );
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to fetch URL';
        res.status(502).json({ error: `Fetch failed: ${msg.replace(/[<>"']/g, '')}` });
        return;
      }

      const fetchTimeMs = Date.now() - startTime;

      // ── 7. Extract title and content ─────────────────────────────────────────
      const html = fetchResult.html || '';

      // Extract title from metadata
      let title = '';
      try {
        const meta = extractMetadata(html, url);
        title = meta.title || '';
      } catch {
        title = '';
      }

      // Extract main content and convert to markdown
      let markdownContent = '';
      try {
        const detected = detectMainContent(html);
        const contentHtml = detected.html || html;
        markdownContent = htmlToMarkdown(contentHtml, { prune: true });
      } catch {
        markdownContent = '';
      }

      // ── 8. Truncate content ──────────────────────────────────────────────────
      const truncated = markdownContent.length > MAX_CONTENT_LENGTH;
      const content = truncated
        ? markdownContent.slice(0, MAX_CONTENT_LENGTH)
        : markdownContent;

      // Count words in the truncated content
      const wordCount = content.split(/\s+/).filter(Boolean).length;

      // ── 9. Build response and cache ──────────────────────────────────────────
      const response: DemoResponse = {
        url: fetchResult.url || url,
        title,
        content,
        wordCount,
        fetchTimeMs,
        truncated,
        demo: true,
        signUpUrl: SIGN_UP_URL,
      };

      demoCache.set(cacheKey, { result: response, timestamp: Date.now() });

      res.setHeader('X-Cache', 'MISS');
      res.json(response);
    } catch (error: any) {
      console.error('Demo endpoint error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
