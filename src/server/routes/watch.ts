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
import { WatchManager } from '../../core/watch-manager.js';

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

  router.post('/v1/watch/:id/check', async (req: Request, res: Response) => {
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

      const diff = await manager.check(watchId);
      res.json({ ok: true, diff });
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
