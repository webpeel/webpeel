/**
 * WebPeel - Fast web fetcher for AI agents
 *
 * Main library export
 */
import { smartFetch } from './core/strategies.js';
import { htmlToMarkdown, htmlToText, estimateTokens } from './core/markdown.js';
import { extractMetadata, extractLinks } from './core/metadata.js';
import { cleanup } from './core/fetcher.js';
export * from './types.js';
/**
 * Fetch and extract content from a URL
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Extracted content and metadata
 *
 * @example
 * ```typescript
 * import { peel } from 'webpeel';
 *
 * const result = await peel('https://example.com');
 * console.log(result.content); // Markdown content
 * console.log(result.metadata); // Structured metadata
 * ```
 */
export async function peel(url, options = {}) {
    const startTime = Date.now();
    const { render = false, wait = 0, format = 'markdown', timeout = 30000, userAgent, } = options;
    try {
        // Fetch the page
        const fetchResult = await smartFetch(url, {
            forceBrowser: render,
            waitMs: wait,
            userAgent,
            timeoutMs: timeout,
        });
        // Extract metadata and title
        const { title, metadata } = extractMetadata(fetchResult.html, fetchResult.url);
        // Extract links
        const links = extractLinks(fetchResult.html, fetchResult.url);
        // Convert content to requested format
        let content;
        switch (format) {
            case 'html':
                content = fetchResult.html;
                break;
            case 'text':
                content = htmlToText(fetchResult.html);
                break;
            case 'markdown':
            default:
                content = htmlToMarkdown(fetchResult.html);
                break;
        }
        // Calculate elapsed time and token estimate
        const elapsed = Date.now() - startTime;
        const tokens = estimateTokens(content);
        return {
            url: fetchResult.url,
            title,
            content,
            metadata,
            links,
            tokens,
            method: fetchResult.method,
            elapsed,
        };
    }
    catch (error) {
        // Clean up browser resources on error
        await cleanup();
        throw error;
    }
}
/**
 * Clean up any browser resources
 * Call this when you're done using WebPeel
 */
export { cleanup };
//# sourceMappingURL=index.js.map