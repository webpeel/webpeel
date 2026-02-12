/**
 * Search endpoint with caching
 */
import { Router } from 'express';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
export function createSearchRouter(authStore) {
    const router = Router();
    // LRU cache: 15 minute TTL, max 500 entries
    const cache = new LRUCache({
        max: 500,
        ttl: 15 * 60 * 1000, // 15 minutes
    });
    router.get('/v1/search', async (req, res) => {
        try {
            const { q, count } = req.query;
            // Validate query parameter
            if (!q || typeof q !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "q" parameter',
                });
                return;
            }
            // Parse and validate count
            const resultCount = count ? parseInt(count, 10) : 5;
            if (isNaN(resultCount) || resultCount < 1 || resultCount > 10) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Invalid "count" parameter: must be between 1 and 10',
                });
                return;
            }
            // Build cache key
            const cacheKey = `search:${q}:${resultCount}`;
            // Check cache
            const cached = cache.get(cacheKey);
            if (cached) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());
                res.json({
                    query: q,
                    count: cached.results.length,
                    results: cached.results,
                });
                return;
            }
            // Perform search
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const startTime = Date.now();
            const response = await undiciFetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
            });
            if (!response.ok) {
                throw new Error(`Search failed: HTTP ${response.status}`);
            }
            const html = await response.text();
            const $ = load(html);
            const results = [];
            $('.result').each((i, elem) => {
                if (results.length >= resultCount)
                    return false;
                const $result = $(elem);
                const title = $result.find('.result__title').text().trim();
                const url = $result.find('.result__url').attr('href') || '';
                const snippet = $result.find('.result__snippet').text().trim();
                if (title && url) {
                    results.push({ title, url, snippet });
                }
            });
            const elapsed = Date.now() - startTime;
            // Track usage (1 credit per search)
            if (req.auth?.keyInfo?.key) {
                await authStore.trackUsage(req.auth.keyInfo.key, 1);
            }
            // Cache results
            cache.set(cacheKey, {
                results,
                timestamp: Date.now(),
            });
            // Add headers
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('X-Credits-Used', '1');
            res.setHeader('X-Processing-Time', elapsed.toString());
            res.json({
                query: q,
                count: results.length,
                results,
            });
        }
        catch (error) {
            const err = error;
            res.status(500).json({
                error: 'search_failed',
                message: err.message || 'Search request failed',
            });
        }
    });
    return router;
}
//# sourceMappingURL=search.js.map