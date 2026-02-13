/**
 * Health check endpoint
 */

import { Router, Request, Response } from 'express';

const startTime = Date.now();

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.json({
      status: 'healthy',
      version: '0.3.0',
      uptime,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
