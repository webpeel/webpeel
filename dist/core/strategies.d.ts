/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */
import { type FetchResult } from './fetcher.js';
export interface StrategyOptions {
    /** Force browser mode (skip simple fetch) */
    forceBrowser?: boolean;
    /** Wait time after page load in browser mode (ms) */
    waitMs?: number;
    /** Custom user agent */
    userAgent?: string;
    /** Request timeout (ms) */
    timeoutMs?: number;
}
export interface StrategyResult extends FetchResult {
    /** Which strategy succeeded: 'simple' | 'browser' */
    method: 'simple' | 'browser';
}
/**
 * Smart fetch with automatic escalation
 *
 * Strategy:
 * 1. Try simple HTTP fetch first (fast, ~200ms)
 * 2. If blocked (403, 503, Cloudflare, empty body) → try browser
 * 3. If browser encounters Cloudflare challenge → wait 5s and retry
 *
 * Returns the result along with which method worked
 */
export declare function smartFetch(url: string, options?: StrategyOptions): Promise<StrategyResult>;
//# sourceMappingURL=strategies.d.ts.map