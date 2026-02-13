/**
 * Search endpoint with caching
 */
import { Router } from 'express';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
export function createSearchRouter(authStore) {
    const router = Router();
    // LRU cache: 15 minute TTL, max 500 entries, 50MB total size
    const cache = new LRUCache({
        max: 500,
        ttl: 15 * 60 * 1000, // 15 minutes
        maxSize: 50 * 1024 * 1024, // 50MB
        sizeCalculation: (entry) => {
            return JSON.stringify(entry).length;
        },
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
            $('.result').each((_i, elem) => {
                if (results.length >= resultCount)
                    return;
                const $result = $(elem);
                let title = $result.find('.result__title').text().trim();
                const rawUrl = $result.find('.result__a').attr('href') || '';
                let snippet = $result.find('.result__snippet').text().trim();
                if (!title || !rawUrl)
                    return;
                // Extract actual URL from DuckDuckGo redirect
                let url = rawUrl;
                try {
                    const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
                    const uddg = ddgUrl.searchParams.get('uddg');
                    if (uddg) {
                        url = decodeURIComponent(uddg);
                    }
                }
                catch {
                    // Use raw URL if parsing fails
                }
                // SECURITY: Validate and sanitize results — only allow HTTP/HTTPS URLs
                try {
                    const parsed = new URL(url);
                    if (!['http:', 'https:'].includes(parsed.protocol)) {
                        return;
                    }
                    url = parsed.href;
                }
                catch {
                    return;
                }
                // Limit text lengths to prevent bloat
                title = title.slice(0, 200);
                snippet = snippet.slice(0, 500);
                results.push({ title, url, snippet });
            });
            const elapsed = Date.now() - startTime;
            // Track usage
            const isSoftLimited = req.auth?.softLimited === true;
            const hasExtraUsage = req.auth?.extraUsageAvailable === true;
            const pgStore = authStore;
            if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
                // Track burst usage (always)
                await pgStore.trackBurstUsage(req.auth.keyInfo.key);
                // If soft-limited with extra usage available, charge to extra usage
                if (isSoftLimited && hasExtraUsage) {
                    const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, 'search', searchUrl, elapsed, response.status);
                    if (extraResult.success) {
                        res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
                        res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
                    }
                }
                else if (!isSoftLimited) {
                    // Normal weekly usage tracking
                    await pgStore.trackUsage(req.auth.keyInfo.key, 'search');
                }
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
            res.setHeader('X-Fetch-Type', 'search');
            res.json({
                query: q,
                count: results.length,
                results,
            });
        }
        catch (error) {
            const err = error;
            // SECURITY: Generic error message to prevent information disclosure
            console.error('Search error:', err); // Log full error server-side
            res.status(500).json({
                error: 'search_failed',
                message: 'Search request failed. Please try again.',
            });
        }
    });
    return router;
}
//# sourceMappingURL=search.js.map