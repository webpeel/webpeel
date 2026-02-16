/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */
import { simpleFetch, browserFetch, retryFetch } from './fetcher.js';
import { BlockedError, NetworkError } from '../types.js';
function shouldForceBrowser(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        // Reddit often returns an HTML shell via simple fetch; browser rendering is needed for real content
        if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
            return { mode: 'browser' };
        }
        // These are known to aggressively block automation; go straight to stealth
        if (hostname === 'glassdoor.com' || hostname.endsWith('.glassdoor.com')) {
            return { mode: 'stealth' };
        }
        if (hostname === 'bloomberg.com' || hostname.endsWith('.bloomberg.com')) {
            return { mode: 'stealth' };
        }
    }
    catch {
        // Ignore URL parsing errors here; validation happens inside fetchers
    }
    return null;
}
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
    // Site-specific escalation overrides
    const forced = shouldForceBrowser(url);
    let effectiveForceBrowser = forceBrowser;
    let effectiveStealth = stealth;
    if (forced) {
        effectiveForceBrowser = true;
        if (forced.mode === 'stealth') {
            effectiveStealth = true;
        }
    }
    // If stealth is requested, force browser mode (stealth requires browser)
    let shouldUseBrowser = effectiveForceBrowser || screenshot || effectiveStealth;
    // Strategy 1: Simple fetch (unless browser is forced or screenshot is requested)
    if (!shouldUseBrowser) {
        try {
            const result = await retryFetch(() => simpleFetch(url, userAgent, timeoutMs, headers), 3);
            // Check if content is suspiciously thin (might be a JS shell page)
            const contentTypeLower = (result.contentType || '').toLowerCase();
            if (contentTypeLower.includes('html')) {
                const textContent = result.html.replace(/<[^>]*>/g, '').trim();
                if (textContent.length < 500 && result.html.length > 1000) {
                    // Shell page detected — HTML is large but text content is minimal
                    // Escalate to browser rendering
                    shouldUseBrowser = true;
                }
            }
            if (!shouldUseBrowser) {
                return {
                    ...result,
                    method: 'simple',
                };
            }
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
            stealth: effectiveStealth,
            actions,
            keepPageOpen,
        });
        return {
            ...result,
            method: effectiveStealth ? 'stealth' : 'browser',
        };
    }
    catch (error) {
        // Strategy 3: If browser gets blocked, try stealth mode as fallback (unless already using stealth)
        if (!effectiveStealth && error instanceof BlockedError) {
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
                stealth: effectiveStealth, // Keep stealth setting
                actions,
                keepPageOpen,
            });
            return {
                ...result,
                method: effectiveStealth ? 'stealth' : 'browser',
            };
        }
        throw error;
    }
}
//# sourceMappingURL=strategies.js.map