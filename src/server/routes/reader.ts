/**
 * Zero-auth URL-prefix reader API — Jina Reader style
 *
 * GET /r/https://example.com  → returns markdown (no auth, no signup)
 * GET /s/search+query         → searches web and returns fetched results
 *
 * Headers (Jina-compatible):
 *   x-respond-with: markdown | text | html | screenshot
 *   x-timeout: seconds (default 10, max 15)
 *   x-target-selector: CSS selector to target
 *   x-wait-for-selector: CSS selector to wait for (triggers browser rendering)
 *   x-with-generated-alt: true to caption images
 *   x-no-cache: true to bypass cache
 *
 * Rate limit: 20 requests per 15 minutes per IP (no auth required)
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { createLogger } from '../../core/logger.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import crypto from 'crypto';

const log = createLogger('reader');

// IP-based rate limiting (same approach as playground)
const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;                // 20 requests per window
const RATE_WINDOW = 15 * 60 * 1000;  // 15 minutes

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

export function createReaderRouter(): Router {
  const router = Router();

  // GET /r/https://example.com — fetch any URL, return markdown
  // Also supports /r/http://example.com
  router.get('/r/*', async (req: Request, res: Response) => {
    // Express wildcard: req.params[0] gives everything after /r/
    const targetUrl = req.params[0] || req.url.replace(/^\/r\//, '');

    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_url',
          message: 'Prepend /r/ to a full URL. Example: /r/https://example.com',
        },
      });
    }

    // SECURITY: SSRF validation — block private IPs, localhost, etc.
    try {
      validateUrlForSSRF(targetUrl);
    } catch (err) {
      if (err instanceof SSRFError) {
        return res.status(400).json({
          success: false,
          error: { type: 'ssrf_blocked', message: err.message },
        });
      }
      throw err;
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const { allowed, remaining } = checkRateLimit(ip);

    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    if (!allowed) {
      return res.status(429).json({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'Rate limit exceeded. 20 requests per 15 minutes without auth.',
        },
      });
    }

    try {
      // Parse request headers for options (Jina-compatible)
      const format = (req.headers['x-respond-with'] as string) || 'markdown';
      const timeoutSec = parseInt(req.headers['x-timeout'] as string || '10', 10);
      const timeout = Math.min(timeoutSec * 1000, 15000); // cap at 15s
      const targetSelector = req.headers['x-target-selector'] as string | undefined;
      const waitForSelector = req.headers['x-wait-for-selector'] as string | undefined;
      const withCaptions = req.headers['x-with-generated-alt'] === 'true';

      const result = await peel(targetUrl, {
        timeout,
        render: !!waitForSelector || !!targetSelector,
        noEscalate: !waitForSelector,  // no browser escalation unless explicitly needed
        captionImages: withCaptions,
        selector: targetSelector,
        waitSelector: waitForSelector,
      });

      // Cache-Control: this endpoint is public and heavily cacheable.
      // Cloudflare edge caches for 2 min; serves stale for up to 10 min while revalidating.
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      // Vary on Accept so different content-type representations are cached separately.
      res.setHeader('Vary', 'Accept');

      // Return based on format
      const responseFormat = format.toLowerCase();
      if (responseFormat === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(result.content || '');
      } else if (responseFormat === 'html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send((result as any).html || (result as any).rawHtml || '');
      } else if (responseFormat === 'screenshot') {
        return res.json({
          success: true,
          screenshot: (result as any).screenshot || null,
          url: targetUrl,
        });
      } else {
        // Default: markdown as plain text (like Jina)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const header =
          `Title: ${result.title || ''}\nURL: ${targetUrl}\nTokens: ${result.tokens || 0}\n\n`;
        return res.send(header + (result.content || ''));
      }
    } catch (err: any) {
      log.error('Reader error:', err.message);
      return res.status(500).json({
        success: false,
        error: { type: 'fetch_failed', message: err.message },
        requestId: crypto.randomUUID(),
      });
    }
  });

  // GET /s/query — search web and return fetched results
  router.get('/s/*', async (req: Request, res: Response) => {
    const query = decodeURIComponent(req.params[0] || '');

    if (!query.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'missing_query',
          message: 'Prepend /s/ to your search query. Example: /s/stripe pricing plans',
        },
      });
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const { allowed, remaining } = checkRateLimit(ip);

    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    if (!allowed) {
      return res.status(429).json({
        success: false,
        error: { type: 'rate_limited', message: 'Rate limit exceeded.' },
      });
    }

    try {
      const { getBestSearchProvider } = await import('../../core/search-provider.js');
      const { provider, apiKey } = await getBestSearchProvider();
      const results = await provider.searchWeb(query, { count: 5, apiKey });

      // Fetch top 3 results (5K char limit each to keep responses manageable)
      const fetched = await Promise.all(
        results.slice(0, 3).map(async (r: any) => {
          try {
            const page = await peel(r.url, { timeout: 5000, noEscalate: true });
            return {
              title: r.title || page.title,
              url: r.url,
              content: (page.content || '').slice(0, 5000),
            };
          } catch {
            return { title: r.title, url: r.url, content: r.snippet || '' };
          }
        })
      );

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const output = fetched
        .map((r, i) => `## Result ${i + 1}: ${r.title}\nURL: ${r.url}\n\n${r.content}`)
        .join('\n\n---\n\n');

      return res.send(`Search: ${query}\nResults: ${fetched.length}\n\n${output}`);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { type: 'search_failed', message: err.message },
      });
    }
  });

  return router;
}
