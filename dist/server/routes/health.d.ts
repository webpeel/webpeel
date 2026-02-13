/**
 * Health check endpoint
 * NOTE: This route is mounted BEFORE auth/rate-limit middleware in app.ts
 * so it's never blocked by rate limiting (Render hits it every ~30s).
 */
import { Router } from 'express';
export declare function createHealthRouter(): Router;
//# sourceMappingURL=health.d.ts.map