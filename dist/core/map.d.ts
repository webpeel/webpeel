/**
 * Domain URL mapping
 * Combines sitemap discovery with link crawling to discover all URLs on a domain
 */
export interface MapOptions {
    /** Include sitemap URLs (default: true) */
    useSitemap?: boolean;
    /** Crawl the homepage for additional links (default: true) */
    crawlHomepage?: boolean;
    /** Maximum URLs to discover (default: 5000) */
    maxUrls?: number;
    /** Timeout per request in ms (default: 10000) */
    timeout?: number;
    /** Include URL patterns matching these regexes only */
    includePatterns?: string[];
    /** Exclude URL patterns matching these regexes */
    excludePatterns?: string[];
    /** Filter URLs by relevance to this search query */
    search?: string;
    /** Only return URLs matching these content types */
    contentTypeFilter?: string[];
}
export interface MapResult {
    /** All discovered URLs (deduplicated) */
    urls: string[];
    /** Sitemap URLs used */
    sitemapUrls: string[];
    /** Total URLs discovered */
    total: number;
    /** Time elapsed in ms */
    elapsed: number;
}
export declare function mapDomain(startUrl: string, options?: MapOptions): Promise<MapResult>;
//# sourceMappingURL=map.d.ts.map