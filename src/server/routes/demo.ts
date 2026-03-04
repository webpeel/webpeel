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
 * - 5s timeout, 3000 char content truncation
 * - CORS: only webpeel.dev + localhost
 * - In-memory cache: 10 min per URL
 */

import { Router, Request, Response } from 'express';
import { RateLimiter } from '../middleware/rate-limit.js';
import { simpleFetch } from '../../core/http-fetch.js';
import { validateUrl } from '../../core/http-fetch.js';
import { htmlToMarkdown, detectMainContent, countRemovedElements, CleaningStats } from '../../core/markdown.js';
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

interface CleanedSummary {
  scripts: number;
  styles: number;
  ads: number;
  tracking: number;
  navigation: number;
  socialWidgets: number;
  popups: number;
  totalRemoved: number;
  originalSizeKB: number;
  cleanedSizeKB: number;
  reductionPercent: number;
}

interface TokenEstimate {
  raw: number;
  clean: number;
  savings: number;
}

interface DemoResponse {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  fetchTimeMs: number;
  truncated: boolean;
  demo: true;
  signUpUrl: string;
  cleaned: CleanedSummary;
  tokenEstimate: TokenEstimate;
}

const MAX_CONTENT_LENGTH = 3000;
const FETCH_TIMEOUT_MS = 5000;
const SIGN_UP_URL = 'https://app.webpeel.dev';

// ── Wikipedia REST API headers (per Wikimedia User-Agent policy) ──────────────

const WIKI_HEADERS = {
  'User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me) Node.js',
  'Api-User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me)',
};

// ── Helper: strip HTML tags and decode common entities ────────────────────────
// Uses a quote-aware regex to handle `>` inside attribute values (e.g. data-mw='{"type":"..."}')

function stripHtmlTags(str: string): string {
  return str
    // Remove tags, handling quoted attribute values containing >
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ── Wikipedia-specific content cleaner (mirrors domain-extractors.ts) ─────────

function cleanWikipediaContent(content: string): string {
  return content
    // Remove [edit] links
    .replace(/\[edit\]/gi, '')
    // Remove citation brackets [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Remove [citation needed], [verification], etc.
    .replace(/\[(citation needed|verification|improve this article|adding citations[^\]]*|when\?|where\?|who\?|clarification needed|dubious[^\]]*|failed verification[^\]]*|unreliable source[^\]]*)\]/gi, '')
    // Remove [Learn how and when to remove this message]
    .replace(/\[Learn how and when to remove this message\]/gi, '')
    // Clean up excess whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── General post-processing for all demo content ──────────────────────────────

function cleanDemoContent(content: string): string {
  return content
    // Remove empty markdown links: [](/path "tooltip") or [  ](...)
    .replace(/\[(?:\s*)\]\([^)]*\)/g, '')
    // Remove Wikipedia boilerplate
    .replace(/From Wikipedia, the free encyclopedia\s*/gi, '')
    // Remove redirect notices
    .replace(/"[^"]*" (?:and "[^"]*" )?redirect(?:s)? here\.\s*(?:For[^.]*\.\s*)?/gi, '')
    // Remove [edit] links
    .replace(/\[edit\]/gi, '')
    // Remove citation brackets
    .replace(/\[\d+\]/g, '')
    // Remove stray JSON attribute value artifacts from HTML parsing (e.g. "}"> )
    .replace(/^["}'>]+\s*$/gm, '')
    // Clean up excess whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Wikipedia REST API fetcher ────────────────────────────────────────────────

async function fetchWikipediaContent(url: string): Promise<string | null> {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // Only handle article pages: /wiki/Article_Title
    if (pathParts[0] !== 'wiki' || pathParts.length < 2) return null;

    const articleTitle = decodeURIComponent(pathParts[1]);
    // Skip special pages (contain a colon, e.g. Special:Random, Talk:Article)
    if (articleTitle.includes(':')) return null;

    const lang = urlObj.hostname.split('.')[0] || 'en';

    // Fetch summary for title/description
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;
    const summaryResult = await simpleFetch(summaryUrl, undefined, 8000, {
      ...WIKI_HEADERS,
      'Accept': 'application/json',
    });

    let summaryData: Record<string, any> | null = null;
    try {
      summaryData = JSON.parse(summaryResult.html || '');
    } catch {
      summaryData = null;
    }

    if (!summaryData || summaryData.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
      return null;
    }

    const articleTitleClean: string = (summaryData.title as string) || articleTitle.replace(/_/g, ' ');
    const description: string = (summaryData.description as string) || '';

    // Fetch full content via mobile-html
    let fullContent = '';
    try {
      const mobileUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(articleTitle)}`;
      const mobileResult = await simpleFetch(mobileUrl, undefined, 15000, {
        ...WIKI_HEADERS,
        'Accept': 'text/html',
      });

      if (mobileResult?.html) {
        const sectionMatches = mobileResult.html.match(/<section[^>]*>([\s\S]*?)<\/section>/gi) || [];
        for (const section of sectionMatches) {
          // Extract section heading
          const headingMatch = section.match(/<h[2-6][^>]*id="([^"]*)"[^>]*class="[^"]*pcs-edit-section-title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
          const heading = headingMatch ? stripHtmlTags(headingMatch[2]).trim() : '';
          // Extract paragraphs
          const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
          const sectionText = paragraphs
            .map((p: string) => stripHtmlTags(p).trim())
            .filter((t: string) => t.length > 0)
            .join('\n\n');
          if (sectionText) {
            const prefix = heading ? `## ${heading}\n\n` : '';
            fullContent += `\n\n${prefix}${sectionText}`;
          }
        }
      }
    } catch {
      // mobile-html failed — fall back to summary extract
      fullContent = (summaryData.extract as string) || '';
    }

    // Clean Wikipedia noise
    fullContent = cleanWikipediaContent(fullContent);

    const cleanContent = `# ${articleTitleClean}\n\n${description ? `*${description}*\n\n` : ''}${fullContent || (summaryData.extract as string) || ''}`;
    return cleanContent;
  } catch {
    return null;
  }
}

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

      // Count what will be removed BEFORE cleaning runs
      let cleaningStats: CleaningStats;
      try {
        cleaningStats = countRemovedElements(html);
      } catch {
        cleaningStats = {
          scripts: 0, styles: 0, ads: 0, tracking: 0,
          navigation: 0, socialWidgets: 0, popups: 0, totalRemoved: 0,
          originalSizeBytes: Buffer.byteLength(html, 'utf8'),
          cleanedSizeBytes: 0, reductionPercent: 0,
        };
      }

      // Extract title from metadata
      let title = '';
      try {
        const meta = extractMetadata(html, url);
        title = meta.title || '';
      } catch {
        title = '';
      }

      // Extract main content and convert to markdown
      // For Wikipedia URLs: use the REST API for clean structured content
      let markdownContent = '';
      const isWikipedia = /(?:^|\.)wikipedia\.org$/.test(parsedUrl.hostname.toLowerCase());
      if (isWikipedia) {
        try {
          const wikiContent = await fetchWikipediaContent(url);
          if (wikiContent) {
            markdownContent = wikiContent;
          }
        } catch {
          markdownContent = '';
        }
      }

      // Fall back to generic HTML→markdown pipeline if Wikipedia fetch failed/N/A
      if (!markdownContent) {
        try {
          const detected = detectMainContent(html);
          const contentHtml = detected.html || html;
          markdownContent = htmlToMarkdown(contentHtml, { prune: true });
        } catch {
          markdownContent = '';
        }
      }

      // Apply general post-processing to remove common noise artifacts
      markdownContent = cleanDemoContent(markdownContent);

      // Finalize cleaning stats now that we have the cleaned content size
      const cleanedSizeBytes = Buffer.byteLength(markdownContent, 'utf8');
      const originalSizeBytes = cleaningStats.originalSizeBytes;
      const reductionPercent = originalSizeBytes > 0
        ? Math.round(((originalSizeBytes - cleanedSizeBytes) / originalSizeBytes) * 100)
        : 0;

      const cleaned: CleanedSummary = {
        scripts:      cleaningStats.scripts,
        styles:       cleaningStats.styles,
        ads:          cleaningStats.ads,
        tracking:     cleaningStats.tracking,
        navigation:   cleaningStats.navigation,
        socialWidgets: cleaningStats.socialWidgets,
        popups:       cleaningStats.popups,
        totalRemoved: cleaningStats.totalRemoved,
        originalSizeKB: Math.round(originalSizeBytes / 1024 * 10) / 10,
        cleanedSizeKB:  Math.round(cleanedSizeBytes  / 1024 * 10) / 10,
        reductionPercent: Math.max(0, Math.min(100, reductionPercent)),
      };

      // ── 7b. Token savings metrics ────────────────────────────────────────────
      const rawTokens = Math.round(html.length / 4);
      const cleanTokens = Math.round(markdownContent.length / 4);
      const savingsPercent = rawTokens > 0
        ? Math.max(0, Math.round((1 - cleanTokens / rawTokens) * 100))
        : 0;
      const tokenEstimate: TokenEstimate = {
        raw: rawTokens,
        clean: cleanTokens,
        savings: savingsPercent,
      };

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
        cleaned,
        tokenEstimate,
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
