/**
 * Cache Pre-Warming Routes
 *
 * GET /internal/popular-urls  — Top N URLs fetched in the last 24h (for CF Worker)
 * GET /internal/cache-status  — Current warmer state (warmed URLs, last run time)
 *
 * Both routes are mounted BEFORE auth middleware so they're accessible internally.
 * /internal/popular-urls is protected by CACHE_WARM_SECRET bearer token when set.
 *
 * startCacheWarmer() — server-side self-warming (opt-in via ENABLE_CACHE_WARM=true)
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { createLogger } from '../logger.js';

const log = createLogger('cache-warm');

// ─── Fallback URLs ────────────────────────────────────────────────────────────
// Used when the DB has no usage data yet (new deployment / empty DB).

const FALLBACK_URLS = [
  'https://www.bbc.com/news',
  'https://news.ycombinator.com',
  'https://github.com',
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://www.reuters.com',
  'https://techcrunch.com',
  'https://stripe.com/docs',
  'https://developer.mozilla.org',
  'https://react.dev',
  'https://docs.python.org/3/',
  'https://nodejs.org/en/docs',
  'https://www.npmjs.com',
  'https://vercel.com/docs',
  'https://nextjs.org/docs',
  'https://tailwindcss.com/docs',
  'https://www.typescriptlang.org/docs/',
  'https://docs.render.com',
  'https://cloudflare.com/docs',
  'https://aws.amazon.com/documentation/',
  'https://docs.github.com',
  'https://www.nytimes.com',
  'https://www.theguardian.com',
  'https://arstechnica.com',
  'https://www.wired.com',
  'https://www.bloomberg.com/technology',
  'https://lobste.rs',
  'https://www.producthunt.com',
  'https://stackoverflow.com',
  'https://css-tricks.com',
  'https://web.dev',
];

// ─── In-memory warmer state ───────────────────────────────────────────────────

const warmerState = {
  warmedUrls: new Set<string>(),
  lastWarmTime: null as Date | null,
};

// ─── Router ──────────────────────────────────────────────────────────────────

export function createCacheWarmRouter(pool: pg.Pool | null): Router {
  const router = Router();

  // GET /internal/popular-urls
  router.get('/internal/popular-urls', async (req: Request, res: Response) => {
    // Auth check — if CACHE_WARM_SECRET is set, require it
    const secret = process.env.CACHE_WARM_SECRET;
    if (secret) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== secret) {
        res.status(401).json({
          success: false,
          error: { type: 'unauthorized', message: 'Invalid or missing bearer token.' },
        });
        return;
      }
    }

    let urls: Array<{ url: string; count: number }> = [];

    // Query DB if available
    if (pool) {
      try {
        const result = await pool.query<{ url: string; fetch_count: string }>(`
          SELECT url, COUNT(*) as fetch_count
          FROM usage_logs
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND url IS NOT NULL
            AND status_code >= 200 AND status_code < 300
            AND url NOT LIKE '%localhost%'
            AND url NOT LIKE '%127.0.0.1%'
            AND url NOT LIKE '%169.254%'
          GROUP BY url
          ORDER BY fetch_count DESC
          LIMIT 50
        `);
        urls = result.rows.map((row) => ({
          url: row.url,
          count: parseInt(row.fetch_count, 10),
        }));
      } catch (err: any) {
        log.warn('Failed to query usage_logs, falling back to static list', {
          error: err?.message,
        });
      }
    }

    // Fall back to static list if no DB data
    if (urls.length === 0) {
      log.info('No usage data found, using fallback URL list');
      urls = FALLBACK_URLS.map((url) => ({ url, count: 0 }));
    }

    res.json({
      urls,
      total: urls.length,
      generatedAt: new Date().toISOString(),
    });
  });

  // GET /internal/cache-status
  router.get('/internal/cache-status', (_req: Request, res: Response) => {
    res.json({
      warmedUrls: Array.from(warmerState.warmedUrls),
      urlCount: warmerState.warmedUrls.size,
      lastWarmTime: warmerState.lastWarmTime?.toISOString() ?? null,
    });
  });

  return router;
}

// ─── Self-Warming ─────────────────────────────────────────────────────────────

/**
 * startCacheWarmer — server-side self-warming (fallback when no CF Worker).
 *
 * Every `intervalMs` (default 2 min):
 *  1. Queries /internal/popular-urls (via the DB, not HTTP)
 *  2. Fetches each URL through /r/<url> with concurrency 5
 *  3. Updates warmerState for /internal/cache-status
 *
 * Only started if ENABLE_CACHE_WARM=true.
 */
export function startCacheWarmer(pool: pg.Pool | null, intervalMs = 120_000): void {
  log.info('Cache warmer started', { intervalMs });

  const runWarm = async () => {
    const t0 = Date.now();
    log.info('Cache warm cycle starting');

    // Determine base URL
    // RENDER_EXTERNAL_URL is legacy (Render is retired). On K8s, use PUBLIC_URL or localhost.
    const base =
      process.env.PUBLIC_URL?.replace(/\/$/, '') ||
      process.env.API_BASE_URL?.replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT || 3000}`;

    // Step 1: Fetch popular URLs (same logic as the endpoint)
    let urls: Array<{ url: string; count: number }> = [];

    if (pool) {
      try {
        const result = await pool.query<{ url: string; fetch_count: string }>(`
          SELECT url, COUNT(*) as fetch_count
          FROM usage_logs
          WHERE created_at > NOW() - INTERVAL '24 hours'
            AND url IS NOT NULL
            AND status_code >= 200 AND status_code < 300
            AND url NOT LIKE '%localhost%'
            AND url NOT LIKE '%127.0.0.1%'
            AND url NOT LIKE '%169.254%'
          GROUP BY url
          ORDER BY fetch_count DESC
          LIMIT 50
        `);
        urls = result.rows.map((row) => ({
          url: row.url,
          count: parseInt(row.fetch_count, 10),
        }));
      } catch (err: any) {
        log.warn('Warm cycle: DB query failed, using fallback', { error: err?.message });
      }
    }

    if (urls.length === 0) {
      urls = FALLBACK_URLS.map((u) => ({ url: u, count: 0 }));
    }

    // Step 2: Warm each URL with concurrency 5
    const concurrency = 5;
    let warmed = 0;
    let failed = 0;
    const newWarmedSet = new Set<string>();

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(({ url }) =>
          fetch(`${base}/r/${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'WebPeel-CacheWarmer/1.0' },
            signal: AbortSignal.timeout(15_000),
          }).then((r) => {
            if (r.ok) {
              newWarmedSet.add(url);
              warmed++;
            } else {
              failed++;
            }
          }),
        ),
      );
      // Count settled rejections as failures
      results.forEach((r) => {
        if (r.status === 'rejected') {
          failed++;
        }
      });
    }

    // Step 3: Update state
    warmerState.warmedUrls = newWarmedSet;
    warmerState.lastWarmTime = new Date();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    log.info(`Warmed ${warmed}/${urls.length} URLs in ${elapsed}s`, { failed });
  };

  // Run once immediately, then on interval
  void runWarm().catch((err) => {
    log.error('Cache warm cycle error', { error: err?.message });
  });

  setInterval(() => {
    void runWarm().catch((err) => {
      log.error('Cache warm cycle error', { error: err?.message });
    });
  }, intervalMs);
}
