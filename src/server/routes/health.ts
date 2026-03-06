/**
 * Health check endpoint
 * NOTE: This route is mounted BEFORE auth/rate-limit middleware in app.ts
 * so it's never blocked by rate limiting (Render hits it every ~30s).
 */

import { Router, Request, Response } from 'express';

const startTime = Date.now();

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.json({
      status: 'healthy',
      uptime,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
