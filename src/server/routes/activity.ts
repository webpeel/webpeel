/**
 * Activity endpoint - provides recent API request history
 */

import { Router, Request, Response } from 'express';
import { PostgresAuthStore } from '../pg-auth-store.js';
import { AuthStore } from '../auth-store.js';

export function createActivityRouter(authStore: AuthStore): Router {
  const router = Router();

  router.get('/v1/activity', async (req: Request, res: Response) => {
    try {
      // Require authentication (API key or JWT session token)
      const userId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'unauthorized',
          message: 'Authentication required',
        });
        return;
      }

      // Only works with PostgreSQL backend
      if (!(authStore instanceof PostgresAuthStore)) {
        res.status(501).json({
          error: 'not_implemented',
          message: 'Activity endpoint requires PostgreSQL backend',
        });
        return;
      }

      // Access pool via any cast (pool is private but we need direct DB access)
      const pgStore = authStore as any;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      // Get recent requests from usage_logs
      const activityQuery = `
        SELECT 
          id,
          url,
          method,
          status_code,
          processing_time_ms,
          created_at
        FROM usage_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await pgStore.pool.query(activityQuery, [userId, limit]);

      // Transform to frontend format
      const requests = result.rows.map((row: any) => ({
        id: row.id,
        url: row.url || 'N/A',
        status: (row.status_code >= 200 && row.status_code < 300) ? 'success' : 'error',
        responseTime: row.processing_time_ms || 0,
        mode: row.method || 'basic',
        timestamp: row.created_at,
      }));

      res.json({ requests });
    } catch (error: any) {
      console.error('Activity error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve activity',
      });
    }
  });

  return router;
}
