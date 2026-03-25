/**
 * Health check endpoints
 * NOTE: This route is mounted BEFORE auth/rate-limit middleware in app.ts
 * so it's never blocked by rate limiting (Render hits it every ~30s).
 *
 * GET /health  — liveness probe: always returns 200 if process is alive
 * GET /ready   — readiness probe: checks DB + job queue; returns 503 if not ready
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchCache, searchCache } from '../../core/fetch-cache.js';
import { browserCircuitBreaker } from '../../core/circuit-breaker.js';
import type pg from 'pg';

// Memory threshold for readiness degradation (90% of 1GB pod limit)
const MEMORY_READY_LIMIT_MB = 900;

const startTime = Date.now();

// Read version once at startup
let version = 'unknown';
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
  version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
} catch {
  // Fallback for bundled/Docker environments
  try {
    const altPath = join(process.cwd(), 'package.json');
    version = JSON.parse(readFileSync(altPath, 'utf-8')).version;
  } catch { /* keep 'unknown' */ }
}

export function createHealthRouter(pool?: pg.Pool | null): Router {
  const router = Router();

  // ------------------------------------------------------------------
  // GET /health — liveness probe
  // K8s: if this fails, pod is restarted
  // ------------------------------------------------------------------
  router.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const fetchStats = fetchCache.stats();
    const searchStats = searchCache.stats();
    const mem = process.memoryUsage();

    res.json({
      status: 'healthy',
      version,
      uptime,
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      browser: browserCircuitBreaker.getState(),
      cache: {
        fetch: {
          size: fetchStats.size,
          hitRate: fetchStats.hitRate,
        },
        search: {
          size: searchStats.size,
          hitRate: searchStats.hitRate,
        },
      },
    });
  });

  // ------------------------------------------------------------------
  // GET /ready — readiness probe
  // K8s: if this fails, pod is removed from service endpoints (no traffic)
  // Checks: database connectivity + queue (job table) reachability
  // ------------------------------------------------------------------
  router.get('/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string; rss?: number }> = {};
    let allOk = true;

    // --- Memory pressure check ---
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    if (rssMB > MEMORY_READY_LIMIT_MB) {
      checks.memory = { ok: false, rss: rssMB, error: `RSS ${rssMB}MB exceeds limit ${MEMORY_READY_LIMIT_MB}MB — pod under memory pressure` };
      allOk = false;
    } else {
      checks.memory = { ok: true, rss: rssMB };
    }

    // --- Database check ---
    if (pool) {
      const t0 = Date.now();
      try {
        await pool.query('SELECT 1');
        checks.database = { ok: true, latencyMs: Date.now() - t0 };
      } catch (err: any) {
        checks.database = { ok: false, latencyMs: Date.now() - t0, error: err?.message ?? 'unknown' };
        allOk = false;
      }
    } else {
      // No pool configured (in-memory mode / local dev without DATABASE_URL)
      checks.database = { ok: true, latencyMs: 0 };
    }

    // --- Job queue check (probe the jobs table via DATABASE_URL directly) ---
    if (process.env.DATABASE_URL) {
      const t0 = Date.now();
      try {
        // Reuse the same pool if available, or do a lightweight table existence check
        if (pool) {
          await pool.query('SELECT COUNT(*) FROM jobs WHERE status = $1 LIMIT 1', ['queued']);
          checks.queue = { ok: true, latencyMs: Date.now() - t0 };
        } else {
          checks.queue = { ok: true, latencyMs: 0 };
        }
      } catch (err: any) {
        // Table may not exist in early boot; treat as non-fatal
        const msg: string = err?.message ?? '';
        if (msg.includes('relation "jobs" does not exist')) {
          checks.queue = { ok: true, latencyMs: Date.now() - t0 };
        } else {
          checks.queue = { ok: false, latencyMs: Date.now() - t0, error: msg };
          allOk = false;
        }
      }
    } else {
      checks.queue = { ok: true, latencyMs: 0 };
    }

    const status = allOk ? 200 : 503;
    res.status(status).json({
      status: allOk ? 'ready' : 'not_ready',
      version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  return router;
}
