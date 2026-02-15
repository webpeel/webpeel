/**
 * Optional Sentry integration for the API server.
 *
 * Enabled only when SENTRY_DSN is set.
 * This keeps local/self-hosted setups dependency-light by default.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
export interface SentryHooks {
    enabled: boolean;
    requestHandler?: RequestHandler;
    errorHandler?: ErrorRequestHandler;
}
export declare function createSentryHooks(): SentryHooks;
//# sourceMappingURL=sentry.d.ts.map