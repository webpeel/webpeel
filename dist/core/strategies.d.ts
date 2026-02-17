/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */
import { type FetchResult } from './fetcher.js';
export declare function clearDomainIntel(): void;
export interface StrategyOptions {
    /** Force browser mode (skip simple fetch) */
    forceBrowser?: boolean;
    /** Use stealth mode to bypass bot detection */
    stealth?: boolean;
    /** Wait time after page load in browser mode (ms) */
    waitMs?: number;
    /** Custom user agent */
    userAgent?: string;
    /** Request timeout (ms) */
    timeoutMs?: number;
    /** Capture a screenshot of the page */
    screenshot?: boolean;
    /** Full-page screenshot (default: viewport only) */
    screenshotFullPage?: boolean;
    /** Custom HTTP headers to send */
    headers?: Record<string, string>;
    /** Cookies to set (key=value pairs) */
    cookies?: string[];
    /** Page actions to execute before extraction */
    actions?: Array<{
        type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
        selector?: string;
        value?: string;
        key?: string;
        ms?: number;
        to?: 'top' | 'bottom' | number;
        timeout?: number;
    }>;
    /** Keep browser page open for reuse (caller must close) */
    keepPageOpen?: boolean;
    /** Disable response cache for this request */
    noCache?: boolean;
    /** Time to wait before launching browser in parallel with simple fetch */
    raceTimeoutMs?: number;
    /** Location/language for geo-targeted scraping */
    location?: {
        country?: string;
        languages?: string[];
    };
}
export interface StrategyResult extends FetchResult {
    /** Which strategy succeeded: 'simple' | 'browser' | 'stealth' | 'cached' */
    method: 'simple' | 'browser' | 'stealth' | 'cached';
}
/**
 * Smart fetch with automatic escalation
 */
export declare function smartFetch(url: string, options?: StrategyOptions): Promise<StrategyResult>;
//# sourceMappingURL=strategies.d.ts.map