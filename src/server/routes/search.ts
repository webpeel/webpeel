/**
 * Search endpoint with caching — supports DuckDuckGo (default) and Brave (BYOK)
 */

import { Router, Request, Response } from 'express';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
// @ts-ignore — ioredis CJS/ESM interop
import IoRedisModule from 'ioredis';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IoRedis: any = (IoRedisModule as any).default ?? IoRedisModule;
import type { Redis as RedisType } from 'ioredis';
import { AuthStore } from '../auth-store.js';
import { peel } from '../../index.js';
import { simpleFetch } from '../../core/fetcher.js';
import { searchCache } from '../../core/fetch-cache.js';
import {
  getSearchProvider,
  getBestSearchProvider,
  type SearchProviderId,
  type WebSearchResult,
} from '../../core/search-provider.js';
import { BaiduSearchProvider, YandexSearchProvider, NaverSearchProvider, YahooJapanSearchProvider } from '../../core/search-engines.js';
import { crossVerifySearch } from '../../core/cross-verify.js';
import {
  searchShopping,
  searchNews as searchNewsVertical,
  searchImages as searchImagesVertical,
  searchVideos,
} from '../../core/vertical-search.js';
import type { GoogleSerpResult } from '../../core/google-serp-parser.js';
import { getSourceCredibility } from '../../core/source-credibility.js';
import { checkAndSendDualAlert } from '../email-service.js';
import { localSearch } from '../../core/local-search.js';

// ─── Redis client (lazy singleton for search instant cache) ───────────────

function buildSearchRedis(): RedisType {
  const url = process.env.REDIS_URL || 'redis://redis:6379';
  const password = process.env.REDIS_PASSWORD || undefined;
  try {
    const parsed = new URL(url);
    return new IoRedis({
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password,
      db: parseInt(parsed.pathname?.slice(1) || '0', 10) || 0,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  } catch {
    return new IoRedis({ host: 'redis', port: 6379, password, lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }
}

let _searchRedis: RedisType | null = null;
function getSearchRedis(): RedisType {
  if (!_searchRedis) _searchRedis = buildSearchRedis();
  return _searchRedis;
}

// ─── Domain filter helpers ────────────────────────────────────────────────

/**
 * Parse comma-separated domain list, normalize, and cap at 100 entries.
 */
function parseDomainList(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .slice(0, 100);
}

/**
 * Suffix-based domain match: `reuters.com` matches `www.reuters.com`, `uk.reuters.com`, etc.
 */
function domainMatches(hostname: string, filterDomain: string): boolean {
  const h = hostname.toLowerCase();
  const f = filterDomain.toLowerCase();
  return h === f || h.endsWith('.' + f);
}

// ─── Date extraction helper ───────────────────────────────────────────────

const DATE_REGEX = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;

/**
 * Try to extract a Date from a snippet/title string. Returns null if no date found.
 */
function extractDateFromText(text: string): Date | null {
  const match = text.match(DATE_REGEX);
  if (!match) return null;
  const raw = match[1];
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;
  // Try MM/DD/YYYY → rewrite to YYYY-MM-DD for parsing
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const alt = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!isNaN(alt.getTime())) return alt;
  }
  return null;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string; // Added when scrapeResults=true
  serp?: GoogleSerpResult; // Added when structured=true
  rank?: number;           // Credibility rank (1 = most trustworthy)
  credibility?: {
    tier: 'official' | 'established' | 'community' | 'new' | 'suspicious';
    score: number;         // 0-100 composite score
    label: string;
    signals?: string[];
    warnings?: string[];
  };
  /** Lightweight trust score (heuristic-only for unscraped, full pipeline for scraped) */
  trust?: {
    score: number;   // 0-1 normalized composite score
    tier: 'official' | 'established' | 'community' | 'new' | 'suspicious';
  };
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
        res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required. Get one free at https://app.webpeel.dev', docs: 'https://webpeel.dev/docs/api-reference#authentication' }, requestId: req.requestId });
        return;
      }

      // scrapeResults=true: fetches full page content for each result (like Firecrawl's scrape_options).
      // Adds `content` field to each result. Significantly increases response time and credits used.
      // Documented in OpenAPI spec under /v1/search parameters.
      const { q, count, scrapeResults, enrich, sources, categories, tbs, country, location, local, language, structured, includeDomains: includeDomainsParam, excludeDomains: excludeDomainsParam, startDate: startDateParam, endDate: endDateParam, instant: instantParam } = req.query;

      // --- Search provider (new: BYOK Brave support) ---
      const providerParam = (req.query.provider as string || '').toLowerCase() || 'auto';
      const validProviders: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google', 'baidu', 'yandex', 'naver', 'yahoo_japan'];
      let providerId: SearchProviderId | 'auto' = validProviders.includes(providerParam as SearchProviderId)
        ? (providerParam as SearchProviderId)
        : providerParam === 'auto' ? 'auto' : 'duckduckgo';

      // --- Auto-geo-routing: when provider=auto, detect language/region and pick best engine ---
      const acceptLang = (req.headers['accept-language'] || '').toLowerCase();
      const langParam = ((req.query.language as string) || '').toLowerCase();
      let geoRoutedProvider: string | null = null;

      if (providerId === 'auto') {
        if (langParam.startsWith('zh') || acceptLang.startsWith('zh')) {
          providerId = 'baidu';
          geoRoutedProvider = 'baidu';
        } else if (langParam.startsWith('ja') || acceptLang.startsWith('ja')) {
          providerId = 'yahoo_japan';
          geoRoutedProvider = 'yahoo_japan';
        } else if (langParam.startsWith('ko') || acceptLang.startsWith('ko')) {
          providerId = 'naver';
          geoRoutedProvider = 'naver';
        } else if (langParam.startsWith('ru') || acceptLang.startsWith('ru')) {
          providerId = 'yandex';
          geoRoutedProvider = 'yandex';
        }
      }

      // API key: query param, header, or empty
      const searchApiKey =
        (req.query.searchApiKey as string) ||
        (req.headers['x-search-api-key'] as string) ||
        '';

      // Validate query parameter
      if (!q || typeof q !== 'string') {
        res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing or invalid "q" parameter. Pass a search query: GET /v1/search?q=your+search+terms', hint: 'Example: curl "https://api.webpeel.dev/v1/search?q=latest+AI+news&count=5"', docs: 'https://webpeel.dev/docs/api-reference#search' }, requestId: req.requestId });
        return;
      }

      // Parse and validate count
      const resultCount = count ? parseInt(count as string, 10) : 10;
      if (isNaN(resultCount) || resultCount < 1 || resultCount > 20) {
        res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Invalid "count" parameter: must be between 1 and 20', hint: 'Use a count value between 1 and 20', docs: 'https://webpeel.dev/docs/errors#invalid_request' }, requestId: req.requestId });
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
      const languageStr = (language as string) || '';
      const isLocalSearch = local === 'true' || local === '1';

      // ── Local search shortcut ─────────────────────────────────────────────
      // When local=true, route through Google Places / Yelp instead of web search.
      if (isLocalSearch) {
        const localStartTime = Date.now();
        try {
          const localResponse = await localSearch({
            query: q,
            location: locationStr || undefined,
            country: countryStr || undefined,
            language: languageStr || undefined,
            limit: resultCount,
          });

          const localElapsed = Date.now() - localStartTime;

          // Track usage
          const pgStoreLocal = authStore as any;
          if (req.auth?.keyInfo?.key && typeof pgStoreLocal.trackUsage === 'function') {
            await pgStoreLocal.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
          }

          res.setHeader('X-Cache', 'MISS');
          res.setHeader('X-Cache-Status', 'MISS');
          res.setHeader('X-Credits-Used', '1');
          res.setHeader('X-Processing-Time', localElapsed.toString());
          res.setHeader('X-Fetch-Type', 'local-search');
          res.setHeader('X-Local-Source', localResponse.source);
          res.setHeader('Cache-Control', 'no-store');

          res.json({
            success: true,
            data: {
              local: localResponse.results,
              source: localResponse.source,
              query: localResponse.query,
              location: localResponse.location,
            },
          });
          return;
        } catch (localErr) {
          console.error('[search] Local search error:', localErr);
          res.status(500).json({
            success: false,
            error: {
              type: 'local_search_failed',
              message: 'Local search failed. Ensure GOOGLE_PLACES_API_KEY or YELP_API_KEY is configured.',
              hint: 'Set GOOGLE_PLACES_API_KEY env var for best results. Without API keys, uses scraping fallback.',
            },
            requestId: req.requestId,
          });
          return;
        }
      }

      // ── Parse domain and date filter params ──────────────────────────────
      const includeDomains = parseDomainList(includeDomainsParam as string | undefined);
      const excludeDomains = parseDomainList(excludeDomainsParam as string | undefined);
      const startDate = startDateParam ? new Date(startDateParam as string) : null;
      const endDate = endDateParam ? new Date(endDateParam as string) : null;
      const isInstant = instantParam === 'true' || instantParam === '1';

      // Validate date params if provided
      if (startDateParam && (!startDate || isNaN(startDate.getTime()))) {
        res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Invalid "startDate" parameter. Use ISO 8601 format (e.g., "2026-01-01").', docs: 'https://webpeel.dev/docs/api-reference#search' }, requestId: req.requestId });
        return;
      }
      if (endDateParam && (!endDate || isNaN(endDate.getTime()))) {
        res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Invalid "endDate" parameter. Use ISO 8601 format (e.g., "2026-12-31").', docs: 'https://webpeel.dev/docs/api-reference#search' }, requestId: req.requestId });
        return;
      }

      // Build cache key (include all parameters — domain/date filters affect results)
      const enrichCount = enrich ? Math.min(Math.max(parseInt(enrich as string, 10) || 0, 0), 5) : 0;
      const isStructured = structured === 'true' || structured === '1';
      const filterSuffix = [
        includeDomains.length ? `inc:${includeDomains.join('|')}` : '',
        excludeDomains.length ? `exc:${excludeDomains.join('|')}` : '',
        startDateParam ? `sd:${startDateParam}` : '',
        endDateParam ? `ed:${endDateParam}` : '',
      ].filter(Boolean).join(':');
      const cacheKey = `search:${providerId}:${q}:${resultCount}:${sourcesStr}:${shouldScrape}:${enrichCount}:${categoriesStr}:${tbsStr}:${countryStr}:${locationStr}:${isStructured}${filterSuffix ? ':' + filterSuffix : ''}`;
      const sharedCacheKey = searchCache.getKey(cacheKey, {});

      // ── Redis instant cache (30-min TTL, checked BEFORE LRU) ────────────
      const redisInstantKey = `search:instant:${cacheKey}`;
      try {
        const redis = getSearchRedis();
        const redisCached = await redis.get(redisInstantKey);
        if (redisCached) {
          const parsed = JSON.parse(redisCached) as { data: CacheEntry['data']; timestamp: number };
          const age = Math.floor((Date.now() - parsed.timestamp) / 1000);
          res.setHeader('X-Cache', 'INSTANT');
          res.setHeader('X-Cache-Status', 'INSTANT');
          res.setHeader('X-Cache-Age', age.toString());
          res.json({
            success: true,
            data: parsed.data,
          });
          return;
        }
        // If instant=true and nothing in Redis, return 404 (instant-only mode)
        if (isInstant) {
          res.status(404).json({
            success: false,
            error: {
              type: 'not_cached',
              message: 'No cached result available for this query. Remove instant=true to perform a live search.',
              docs: 'https://webpeel.dev/docs/api-reference#search',
            },
            requestId: req.requestId,
          });
          return;
        }
      } catch (err) {
        // Redis unavailable — graceful degradation, continue to LRU
        if (process.env.DEBUG) console.debug('[search] Redis instant cache error (non-fatal):', (err as Error).message);
        // If instant=true and Redis is down, we can't serve cached results
        if (isInstant) {
          res.status(503).json({
            success: false,
            error: {
              type: 'cache_unavailable',
              message: 'Instant cache is temporarily unavailable. Try again without instant=true.',
              docs: 'https://webpeel.dev/docs/api-reference#search',
            },
            requestId: req.requestId,
          });
          return;
        }
      }

      // Check cache (local LRU first, then shared singleton)
      const cached = cache.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());
        res.json({
          success: true,
          data: cached.data,
        });
        return;
      }
      // Also check shared searchCache singleton (used for /health stats)
      const sharedCached = searchCache.get(sharedCacheKey);
      if (sharedCached) {
        const age = Math.floor((Date.now() - sharedCached.timestamp) / 1000);
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Age', age.toString());
        res.json({
          success: true,
          data: sharedCached.content ? JSON.parse(sharedCached.content) : {},
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
        } else if (providerId === 'baidu') {
          searchProvider = new BaiduSearchProvider();
          effectiveApiKey = undefined;
        } else if (providerId === 'yandex') {
          searchProvider = new YandexSearchProvider();
          effectiveApiKey = undefined;
        } else if (providerId === 'naver') {
          searchProvider = new NaverSearchProvider();
          effectiveApiKey = undefined;
        } else if (providerId === 'yahoo_japan') {
          searchProvider = new YahooJapanSearchProvider();
          effectiveApiKey = undefined;
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
          structured: isStructured,
        });

        // ── Domain filtering (suffix-based) ──────────────────────────────
        if (includeDomains.length > 0) {
          providerResults = providerResults.filter(r => {
            try {
              const hostname = new URL(r.url).hostname.toLowerCase();
              return includeDomains.some(d => domainMatches(hostname, d));
            } catch { return false; }
          });
        }
        if (excludeDomains.length > 0) {
          providerResults = providerResults.filter(r => {
            try {
              const hostname = new URL(r.url).hostname.toLowerCase();
              return !excludeDomains.some(d => domainMatches(hostname, d));
            } catch { return true; }
          });
        }

        // ── Date filtering (fuzzy, from snippet/title text) ──────────────
        if (startDate || endDate) {
          providerResults = providerResults.filter(r => {
            const text = `${r.title} ${r.snippet}`;
            const detected = extractDateFromText(text);
            if (!detected) return true; // Keep undatable results
            if (startDate && detected < startDate) return false;
            if (endDate && detected > endDate) return false;
            return true;
          });
        }

        // Map to SearchResult (with optional content field)
        let results: SearchResult[] = providerResults.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          ...(r.serp ? { serp: r.serp } : {}),
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

        // Scrape each result URL if requested (sequential — legacy)
        if (shouldScrape) {
          for (const result of results) {
            try {
              const peelResult = await peel(result.url, {
                format: 'markdown',
                maxTokens: 2000,
              });
              result.content = peelResult.content;
              // Attach full trust score from pipeline
              if (peelResult.trust) {
                result.trust = {
                  score: peelResult.trust.score,
                  tier: peelResult.trust.source.tier,
                };
              }
            } catch (error) {
              result.content = `[Failed to scrape: ${(error as Error).message}]`;
            }
          }
        }

        // Lightweight enrichment — HTTP-only, no browser, no full pipeline
        // Uses simpleFetch + cheerio to extract text without launching Playwright
        // This is intentionally minimal to stay within 512MB container memory limit
        if (enrichCount > 0 && !shouldScrape) {
          const ENRICH_TIMEOUT = 4000;
          const toEnrich = results.slice(0, enrichCount);
          const enrichResults = await Promise.allSettled(
            toEnrich.map(async (result) => {
              const t0 = Date.now();
              const fetchPromise = (async () => {
                const fetched = await simpleFetch(result.url, undefined, ENRICH_TIMEOUT);
                if (!fetched.html) return { url: result.url, content: null, wordCount: 0, method: 'empty', fetchTimeMs: 0 };
                // Extract visible text with cheerio — lightweight, no full pipeline
                const $ = load(fetched.html);
                $('script, style, nav, header, footer, [aria-hidden="true"], .ad, .advertisement').remove();
                // Try main content selectors first, then body
                const mainEl = $('main, article, [role="main"], .content, .article-body, #content').first();
                const textEl = mainEl.length ? mainEl : $('body');
                const text = textEl.text().replace(/\s+/g, ' ').trim().substring(0, 2000);
                const wordCount = text.split(/\s+/).filter(Boolean).length;
                return {
                  url: result.url,
                  content: text.substring(0, 1500) || null,
                  wordCount,
                  method: 'simple',
                  fetchTimeMs: Date.now() - t0,
                };
              })();
              const timeoutPromise = new Promise<{ url: string; content: null; wordCount: 0; method: 'timeout'; fetchTimeMs: number }>(
                resolve => setTimeout(() => resolve({ url: result.url, content: null, wordCount: 0, method: 'timeout', fetchTimeMs: ENRICH_TIMEOUT }), ENRICH_TIMEOUT)
              );
              return Promise.race([fetchPromise, timeoutPromise]);
            })
          );

          // Merge enrichment data back into results
          for (const settled of enrichResults) {
            if (settled.status === 'fulfilled' && settled.value.content) {
              const match = results.find(r => r.url === settled.value.url);
              if (match) {
                (match as any).content = settled.value.content;
                (match as any).wordCount = settled.value.wordCount;
                (match as any).method = settled.value.method;
                (match as any).fetchTimeMs = settled.value.fetchTimeMs;
              }
            }
          }
        }

        // Add credibility scores and sort by trustworthiness
        const tierOrder: Record<string, number> = { official: 0, established: 1, community: 2, new: 3, suspicious: 4 };
        results = results
          .map(r => {
            const cred = getSourceCredibility(r.url);
            // Add lightweight trust score (heuristic only, no network) if not already set by scraper
            const trust = r.trust ?? {
              score: Math.round(Math.max(0, Math.min(100, cred.score))) / 100,
              tier: cred.tier,
            };
            return { ...r, credibility: cred, trust };
          })
          .sort((a, b) => {
            const aTier = tierOrder[a.credibility?.tier || 'new'] ?? 3;
            const bTier = tierOrder[b.credibility?.tier || 'new'] ?? 3;
            return aTier - bTier; // Official first, then established, community, new, suspicious
          })
          .map((r, i) => ({ ...r, rank: i + 1 }));

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

        // Automatic dual-threshold alerts (80% and 90%)
        if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
          checkAndSendDualAlert(pgStore.pool, req.auth.keyInfo.accountId).catch(() => {});
        }
      }

      // Cache results (local LRU + shared singleton for /health stats + Redis instant)
      const cacheTimestamp = Date.now();
      cache.set(cacheKey, {
        data,
        timestamp: cacheTimestamp,
      });
      searchCache.set(sharedCacheKey, {
        content: JSON.stringify(data),
        title: q as string,
        metadata: {},
        method: 'search',
        tokens: 0,
        timestamp: cacheTimestamp,
      });
      // Write to Redis for instant cache (30-min TTL)
      try {
        const redis = getSearchRedis();
        await redis.setex(redisInstantKey, 1800, JSON.stringify({ data, timestamp: cacheTimestamp }));
      } catch (err) {
        if (process.env.DEBUG) console.debug('[search] Redis instant cache write error (non-fatal):', (err as Error).message);
      }

      // Add headers
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Status', 'MISS');
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', 'search');
      res.setHeader('Cache-Control', 'no-store');  // Never cache search results — they must be fresh
      if (geoRoutedProvider) {
        res.setHeader('X-Geo-Provider', geoRoutedProvider);
      }

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      const err = error as Error;
      // SECURITY: Generic error message to prevent information disclosure
      console.error('Search error:', err); // Log full error server-side
      res.status(500).json({
        success: false,
        error: {
          type: 'search_failed',
          message: 'Search request failed. If using Brave provider, verify your API key. Otherwise try again.',
          hint: 'Free search uses DuckDuckGo (no key required). For higher quality, add provider=brave&searchApiKey=YOUR_KEY',
          docs: 'https://webpeel.dev/docs/api-reference#search',
        },
        requestId: req.requestId,
      });
    }
  });

  // ── GET /v1/search/shopping ──────────────────────────────────────────────
  router.get('/v1/search/shopping', async (req: Request, res: Response) => {
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required.' } });
      return;
    }
    const { q, count, country, language } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing required "q" parameter.' } });
      return;
    }
    const resultCount = count ? Math.min(Math.max(parseInt(count as string, 10) || 10, 1), 40) : 10;
    const startTime = Date.now();
    try {
      const results = await searchShopping({
        query: q,
        count: resultCount,
        country: country as string | undefined,
        language: language as string | undefined,
      });
      const elapsed = Date.now() - startTime;
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
      }
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.json({ success: true, data: { results, query: q, count: results.length, elapsed } });
    } catch (err) {
      console.error('[search/shopping] error:', err);
      res.status(500).json({ success: false, error: { type: 'search_failed', message: 'Shopping search failed.' } });
    }
  });

  // ── GET /v1/search/news ──────────────────────────────────────────────────
  router.get('/v1/search/news', async (req: Request, res: Response) => {
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required.' } });
      return;
    }
    const { q, count, language, freshness } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing required "q" parameter.' } });
      return;
    }
    const resultCount = count ? Math.min(Math.max(parseInt(count as string, 10) || 10, 1), 40) : 10;
    const startTime = Date.now();
    try {
      const results = await searchNewsVertical({
        query: q,
        count: resultCount,
        language: language as string | undefined,
        freshness: freshness as string | undefined,
      });
      const elapsed = Date.now() - startTime;
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
      }
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.json({ success: true, data: { results, query: q, count: results.length, elapsed } });
    } catch (err) {
      console.error('[search/news] error:', err);
      res.status(500).json({ success: false, error: { type: 'search_failed', message: 'News search failed.' } });
    }
  });

  // ── GET /v1/search/images ────────────────────────────────────────────────
  router.get('/v1/search/images', async (req: Request, res: Response) => {
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required.' } });
      return;
    }
    const { q, count, country, language } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing required "q" parameter.' } });
      return;
    }
    const resultCount = count ? Math.min(Math.max(parseInt(count as string, 10) || 20, 1), 50) : 20;
    const startTime = Date.now();
    try {
      const results = await searchImagesVertical({
        query: q,
        count: resultCount,
        country: country as string | undefined,
        language: language as string | undefined,
      });
      const elapsed = Date.now() - startTime;
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
      }
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.json({ success: true, data: { results, query: q, count: results.length, elapsed } });
    } catch (err) {
      console.error('[search/images] error:', err);
      res.status(500).json({ success: false, error: { type: 'search_failed', message: 'Image search failed.' } });
    }
  });

  // ── GET /v1/search/verify ────────────────────────────────────────────────
  // Cross-source verification: searches multiple engines and computes consensus
  // GET /v1/search/verify?q=...&engines=google,duckduckgo,baidu&count=10
  router.get('/v1/search/verify', async (req: Request, res: Response) => {
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required.' } });
      return;
    }
    const { q, engines, count } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing required "q" parameter.' } });
      return;
    }
    const engineList = engines
      ? (engines as string).split(',').map(e => e.trim()).filter(Boolean)
      : undefined;
    const resultCount = count ? Math.min(Math.max(parseInt(count as string, 10) || 10, 1), 20) : 10;
    const startTime = Date.now();
    try {
      const result = await crossVerifySearch(q, { engines: engineList, count: resultCount });
      const elapsed = Date.now() - startTime;
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
      }
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[search/verify] error:', err);
      res.status(500).json({ success: false, error: { type: 'search_failed', message: 'Cross-verify search failed.' } });
    }
  });

  // ── GET /v1/search/videos ────────────────────────────────────────────────
  router.get('/v1/search/videos', async (req: Request, res: Response) => {
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required.' } });
      return;
    }
    const { q, count, language } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: { type: 'invalid_request', message: 'Missing required "q" parameter.' } });
      return;
    }
    const resultCount = count ? Math.min(Math.max(parseInt(count as string, 10) || 10, 1), 20) : 10;
    const startTime = Date.now();
    try {
      const results = await searchVideos({
        query: q,
        count: resultCount,
        language: language as string | undefined,
      });
      const elapsed = Date.now() - startTime;
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        await pgStore.trackUsage(req.auth.keyInfo.key, 'search').catch(() => {});
      }
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.json({ success: true, data: { results, query: q, count: results.length, elapsed } });
    } catch (err) {
      console.error('[search/videos] error:', err);
      res.status(500).json({ success: false, error: { type: 'search_failed', message: 'Video search failed.' } });
    }
  });

  return router;
}
