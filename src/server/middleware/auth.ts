/**
 * API key authentication middleware
 */

import { Request, Response, NextFunction } from 'express';
import { AuthStore, ApiKeyInfo } from '../auth-store.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        keyInfo: ApiKeyInfo | null;
        tier: 'free' | 'starter' | 'pro' | 'enterprise';
        rateLimit: number;
      };
    }
  }
}

export function createAuthMiddleware(authStore: AuthStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract API key from Authorization header or X-API-Key header
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers['x-api-key'];

      let apiKey: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7);
      } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
        apiKey = apiKeyHeader;
      }

      // Validate API key if provided
      let keyInfo: ApiKeyInfo | null = null;
      if (apiKey) {
        keyInfo = await authStore.validateKey(apiKey);
        if (!keyInfo) {
          res.status(401).json({
            error: 'invalid_key',
            message: 'Invalid API key',
          });
          return;
        }
      }

      // Set auth context on request
      req.auth = {
        keyInfo,
        tier: keyInfo?.tier || 'free',
        rateLimit: keyInfo?.rateLimit || 10, // Free tier: 10 req/min
      };

      next();
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        error: 'auth_error',
        message: err.message || 'Authentication failed',
      });
    }
  };
}
