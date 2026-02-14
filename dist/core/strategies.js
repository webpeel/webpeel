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
 * 3. If browser gets blocked (403, CAPTCHA) → try stealth mode
 * 4. If stealth mode is explicitly requested → skip to stealth
 *
 * Returns the result along with which method worked
 */
export async function smartFetch(url, options = {}) {
    const { forceBrowser = false, stealth = false, waitMs = 0, userAgent, timeoutMs = 30000, screenshot = false, screenshotFullPage = false, headers, cookies, actions, keepPageOpen = false, } = options;
    // If stealth is requested, force browser mode (stealth requires browser)
    const shouldUseBrowser = forceBrowser || screenshot || stealth;
    // Strategy 1: Simple fetch (unless browser is forced or screenshot is requested)
    if (!shouldUseBrowser) {
        try {
            const result = await retryFetch(() => simpleFetch(url, userAgent, timeoutMs, headers), 3);
            return {
                ...result,
                method: 'simple',
            };
        }
        catch (error) {
            // If blocked, needs JS, or has TLS issues, escalate to browser
            if (error instanceof BlockedError) {
                // Fall through to browser strategy
            }
            else if (error instanceof NetworkError && error.message.includes('TLS/SSL')) {
                // TLS errors may work with browser (different cert handling)
                // Fall through to browser strategy
            }
            else {
                // Re-throw other errors (timeout, DNS, connection refused)
                throw error;
            }
        }
    }
    // Strategy 2: Browser fetch (with or without stealth)
    try {
        const result = await browserFetch(url, {
            userAgent,
            waitMs,
            timeoutMs,
            screenshot,
            screenshotFullPage,
            headers,
            cookies,
            stealth,
            actions,
            keepPageOpen,
        });
        return {
            ...result,
            method: stealth ? 'stealth' : 'browser',
        };
    }
    catch (error) {
        // Strategy 3: If browser gets blocked, try stealth mode as fallback (unless already using stealth)
        if (!stealth && error instanceof BlockedError) {
            try {
                const result = await browserFetch(url, {
                    userAgent,
                    waitMs,
                    timeoutMs,
                    screenshot,
                    screenshotFullPage,
                    headers,
                    cookies,
                    stealth: true, // Escalate to stealth mode
                    actions,
                    keepPageOpen,
                });
                return {
                    ...result,
                    method: 'stealth',
                };
            }
            catch (stealthError) {
                // If stealth also fails, throw the original error
                throw stealthError;
            }
        }
        // If browser encounters Cloudflare, retry with extra wait time
        if (error instanceof NetworkError &&
            error.message.toLowerCase().includes('cloudflare')) {
            const result = await browserFetch(url, {
                userAgent,
                waitMs: 5000, // Wait 5s for Cloudflare challenge
                timeoutMs,
                screenshot,
                screenshotFullPage,
                headers,
                cookies,
                stealth, // Keep stealth setting
                actions,
                keepPageOpen,
            });
            return {
                ...result,
                method: stealth ? 'stealth' : 'browser',
            };
        }
        throw error;
    }
}
//# sourceMappingURL=strategies.js.map