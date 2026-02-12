/**
 * Health check endpoint
 */
import { Router } from 'express';
const startTime = Date.now();
export function createHealthRouter() {
    const router = Router();
    router.get('/health', (req, res) => {
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        res.json({
            status: 'healthy',
            version: process.env.npm_package_version || '1.0.0',
            uptime,
            timestamp: new Date().toISOString(),
        });
    });
    return router;
}
//# sourceMappingURL=health.js.map