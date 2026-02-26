/**
 * Sliding window rate limiting middleware
 */

import { Request, Response, NextFunction } from 'express';
import '../types.js'; // Augments Express.Request with requestId

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private windowMs: number;

  constructor(windowMs: number = 60000) {
    this.windowMs = windowMs;
  }

  /**
   * Check if request is allowed under rate limit
   * @param cost - Number of credits this request costs (default: 1)
   */
  checkLimit(identifier: string, limit: number, cost: number = 1): {
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
  } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create entry
    let entry = this.store.get(identifier);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(identifier, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

    // Check if limit would be exceeded by this request's cost
    if (entry.timestamps.length + cost > limit) {
      const oldestTimestamp = entry.timestamps[0];
      const retryAfter = oldestTimestamp
        ? Math.ceil((oldestTimestamp + this.windowMs - now) / 1000)
        : 1;
      
      return {
        allowed: false,
        remaining: Math.max(0, limit - entry.timestamps.length),
        retryAfter,
      };
    }

    // Add `cost` timestamps to represent the weight of this request
    for (let i = 0; i < cost; i++) {
      entry.timestamps.push(now);
    }

    return {
      allowed: true,
      remaining: limit - entry.timestamps.length,
    };
  }

  /**
   * Clean up old entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [identifier, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
      if (entry.timestamps.length === 0) {
        this.store.delete(identifier);
      }
    }
  }
}

/**
 * Hourly burst limits per tier.
 * These are the hard caps enforced by the in-memory sliding window.
 * Free: 25/hr, Pro: 100/hr, Max: 500/hr (matches pricing page).
 */
const TIER_BURST_LIMITS: Record<string, number> = {
  free: 25,
  starter: 50,
  pro: 100,
  enterprise: 250,
  max: 500,
  admin: 999999,
};

export function createRateLimitMiddleware(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Use API key or real client IP as identifier.
      // Prefer Cloudflare CF-Connecting-IP, then x-forwarded-for first
      // entry (real client), then x-real-ip, then req.ip.
      const forwardedFor = req.headers['x-forwarded-for'];
      const firstForwardedIp = typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : Array.isArray(forwardedFor) ? forwardedFor[0] : undefined;

      const clientIp = (req.headers['cf-connecting-ip'] as string)
        || firstForwardedIp
        || (req.headers['x-real-ip'] as string)
        || req.ip 
        || 'unknown';
      const identifier = req.auth?.keyInfo?.key || clientIp;

      // Use tier-based hourly burst limits (matches the 1-hour sliding window)
      const limit = TIER_BURST_LIMITS[req.auth?.tier || 'free'] || 25;

      // Weighted cost based on route — heavier operations consume more credits
      let cost = 1;
      const path = req.path;
      if (path.includes('/crawl') || path.includes('/map')) cost = 5;
      else if (path.includes('/batch')) cost = 2;
      else if (path.includes('/screenshot')) cost = 2;
      else if (req.query.render === 'true' || (req.body as any)?.render === true) cost = 3;

      const result = limiter.checkLimit(identifier, limit, cost);

      // Calculate reset timestamp
      const now = Date.now();
      const resetTimestamp = Math.ceil((now + limiter['windowMs']) / 1000);

      // Set rate limit headers on ALL responses
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining).toString());
      res.setHeader('X-RateLimit-Reset', resetTimestamp.toString());

      // Add plan header if authenticated
      if (req.auth?.tier) {
        res.setHeader('X-WebPeel-Plan', req.auth.tier);
      }

      if (!result.allowed) {
        const retryAfterSecs = result.retryAfter!;
        res.setHeader('Retry-After', retryAfterSecs.toString());
        const tier = req.auth?.tier || 'free';
        const upgradeHint = tier === 'free'
          ? ' Upgrade to Pro ($9/mo) for 100/hr burst limit → https://webpeel.dev/#pricing'
          : tier === 'pro'
          ? ' Upgrade to Max ($29/mo) for 500/hr burst limit → https://webpeel.dev/#pricing'
          : '';
        res.status(429).json({
          success: false,
          error: {
            type: 'rate_limited',
            message: `Hourly rate limit exceeded (${limit} requests/hr on ${tier} plan). Try again in ${retryAfterSecs}s.`,
            hint: `Retry after ${retryAfterSecs} seconds.${upgradeHint}`,
            docs: 'https://webpeel.dev/docs/errors#rate-limited',
          },
          metadata: { requestId: req.requestId },
        });
        return; // Stop processing - rate limit exceeded
      }

      next();
    } catch (_error) {
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message: 'Rate limiting failed',
          docs: 'https://webpeel.dev/docs/errors#internal-error',
        },
        metadata: { requestId: req.requestId },
      });
    }
  };
}
