/**
 * Shareable read links — short public URLs for fetched content
 *
 * POST /v1/share     — create a short link (auth required, 50/day limit)
 * GET  /s/:id        — serve shared content (public, no auth)
 *
 * IDs are 9-char base64url strings (crypto.randomBytes(6).toString('base64url').slice(0, 9))
 * Shares expire after 30 days. view_count is incremented on every public read.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { createLogger } from '../logger.js';
import { peel } from '../../index.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';

const log = createLogger('share');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a cryptographically secure 9-char base64url ID.
 *  randomBytes(7) → base64url gives 10 chars (7*4/3=9.33→10), slice to 9.
 *  Note: randomBytes(6) → base64url gives only 8 chars (6/3*4=8), so we need 7+ bytes.
 */
export function generateShareId(): string {
  return crypto.randomBytes(7).toString('base64url').slice(0, 9);
}

/** Base URL for share links */
function getBaseUrl(): string {
  return process.env.API_BASE_URL || 'https://api.webpeel.dev';
}

/** Simple markdown → HTML renderer (no external deps) */
function markdownToHtml(md: string): string {
  let html = md
    // Escape raw HTML in content to prevent XSS
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (``` ... ```)
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
      `<pre><code>${code.trim()}</code></pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold + italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list items
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    // Double newlines → paragraph breaks
    .replace(/\n\n+/g, '\n</p><p>\n')
    // Remaining single newlines → <br>
    .replace(/\n/g, '<br>\n');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>.*?<\/li>\n?)+/gs, (m) => `<ul>\n${m}</ul>\n`);

  return `<p>\n${html}\n</p>`;
}

/** Build the full HTML page for a shared read */
function buildHtmlPage(share: {
  id: string;
  url: string;
  title: string | null;
  content: string;
  tokens: number | null;
  created_at: Date;
  expires_at: Date;
  view_count: number;
}): string {
  const title = share.title ? `${share.title} — WebPeel` : 'Shared Read — WebPeel';
  const description =
    share.content.slice(0, 200).replace(/\n/g, ' ').replace(/"/g, '&quot;') + '…';
  const canonicalUrl = `${getBaseUrl()}/s/${share.id}`;
  const originalUrl = share.url
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const bodyHtml = markdownToHtml(share.content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/</g, '&lt;')}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonicalUrl}">

  <!-- Open Graph -->
  <meta property="og:title" content="${(share.title || 'Shared Read').replace(/</g, '&lt;')}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="WebPeel">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${(share.title || 'Shared Read').replace(/</g, '&lt;')}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:site" content="@webpeel">

  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --bg: #0f0f11;
      --surface: #1a1a1f;
      --border: #2a2a35;
      --text: #e4e4e7;
      --muted: #71717a;
      --accent: #818cf8;
      --link: #6366f1;
      --code-bg: #1e1e28;
      --max-w: 760px;
    }
    html { background: var(--bg); }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 16px;
      line-height: 1.75;
      color: var(--text);
      background: var(--bg);
      padding: 0 16px;
    }

    /* Top bar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: var(--max-w);
      margin: 0 auto;
      padding: 20px 0 16px;
      border-bottom: 1px solid var(--border);
      gap: 12px;
      flex-wrap: wrap;
    }
    .logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--text); }
    .logo-mark {
      width: 28px; height: 28px;
      background: var(--accent);
      border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700; color: #fff; letter-spacing: -0.5px;
    }
    .logo-name { font-weight: 600; font-size: 15px; }
    .source-link {
      font-size: 12px; color: var(--muted);
      text-decoration: none; max-width: 300px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .source-link:hover { color: var(--accent); }

    /* Main content */
    main {
      max-width: var(--max-w);
      margin: 32px auto;
    }
    h1 { font-size: 1.75rem; font-weight: 700; line-height: 1.25; margin: 0 0 24px; color: var(--text); }
    h2 { font-size: 1.35rem; font-weight: 600; margin: 28px 0 12px; color: var(--text); }
    h3 { font-size: 1.1rem; font-weight: 600; margin: 24px 0 10px; color: var(--text); }
    p { margin: 0 0 16px; color: #d4d4d8; }
    a { color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
    a:hover { color: var(--accent); }
    ul, ol { padding-left: 24px; margin: 0 0 16px; }
    li { margin-bottom: 6px; color: #d4d4d8; }
    blockquote {
      border-left: 3px solid var(--accent); margin: 16px 0;
      padding: 4px 16px; color: var(--muted); font-style: italic;
    }
    code {
      background: var(--code-bg); padding: 2px 6px; border-radius: 4px;
      font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.875em;
      color: var(--accent);
    }
    pre {
      background: var(--code-bg); padding: 16px; border-radius: 8px;
      overflow-x: auto; margin: 16px 0; border: 1px solid var(--border);
    }
    pre code { background: none; padding: 0; color: #e4e4e7; }
    img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
    hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }

    /* Meta info */
    .meta {
      display: flex; gap: 16px; flex-wrap: wrap;
      font-size: 12px; color: var(--muted);
      margin-bottom: 28px; padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .meta span { display: flex; align-items: center; gap: 4px; }

    /* Footer */
    footer {
      max-width: var(--max-w);
      margin: 48px auto 32px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .footer-left { font-size: 13px; color: var(--muted); }
    .cta-btn {
      display: inline-flex; align-items: center; gap-6px;
      padding: 8px 16px; border-radius: 8px;
      background: var(--accent); color: #fff;
      font-size: 13px; font-weight: 600;
      text-decoration: none; transition: opacity 0.15s;
    }
    .cta-btn:hover { opacity: 0.85; color: #fff; }

    @media (max-width: 600px) {
      h1 { font-size: 1.4rem; }
      .topbar { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <!-- Top bar -->
  <div class="topbar">
    <a class="logo" href="https://webpeel.dev" target="_blank" rel="noopener">
      <div class="logo-mark">W</div>
      <span class="logo-name">WebPeel</span>
    </a>
    <a class="source-link" href="${originalUrl}" target="_blank" rel="noopener noreferrer" title="${originalUrl}">
      ↗ ${originalUrl}
    </a>
  </div>

  <!-- Article -->
  <main>
    ${share.title ? `<h1>${share.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>` : ''}
    <div class="meta">
      ${share.tokens != null ? `<span>📝 ${share.tokens.toLocaleString()} tokens</span>` : ''}
      <span>👁 ${share.view_count.toLocaleString()} views</span>
      <span>⏰ Expires ${new Date(share.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </div>
    <div class="content">
      ${bodyHtml}
    </div>
  </main>

  <!-- Footer -->
  <footer>
    <span class="footer-left">Powered by <a href="https://webpeel.dev" target="_blank" rel="noopener">WebPeel</a> — clean web reading for humans &amp; AI</span>
    <a class="cta-btn" href="https://app.webpeel.dev" target="_blank" rel="noopener">
      Try WebPeel →
    </a>
  </footer>
</body>
</html>`;
}

// ─── Rate limit: 50 shares per day per user ───────────────────────────────────

const shareRateMap = new Map<string, { count: number; resetAt: number }>();
const SHARE_DAY_LIMIT = 50;
const SHARE_DAY_MS = 24 * 60 * 60 * 1000;

function checkShareRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = shareRateMap.get(userId);
  if (!entry || entry.resetAt < now) {
    shareRateMap.set(userId, { count: 1, resetAt: now + SHARE_DAY_MS });
    return { allowed: true, remaining: SHARE_DAY_LIMIT - 1 };
  }
  entry.count++;
  if (entry.count > SHARE_DAY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: SHARE_DAY_LIMIT - entry.count };
}

// ─── Public router: GET /s/:id ────────────────────────────────────────────────

export function createSharePublicRouter(pool: pg.Pool | null): Router {
  const router = Router();

  router.get('/s/:id', async (req: Request, res: Response, next: NextFunction) => {
    const id = String(req.params['id'] || '');

    // Only intercept valid-looking 9-char base64url IDs
    if (!/^[A-Za-z0-9_-]{9}$/.test(id)) {
      return next();
    }

    if (!pool) {
      // No DB: fall through to reader's search handler
      return next();
    }

    try {
      // Fetch share and increment view count atomically
      const result = await pool.query(
        `UPDATE shared_reads
         SET view_count = view_count + 1
         WHERE id = $1
           AND expires_at > NOW()
         RETURNING id, url, title, content, tokens, created_at, expires_at, view_count`,
        [id]
      );

      if (result.rows.length === 0) {
        // Not found or expired — fall through to reader's /s/* search handler
        return next();
      }

      const share = result.rows[0];

      // Respond based on Accept header
      const accept = req.headers.accept || '';

      if (accept.includes('application/json')) {
        return res.json({
          success: true,
          shareId: share.id,
          url: share.url,
          title: share.title,
          content: share.content,
          tokens: share.tokens,
          viewCount: share.view_count,
          createdAt: share.created_at,
          expiresAt: share.expires_at,
        });
      }

      if (accept.includes('text/markdown')) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.send(share.content);
      }

      // Default: return HTML page (also covers text/html)
      // Override CSP to allow inline styles for the share page
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; " +
        "frame-ancestors 'none'; base-uri 'none'; form-action 'none'; " +
        "script-src 'none'"
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.send(buildHtmlPage(share));
    } catch (err: any) {
      log.error('Share GET error:', err.message);
      return res.status(500).json({
        success: false,
        error: { type: 'server_error', message: 'Failed to retrieve share' },
      });
    }
  });

  return router;
}

// ─── Protected router: POST /v1/share ─────────────────────────────────────────

export function createShareRouter(pool: pg.Pool | null): Router {
  const router = Router();

  router.post('/v1/share', async (req: Request, res: Response) => {
    // Require auth
    const userId =
      req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: 'unauthorized',
          message: 'Authentication required to create share links.',
          hint: 'Include an Authorization: Bearer <token> header.',
          docs: 'https://webpeel.dev/docs/errors#unauthorized',
        },
      });
    }

    if (!pool) {
      return res.status(503).json({
        success: false,
        error: {
          type: 'unavailable',
          message: 'Share links require a PostgreSQL database.',
        },
      });
    }

    // Rate limit: 50 shares per day per user
    const { allowed, remaining } = checkShareRateLimit(userId);
    res.setHeader('X-Share-Limit-Remaining', remaining.toString());

    if (!allowed) {
      return res.status(429).json({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'Share limit exceeded. Maximum 50 shares per day.',
          hint: 'Wait until tomorrow to create more share links.',
        },
      });
    }

    const { url, content, title } = req.body as {
      url?: string;
      content?: string;
      title?: string;
    };

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request',
          message: 'url is required.',
        },
      });
    }

    // SECURITY: SSRF validation
    try {
      validateUrlForSSRF(url);
    } catch (err) {
      if (err instanceof SSRFError) {
        return res.status(400).json({
          success: false,
          error: { type: 'ssrf_blocked', message: (err as Error).message },
        });
      }
      throw err;
    }

    let shareContent: string;
    let shareTitle: string | undefined;
    let tokens: number | undefined;

    if (content && typeof content === 'string') {
      // Content provided directly (user already fetched it in dashboard)
      shareContent = content;
      shareTitle = title;
      tokens = content.split(/\s+/).filter(Boolean).length;
    } else {
      // Fetch the URL via peel()
      try {
        const result = await peel(url, { timeout: 15000, noEscalate: true });
        shareContent = result.content || '';
        shareTitle = result.title;
        tokens = result.tokens ?? undefined;
      } catch (err: any) {
        log.error('Share: peel failed', { url, error: err.message });
        return res.status(422).json({
          success: false,
          error: {
            type: 'fetch_failed',
            message: `Failed to fetch URL: ${err.message}`,
          },
        });
      }
    }

    if (!shareContent) {
      return res.status(422).json({
        success: false,
        error: {
          type: 'empty_content',
          message: 'No content could be extracted from the URL.',
        },
      });
    }

    // Generate a unique ID with retry for collisions (extremely rare)
    let shareId: string = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateShareId();
      const exists = await pool.query(
        'SELECT 1 FROM shared_reads WHERE id = $1',
        [candidate]
      );
      if (exists.rows.length === 0) {
        shareId = candidate;
        break;
      }
    }

    if (!shareId) {
      return res.status(500).json({
        success: false,
        error: { type: 'server_error', message: 'Failed to generate unique share ID.' },
      });
    }

    // Insert share into DB
    await pool.query(
      `INSERT INTO shared_reads (id, url, title, content, tokens, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [shareId, url, shareTitle ?? null, shareContent, tokens ?? null, userId]
    );

    const shareUrl = `${getBaseUrl()}/s/${shareId}`;

    log.info('Share created', { shareId, url, userId });

    return res.status(201).json({
      success: true,
      shareId,
      shareUrl,
    });
  });

  return router;
}
