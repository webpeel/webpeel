/**
 * WebPeel API Server
 * Express-based REST API for hosted deployments
 */
import { Express } from 'express';
export interface ServerConfig {
    port?: number;
    corsOrigins?: string[];
    rateLimitWindowMs?: number;
}
export declare function createApp(config?: ServerConfig): Express;
export declare function startServer(config?: ServerConfig): void;
//# sourceMappingURL=app.d.ts.map