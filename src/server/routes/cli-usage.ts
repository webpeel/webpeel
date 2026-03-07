/**
 * CLI Usage endpoint — works with API key auth (not JWT)
 * Used by the `webpeel usage` command and pre-fetch usage checks
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';

const { Pool } = pg;

export function createCLIUsageRouter(): Router {
  const router = Router();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // If no DB, return a stub router
    router.get('/v1/cli/usage', (_req: Request, res: Response) => {
      res.status(501).json({
        error: 'not_configured',
        message: 'Usage tracking requires PostgreSQL backend',
      });
    });
    return router;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    // TLS: enabled when DATABASE_URL contains sslmode=require.
    // Secure by default (rejectUnauthorized: true); set PG_REJECT_UNAUTHORIZED=false
    // only for managed DBs (Render/Neon/Supabase) that use self-signed certs.
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  });

  /**
   * GET /v1/cli/usage
   * Returns usage info for the authenticated API key's owner
   * Auth: API key via Authorization: Bearer <key> or X-API-Key header
   */
  router.get('/v1/cli/usage', async (req: Request, res: Response) => {
    try {
      // Require API key auth (set by global auth middleware)
      if (!req.auth?.keyInfo?.accountId) {
        res.status(401).json({
          success: false,
          error: { type: 'unauthorized', message: 'Valid API key required. Run `webpeel login` to authenticate.', docs: 'https://webpeel.dev/docs/authentication' },
          requestId: req.requestId,
        });
        return;
      }

      const userId = req.auth.keyInfo.accountId;

      // Get user plan info
      const planResult = await pool.query(
        'SELECT tier, weekly_limit, burst_limit FROM users WHERE id = $1',
        [userId]
      );

      if (planResult.rows.length === 0) {
        res.status(404).json({ error: 'user_not_found', message: 'User not found' });
        return;
      }

      const plan = planResult.rows[0];

      // Current week (ISO format)
      const now = new Date();
      const year = now.getUTCFullYear();
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const weekNum = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
      const currentWeek = `${year}-W${String(weekNum).padStart(2, '0')}`;

      // Current hour bucket
      const currentHour = now.toISOString().substring(0, 13);

      // Get weekly usage
      const weeklyResult = await pool.query(
        `SELECT 
          COALESCE(SUM(wu.total_count), 0) as total_used,
          COALESCE(SUM(wu.basic_count), 0) as basic_used,
          COALESCE(SUM(wu.stealth_count), 0) as stealth_used,
          COALESCE(SUM(wu.search_count), 0) as search_used
        FROM api_keys ak
        LEFT JOIN weekly_usage wu ON wu.api_key_id = ak.id AND wu.week = $2
        WHERE ak.user_id = $1 AND ak.is_active = true`,
        [userId, currentWeek]
      );

      const weekly = weeklyResult.rows[0];
      const totalUsed = parseInt(weekly.total_used) || 0;
      const weeklyLimit = plan.weekly_limit || 125;
      const remaining = Math.max(0, weeklyLimit - totalUsed);

      // Get burst usage
      const burstResult = await pool.query(
        `SELECT COALESCE(SUM(bu.count), 0) as burst_used
        FROM api_keys ak
        LEFT JOIN burst_usage bu ON bu.api_key_id = ak.id AND bu.hour_bucket = $2
        WHERE ak.user_id = $1 AND ak.is_active = true`,
        [userId, currentHour]
      );

      const burstUsed = parseInt(burstResult.rows[0]?.burst_used) || 0;
      const burstLimit = plan.burst_limit || 25;
      const minutesRemaining = 59 - now.getUTCMinutes();

      // Get next Monday reset time
      const dayOfWeek = now.getUTCDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      const nextMonday = new Date(now);
      nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
      nextMonday.setUTCHours(0, 0, 0, 0);

      res.json({
        plan: {
          tier: plan.tier,
          weeklyLimit,
          burstLimit,
        },
        weekly: {
          used: totalUsed,
          limit: weeklyLimit,
          remaining,
          resetsAt: nextMonday.toISOString(),
          percentUsed: Math.round((totalUsed / weeklyLimit) * 100),
        },
        burst: {
          used: burstUsed,
          limit: burstLimit,
          resetsIn: minutesRemaining <= 0 ? '< 1 min' : `${minutesRemaining}m`,
        },
        // Simple boolean flags for CLI to check quickly
        canFetch: remaining > 0 && burstUsed < burstLimit,
        upgradeUrl: 'https://webpeel.dev/pricing',
      });
    } catch (error: any) {
      console.error('CLI usage error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve usage',
      });
    }
  });

  return router;
}
