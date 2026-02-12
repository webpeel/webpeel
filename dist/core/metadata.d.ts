/**
 * Extract structured metadata from HTML
 */
import type { PageMetadata } from '../types.js';
/**
 * Extract all links from page
 * Returns absolute URLs, deduplicated
 */
export declare function extractLinks(html: string, baseUrl: string): string[];
/**
 * Extract all metadata from HTML
 */
export declare function extractMetadata(html: string, _url: string): {
    title: string;
    metadata: PageMetadata;
};
//# sourceMappingURL=metadata.d.ts.map