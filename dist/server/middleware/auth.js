/**
 * API key authentication middleware
 */
export function createAuthMiddleware(authStore) {
    return async (req, res, next) => {
        try {
            // Extract API key from Authorization header or X-API-Key header
            const authHeader = req.headers.authorization;
            const apiKeyHeader = req.headers['x-api-key'];
            let apiKey = null;
            if (authHeader?.startsWith('Bearer ')) {
                apiKey = authHeader.slice(7);
            }
            else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
                apiKey = apiKeyHeader;
            }
            // SECURITY: Require API key for all non-health endpoints
            const isHealthEndpoint = req.path === '/health';
            if (!apiKey && !isHealthEndpoint) {
                res.status(401).json({
                    error: 'missing_key',
                    message: 'API key is required. Provide via Authorization: Bearer <key> or X-API-Key header.',
                });
                return;
            }
            // Validate API key if provided
            let keyInfo = null;
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
                rateLimit: keyInfo?.rateLimit || 10,
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