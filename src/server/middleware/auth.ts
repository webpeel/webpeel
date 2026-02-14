/**
 * API key authentication middleware with SOFT LIMIT enforcement
 * 
 * Philosophy: Never fully block users. When weekly limits are exceeded,
 * degrade to HTTP-only mode instead of returning 429.
 * BURST limits (hourly) are HARD limits and return 429.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthStore, ApiKeyInfo } from '../auth-store.js';
import { PostgresAuthStore } from '../pg-auth-store.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        keyInfo: ApiKeyInfo | null;
        tier: 'free' | 'starter' | 'pro' | 'enterprise' | 'max';
        rateLimit: number;
        softLimited: boolean;  // true when over quota — degrade, don't block
        extraUsageAvailable: boolean; // true when extra usage is enabled and can be used
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

      // SECURITY: Skip API key auth for public/JWT-protected endpoints
      // These routes either need no auth or use their own JWT middleware
      const isPublicEndpoint = 
        req.path === '/health' || 
        req.path.startsWith('/v1/auth/') ||
        req.path === '/v1/webhooks/stripe' ||
        req.path === '/v1/me' ||
        req.path.startsWith('/v1/keys') ||
        req.path === '/v1/usage' ||
        req.path.startsWith('/v1/extra-usage');

      if (isPublicEndpoint) {
        req.auth = { 
          keyInfo: null, 
          tier: 'free', 
          rateLimit: 10, 
          softLimited: false,
          extraUsageAvailable: false,
        };
        return next();
      }

      let apiKey: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7);
      } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
        apiKey = apiKeyHeader;
      }
      
      if (!apiKey) {
        // Allow anonymous free-tier access (125/week, 25/hr burst)
        // This enables the playground and basic usage without signup
        req.auth = {
          keyInfo: null,
          tier: 'free',
          rateLimit: 25,  // requests per minute for anonymous
          softLimited: false,
          extraUsageAvailable: false,
        };
        return next();
      }

      // Validate API key if provided
      let keyInfo: ApiKeyInfo | null = null;
      let softLimited = false;
      let extraUsageAvailable = false;

      if (apiKey) {
        keyInfo = await authStore.validateKey(apiKey);
        if (!keyInfo) {
          res.status(401).json({
            error: 'invalid_key',
            message: 'Invalid API key',
          });
          return;
        }

        // Check limits (only for PostgresAuthStore)
        if (authStore instanceof PostgresAuthStore) {
          // HARD LIMIT: Check burst limit first (per-hour cap)
          const { allowed: burstAllowed, burst } = await authStore.checkBurstLimit(apiKey);
          
          if (!burstAllowed) {
            // Burst limit exceeded - HARD 429 with Retry-After
            const retryAfterSeconds = 60 * parseInt(burst.resetsIn.match(/\d+/)?.[0] || '1', 10);
            res.setHeader('Retry-After', retryAfterSeconds.toString());
            res.setHeader('X-Burst-Limit', burst.limit.toString());
            res.setHeader('X-Burst-Used', burst.count.toString());
            
            res.status(429).json({
              error: 'burst_limit_exceeded',
              message: `Hourly burst limit exceeded (${burst.count}/${burst.limit}). Please wait ${burst.resetsIn} before making more requests.`,
              retryAfter: burst.resetsIn,
            });
            return;
          }

          // Add burst headers
          res.setHeader('X-Burst-Limit', burst.limit.toString());
          res.setHeader('X-Burst-Used', burst.count.toString());
          res.setHeader('X-Burst-Remaining', burst.remaining.toString());

          // SOFT LIMIT: Check weekly usage
          const { allowed, usage } = await authStore.checkLimit(apiKey);
          
          // Check if extra usage is available
          if (!allowed) {
            extraUsageAvailable = await authStore.canUseExtraUsage(apiKey);
            
            if (!extraUsageAvailable) {
              // Over weekly quota, no extra usage — SOFT LIMIT (degrade to HTTP-only)
              softLimited = true;
              res.setHeader('X-Soft-Limited', 'true');
              res.setHeader('X-Soft-Limit-Reason', 'Weekly quota exceeded. Requests degraded to HTTP-only mode.');
              res.setHeader('X-Upgrade-URL', 'https://webpeel.dev/pricing');
            }
          }

          // Add weekly usage headers
          if (usage) {
            res.setHeader('X-Weekly-Limit', usage.totalAvailable.toString());
            res.setHeader('X-Weekly-Used', usage.totalUsed.toString());
            res.setHeader('X-Weekly-Remaining', Math.max(0, usage.remaining).toString());
            res.setHeader('X-Weekly-Percent', usage.percentUsed.toString());
            res.setHeader('X-Weekly-Resets-At', usage.resetsAt);

            // Warn if over 80% usage and not using extra usage
            if (usage.percentUsed >= 80 && !softLimited && !extraUsageAvailable) {
              res.setHeader(
                'X-Usage-Warning',
                `You've used ${usage.percentUsed}% of your weekly quota. Consider upgrading at https://webpeel.dev/pricing`
              );
            }
          }

          // Add extra usage headers if available
          const extraInfo = await authStore.getExtraUsageInfo(apiKey);
          if (extraInfo) {
            res.setHeader('X-Extra-Usage-Enabled', extraInfo.enabled ? 'true' : 'false');
            res.setHeader('X-Extra-Usage-Balance', extraInfo.balance.toFixed(2));
            
            if (extraInfo.enabled) {
              res.setHeader('X-Extra-Usage-Spent', extraInfo.spent.toFixed(2));
              res.setHeader('X-Extra-Usage-Limit', extraInfo.spendingLimit.toFixed(2));
            }
          }
        }
      }

      // Set auth context on request
      req.auth = {
        keyInfo,
        tier: keyInfo?.tier || 'free',
        rateLimit: keyInfo?.rateLimit || 10,
        softLimited,
        extraUsageAvailable,
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
