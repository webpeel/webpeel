/**
 * WebPeel Audit Logging Middleware
 *
 * Records who accessed which API endpoints and the outcome.
 * Designed to be privacy-safe:
 *  - Logs userId, keyId, method, path, status, duration, IP, user-agent
 *  - Does NOT log: request bodies, auth headers, query params (may contain API keys)
 *  - Only logs /v1/ endpoints (skips health checks, static files)
 */

import { Request, Response, NextFunction } from 'express';
import '../types.js'; // Augments Express.Request with requestId
import { createLogger } from '../logger.js';

const auditLog = createLogger('audit');

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (req as any).auth as { keyInfo?: { accountId?: string; key?: string } } | undefined;
    const userId = auth?.keyInfo?.accountId || 'anonymous';
    // Use a truncated prefix of the key as a safe identifier (never log the full key)
    const rawKey = auth?.keyInfo?.key;
    const keyId = rawKey ? rawKey.slice(0, 8) + '...' : 'none';

    // Only log API endpoints (skip health checks, static files)
    if (req.path.startsWith('/v1/')) {
      auditLog.info(`${req.method} ${req.path}`, {
        action: `${req.method} ${req.path}`,
        userId,
        keyId,
        statusCode: res.statusCode,
        duration,
        ip: (req.headers['cf-connecting-ip'] as string) ||
            (req.headers['x-forwarded-for'] as string) ||
            req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 100),
        // DO NOT log: request body, auth headers, query params (may contain API keys or secrets)
      });
    }
  });

  next();
}
