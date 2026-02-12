/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */
export interface FetchResult {
    html: string;
    url: string;
    statusCode?: number;
}
/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 */
export declare function simpleFetch(url: string, userAgent?: string, timeoutMs?: number): Promise<FetchResult>;
/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export declare function browserFetch(url: string, options?: {
    userAgent?: string;
    waitMs?: number;
    timeoutMs?: number;
}): Promise<FetchResult>;
/**
 * Retry a fetch operation with exponential backoff
 */
export declare function retryFetch<T>(fn: () => Promise<T>, maxAttempts?: number, baseDelayMs?: number): Promise<T>;
/**
 * Clean up browser resources
 */
export declare function cleanup(): Promise<void>;
//# sourceMappingURL=fetcher.d.ts.map