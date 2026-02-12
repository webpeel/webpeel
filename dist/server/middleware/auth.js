/**
 * API key authentication middleware with SOFT LIMIT enforcement
 *
 * Philosophy: Never fully block users. When limits are exceeded,
 * degrade to HTTP-only mode instead of returning 429.
 * This applies to ALL tiers including free.
 */
import { PostgresAuthStore } from '../pg-auth-store.js';
export function createAuthMiddleware(authStore) {
    return async (req, res, next) => {
        try {
            // Extract API key from Authorization header or X-API-Key header
            const authHeader = req.headers.authorization;
            const apiKeyHeader = req.headers['x-api-key'];
            // SECURITY: Skip API key auth for public/JWT-protected endpoints
            // These routes either need no auth or use their own JWT middleware
            const isPublicEndpoint = req.path === '/health' ||
                req.path.startsWith('/v1/auth/') ||
                req.path === '/v1/webhooks/stripe' ||
                req.path === '/v1/me' ||
                req.path.startsWith('/v1/keys') ||
                req.path === '/v1/usage';
            if (isPublicEndpoint) {
                req.auth = { keyInfo: null, tier: 'free', rateLimit: 10, softLimited: false };
                return next();
            }
            let apiKey = null;
            if (authHeader?.startsWith('Bearer ')) {
                apiKey = authHeader.slice(7);
            }
            else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
                apiKey = apiKeyHeader;
            }
            if (!apiKey) {
                res.status(401).json({
                    error: 'missing_key',
                    message: 'API key is required. Provide via Authorization: Bearer <key> or X-API-Key header.',
                });
                return;
            }
            // Validate API key if provided
            let keyInfo = null;
            let softLimited = false;
            if (apiKey) {
                keyInfo = await authStore.validateKey(apiKey);
                if (!keyInfo) {
                    res.status(401).json({
                        error: 'invalid_key',
                        message: 'Invalid API key',
                    });
                    return;
                }
                // Check usage limits (only for PostgresAuthStore)
                if (authStore instanceof PostgresAuthStore) {
                    const { allowed, usage } = await authStore.checkLimit(apiKey);
                    // SOFT LIMITS: Don't block — degrade instead
                    // When over quota, set softLimited flag. The fetch route
                    // will force HTTP-only mode and still serve the request.
                    if (!allowed && usage) {
                        softLimited = true;
                        res.setHeader('X-Soft-Limited', 'true');
                        res.setHeader('X-Soft-Limit-Reason', 'Monthly quota exceeded. Requests degraded to HTTP-only mode.');
                        res.setHeader('X-Upgrade-URL', 'https://webpeel.dev/pricing');
                    }
                    // Add usage headers
                    if (usage) {
                        res.setHeader('X-Monthly-Limit', usage.totalAvailable.toString());
                        res.setHeader('X-Monthly-Used', usage.totalUsed.toString());
                        res.setHeader('X-Monthly-Remaining', Math.max(0, usage.remaining).toString());
                        // Warn if over 80% usage
                        const usagePercent = (usage.totalUsed / usage.totalAvailable) * 100;
                        if (usagePercent >= 80 && !softLimited) {
                            res.setHeader('X-Usage-Warning', `You've used ${usagePercent.toFixed(0)}% of your monthly quota. Consider upgrading at https://webpeel.dev/pricing`);
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
            };
            next();
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                error: 'auth_error',
                message: err.message || 'Authentication failed',
            });
        }
    };
}
//# sourceMappingURL=auth.js.map