/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */
import { simpleFetch, browserFetch, retryFetch } from './fetcher.js';
import { BlockedError, NetworkError } from '../types.js';
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
export async function smartFetch(url, options = {}) {
    const { forceBrowser = false, waitMs = 0, userAgent, timeoutMs = 30000 } = options;
    // Strategy 1: Simple fetch (unless browser is forced)
    if (!forceBrowser) {
        try {
            const result = await retryFetch(() => simpleFetch(url, userAgent, timeoutMs), 3);
            return {
                ...result,
                method: 'simple',
            };
        }
        catch (error) {
            // If blocked or needs JS, escalate to browser
            if (error instanceof BlockedError) {
                // Fall through to browser strategy
            }
            else {
                // Re-throw other errors (timeout, network errors)
                throw error;
            }
        }
    }
    // Strategy 2: Browser fetch
    try {
        const result = await browserFetch(url, {
            userAgent,
            waitMs,
            timeoutMs,
        });
        return {
            ...result,
            method: 'browser',
        };
    }
    catch (error) {
        // If browser encounters Cloudflare, retry with extra wait time
        if (error instanceof NetworkError &&
            error.message.toLowerCase().includes('cloudflare')) {
            const result = await browserFetch(url, {
                userAgent,
                waitMs: 5000, // Wait 5s for Cloudflare challenge
                timeoutMs,
            });
            return {
                ...result,
                method: 'browser',
            };
        }
        throw error;
    }
}
//# sourceMappingURL=strategies.js.map