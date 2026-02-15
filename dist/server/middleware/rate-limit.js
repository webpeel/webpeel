/**
 * Sliding window rate limiting middleware
 */
export class RateLimiter {
    store = new Map();
    windowMs;
    constructor(windowMs = 60000) {
        this.windowMs = windowMs;
    }
    /**
     * Check if request is allowed under rate limit
     */
    checkLimit(identifier, limit) {
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
    cleanup() {
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
const TIER_BURST_LIMITS = {
    free: 25,
    starter: 50,
    pro: 100,
    enterprise: 250,
    max: 500,
};
export function createRateLimitMiddleware(limiter) {
    return (req, res, next) => {
        try {
            // Use API key or real client IP as identifier.
            // Prefer Cloudflare CF-Connecting-IP, then x-forwarded-for first
            // entry (real client), then x-real-ip, then req.ip.
            const forwardedFor = req.headers['x-forwarded-for'];
            const firstForwardedIp = typeof forwardedFor === 'string'
                ? forwardedFor.split(',')[0].trim()
                : Array.isArray(forwardedFor) ? forwardedFor[0] : undefined;
            const clientIp = req.headers['cf-connecting-ip']
                || firstForwardedIp
                || req.headers['x-real-ip']
                || req.ip
                || 'unknown';
            const identifier = req.auth?.keyInfo?.key || clientIp;
            // Use tier-based hourly burst limits (matches the 1-hour sliding window)
            const limit = TIER_BURST_LIMITS[req.auth?.tier || 'free'] || 25;
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
                res.setHeader('Retry-After', result.retryAfter.toString());
                res.status(429).json({
                    error: 'rate_limited',
                    message: 'Rate limit exceeded',
                    retryAfter: result.retryAfter,
                });
                return; // Stop processing - rate limit exceeded
            }
            next();
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                error: 'rate_limit_error',
                message: err.message || 'Rate limiting failed',
            });
        }
    };
}
//# sourceMappingURL=rate-limit.js.map