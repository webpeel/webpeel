/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */
import { chromium } from 'playwright';
import { TimeoutError, BlockedError, NetworkError } from '../types.js';
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 */
export async function simpleFetch(url, userAgent, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': userAgent || getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!response.ok) {
            if (response.status === 403 || response.status === 503) {
                throw new BlockedError(`HTTP ${response.status}: Site may be blocking requests. Try --render for browser mode.`);
            }
            throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
        }
        const html = await response.text();
        if (!html || html.length < 100) {
            throw new BlockedError('Empty or suspiciously small response. Site may require JavaScript.');
        }
        // Check for Cloudflare challenge
        if (html.includes('cf-browser-verification') || html.includes('Just a moment...')) {
            throw new BlockedError('Cloudflare challenge detected. Try --render for browser mode.');
        }
        return {
            html,
            url: response.url,
            statusCode: response.status,
        };
    }
    catch (error) {
        clearTimeout(timer);
        if (error instanceof BlockedError || error instanceof NetworkError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
        }
        throw new NetworkError(`Failed to fetch ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
let sharedBrowser = null;
async function getBrowser() {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }
    sharedBrowser = await chromium.launch({ headless: true });
    return sharedBrowser;
}
/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export async function browserFetch(url, options = {}) {
    const { userAgent, waitMs = 0, timeoutMs = 30000 } = options;
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage({
            userAgent: userAgent || getRandomUserAgent(),
        });
        // Block images, fonts, and other heavy resources for speed
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                route.abort();
            }
            else {
                route.continue();
            }
        });
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: timeoutMs,
        });
        // Wait for additional time if requested (for dynamic content)
        if (waitMs > 0) {
            await page.waitForTimeout(waitMs);
        }
        const html = await page.content();
        const finalUrl = page.url();
        await page.close();
        if (!html || html.length < 100) {
            throw new BlockedError('Empty or suspiciously small response from browser.');
        }
        return {
            html,
            url: finalUrl,
        };
    }
    catch (error) {
        if (page) {
            await page.close().catch(() => { });
        }
        if (error instanceof BlockedError) {
            throw error;
        }
        if (error instanceof Error && error.message.includes('Timeout')) {
            throw new TimeoutError(`Browser navigation timed out after ${timeoutMs}ms`);
        }
        throw new NetworkError(`Browser fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Retry a fetch operation with exponential backoff
 */
export async function retryFetch(fn, maxAttempts = 3, baseDelayMs = 1000) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error');
            // Don't retry on blocked errors or timeouts
            if (error instanceof BlockedError || error instanceof TimeoutError) {
                throw error;
            }
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError || new NetworkError('Retry failed');
}
/**
 * Clean up browser resources
 */
export async function cleanup() {
    if (sharedBrowser) {
        await sharedBrowser.close();
        sharedBrowser = null;
    }
}
//# sourceMappingURL=fetcher.js.map