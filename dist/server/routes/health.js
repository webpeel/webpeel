/**
 * Health check endpoint
 * NOTE: This route is mounted BEFORE auth/rate-limit middleware in app.ts
 * so it's never blocked by rate limiting (Render hits it every ~30s).
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const startTime = Date.now();
// Read version from package.json at startup
let version = '0.0.0';
try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Walk up from dist/server/routes/ to project root
    const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    version = pkg.version;
}
catch {
    // Fallback if package.json can't be read
}
export function createHealthRouter() {
    const router = Router();
    router.get('/health', (_req, res) => {
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        res.json({
            status: 'healthy',
            version,
            uptime,
            timestamp: new Date().toISOString(),
        });
    });
    return router;
}
//# sourceMappingURL=health.js.map