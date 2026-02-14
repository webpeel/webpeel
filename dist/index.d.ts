/**
 * WebPeel - Fast web fetcher for AI agents
 *
 * Main library export
 */
import { cleanup } from './core/fetcher.js';
import type { PeelOptions, PeelResult } from './types.js';
export * from './types.js';
export { crawl, type CrawlOptions, type CrawlResult, type CrawlProgress } from './core/crawler.js';
export { discoverSitemap, type SitemapUrl, type SitemapResult } from './core/sitemap.js';
export { mapDomain, type MapOptions, type MapResult } from './core/map.js';
export { extractBranding, type BrandingProfile } from './core/branding.js';
export { trackChange, getSnapshot, clearSnapshots, type ChangeResult, type Snapshot } from './core/change-tracking.js';
export { extractWithLLM } from './core/extract.js';
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
export declare function peel(url: string, options?: PeelOptions): Promise<PeelResult>;
/**
 * Fetch multiple URLs in batch with concurrency control
 *
 * @param urls - Array of URLs to fetch
 * @param options - Fetch options (including concurrency)
 * @returns Array of results or errors
 *
 * @example
 * ```typescript
 * import { peelBatch } from 'webpeel';
 *
 * const urls = ['https://example.com', 'https://example.org'];
 * const results = await peelBatch(urls, { concurrency: 3 });
 * ```
 */
export declare function peelBatch(urls: string[], options?: PeelOptions & {
    concurrency?: number;
}): Promise<(PeelResult | {
    url: string;
    error: string;
})[]>;
/**
 * Clean up any browser resources
 * Call this when you're done using WebPeel
 */
export { cleanup };
//# sourceMappingURL=index.d.ts.map