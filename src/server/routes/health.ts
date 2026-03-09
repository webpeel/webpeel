/**
 * Health check endpoint
 * NOTE: This route is mounted BEFORE auth/rate-limit middleware in app.ts
 * so it's never blocked by rate limiting (Render hits it every ~30s).
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.json({
      status: 'healthy',
      version,
      uptime,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
