/**
 * Sliding window rate limiting middleware
 */

import { Request, Response, NextFunction } from 'express';

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
   */
  checkLimit(identifier: string, limit: number): {
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

    // Check if limit exceeded
    if (entry.timestamps.length >= limit) {
      const oldestTimestamp = entry.timestamps[0];
      const retryAfter = Math.ceil((oldestTimestamp + this.windowMs - now) / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        retryAfter,
      };
    }

    // Add current timestamp
    entry.timestamps.push(now);

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

export function createRateLimitMiddleware(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Use API key or real client IP as identifier
      // Cloudflare sets CF-Connecting-IP to the real client IP;
      // req.ip can vary per Cloudflare edge node causing rate limit bypass
      const clientIp = (req.headers['cf-connecting-ip'] as string) 
        || (req.headers['x-real-ip'] as string)
        || req.ip 
        || 'unknown';
      const identifier = req.auth?.keyInfo?.key || clientIp;
      const limit = req.auth?.rateLimit || 10;

      const result = limiter.checkLimit(identifier, limit);

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
        res.setHeader('Retry-After', result.retryAfter!.toString());
        res.status(429).json({
          error: 'rate_limited',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
        });
        return; // Stop processing - rate limit exceeded
      }

      next();
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        error: 'rate_limit_error',
        message: err.message || 'Rate limiting failed',
      });
    }
  };
}
