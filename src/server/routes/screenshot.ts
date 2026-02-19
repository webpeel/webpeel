/**
 * Screenshot endpoint — POST /v1/screenshot
 *
 * Takes a screenshot of a URL and returns base64-encoded image data.
 * Uses the same rate limiting / credit system as the fetch endpoint (1 credit).
 */

import { Router, Request, Response } from 'express';
import { takeScreenshot } from '../../core/screenshot.js';
import type { AuthStore } from '../auth-store.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import { normalizeActions } from '../../core/actions.js';

export function createScreenshotRouter(authStore: AuthStore): Router {
  const router = Router();

  router.post('/v1/screenshot', async (req: Request, res: Response) => {
    try {
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
      } = req.body;

      // --- Validate URL --------------------------------------------------
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "url" parameter',
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          error: 'invalid_url',
          message: 'URL too long (max 2048 characters)',
        });
        return;
      }

      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          res.status(400).json({
            error: 'invalid_url',
            message: 'Only HTTP and HTTPS protocols are allowed',
          });
          return;
        }
      } catch {
        res.status(400).json({
          error: 'invalid_url',
          message: 'Invalid URL format',
        });
        return;
      }

      try {
        validateUrlForSSRF(url);
      } catch (error) {
        if (error instanceof SSRFError) {
          res.status(400).json({
            error: 'ssrf_blocked',
            message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
          });
          return;
        }
        throw error;
      }

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

  return router;
}
