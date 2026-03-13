/**
 * Scope enforcement middleware for API key permission scoping.
 *
 * Keys have one of three scopes:
 *   'full'       — all endpoints (default)
 *   'read'       — read/fetch operations only
 *   'restricted' — /v1/scrape only (for limited sharing)
 *
 * JWT-authenticated requests (dashboard sessions) bypass scope enforcement:
 * req.keyScope is undefined for JWT requests, which are always allowed through.
 */

import { Request, Response, NextFunction } from 'express';
import { KeyScope } from '../pg-auth-store.js';

/**
 * Middleware factory that enforces API key scope.
 * Pass the set of scopes that are permitted to access the guarded route.
 *
 * @example
 * // Only full-access keys may manage billing:
 * router.post('/v1/billing', requireScope('full'), handler);
 *
 * // Read and full keys may scrape:
 * app.use('/v1/scrape', requireScope('full', 'read', 'restricted'), scrapeRouter);
 */
export function requireScope(...allowedScopes: KeyScope[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // JWT sessions (req.keyScope === undefined) always pass through.
    // Scope enforcement only applies to API key requests.
    if (req.keyScope === undefined) {
      return next();
    }

    if (!allowedScopes.includes(req.keyScope)) {
      res.status(403).json({
        success: false,
        error: {
          type: 'insufficient_scope',
          message: `This API key has '${req.keyScope}' scope. This endpoint requires: ${allowedScopes.join(' or ')}.`,
          docs: 'https://webpeel.dev/docs/authentication#scopes',
          hint: 'Create a new API key with the required scope in your dashboard.',
        },
        requestId: req.requestId,
      });
      return;
    }

    next();
  };
}
