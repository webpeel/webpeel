/**
 * Optional Sentry integration for the API server.
 *
 * Enabled only when SENTRY_DSN is set.
 * This keeps local/self-hosted setups dependency-light by default.
 */
import * as Sentry from '@sentry/node';
function parseSampleRate(value) {
    if (!value)
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        console.warn(`Ignoring invalid SENTRY_TRACES_SAMPLE_RATE="${value}" (expected 0.0 - 1.0)`);
        return undefined;
    }
    return parsed;
}
export function createSentryHooks() {
    const dsn = process.env.SENTRY_DSN?.trim();
    if (!dsn) {
        return { enabled: false };
    }
    const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
    const tracesSampleRate = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE);
    Sentry.init({
        dsn,
        enabled: true,
        environment,
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate,
    });
    console.log(`Sentry enabled (environment: ${environment})`);
    return {
        enabled: true,
        requestHandler: Sentry.Handlers.requestHandler(),
        errorHandler: Sentry.Handlers.errorHandler(),
    };
}
//# sourceMappingURL=sentry.js.map