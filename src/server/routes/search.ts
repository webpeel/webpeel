/**
 * Search endpoint with caching — supports DuckDuckGo (default) and Brave (BYOK)
 */

import { Router, Request, Response } from 'express';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
import { AuthStore } from '../auth-store.js';
import { peel } from '../../index.js';
import {
  getSearchProvider,
  getBestSearchProvider,
  type SearchProviderId,
  type WebSearchResult,
} from '../../core/search-provider.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string; // Added when scrapeResults=true
}

interface ImageResult {
  title: string;
  url: string;
  thumbnail: string;
  source: string;
}

interface NewsResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
}

interface CacheEntry {
  data: {
    web?: SearchResult[];
    images?: ImageResult[];
    news?: NewsResult[];
  };
  timestamp: number;
}

export function createSearchRouter(authStore: AuthStore): Router {
  const router = Router();

  // LRU cache: 15 minute TTL, max 500 entries, 50MB total size
  const cache = new LRUCache<string, CacheEntry>({
    max: 500,
    ttl: 15 * 60 * 1000, // 15 minutes
    maxSize: 50 * 1024 * 1024, // 50MB
    sizeCalculation: (entry) => {
      return JSON.stringify(entry).length;
    },
  });

  router.get('/v1/search', async (req: Request, res: Response) => {
    try {
      // Require authentication
      const searchAuthId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!searchAuthId) {
        res.status(401).json({
          error: 'authentication_required',
          message: 'API key required. Get one free at https://app.webpeel.dev',
          docs: 'https://webpeel.dev/docs/api-reference#authentication',
        });
        return;
      }

      const { q, count, scrapeResults, sources, categories, tbs, country, location } = req.query;

      // --- Search provider (new: BYOK Brave support) ---
      const providerParam = (req.query.provider as string || '').toLowerCase() || 'auto';
      const validProviders: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google'];
      const providerId: SearchProviderId | 'auto' = validProviders.includes(providerParam as SearchProviderId)
        ? (providerParam as SearchProviderId)
        : providerParam === 'auto' ? 'auto' : 'duckduckgo';

      // API key: query param, header, or empty
      const searchApiKey =
        (req.query.searchApiKey as string) ||
        (req.headers['x-search-api-key'] as string) ||
        '';

      // Validate query parameter
      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "q" parameter. Pass a search query: GET /v1/search?q=your+search+terms',
          example: 'curl "https://api.webpeel.dev/v1/search?q=latest+AI+news&count=5"',
          docs: 'https://webpeel.dev/docs/api-reference#search',
        });
        return;
      }

      // Parse and validate count
      const resultCount = count ? parseInt(count as string, 10) : 5;
      if (isNaN(resultCount) || resultCount < 1 || resultCount > 10) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid "count" parameter: must be between 1 and 10',
        });
        return;
      }

      // Parse sources parameter (comma-separated: web,news,images)
      const sourcesStr = (sources as string) || 'web';
      const sourcesArray = sourcesStr.split(',').map(s => s.trim());
      const shouldScrape = scrapeResults === 'true';

      // Parse new search parameters
      const categoriesStr = (categories as string) || '';
      const tbsStr = (tbs as string) || '';
      const countryStr = (country as string) || '';
      const locationStr = (location as string) || '';

      // Build cache key (include all parameters)
      const cacheKey = `search:${providerId}:${q}:${resultCount}:${sourcesStr}:${shouldScrape}:${categoriesStr}:${tbsStr}:${countryStr}:${locationStr}`;

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
      const data: {
        web?: SearchResult[];
        images?: ImageResult[];
        news?: NewsResult[];
      } = {};

      // Fetch web results via the search-provider abstraction
      if (sourcesArray.includes('web')) {
        // When provider=auto (default), use getBestSearchProvider which picks
        // the best available provider based on configured API keys.
        // When a specific provider is requested, use that directly.
        let searchProvider;
        let effectiveApiKey: string | undefined;

        if (providerId === 'auto') {
          const best = getBestSearchProvider();
          searchProvider = best.provider;
          effectiveApiKey = searchApiKey || best.apiKey;
        } else {
          searchProvider = getSearchProvider(providerId);
          effectiveApiKey = searchApiKey || undefined;
        }

        let providerResults: WebSearchResult[] = await searchProvider.searchWeb(q, {
          count: resultCount,
          apiKey: effectiveApiKey,
          tbs: tbsStr || undefined,
          country: countryStr || undefined,
          location: locationStr || undefined,
        });

        // Map to SearchResult (with optional content field)
        let results: SearchResult[] = providerResults.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        }));

        // Apply category filtering if specified
        if (categoriesStr) {
          const categoryList = categoriesStr.split(',').map(c => c.trim().toLowerCase());
          results = results.filter(result => {
            const urlLower = result.url.toLowerCase();
            return categoryList.some(category => {
              switch (category) {
                case 'github':
                  return urlLower.includes('github.com');
                case 'pdf':
                  return urlLower.endsWith('.pdf');
                case 'docs':
                case 'documentation':
                  return urlLower.includes('/docs') || urlLower.includes('/documentation');
                case 'blog':
                  return urlLower.includes('blog') || urlLower.includes('/post/');
                case 'news':
                  return urlLower.includes('news') || urlLower.includes('/article/');
                case 'video':
                  return urlLower.includes('youtube.com') || urlLower.includes('vimeo.com');
                case 'social':
                  return urlLower.includes('twitter.com') || urlLower.includes('x.com') || 
                         urlLower.includes('facebook.com') || urlLower.includes('linkedin.com');
                default:
                  return urlLower.includes(category);
              }
            });
          });
        }

        // Scrape each result URL if requested
        if (shouldScrape) {
          for (const result of results) {
            try {
              const peelResult = await peel(result.url, {
                format: 'markdown',
                maxTokens: 2000,
              });
              result.content = peelResult.content;
            } catch (error) {
              result.content = `[Failed to scrape: ${(error as Error).message}]`;
            }
          }
        }

        data.web = results;
      }

      // Fetch news results (DDG only — Brave news is not supported via HTML scraping)
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
          const results: NewsResult[] = [];

          $('.result').each((_i, elem) => {
            if (results.length >= resultCount) return;

            const $result = $(elem);
            let title = $result.find('.result__title').text().trim();
            const rawUrl = $result.find('.result__a').attr('href') || '';
            let snippet = $result.find('.result__snippet').text().trim();
            const sourceText = $result.find('.result__extras__url').text().trim();

            if (!title || !rawUrl) return;

            let url = rawUrl;
            try {
              const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
              const uddg = ddgUrl.searchParams.get('uddg');
              if (uddg) {
                url = decodeURIComponent(uddg);
              }
            } catch (e) {
              if (process.env.DEBUG) console.debug('[webpeel]', 'ddg url parse failed:', e instanceof Error ? e.message : e);
            }

            try {
              const parsed = new URL(url);
              if (!['http:', 'https:'].includes(parsed.protocol)) {
                return;
              }
              url = parsed.href;
            } catch {
              return;
            }

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

      // Fetch image results (DDG only)
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
          const results: ImageResult[] = [];

          $('.result').each((_i, elem) => {
            if (results.length >= resultCount) return;

            const $result = $(elem);
            const title = $result.find('.result__title').text().trim();
            const thumbnail = $result.find('.result__image img').attr('src') || '';
            const rawUrl = $result.find('.result__a').attr('href') || '';
            const sourceText = $result.find('.result__extras__url').text().trim();

            if (!title || !rawUrl || !thumbnail) return;

            let url = rawUrl;
            try {
              const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
              const uddg = ddgUrl.searchParams.get('uddg');
              if (uddg) {
                url = decodeURIComponent(uddg);
              }
            } catch (e) {
              if (process.env.DEBUG) console.debug('[webpeel]', 'ddg url parse failed:', e instanceof Error ? e.message : e);
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

      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        // Track burst usage (always)
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        // If soft-limited with extra usage available, charge to extra usage
        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            'search',
            `search:${q}`,
            elapsed,
            200
          );

          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          }
        } else if (!isSoftLimited) {
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
    } catch (error) {
      const err = error as Error;
      // SECURITY: Generic error message to prevent information disclosure
      console.error('Search error:', err); // Log full error server-side
      res.status(500).json({
        error: 'search_failed',
        message: 'Search request failed. If using Brave provider, verify your API key. Otherwise try again.',
        hint: 'Free search uses DuckDuckGo (no key required). For higher quality, add provider=brave&searchApiKey=YOUR_KEY',
        docs: 'https://webpeel.dev/docs/api-reference#search',
      });
    }
  });

  return router;
}
