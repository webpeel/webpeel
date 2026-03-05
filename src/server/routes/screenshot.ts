/**
 * Screenshot endpoint — POST /v1/screenshot
 *
 * Takes a screenshot of a URL and returns base64-encoded image data.
 * Uses the same rate limiting / credit system as the fetch endpoint (1 credit).
 *
 * The main endpoint accepts an optional `mode` parameter to select behaviour:
 *   - "screenshot" (default) — basic screenshot
 *   - "filmstrip"            — multiple frames over time
 *   - "audit"               — accessibility / section audit
 *   - "viewports"           — multi-viewport screenshots
 *   - "design"              — design analysis (audit + tokens merged)
 *   - "diff"                — visual diff between url and compareUrl
 *   - "compare"             — design comparison between url and compareUrl/ref
 *
 * All legacy sub-endpoints (/filmstrip, /audit, /viewports, …) are kept as
 * thin wrappers that delegate to the same named handler functions.
 * /animation is deprecated and returns 410 Gone.
 */

import { Router, Request, Response } from 'express';
import {
  takeScreenshot,
  takeFilmstrip,
  takeAuditScreenshots,
  takeViewportsBatch,
  takeDesignAudit,
  takeScreenshotDiff,
  takeDesignAnalysis,
  takeDesignComparison,
} from '../../core/screenshot.js';
import type { AuthStore } from '../auth-store.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import { normalizeActions } from '../../core/actions.js';

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Validate a URL from a request body. Sends a 400 response and returns false on failure.
 * Returns true when the URL is valid and safe to use.
 */
function validateRequestUrl(url: unknown, res: Response): boolean {
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'invalid_request', message: 'Missing or invalid "url" parameter' });
    return false;
  }
  if ((url as string).length > 2048) {
    res.status(400).json({ error: 'invalid_url', message: 'URL too long (max 2048 characters)' });
    return false;
  }
  try {
    const parsed = new URL(url as string);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(400).json({ error: 'invalid_url', message: 'Only HTTP and HTTPS protocols are allowed' });
      return false;
    }
  } catch {
    res.status(400).json({ error: 'invalid_url', message: 'Invalid URL format' });
    return false;
  }
  try {
    validateUrlForSSRF(url as string);
  } catch (error) {
    if (error instanceof SSRFError) {
      res.status(400).json({ error: 'ssrf_blocked', message: 'Cannot fetch localhost, private networks, or non-HTTP URLs' });
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * Fire-and-forget usage tracking + DB logging for screenshot endpoints.
 */
function trackUsageAndLog(
  req: Request,
  res: Response,
  authStore: AuthStore,
  endpoint: string,
  url: string,
  elapsed: number,
): void {
  const isSoftLimited = req.auth?.softLimited === true;
  const hasExtraUsage = req.auth?.extraUsageAvailable === true;
  const pgStore = authStore as any;

  if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
    pgStore.trackBurstUsage(req.auth.keyInfo.key).then(async () => {
      if (isSoftLimited && hasExtraUsage) {
        const extraResult = await pgStore.trackExtraUsage(req.auth!.keyInfo!.key, 'stealth', url, elapsed, 200);
        if (extraResult.success) {
          res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
          res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
        }
      } else if (!isSoftLimited) {
        await pgStore.trackUsage(req.auth!.keyInfo!.key, 'stealth');
      }
    }).catch(() => {});
  }

  if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
    pgStore.pool.query(
      `INSERT INTO usage_logs (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.auth.keyInfo.accountId, endpoint, url, 'stealth', elapsed, 200,
        req.ip || req.socket.remoteAddress, req.get('user-agent')],
    ).catch(() => {});
  }
}

// ── Named handler functions ───────────────────────────────────────────────────
// Each accepts (req, res, authStore) and handles a specific screenshot mode.
// Both the main /v1/screenshot?mode=X dispatcher AND the legacy sub-endpoints
// call the same function — no logic duplication.

async function handleFilmstrip(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const {
      url,
      frames = 6,
      width,
      height,
      format = 'png',
      quality,
      waitFor,
      timeout,
      headers,
      cookies,
      stealth,
    } = req.body;

    if (!validateRequestUrl(url, res)) return;

    if (frames !== undefined && (typeof frames !== 'number' || frames < 2 || frames > 12)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid frames: must be between 2 and 12' });
      return;
    }
    if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid format: must be "png", "jpeg", or "jpg"' });
      return;
    }
    if (width !== undefined && (typeof width !== 'number' || width < 100 || width > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid width: must be between 100 and 5000' });
      return;
    }
    if (height !== undefined && (typeof height !== 'number' || height < 100 || height > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid height: must be between 100 and 5000' });
      return;
    }
    if (quality !== undefined && (typeof quality !== 'number' || quality < 1 || quality > 100)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid quality: must be between 1 and 100' });
      return;
    }
    if (waitFor !== undefined && (typeof waitFor !== 'number' || waitFor < 0 || waitFor > 60000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid waitFor: must be between 0 and 60000ms' });
      return;
    }

    const startTime = Date.now();
    const result = await takeFilmstrip(url, {
      frames,
      width,
      height,
      format,
      quality,
      waitFor,
      timeout: timeout || 30000,
      headers,
      cookies,
      stealth: stealth === true,
    });
    const elapsed = Date.now() - startTime;

    const isSoftLimited = req.auth?.softLimited === true;
    const hasExtraUsage = req.auth?.extraUsageAvailable === true;
    const pgStore = authStore as any;

    if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
      await pgStore.trackBurstUsage(req.auth.keyInfo.key);
      if (isSoftLimited && hasExtraUsage) {
        const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, 'stealth', url, elapsed, 200);
        if (extraResult.success) {
          res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
          res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
        }
      } else if (!isSoftLimited) {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'stealth');
      }
    }

    if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
      pgStore.pool.query(
        `INSERT INTO usage_logs (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.auth.keyInfo.accountId, 'screenshot_filmstrip', url, 'stealth', elapsed, 200,
          req.ip || req.socket.remoteAddress, req.get('user-agent')],
      ).catch(() => {});
    }

    res.setHeader('X-Credits-Used', '1');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'filmstrip');

    res.json({
      success: true,
      data: {
        url: result.url,
        format: result.format,
        frameCount: result.frameCount,
        frames: result.frames,
      },
    });
  } catch (error: any) {
    const pgStore = authStore as any;
    if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
      pgStore.pool.query(
        `INSERT INTO usage_logs (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.auth.keyInfo.accountId, 'screenshot_filmstrip', req.body?.url, 'stealth', 500,
          error.message || 'Unknown error', req.ip || req.socket.remoteAddress, req.get('user-agent')],
      ).catch(() => {});
    }
    if (error.code) {
      res.status(500).json({ error: 'filmstrip_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred while taking the filmstrip' });
    }
  }
}

async function handleAudit(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const { url, width, height, format = 'jpeg', quality, selector, scrollThrough = false, waitFor, timeout } = req.body;

    if (!validateRequestUrl(url, res)) return;

    if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid format: must be "png", "jpeg", or "jpg"' });
      return;
    }

    const startTime = Date.now();
    const result = await takeAuditScreenshots(url, {
      width, height, format, quality,
      selector: typeof selector === 'string' ? selector : 'section',
      scrollThrough: scrollThrough === true,
      waitFor, timeout: timeout || 60000,
    });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'screenshot_audit', url, elapsed);

    res.setHeader('X-Credits-Used', String(result.sections.length || 1));
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'audit');

    res.json({
      success: true,
      data: {
        url: result.url,
        format: result.format,
        sections: result.sections.map(s => ({
          index: s.index,
          tag: s.tag,
          id: s.id,
          className: s.className,
          top: s.top,
          height: s.height,
          screenshot: s.screenshot,
        })),
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'audit_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during audit screenshots' });
    }
  }
}

async function handleViewports(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const { url, viewports, fullPage = false, format = 'jpeg', quality, scrollThrough = false, waitFor, timeout } = req.body;

    if (!validateRequestUrl(url, res)) return;

    if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid format: must be "png", "jpeg", or "jpg"' });
      return;
    }

    if (!Array.isArray(viewports) || viewports.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'Missing or invalid "viewports" array' });
      return;
    }
    if (viewports.length > 6) {
      res.status(400).json({ error: 'invalid_request', message: 'Maximum 6 viewports per request' });
      return;
    }
    for (const vp of viewports) {
      if (!vp || typeof vp.width !== 'number' || typeof vp.height !== 'number') {
        res.status(400).json({ error: 'invalid_request', message: 'Each viewport must have numeric width and height' });
        return;
      }
      if (vp.width < 100 || vp.width > 5000 || vp.height < 100 || vp.height > 5000) {
        res.status(400).json({ error: 'invalid_request', message: 'Viewport dimensions must be between 100 and 5000' });
        return;
      }
    }

    const startTime = Date.now();
    const result = await takeViewportsBatch(url, {
      viewports, fullPage: fullPage === true,
      format, quality,
      scrollThrough: scrollThrough === true,
      waitFor, timeout: timeout || 90000,
    });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'screenshot_viewports', url, elapsed);

    res.setHeader('X-Credits-Used', String(viewports.length));
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'viewports');

    res.json({
      success: true,
      data: {
        url: result.url,
        format: result.format,
        viewports: result.viewports,
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'viewports_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during viewport screenshots' });
    }
  }
}

async function handleDesignAuditHandler(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const { url, rules, selector, width, height, waitFor, timeout } = req.body;

    if (!validateRequestUrl(url, res)) return;

    if (rules !== undefined && typeof rules !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid "rules": must be an object' });
      return;
    }

    const startTime = Date.now();
    const result = await takeDesignAudit(url, {
      rules: typeof rules === 'object' ? rules : undefined,
      selector: typeof selector === 'string' ? selector : undefined,
      width, height,
      waitFor, timeout: timeout || 60000,
    });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'design_audit', url, elapsed);

    res.setHeader('X-Credits-Used', '1');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'design-audit');

    res.json({
      success: true,
      data: {
        url: result.url,
        audit: result.audit,
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'design_audit_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design audit' });
    }
  }
}

async function handleDesignAnalysisHandler(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const { url, selector, width, height, waitFor, timeout, stealth } = req.body;

    if (!validateRequestUrl(url, res)) return;

    const startTime = Date.now();
    const result = await takeDesignAnalysis(url, {
      selector: typeof selector === 'string' ? selector : undefined,
      width, height,
      waitFor, timeout: timeout || 60000,
      stealth: typeof stealth === 'boolean' ? stealth : undefined,
    });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'design_analysis', url, elapsed);

    res.setHeader('X-Credits-Used', '1');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'design-analysis');

    res.json({
      success: true,
      data: {
        url: result.url,
        analysis: result.analysis,
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'design_analysis_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design analysis' });
    }
  }
}

/**
 * mode: "design" — merges design-audit and design-analysis into one response.
 */
async function handleDesignMerged(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    const { url, rules, selector, width, height, waitFor, timeout, stealth } = req.body;

    if (!validateRequestUrl(url, res)) return;

    if (rules !== undefined && typeof rules !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid "rules": must be an object' });
      return;
    }

    const startTime = Date.now();

    const [auditResult, analysisResult] = await Promise.all([
      takeDesignAudit(url, {
        rules: typeof rules === 'object' ? rules : undefined,
        selector: typeof selector === 'string' ? selector : undefined,
        width, height,
        waitFor, timeout: timeout || 60000,
      }),
      takeDesignAnalysis(url, {
        selector: typeof selector === 'string' ? selector : undefined,
        width, height,
        waitFor, timeout: timeout || 60000,
        stealth: typeof stealth === 'boolean' ? stealth : undefined,
      }),
    ]);

    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'design', url, elapsed);

    res.setHeader('X-Credits-Used', '2');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'design');

    res.json({
      success: true,
      data: {
        url: auditResult.url,
        audit: auditResult.audit,
        analysis: analysisResult.analysis,
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'design_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design analysis' });
    }
  }
}

/**
 * Handles both mode:"diff" (uses url + compareUrl) and the legacy /diff endpoint (url1 + url2).
 */
async function handleDiff(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ssUserId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    // Accept both { url1, url2 } (legacy) and { url, compareUrl } (new mode param style)
    const url1 = req.body.url1 ?? req.body.url;
    const url2 = req.body.url2 ?? req.body.compareUrl;
    const { width, height, fullPage = false, threshold, waitFor, timeout } = req.body;

    if (!validateRequestUrl(url1, res)) return;
    if (!validateRequestUrl(url2, res)) return;

    if (url1 === url2) {
      res.status(400).json({ error: 'invalid_request', message: 'url1 and url2 must be different URLs' });
      return;
    }

    if (threshold !== undefined && (typeof threshold !== 'number' || threshold < 0 || threshold > 1)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid threshold: must be a number between 0 and 1' });
      return;
    }
    if (width !== undefined && (typeof width !== 'number' || width < 100 || width > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid width: must be between 100 and 5000' });
      return;
    }
    if (height !== undefined && (typeof height !== 'number' || height < 100 || height > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid height: must be between 100 and 5000' });
      return;
    }

    const startTime = Date.now();
    const result = await takeScreenshotDiff(url1, url2, {
      width,
      height,
      fullPage: fullPage === true,
      threshold: threshold ?? 0.1,
      waitFor,
      timeout: timeout || 60000,
    });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'screenshot_diff', url1, elapsed);

    res.setHeader('X-Credits-Used', '2');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'diff');

    const responseFormat = req.body.responseFormat || req.query.responseFormat;
    if (responseFormat === 'binary') {
      const imgBuf = Buffer.from(result.diff, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.send(imgBuf);
      return;
    }

    res.json({
      success: true,
      data: {
        diff: result.diff,
        diffPixels: result.diffPixels,
        totalPixels: result.totalPixels,
        diffPercent: result.diffPercent,
        dimensions: result.dimensions,
      },
    });
  } catch (error: any) {
    if (error.code) {
      res.status(500).json({ error: 'diff_error', message: error.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during visual diff' });
    }
  }
}

/**
 * mode: "compare" — design comparison (same as GET /v1/design-compare but via POST).
 * Accepts { url, compareUrl } or { url, ref } in the body.
 */
async function handleDesignCompare(req: Request, res: Response, authStore: AuthStore): Promise<void> {
  try {
    const userId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }

    // Accept body params (POST mode) or query params (GET /v1/design-compare)
    const url = (req.body.url ?? req.query.url) as string | undefined;
    const ref = (req.body.compareUrl ?? req.body.ref ?? req.query.ref) as string | undefined;
    const widthParam = req.body.width ?? req.query.width;
    const heightParam = req.body.height ?? req.query.height;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'Missing required parameter "url"' });
      return;
    }
    if (!validateRequestUrl(url, res)) return;

    if (!ref || typeof ref !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'Missing required parameter "compareUrl" (or "ref")' });
      return;
    }
    if (!validateRequestUrl(ref, res)) return;

    if (url === ref) {
      res.status(400).json({ error: 'invalid_request', message: '"url" and "compareUrl" must be different URLs' });
      return;
    }

    const width = widthParam !== undefined ? parseInt(String(widthParam), 10) : undefined;
    const height = heightParam !== undefined ? parseInt(String(heightParam), 10) : undefined;

    if (width !== undefined && (isNaN(width) || width < 100 || width > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid width: must be between 100 and 5000' });
      return;
    }
    if (height !== undefined && (isNaN(height) || height < 100 || height > 5000)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid height: must be between 100 and 5000' });
      return;
    }

    const startTime = Date.now();
    const result = await takeDesignComparison(url, ref, { width, height });
    const elapsed = Date.now() - startTime;

    trackUsageAndLog(req, res, authStore, 'design_compare', url, elapsed);

    res.setHeader('X-Credits-Used', '2');
    res.setHeader('X-Processing-Time', elapsed.toString());
    res.setHeader('X-Fetch-Type', 'design-compare');

    res.json({
      success: true,
      data: {
        subjectUrl: result.subjectUrl,
        referenceUrl: result.referenceUrl,
        score: result.comparison.score,
        summary: result.comparison.summary,
        gaps: result.comparison.gaps,
        subjectAnalysis: result.comparison.subjectAnalysis,
        referenceAnalysis: result.comparison.referenceAnalysis,
      },
    });
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    if (err.code) {
      res.status(500).json({ error: 'design_compare_error', message: err.message.replace(/[<>"']/g, '') });
    } else {
      res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design comparison' });
    }
  }
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createScreenshotRouter(authStore: AuthStore): Router {
  const router = Router();

  // ── POST /v1/screenshot ────────────────────────────────────────────────────
  // Accepts optional `mode` parameter to dispatch to sub-handlers.
  // Falls through to basic screenshot when mode is "screenshot" or absent.
  router.post('/v1/screenshot', async (req: Request, res: Response) => {
    // Mode-based dispatch
    const mode = req.body.mode;
    if (mode === 'filmstrip') return handleFilmstrip(req, res, authStore);
    if (mode === 'audit') return handleAudit(req, res, authStore);
    if (mode === 'viewports') return handleViewports(req, res, authStore);
    if (mode === 'design') return handleDesignMerged(req, res, authStore);
    if (mode === 'diff') return handleDiff(req, res, authStore);
    if (mode === 'compare') return handleDesignCompare(req, res, authStore);
    // mode === 'screenshot' or absent → basic screenshot below

    try {
      const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!ssUserId) {
        res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
        return;
      }

      const {
        url,
        fullPage = false,
        width,
        height,
        format = 'png',
        quality,
        waitFor,
        timeout,
        actions,
        headers,
        cookies,
        stealth,
        scrollThrough = false,
        selector,
      } = req.body;

      if (!validateRequestUrl(url, res)) return;

      if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid format: must be "png", "jpeg", or "jpg"' });
        return;
      }
      if (width !== undefined && (typeof width !== 'number' || width < 100 || width > 5000)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid width: must be between 100 and 5000' });
        return;
      }
      if (height !== undefined && (typeof height !== 'number' || height < 100 || height > 5000)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid height: must be between 100 and 5000' });
        return;
      }
      if (quality !== undefined && (typeof quality !== 'number' || quality < 1 || quality > 100)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid quality: must be between 1 and 100' });
        return;
      }
      if (waitFor !== undefined && (typeof waitFor !== 'number' || waitFor < 0 || waitFor > 60000)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid waitFor: must be between 0 and 60000ms' });
        return;
      }
      if (selector !== undefined && typeof selector !== 'string') {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid selector: must be a string' });
        return;
      }

      let normalizedActions;
      if (actions !== undefined) {
        try {
          normalizedActions = normalizeActions(actions);
        } catch (e) {
          res.status(400).json({ error: 'invalid_request', message: `Invalid actions: ${(e as Error).message}` });
          return;
        }
      }

      const startTime = Date.now();
      const result = await takeScreenshot(url, {
        fullPage: fullPage === true,
        width,
        height,
        format,
        quality,
        waitFor,
        timeout: timeout || 30000,
        actions: normalizedActions,
        headers,
        cookies,
        stealth: stealth === true,
        scrollThrough: scrollThrough === true,
        selector: typeof selector === 'string' ? selector : undefined,
      });
      const elapsed = Date.now() - startTime;

      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;
      const pgStore = authStore as any;

      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);
        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, 'stealth', url, elapsed, 200);
          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          }
        } else if (!isSoftLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'stealth');
        }
      }

      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.auth.keyInfo.accountId, 'screenshot', url, 'stealth', elapsed, 200,
            req.ip || req.socket.remoteAddress, req.get('user-agent')],
        ).catch(() => {});
      }

      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'screenshot');

      const responseFormat = req.body.responseFormat || req.query.responseFormat;
      if (responseFormat === 'binary') {
        const imgBuf = Buffer.from(result.screenshot, 'base64');
        res.setHeader('Content-Type', `image/${result.format}`);
        res.setHeader('X-Final-URL', result.url);
        res.send(imgBuf);
        return;
      }

      res.json({
        success: true,
        data: {
          url: result.url,
          screenshot: `data:${result.contentType};base64,${result.screenshot}`,
          metadata: {
            sourceURL: result.url,
            format: result.format,
            width: width || 1280,
            height: height || 720,
            fullPage: fullPage === true,
          },
        },
      });
    } catch (error: any) {
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.auth.keyInfo.accountId, 'screenshot', req.body?.url, 'stealth', 500,
            error.message || 'Unknown error', req.ip || req.socket.remoteAddress, req.get('user-agent')],
        ).catch(() => {});
      }

      if (error.code) {
        res.status(500).json({ error: 'screenshot_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred while taking the screenshot' });
      }
    }
  });

  // ── POST /v1/screenshot/filmstrip — thin wrapper ───────────────────────────
  router.post('/v1/screenshot/filmstrip', (req: Request, res: Response) =>
    handleFilmstrip(req, res, authStore),
  );

  // ── POST /v1/screenshot/audit — thin wrapper ───────────────────────────────
  router.post('/v1/screenshot/audit', (req: Request, res: Response) =>
    handleAudit(req, res, authStore),
  );

  // ── POST /v1/screenshot/animation — DEPRECATED (410 Gone) ─────────────────
  router.post('/v1/screenshot/animation', (_req: Request, res: Response) => {
    res.status(410).json({
      error: "This endpoint has been deprecated. Use POST /v1/screenshot with mode='filmstrip' instead.",
    });
  });

  // ── POST /v1/screenshot/viewports — thin wrapper ───────────────────────────
  router.post('/v1/screenshot/viewports', (req: Request, res: Response) =>
    handleViewports(req, res, authStore),
  );

  // ── POST /v1/screenshot/design-audit — thin wrapper ───────────────────────
  router.post('/v1/screenshot/design-audit', (req: Request, res: Response) =>
    handleDesignAuditHandler(req, res, authStore),
  );

  // ── POST /v1/screenshot/design-analysis — thin wrapper ────────────────────
  router.post('/v1/screenshot/design-analysis', (req: Request, res: Response) =>
    handleDesignAnalysisHandler(req, res, authStore),
  );

  // ── POST /v1/screenshot/diff — thin wrapper ────────────────────────────────
  router.post('/v1/screenshot/diff', (req: Request, res: Response) =>
    handleDiff(req, res, authStore),
  );

  // ── POST /v1/review ────────────────────────────────────────────────────────
  router.post('/v1/review', async (req: Request, res: Response) => {
    try {
      const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!ssUserId) {
        res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
        return;
      }

      const { url, rules, selector } = req.body;

      if (!validateRequestUrl(url, res)) return;

      const startTime = Date.now();

      const [viewportsResult, auditResult] = await Promise.all([
        takeViewportsBatch(url, {
          viewports: [
            { width: 375, height: 812, label: 'mobile' },
            { width: 768, height: 1024, label: 'tablet' },
            { width: 1440, height: 900, label: 'desktop' },
          ],
          fullPage: false,
          format: 'jpeg',
          quality: 80,
          timeout: 90000,
        }),
        takeDesignAudit(url, {
          rules: typeof rules === 'object' ? rules : undefined,
          selector: typeof selector === 'string' ? selector : undefined,
          timeout: 60000,
        }),
      ]);

      const elapsed = Date.now() - startTime;

      trackUsageAndLog(req, res, authStore, 'review', url, elapsed);

      res.setHeader('X-Credits-Used', '4');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'review');

      res.json({
        success: true,
        data: {
          url: viewportsResult.url,
          viewports: viewportsResult.viewports,
          audit: auditResult.audit,
        },
      });
    } catch (error: any) {
      if (error.code) {
        res.status(500).json({ error: 'review_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during review' });
      }
    }
  });

  // ── GET /v1/design-compare — thin wrapper (delegates to handleDesignCompare) ─
  router.get('/v1/design-compare', async (req: Request, res: Response) => {
    const userId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
      return;
    }
    // Validate ref query param (url is validated inside handleDesignCompare)
    const { ref } = req.query;
    if (!ref || typeof ref !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'Missing required query parameter "ref"' });
      return;
    }
    return handleDesignCompare(req, res, authStore);
  });

  return router;
}
