/**
 * Health check endpoint
 */

import { Router, Request, Response } from 'express';

const startTime = Date.now();

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.json({
      status: 'healthy',
      version: process.env.npm_package_version || '1.0.0',
      uptime,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
