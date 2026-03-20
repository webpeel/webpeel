/**
 * Feed discovery and parsing endpoint — GET /v1/feed
 *
 * Discovers and fetches RSS/Atom feeds for any website URL.
 * Supports direct feed URLs as well as HTML pages (auto-discovers via <link> tags
 * or probes common feed paths like /feed, /rss.xml, etc.).
 *
 * Query params:
 *   - url     (required) — website URL or direct feed URL
 *   - limit   (optional) — max items to return (default 20, max 100)
 *   - format  (optional) — "json" (default) or "markdown"
 */

import { Router, Request, Response } from 'express';
import { AuthStore } from '../auth-store.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author: string;
  guid: string;
}

interface DiscoveredFeed {
  url: string;
  type: string;
  title: string;
}

// ── Helpers: XML text extraction ──────────────────────────────────────────────

/** Extract the inner text of the first matching XML tag. */
function extractTag(xml: string, tag: string): string {
  // Try with namespace prefix first (e.g. dc:creator), then plain
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

/** Extract an attribute value from an XML/HTML tag. */
function extractAttr(tag: string, attr: string): string {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1].trim() : '';
}

/** Strip HTML tags from a string (for description cleanup). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ── RSS/Atom parser ───────────────────────────────────────────────────────────

/**
 * Parse an RSS 2.0 or Atom feed XML string into a flat array of FeedItem objects.
 * Uses regex — no external dependencies.
 */
function parseRSSFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Detect feed type
  const isAtom = /<feed[\s>]/i.test(xml);

  if (isAtom) {
    // ── Atom ───────────────────────────────────────────────────────────────
    const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let m: RegExpExecArray | null;

    while ((m = entryRe.exec(xml)) !== null) {
      const entry = m[1];

      // title
      const title = stripHtml(extractTag(entry, 'title') || '');

      // link — prefer <link rel="alternate" href="..."> else <link href="...">
      let link = '';
      const linkTagRe = /<link([^>]*)\/?>/gi;
      let lt: RegExpExecArray | null;
      while ((lt = linkTagRe.exec(entry)) !== null) {
        const attrs = lt[1];
        const rel = extractAttr(attrs, 'rel') || 'alternate';
        const href = extractAttr(attrs, 'href');
        if (href && (rel === 'alternate' || rel === '')) {
          link = href;
          break;
        }
        if (href && !link) link = href; // fallback
      }

      // description — prefer <content>, fallback <summary>
      const content = extractTag(entry, 'content') || extractTag(entry, 'summary') || '';
      const description = stripHtml(content).substring(0, 500);

      // date — prefer <published>, fallback <updated>
      const pubDate = extractTag(entry, 'published') || extractTag(entry, 'updated') || '';

      // author
      const authorBlock = entry.match(/<author[\s>]([\s\S]*?)<\/author>/i);
      const author = authorBlock ? (extractTag(authorBlock[1], 'name') || '') : '';

      // id
      const guid = extractTag(entry, 'id') || link;

      items.push({ title, link, description, pubDate, author, guid });
    }
  } else {
    // ── RSS 2.0 ────────────────────────────────────────────────────────────
    const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;

    while ((m = itemRe.exec(xml)) !== null) {
      const item = m[1];

      const title = stripHtml(extractTag(item, 'title') || '');
      const link = extractTag(item, 'link') || extractTag(item, 'feedburner:origLink') || '';
      const rawDesc = extractTag(item, 'description') || extractTag(item, 'content:encoded') || '';
      const description = stripHtml(rawDesc).substring(0, 500);
      const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || '';
      const author = extractTag(item, 'author') || extractTag(item, 'dc:creator') || '';
      const guid = extractTag(item, 'guid') || link;

      items.push({ title, link, description, pubDate, author, guid });
    }
  }

  return items;
}

// ── HTML feed discovery ───────────────────────────────────────────────────────

/**
 * Scan an HTML document for <link rel="alternate" type="application/rss+xml"> tags
 * and similar, returning discovered feed URLs resolved against the page URL.
 */
function discoverFeeds(html: string, pageUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  // Match all <link ...> tags in the <head>
  const linkRe = /<link([^>]+)>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const attrs = m[1];
    const rel = extractAttr(attrs, 'rel').toLowerCase();
    const type = extractAttr(attrs, 'type').toLowerCase();
    const href = extractAttr(attrs, 'href');

    if (rel !== 'alternate' || !href) continue;

    // Accept RSS, Atom, and generic XML feed types
    const isFeed =
      type.includes('rss') ||
      type.includes('atom') ||
      type.includes('application/xml') ||
      type.includes('text/xml');

    if (!isFeed) continue;

    // Resolve relative URLs
    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }

    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const title = extractAttr(attrs, 'title') || 'Feed';
    feeds.push({ url: resolvedUrl, type, title });
  }

  return feeds;
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createFeedRouter(_authStore: AuthStore): Router {
  const router = Router();

  router.get('/v1/feed', async (req: Request, res: Response) => {
    try {
      const url = req.query.url as string;
      const limitRaw = parseInt(req.query.limit as string || '20', 10);
      const limit = isNaN(limitRaw) ? 20 : Math.min(limitRaw, 100);
      const format = (req.query.format as string) || 'json';

      // ── Validate required param ──────────────────────────────────────────
      if (!url) {
        res.status(400).json({
          success: false,
          error: { type: 'invalid_request', message: 'Missing required parameter: "url"' },
        });
        return;
      }

      // ── SSRF guard ───────────────────────────────────────────────────────
      try {
        validateUrlForSSRF(url);
      } catch (e) {
        if (e instanceof SSRFError) {
          res.status(400).json({
            success: false,
            error: { type: 'invalid_request', message: e.message },
          });
          return;
        }
        throw e;
      }

      let feedUrl = url;
      let feedItems: FeedItem[] = [];

      // ── Fetch the URL ────────────────────────────────────────────────────
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'WebPeel/0.21 (+https://webpeel.dev/bot)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        res.status(502).json({
          success: false,
          error: { type: 'fetch_error', message: `Failed to fetch URL: HTTP ${response.status}` },
        });
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const trimmed = text.trimStart();

      const looksLikeFeed =
        contentType.includes('xml') ||
        contentType.includes('rss') ||
        contentType.includes('atom') ||
        trimmed.startsWith('<?xml') ||
        trimmed.startsWith('<rss') ||
        trimmed.startsWith('<feed');

      if (looksLikeFeed) {
        // ── Direct feed URL ────────────────────────────────────────────────
        feedItems = parseRSSFeed(text);
      } else {
        // ── HTML page — discover feeds ─────────────────────────────────────
        const feedLinks = discoverFeeds(text, url);

        if (feedLinks.length > 0) {
          // Fetch the first (highest-priority) discovered feed
          feedUrl = feedLinks[0].url;

          try {
            validateUrlForSSRF(feedUrl);
          } catch {
            // If discovered feed URL is blocked, fall through to probe paths
            feedUrl = url;
          }

          if (feedUrl !== url) {
            const feedRes = await fetch(feedUrl, {
              headers: { 'User-Agent': 'WebPeel/0.21 (+https://webpeel.dev/bot)' },
              signal: AbortSignal.timeout(10000),
            });
            if (feedRes.ok) {
              const feedText = await feedRes.text();
              feedItems = parseRSSFeed(feedText);
            }
          }
        }

        // If still no items, probe common feed paths
        if (feedItems.length === 0) {
          const baseUrl = new URL(url).origin;
          const commonPaths = [
            '/feed',
            '/rss',
            '/rss.xml',
            '/feed.xml',
            '/atom.xml',
            '/feed/rss',
            '/blog/feed',
            '/blog/rss',
            '/index.xml',
          ];

          for (const path of commonPaths) {
            const candidateUrl = baseUrl + path;

            try {
              validateUrlForSSRF(candidateUrl);
            } catch {
              continue;
            }

            try {
              const probeRes = await fetch(candidateUrl, {
                headers: { 'User-Agent': 'WebPeel/0.21 (+https://webpeel.dev/bot)' },
                signal: AbortSignal.timeout(3000),
              });
              if (!probeRes.ok) continue;
              const probeText = await probeRes.text();
              const probeTrimmed = probeText.trimStart();
              if (
                probeTrimmed.startsWith('<?xml') ||
                probeTrimmed.startsWith('<rss') ||
                probeTrimmed.startsWith('<feed')
              ) {
                feedItems = parseRSSFeed(probeText);
                feedUrl = candidateUrl;
                break;
              }
            } catch {
              // Continue to next candidate
            }
          }
        }
      }

      // ── Trim to limit ────────────────────────────────────────────────────
      feedItems = feedItems.slice(0, limit);

      // ── Format response ──────────────────────────────────────────────────
      if (format === 'markdown') {
        const md = feedItems
          .map(
            (item, i) =>
              `${i + 1}. **${item.title || '(no title)'}**\n   ${item.link || ''}\n   ${item.pubDate || ''}\n   ${item.description?.substring(0, 200) || ''}`,
          )
          .join('\n\n');

        res.json({
          success: true,
          data: {
            feedUrl,
            format: 'markdown',
            content: md,
            itemCount: feedItems.length,
          },
        });
      } else {
        res.json({
          success: true,
          data: {
            feedUrl,
            items: feedItems,
            itemCount: feedItems.length,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: { type: 'internal', message },
      });
    }
  });

  return router;
}
