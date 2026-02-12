/**
 * Sliding window rate limiting middleware
 */
import { Request, Response, NextFunction } from 'express';
export declare class RateLimiter {
    private store;
    private windowMs;
    constructor(windowMs?: number);
    /**
     * Check if request is allowed under rate limit
     */
    checkLimit(identifier: string, limit: number): {
        allowed: boolean;
        remaining: number;
        retryAfter?: number;
    };
    /**
     * Clean up old entries (call periodically)
     */
    cleanup(): void;
}
export declare function createRateLimitMiddleware(limiter: RateLimiter): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=rate-limit.d.ts.map