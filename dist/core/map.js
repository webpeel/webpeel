/**
 * Domain URL mapping
 * Combines sitemap discovery with link crawling to discover all URLs on a domain
 */
import { discoverSitemap } from './sitemap.js';
import { peel } from '../index.js';
export async function mapDomain(startUrl, options = {}) {
    const startTime = Date.now();
    const { useSitemap = true, crawlHomepage = true, maxUrls = 5000, timeout = 10000, includePatterns = [], excludePatterns = [], search, contentTypeFilter = [], } = options;
    const urlObj = new URL(startUrl);
    const domain = urlObj.hostname;
    const allUrls = new Map(); // URL -> relevance score
    let sitemapUrls = [];
    // Compile filter patterns
    const includeRegexes = includePatterns.map(p => new RegExp(p));
    const excludeRegexes = excludePatterns.map(p => new RegExp(p));
    // Parse search terms
    const searchTerms = search ? search.toLowerCase().split(/\s+/).filter(t => t.length > 0) : [];
    /**
     * Calculate relevance score for a URL based on search terms
     * Scores based on matches in URL path and title/description if available
     */
    function calculateRelevance(url, title, description) {
        if (searchTerms.length === 0)
            return 1; // No search = all equal
        let score = 0;
        const urlLower = url.toLowerCase();
        const titleLower = (title || '').toLowerCase();
        const descLower = (description || '').toLowerCase();
        for (const term of searchTerms) {
            // URL path matches (highest weight)
            if (urlLower.includes(term))
                score += 3;
            // Title matches
            if (titleLower.includes(term))
                score += 2;
            // Description matches
            if (descLower.includes(term))
                score += 1;
        }
        return score;
    }
    /**
     * Check if URL should be included based on patterns and content type
     */
    function shouldInclude(url) {
        if (excludeRegexes.some(r => r.test(url)))
            return false;
        if (includeRegexes.length > 0 && !includeRegexes.some(r => r.test(url)))
            return false;
        // Content type filter (check file extension)
        if (contentTypeFilter.length > 0) {
            const ext = url.split('.').pop()?.toLowerCase() || '';
            const hasMatch = contentTypeFilter.some(type => {
                const typeExt = type.replace(/^\./, '').toLowerCase();
                return ext === typeExt || url.toLowerCase().includes(`.${typeExt}`);
            });
            if (!hasMatch)
                return false;
        }
        return true;
    }
    // Step 1: Sitemap discovery
    if (useSitemap) {
        const sitemap = await discoverSitemap(domain, { timeout, maxUrls });
        sitemapUrls = sitemap.sitemapUrls;
        for (const entry of sitemap.urls) {
            if (allUrls.size >= maxUrls)
                break;
            if (shouldInclude(entry.url)) {
                // Sitemap entries don't have title/description, just score by URL
                const score = calculateRelevance(entry.url);
                allUrls.set(entry.url, score);
            }
        }
    }
    // Step 2: Crawl homepage for additional links
    if (crawlHomepage && allUrls.size < maxUrls) {
        try {
            const result = await peel(startUrl, { timeout });
            for (const link of result.links) {
                if (allUrls.size >= maxUrls)
                    break;
                try {
                    const linkUrl = new URL(link);
                    if (linkUrl.hostname === domain && shouldInclude(link)) {
                        const score = calculateRelevance(link);
                        if (!allUrls.has(link)) {
                            allUrls.set(link, score);
                        }
                    }
                }
                catch { /* skip invalid URLs */ }
            }
        }
        catch { /* skip homepage crawl errors */ }
    }
    // Sort URLs by relevance score (highest first), then alphabetically
    const sortedUrls = Array.from(allUrls.entries())
        .sort((a, b) => {
        if (search) {
            // Sort by score first if searching
            if (b[1] !== a[1])
                return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
    })
        .map(([url]) => url);
    return {
        urls: sortedUrls,
        sitemapUrls,
        total: allUrls.size,
        elapsed: Date.now() - startTime,
    };
}
//# sourceMappingURL=map.js.map