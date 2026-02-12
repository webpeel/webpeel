/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */
import { chromium } from 'playwright';
import { TimeoutError, BlockedError, NetworkError, WebPeelError } from '../types.js';
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
 * SECURITY: Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, link-local, and various bypass techniques
 */
function validateUrl(urlString) {
    // Length check
    if (urlString.length > 2048) {
        throw new WebPeelError('URL too long (max 2048 characters)');
    }
    // Check for control characters and suspicious encoding
    if (/[\x00-\x1F\x7F]/.test(urlString)) {
        throw new WebPeelError('URL contains invalid control characters');
    }
    let url;
    try {
        url = new URL(urlString);
    }
    catch {
        throw new WebPeelError('Invalid URL format');
    }
    // Only allow HTTP(S)
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new WebPeelError('Only HTTP and HTTPS protocols are allowed');
    }
    // Validate hostname is not empty
    if (!url.hostname) {
        throw new WebPeelError('Invalid hostname');
    }
    const hostname = url.hostname.toLowerCase();
    // Block localhost patterns
    const localhostPatterns = ['localhost', '0.0.0.0'];
    if (localhostPatterns.some(pattern => hostname === pattern || hostname.endsWith('.' + pattern))) {
        throw new WebPeelError('Access to localhost is not allowed');
    }
    // ENHANCED: Parse and validate IP addresses (handles hex, octal, decimal, mixed)
    const ipv4Info = parseAndValidateIPv4(hostname);
    if (ipv4Info) {
        validateIPv4Address(ipv4Info);
    }
    // ENHANCED: Comprehensive IPv6 validation
    if (hostname.includes(':')) {
        validateIPv6Address(hostname);
    }
}
/**
 * Parse IPv4 address in any format (dotted, hex, octal, decimal, mixed)
 * Returns null if not an IPv4 address
 */
function parseAndValidateIPv4(hostname) {
    // Remove brackets if present
    const cleaned = hostname.replace(/^\[|\]$/g, '');
    // Standard dotted notation: 192.168.1.1
    const dottedRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const dottedMatch = cleaned.match(dottedRegex);
    if (dottedMatch) {
        const octets = dottedMatch.slice(1).map(Number);
        if (octets.every(o => o >= 0 && o <= 255)) {
            return octets;
        }
        throw new WebPeelError('Invalid IPv4 address');
    }
    // Hex notation: 0x7f000001
    if (/^0x[0-9a-fA-F]+$/.test(cleaned)) {
        const num = parseInt(cleaned, 16);
        return [
            (num >>> 24) & 0xff,
            (num >>> 16) & 0xff,
            (num >>> 8) & 0xff,
            num & 0xff,
        ];
    }
    // Octal notation: 0177.0.0.1 or full octal 017700000001
    if (/^0[0-7]/.test(cleaned)) {
        // Full octal (all digits)
        if (/^0[0-7]+$/.test(cleaned)) {
            const num = parseInt(cleaned, 8);
            if (num <= 0xffffffff) {
                return [
                    (num >>> 24) & 0xff,
                    (num >>> 16) & 0xff,
                    (num >>> 8) & 0xff,
                    num & 0xff,
                ];
            }
        }
        // Mixed octal-decimal: 0177.0.0.1
        const parts = cleaned.split('.');
        if (parts.length === 4) {
            const octets = parts.map(p => parseInt(p, /^0[0-7]/.test(p) ? 8 : 10));
            if (octets.every(o => o >= 0 && o <= 255)) {
                return octets;
            }
        }
    }
    // Decimal notation: 2130706433
    if (/^\d+$/.test(cleaned)) {
        const num = parseInt(cleaned, 10);
        if (num <= 0xffffffff) {
            return [
                (num >>> 24) & 0xff,
                (num >>> 16) & 0xff,
                (num >>> 8) & 0xff,
                num & 0xff,
            ];
        }
    }
    return null;
}
/**
 * Validate IPv4 address against private/reserved ranges
 */
function validateIPv4Address(octets) {
    const [a, b, c, d] = octets;
    // Loopback: 127.0.0.0/8
    if (a === 127) {
        throw new WebPeelError('Access to loopback addresses is not allowed');
    }
    // Private: 10.0.0.0/8
    if (a === 10) {
        throw new WebPeelError('Access to private IP addresses is not allowed');
    }
    // Private: 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) {
        throw new WebPeelError('Access to private IP addresses is not allowed');
    }
    // Private: 192.168.0.0/16
    if (a === 192 && b === 168) {
        throw new WebPeelError('Access to private IP addresses is not allowed');
    }
    // Link-local: 169.254.0.0/16
    if (a === 169 && b === 254) {
        throw new WebPeelError('Access to link-local addresses is not allowed');
    }
    // Broadcast: 255.255.255.255
    if (a === 255 && b === 255 && c === 255 && d === 255) {
        throw new WebPeelError('Access to broadcast address is not allowed');
    }
    // This network: 0.0.0.0/8
    if (a === 0) {
        throw new WebPeelError('Access to "this network" addresses is not allowed');
    }
}
/**
 * Validate IPv6 address against private/reserved ranges
 */
function validateIPv6Address(hostname) {
    // Remove brackets
    const addr = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    // Loopback: ::1
    if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') {
        throw new WebPeelError('Access to loopback addresses is not allowed');
    }
    // IPv6 mapped IPv4: ::ffff:192.168.1.1 or ::ffff:c0a8:0101
    if (addr.startsWith('::ffff:')) {
        // Extract the IPv4 part
        const ipv4Part = addr.substring(7);
        // Could be dotted (::ffff:192.168.1.1) or hex (::ffff:c0a8:0101)
        if (ipv4Part.includes('.')) {
            // Parse dotted IPv4
            const parts = ipv4Part.split('.');
            if (parts.length === 4) {
                const octets = parts.map(p => parseInt(p, 10));
                if (octets.every(o => !isNaN(o) && o >= 0 && o <= 255)) {
                    validateIPv4Address(octets);
                }
            }
        }
        else {
            // Parse hex IPv4 (e.g., c0a80101 = 192.168.1.1)
            const hexStr = ipv4Part.replace(/:/g, '');
            if (/^[0-9a-f]{1,8}$/.test(hexStr)) {
                const num = parseInt(hexStr, 16);
                const octets = [
                    (num >>> 24) & 0xff,
                    (num >>> 16) & 0xff,
                    (num >>> 8) & 0xff,
                    num & 0xff,
                ];
                validateIPv4Address(octets);
            }
        }
        throw new WebPeelError('Access to IPv6-mapped IPv4 addresses is not allowed');
    }
    // Unique local addresses: fc00::/7 (fc00:: to fdff::)
    if (addr.startsWith('fc') || addr.startsWith('fd')) {
        throw new WebPeelError('Access to unique local IPv6 addresses is not allowed');
    }
    // Link-local: fe80::/10
    if (addr.startsWith('fe8') || addr.startsWith('fe9') ||
        addr.startsWith('fea') || addr.startsWith('feb')) {
        throw new WebPeelError('Access to link-local IPv6 addresses is not allowed');
    }
}
/**
 * Validate and sanitize user agent string
 */
function validateUserAgent(userAgent) {
    if (userAgent.length > 500) {
        throw new WebPeelError('User agent too long (max 500 characters)');
    }
    // Allow only printable ASCII characters
    if (!/^[\x20-\x7E]*$/.test(userAgent)) {
        throw new WebPeelError('User agent contains invalid characters');
    }
    return userAgent;
}
/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 * SECURITY: Manual redirect handling with SSRF re-validation
 */
export async function simpleFetch(url, userAgent, timeoutMs = 30000) {
    // SECURITY: Validate URL to prevent SSRF
    validateUrl(url);
    // Validate user agent if provided
    const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();
    const MAX_REDIRECTS = 10;
    let redirectCount = 0;
    let currentUrl = url;
    const seenUrls = new Set();
    while (redirectCount <= MAX_REDIRECTS) {
        // Detect redirect loops
        if (seenUrls.has(currentUrl)) {
            throw new WebPeelError('Redirect loop detected');
        }
        seenUrls.add(currentUrl);
        // Re-validate on each redirect
        validateUrl(currentUrl);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(currentUrl, {
                headers: {
                    'User-Agent': validatedUserAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                },
                signal: controller.signal,
                redirect: 'manual', // SECURITY: Manual redirect handling
            });
            clearTimeout(timer);
            // Handle redirects manually
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) {
                    throw new NetworkError('Redirect response missing Location header');
                }
                // Resolve relative URLs
                currentUrl = new URL(location, currentUrl).href;
                redirectCount++;
                continue;
            }
            if (!response.ok) {
                if (response.status === 403 || response.status === 503) {
                    throw new BlockedError(`HTTP ${response.status}: Site may be blocking requests. Try --render for browser mode.`);
                }
                throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
            }
            // SECURITY: Validate Content-Type
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
                throw new WebPeelError('Unsupported content type. Only HTML is supported.');
            }
            // SECURITY: Stream response with size limit (prevent memory exhaustion)
            const chunks = [];
            let totalSize = 0;
            const MAX_SIZE = 10 * 1024 * 1024; // 10MB
            const reader = response.body?.getReader();
            if (!reader) {
                throw new NetworkError('Response body is not readable');
            }
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    totalSize += value.length;
                    if (totalSize > MAX_SIZE) {
                        reader.cancel();
                        throw new WebPeelError('Response too large (max 10MB)');
                    }
                    chunks.push(value);
                }
            }
            finally {
                reader.releaseLock();
            }
            // Combine chunks
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }
            const html = new TextDecoder().decode(combined);
            if (!html || html.length < 100) {
                throw new BlockedError('Empty or suspiciously small response. Site may require JavaScript.');
            }
            // Check for Cloudflare challenge
            if (html.includes('cf-browser-verification') || html.includes('Just a moment...')) {
                throw new BlockedError('Cloudflare challenge detected. Try --render for browser mode.');
            }
            return {
                html,
                url: currentUrl,
                statusCode: response.status,
            };
        }
        catch (error) {
            clearTimeout(timer);
            if (error instanceof BlockedError || error instanceof NetworkError || error instanceof WebPeelError) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
            }
            throw new NetworkError(`Failed to fetch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    throw new WebPeelError(`Too many redirects (max ${MAX_REDIRECTS})`);
}
let sharedBrowser = null;
let activePagesCount = 0;
const MAX_CONCURRENT_PAGES = 5;
async function getBrowser() {
    // SECURITY: Check if browser is still connected and healthy
    if (sharedBrowser) {
        try {
            if (sharedBrowser.isConnected()) {
                return sharedBrowser;
            }
        }
        catch {
            // Browser is dead, recreate
            sharedBrowser = null;
        }
    }
    sharedBrowser = await chromium.launch({ headless: true });
    return sharedBrowser;
}
/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export async function browserFetch(url, options = {}) {
    // SECURITY: Validate URL to prevent SSRF
    validateUrl(url);
    const { userAgent, waitMs = 0, timeoutMs = 30000 } = options;
    // Validate user agent if provided
    const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();
    // Validate wait time
    if (waitMs < 0 || waitMs > 60000) {
        throw new WebPeelError('Wait time must be between 0 and 60000ms');
    }
    // SECURITY: Limit concurrent browser pages
    while (activePagesCount >= MAX_CONCURRENT_PAGES) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    activePagesCount++;
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage({
            userAgent: validatedUserAgent,
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
        // SECURITY: Wrap entire operation in timeout
        const fetchPromise = (async () => {
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
            return { html, finalUrl };
        })();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        const { html, finalUrl } = await Promise.race([fetchPromise, timeoutPromise]);
        // SECURITY: Limit HTML size
        if (html.length > 10 * 1024 * 1024) { // 10MB limit
            throw new WebPeelError('Response too large (max 10MB)');
        }
        if (!html || html.length < 100) {
            throw new BlockedError('Empty or suspiciously small response from browser.');
        }
        return {
            html,
            url: finalUrl,
        };
    }
    catch (error) {
        if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) {
            throw error;
        }
        if (error instanceof Error && error.message.includes('Timeout')) {
            throw new TimeoutError(`Browser navigation timed out`);
        }
        throw new NetworkError(`Browser fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    finally {
        // CRITICAL: Always close page and decrement counter
        if (page) {
            await page.close().catch(() => { });
        }
        activePagesCount--;
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