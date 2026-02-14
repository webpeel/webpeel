/**
 * Search endpoint with caching
 */
import { Router } from 'express';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
import { peel } from '../../index.js';
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
            const { q, count, scrapeResults, sources } = req.query;
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
            // Parse sources parameter (comma-separated: web,news,images)
            const sourcesStr = sources || 'web';
            const sourcesArray = sourcesStr.split(',').map(s => s.trim());
            const shouldScrape = scrapeResults === 'true';
            // Build cache key
            const cacheKey = `search:${q}:${resultCount}:${sourcesStr}:${shouldScrape}`;
            // Check cache
            const cached = cache.get(cacheKey);
            if (cached) {
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());
                res.json({
                    success: true,
                    data: cached.data,
                });
                return;
            }
            const startTime = Date.now();
            const data = {};
            // Fetch web results
            if (sourcesArray.includes('web')) {
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
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
                // Scrape each result URL if requested
                if (shouldScrape) {
                    for (const result of results) {
                        try {
                            const peelResult = await peel(result.url, {
                                format: 'markdown',
                                maxTokens: 2000,
                            });
                            result.content = peelResult.content;
                        }
                        catch (error) {
                            // Skip failed scrapes
                            result.content = `[Failed to scrape: ${error.message}]`;
                        }
                    }
                }
                data.web = results;
            }
            // Fetch news results
            if (sourcesArray.includes('news')) {
                const newsUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&t=news`;
                const response = await undiciFetch(newsUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    },
                });
                if (response.ok) {
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
                        const sourceText = $result.find('.result__extras__url').text().trim();
                        if (!title || !rawUrl)
                            return;
                        // Extract actual URL
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
                        // Validate URL
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
                        // Limit text lengths
                        title = title.slice(0, 200);
                        snippet = snippet.slice(0, 500);
                        results.push({
                            title,
                            url,
                            snippet,
                            source: sourceText.slice(0, 100),
                        });
                    });
                    data.news = results;
                }
            }
            // Fetch image results
            if (sourcesArray.includes('images')) {
                const imagesUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&t=images`;
                const response = await undiciFetch(imagesUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    },
                });
                if (response.ok) {
                    const html = await response.text();
                    const $ = load(html);
                    const results = [];
                    $('.result').each((_i, elem) => {
                        if (results.length >= resultCount)
                            return;
                        const $result = $(elem);
                        const title = $result.find('.result__title').text().trim();
                        const thumbnail = $result.find('.result__image img').attr('src') || '';
                        const rawUrl = $result.find('.result__a').attr('href') || '';
                        const sourceText = $result.find('.result__extras__url').text().trim();
                        if (!title || !rawUrl || !thumbnail)
                            return;
                        // Extract actual URL
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
                        results.push({
                            title: title.slice(0, 200),
                            url,
                            thumbnail,
                            source: sourceText.slice(0, 100),
                        });
                    });
                    data.images = results;
                }
            }
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
                    const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, 'search', `search:${q}`, elapsed, 200);
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
                data,
                timestamp: Date.now(),
            });
            // Add headers
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('X-Credits-Used', '1');
            res.setHeader('X-Processing-Time', elapsed.toString());
            res.setHeader('X-Fetch-Type', 'search');
            res.json({
                success: true,
                data,
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