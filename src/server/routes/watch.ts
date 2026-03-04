/**
 * WebPeel Watch REST API
 *
 * POST   /v1/watch           — Create a new watch
 * GET    /v1/watch           — List watches for the authenticated account
 * GET    /v1/watch/:id       — Get a single watch entry
 * POST   /v1/watch/:id/check — Manually trigger a content check
 * PATCH  /v1/watch/:id       — Update a watch (pause/resume/interval)
 * DELETE /v1/watch/:id       — Delete a watch
 *
 * All routes require API-key authentication via the global auth middleware.
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';
import { WatchManager, computeLineDiff } from '../../core/watch-manager.js';

// ─── Diff-mode response shape ─────────────────────────────────────────────────

interface WatchDiffResult {
  changed: boolean;
  /** Full current page content (always present). */
  content: string;
  /** Line-level diff details (only when ?diff=true and content changed). */
  diff?: {
    added: string[];
    removed: string[];
    summary: string;
    changePercent: number;
  };
  /** Approximate token count of the diff text alone. */
  diffTokens?: number;
  /** Approximate token count of the full content. */
  fullTokens?: number;
}

/** Rough token estimate: ~4 characters per token (GPT-style approximation). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createWatchRouter(pool: pg.Pool): Router {
  const router = Router();
  const manager = new WatchManager(pool);

  // ─── Require authentication helper ─────────────────────────────────────────

  function requireAuth(req: Request, res: Response): string | null {
    const accountId = req.auth?.keyInfo?.accountId;
    if (!accountId) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'API key required. Pass via Authorization: Bearer <key>.',
      });
      return null;
    }
    return accountId;
  }

  // ─── POST /v1/watch — create a watch ────────────────────────────────────────

  router.post('/v1/watch', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;

    const { url, webhookUrl, checkIntervalMinutes, selector } = req.body as {
      url?: unknown;
      webhookUrl?: unknown;
      checkIntervalMinutes?: unknown;
      selector?: unknown;
    };

    if (!url || typeof url !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Missing or invalid "url" parameter.',
      });
      return;
    }

    if (url.length > 2048) {
      res.status(400).json({ error: 'invalid_url', message: 'URL too long (max 2048 characters).' });
      return;
    }

    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'invalid_url', message: 'URL format is invalid.' });
      return;
    }

    if (webhookUrl !== undefined && (typeof webhookUrl !== 'string' || webhookUrl.length > 2048)) {
      res.status(400).json({ error: 'invalid_request', message: 'Invalid "webhookUrl".' });
      return;
    }

    const intervalMinutes =
      checkIntervalMinutes !== undefined ? Number(checkIntervalMinutes) : 60;
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 44640) {
      res.status(400).json({
        error: 'invalid_request',
        message: '"checkIntervalMinutes" must be between 1 and 44640 (31 days).',
      });
      return;
    }

    try {
      const entry = await manager.create(accountId, url, {
        webhookUrl: typeof webhookUrl === 'string' ? webhookUrl : undefined,
        checkIntervalMinutes: intervalMinutes,
        selector: typeof selector === 'string' ? selector : undefined,
      });
      res.status(201).json({ ok: true, watch: entry });
    } catch (err) {
      console.error('[watch] create error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to create watch.' });
    }
  });

  // ─── GET /v1/watch — list watches ───────────────────────────────────────────

  router.get('/v1/watch', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;

    try {
      const watches = await manager.list(accountId);
      res.json({ ok: true, watches });
    } catch (err) {
      console.error('[watch] list error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to list watches.' });
    }
  });

  // ─── GET /v1/watch/:id — get a watch ────────────────────────────────────────

  router.get('/v1/watch/:id', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;
    const watchId = req.params['id'] as string;

    try {
      const entry = await manager.get(watchId);
      if (!entry) {
        res.status(404).json({ error: 'not_found', message: 'Watch not found.' });
        return;
      }
      if (entry.accountId !== accountId) {
        res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
        return;
      }
      res.json({ ok: true, watch: entry });
    } catch (err) {
      console.error('[watch] get error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to get watch.' });
    }
  });

  // ─── POST /v1/watch/:id/check — manual check ─────────────────────────────────
  //
  // Query params:
  //   ?diff=true  — Return a line-level diff alongside the full content, with
  //                 token-savings metadata.  Default behaviour (no param) is
  //                 unchanged — returns the raw WatchDiff object.

  router.post('/v1/watch/:id/check', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;
    const watchId = req.params['id'] as string;
    const includeDiff = req.query['diff'] === 'true';

    try {
      const entry = await manager.get(watchId);
      if (!entry) {
        res.status(404).json({ error: 'not_found', message: 'Watch not found.' });
        return;
      }
      if (entry.accountId !== accountId) {
        res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
        return;
      }

      const watchDiff = await manager.check(watchId);

      if (includeDiff) {
        // Compute line-level diff between previous and current content.
        const lineDiff = computeLineDiff(watchDiff.previousContent, watchDiff.content);
        const fullTokens = estimateTokens(watchDiff.content);
        const diffText = [...lineDiff.added, ...lineDiff.removed].join('\n');
        const diffTokens = estimateTokens(diffText);

        const result: WatchDiffResult = {
          changed: watchDiff.changed,
          content: watchDiff.content,
          diffTokens,
          fullTokens,
        };

        if (lineDiff.changed) {
          result.diff = {
            added: lineDiff.added,
            removed: lineDiff.removed,
            summary: lineDiff.summary,
            changePercent: lineDiff.changePercent,
          };
        }

        res.json({ ok: true, diff: result });
      } else {
        res.json({ ok: true, diff: watchDiff });
      }
    } catch (err) {
      console.error('[watch] manual check error:', err);
      res.status(500).json({
        error: 'check_failed',
        message: err instanceof Error ? err.message : 'Check failed.',
      });
    }
  });

  // ─── PATCH /v1/watch/:id — update a watch ───────────────────────────────────

  router.patch('/v1/watch/:id', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;
    const watchId = req.params['id'] as string;

    const { status, webhookUrl, checkIntervalMinutes, selector } = req.body as {
      status?: unknown;
      webhookUrl?: unknown;
      checkIntervalMinutes?: unknown;
      selector?: unknown;
    };

    try {
      const existing = await manager.get(watchId);
      if (!existing) {
        res.status(404).json({ error: 'not_found', message: 'Watch not found.' });
        return;
      }
      if (existing.accountId !== accountId) {
        res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
        return;
      }

      // Handle pause/resume as a convenience.
      if (status === 'paused') {
        await manager.pause(watchId);
      } else if (status === 'active') {
        await manager.resume(watchId);
      }

      // Build the partial update payload.
      type WatchUpdate = Parameters<typeof manager.update>[1];
      const updates: WatchUpdate = {};
      if (webhookUrl !== undefined) {
        updates.webhookUrl = typeof webhookUrl === 'string' ? webhookUrl : undefined;
      }
      if (checkIntervalMinutes !== undefined) {
        const n = Number(checkIntervalMinutes);
        if (!Number.isFinite(n) || n < 1 || n > 44640) {
          res.status(400).json({
            error: 'invalid_request',
            message: '"checkIntervalMinutes" must be between 1 and 44640.',
          });
          return;
        }
        updates.checkIntervalMinutes = n;
      }
      if (selector !== undefined) {
        updates.selector = typeof selector === 'string' ? selector : undefined;
      }

      const updated = await manager.update(watchId, updates);
      res.json({ ok: true, watch: updated ?? existing });
    } catch (err) {
      console.error('[watch] update error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to update watch.' });
    }
  });

  // ─── DELETE /v1/watch/:id — delete a watch ───────────────────────────────────

  router.delete('/v1/watch/:id', async (req: Request, res: Response) => {
    const accountId = requireAuth(req, res);
    if (!accountId) return;
    const watchId = req.params['id'] as string;

    try {
      const existing = await manager.get(watchId);
      if (!existing) {
        res.status(404).json({ error: 'not_found', message: 'Watch not found.' });
        return;
      }
      if (existing.accountId !== accountId) {
        res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
        return;
      }

      await manager.delete(watchId);
      res.json({ ok: true, deleted: watchId });
    } catch (err) {
      console.error('[watch] delete error:', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to delete watch.' });
    }
  });

  return router;
}
