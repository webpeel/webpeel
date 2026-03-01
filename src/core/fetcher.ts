/**
 * Core fetching — thin re-export layer for backward compatibility.
 *
 * The implementation has been split into focused modules:
 *   - http-fetch.ts  — Pure HTTP fetching (simpleFetch, SSRF validation, HTTP pool)
 *   - browser-pool.ts — Browser lifecycle & page pool (getBrowser, cleanup, warmup)
 *   - browser-fetch.ts — Browser-based fetching (browserFetch, browserScreenshot)
 */

// Re-export everything for backward compatibility
export { simpleFetch, type FetchResult } from './http-fetch.js';
export { cleanup, warmup, closePool, closeProfileBrowser, playwrightLoaded } from './browser-pool.js';
export { browserFetch, browserScreenshot, browserFilmstrip, browserAudit, browserAnimationCapture, browserViewports, browserDesignAudit, retryFetch, scrollAndWait } from './browser-fetch.js';
export type { DesignAuditResult } from './browser-fetch.js';
