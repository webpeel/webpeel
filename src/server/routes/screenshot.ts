/**
 * Screenshot endpoint — POST /v1/screenshot
 *
 * Takes a screenshot of a URL and returns base64-encoded image data.
 * Uses the same rate limiting / credit system as the fetch endpoint (1 credit).
 */

import { Router, Request, Response } from 'express';
import { takeScreenshot, takeFilmstrip, takeAuditScreenshots, takeAnimationCapture, takeViewportsBatch, takeDesignAudit, takeScreenshotDiff, takeDesignAnalysis } from '../../core/screenshot.js';
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
  elapsed: number
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
        req.ip || req.socket.remoteAddress, req.get('user-agent')]
    ).catch(() => {});
  }
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createScreenshotRouter(authStore: AuthStore): Router {
  const router = Router();

  router.post('/v1/screenshot', async (req: Request, res: Response) => {
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

      // --- Validate URL --------------------------------------------------
      if (!validateRequestUrl(url, res)) return;

      // --- Validate options -----------------------------------------------
      if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid format: must be "png", "jpeg", or "jpg"',
        });
        return;
      }

      if (width !== undefined && (typeof width !== 'number' || width < 100 || width > 5000)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid width: must be between 100 and 5000',
        });
        return;
      }

      if (height !== undefined && (typeof height !== 'number' || height < 100 || height > 5000)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid height: must be between 100 and 5000',
        });
        return;
      }

      if (quality !== undefined && (typeof quality !== 'number' || quality < 1 || quality > 100)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid quality: must be between 1 and 100',
        });
        return;
      }

      if (waitFor !== undefined && (typeof waitFor !== 'number' || waitFor < 0 || waitFor > 60000)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid waitFor: must be between 0 and 60000ms',
        });
        return;
      }

      if (selector !== undefined && typeof selector !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid selector: must be a string',
        });
        return;
      }

      // Normalize user-provided actions (accepts Firecrawl-style too)
      let normalizedActions;
      if (actions !== undefined) {
        try {
          normalizedActions = normalizeActions(actions);
        } catch (e) {
          res.status(400).json({
            error: 'invalid_request',
            message: `Invalid actions: ${(e as Error).message}`,
          });
          return;
        }
      }

      // --- Take the screenshot -------------------------------------------
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

      // --- Track usage ---------------------------------------------------
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;

      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            'stealth',
            url,
            elapsed,
            200
          );

          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          }
        } else if (!isSoftLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'stealth');
        }
      }

      // Log to usage_logs (fire and forget)
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'screenshot',
            url,
            'stealth',
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log screenshot request:', err);
        });
      }

      // --- Respond -------------------------------------------------------
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'screenshot');

      // Binary response format support
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
      console.error('Screenshot error:', error);

      // Log error (fire and forget)
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'screenshot',
            req.body?.url,
            'stealth',
            500,
            error.message || 'Unknown error',
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((logErr: any) => {
          console.error('Failed to log screenshot error:', logErr);
        });
      }

      if (error.code) {
        const safeMessage = error.message.replace(/[<>"']/g, '');
        res.status(500).json({
          error: 'screenshot_error',
          message: safeMessage,
        });
      } else {
        res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred while taking the screenshot',
        });
      }
    }
  });

  // ── POST /v1/screenshot/filmstrip ──────────────────────────────────────────
  router.post('/v1/screenshot/filmstrip', async (req: Request, res: Response) => {
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

      // --- Validate URL --------------------------------------------------
      if (!validateRequestUrl(url, res)) return;

      // --- Validate options -----------------------------------------------
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

      // --- Take the filmstrip -------------------------------------------
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

      // --- Track usage ---------------------------------------------------
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;

      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            'stealth',
            url,
            elapsed,
            200
          );
          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          }
        } else if (!isSoftLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'stealth');
        }
      }

      // Log to usage_logs (fire and forget)
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'screenshot_filmstrip',
            url,
            'stealth',
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log filmstrip request:', err);
        });
      }

      // --- Respond -------------------------------------------------------
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
      console.error('Filmstrip error:', error);

      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'screenshot_filmstrip',
            req.body?.url,
            'stealth',
            500,
            error.message || 'Unknown error',
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((logErr: any) => {
          console.error('Failed to log filmstrip error:', logErr);
        });
      }

      if (error.code) {
        const safeMessage = error.message.replace(/[<>"']/g, '');
        res.status(500).json({ error: 'filmstrip_error', message: safeMessage });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred while taking the filmstrip' });
      }
    }
  });

  // ── POST /v1/screenshot/audit ──────────────────────────────────────────────
  router.post('/v1/screenshot/audit', async (req: Request, res: Response) => {
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
      console.error('Audit screenshot error:', error);
      if (error.code) {
        res.status(500).json({ error: 'audit_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during audit screenshots' });
      }
    }
  });

  // ── POST /v1/screenshot/animation ─────────────────────────────────────────
  router.post('/v1/screenshot/animation', async (req: Request, res: Response) => {
    try {
      const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!ssUserId) {
        res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
        return;
      }

      const { url, frames = 6, intervalMs = 500, scrollTo, selector, width, height,
        format = 'jpeg', quality, waitFor, timeout } = req.body;

      if (!validateRequestUrl(url, res)) return;

      if (format !== undefined && !['png', 'jpeg', 'jpg'].includes(format)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid format: must be "png", "jpeg", or "jpg"' });
        return;
      }

      if (frames !== undefined && (typeof frames !== 'number' || frames < 1 || frames > 30)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid frames: must be between 1 and 30' });
        return;
      }
      if (intervalMs !== undefined && (typeof intervalMs !== 'number' || intervalMs < 50 || intervalMs > 10000)) {
        res.status(400).json({ error: 'invalid_request', message: 'Invalid intervalMs: must be between 50 and 10000' });
        return;
      }

      const startTime = Date.now();
      const result = await takeAnimationCapture(url, {
        frames, intervalMs, scrollTo,
        selector: typeof selector === 'string' ? selector : undefined,
        width, height, format, quality,
        waitFor, timeout: timeout || 60000,
      });
      const elapsed = Date.now() - startTime;

      trackUsageAndLog(req, res, authStore, 'screenshot_animation', url, elapsed);

      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'animation');

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
      console.error('Animation capture error:', error);
      if (error.code) {
        res.status(500).json({ error: 'animation_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during animation capture' });
      }
    }
  });

  // ── POST /v1/screenshot/viewports ─────────────────────────────────────────
  router.post('/v1/screenshot/viewports', async (req: Request, res: Response) => {
    try {
      const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!ssUserId) {
        res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
        return;
      }

      const { url, viewports, fullPage = false, format = 'jpeg', quality,
        scrollThrough = false, waitFor, timeout } = req.body;

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
      console.error('Viewports error:', error);
      if (error.code) {
        res.status(500).json({ error: 'viewports_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during viewport screenshots' });
      }
    }
  });

  // ── POST /v1/screenshot/design-audit ──────────────────────────────────────
  router.post('/v1/screenshot/design-audit', async (req: Request, res: Response) => {
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
      console.error('Design audit error:', error);
      if (error.code) {
        res.status(500).json({ error: 'design_audit_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design audit' });
      }
    }
  });

  // ── POST /v1/screenshot/design-analysis ───────────────────────────────────
  router.post('/v1/screenshot/design-analysis', async (req: Request, res: Response) => {
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
      console.error('Design analysis error:', error);
      if (error.code) {
        res.status(500).json({ error: 'design_analysis_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during design analysis' });
      }
    }
  });

  // ── POST /v1/screenshot/diff ───────────────────────────────────────────────
  router.post('/v1/screenshot/diff', async (req: Request, res: Response) => {
    try {
      const ssUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!ssUserId) {
        res.status(401).json({ error: 'unauthorized', message: 'API key required. Get one free at https://app.webpeel.dev/keys' });
        return;
      }

      const { url1, url2, width, height, fullPage = false, threshold, waitFor, timeout } = req.body;

      // --- Validate URLs ------------------------------------------------
      if (!validateRequestUrl(url1, res)) return;
      if (!validateRequestUrl(url2, res)) return;

      if (url1 === url2) {
        res.status(400).json({ error: 'invalid_request', message: 'url1 and url2 must be different URLs' });
        return;
      }

      // --- Validate options -----------------------------------------------
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

      // --- Take diff ---------------------------------------------------
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

      // --- Track usage ---------------------------------------------------
      trackUsageAndLog(req, res, authStore, 'screenshot_diff', url1, elapsed);

      // --- Respond -------------------------------------------------------
      res.setHeader('X-Credits-Used', '2');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'diff');

      // Binary response format support
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
      console.error('Diff screenshot error:', error);
      if (error.code) {
        res.status(500).json({ error: 'diff_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during visual diff' });
      }
    }
  });

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
      console.error('Review error:', error);
      if (error.code) {
        res.status(500).json({ error: 'review_error', message: error.message.replace(/[<>"']/g, '') });
      } else {
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred during review' });
      }
    }
  });

  return router;
}
