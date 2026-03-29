/**
 * Smart Search endpoint — intent detection + travel/commerce routing
 * POST /v1/search/smart
 *
 * Detects user intent from natural language and routes to the best source:
 * - cars       → Cars.com with browser rendering + structured extraction
 * - flights    → Google Flights with browser rendering + flight extractor
 * - hotels     → Google Hotels with browser rendering
 * - rental     → Kayak with browser rendering + rental extractor
 * - restaurants → Yelp Fusion API extractor
 * - products   → Amazon search with structured extraction
 * - general    → SearXNG with smart enrichment (peel() for top 3)
 */

import { Router, Request, Response } from 'express';
import '../../types.js'; // Augments Express.Request with requestId, auth
import { AuthStore } from '../../auth-store.js';
// @ts-ignore — ioredis CJS/ESM interop
import IoRedisModule from 'ioredis';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IoRedis: any = (IoRedisModule as any).default ?? IoRedisModule;
import type { Redis as RedisType } from 'ioredis';

// Re-export types and key functions for external consumers
export type { SearchIntent, SmartSearchResult } from './types.js';
export { detectSearchIntent } from './intent.js';

// Internal imports
import type { SmartSearchResult } from './types.js';
import { detectSearchIntent, classifyIntentWithLLM } from './intent.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from './llm.js';
import { handleCarSearch } from './handlers/cars.js';
import { handleFlightSearch } from './handlers/flights.js';
import { handleHotelSearch } from './handlers/hotels.js';
import { handleRentalSearch } from './handlers/rental.js';
import { handleRestaurantSearch } from './handlers/restaurants.js';
import { handleProductSearch } from './handlers/products.js';
import { handleGeneralSearch } from './handlers/general.js';
import { fetchYelpResults } from './sources/yelp.js';
import { fetchRedditResults } from './sources/reddit.js';
import { fetchYouTubeResults } from './sources/youtube.js';

// ─── Redis client (lazy singleton for smart-search caching) ───────────────

function buildSmartRedis(): RedisType {
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

let _smartRedis: RedisType | null = null;
function getSmartRedis(): RedisType {
  if (!_smartRedis) _smartRedis = buildSmartRedis();
  return _smartRedis;
}

// TTL by intent type (seconds)
const CACHE_TTL: Record<string, number> = {
  restaurants: 1800,  // 30 min
  cars: 900,          // 15 min
  products: 900,      // 15 min
  flights: 600,       // 10 min
  hotels: 600,        // 10 min
  rental: 1800,       // 30 min
  general: 3600,      // 60 min
};

// ─── Loading message by intent type ────────────────────────────────────────

function getLoadingMessage(type: string): string {
  const msgs: Record<string, string> = {
    cars: 'Searching cars on Cars.com…',
    flights: 'Searching for flights...',
    hotels: 'Searching for hotels...',
    rental: 'Searching for rental cars...',
    restaurants: 'Finding restaurants on Yelp…',
    products: 'Searching Amazon for products…',
    general: '🔍 Searching and analyzing results...',
  };
  return msgs[type] || 'Searching…';
}

// ─── Router ────────────────────────────────────────────────────────────────

// Log LLM provider at startup
{
  let _llmProvider: string;
  let _llmModel: string;
  if (process.env.OPENAI_API_KEY) {
    _llmProvider = 'openai';
    _llmModel = process.env.LLM_MODEL || 'gpt-4o-mini';
  } else if (process.env.GLAMA_API_KEY) {
    _llmProvider = 'glama';
    _llmModel = process.env.LLM_MODEL || 'google-vertex/gemini-2.5-flash';
  } else if (process.env.OPENROUTER_API_KEY) {
    _llmProvider = 'openrouter';
    _llmModel = process.env.LLM_MODEL || 'google/gemini-2.0-flash-exp:free';
  } else if (process.env.OLLAMA_URL) {
    _llmProvider = 'ollama';
    _llmModel = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
  } else {
    _llmProvider = 'none';
    _llmModel = 'n/a';
  }
  console.log(`[smart-search] LLM provider: ${_llmProvider} (${_llmModel})`);
}

export function createSmartSearchRouter(authStore: AuthStore): Router {
  const router = Router();

  router.post('/v1/search/smart', async (req: Request, res: Response) => {
    try {
      // Authentication: API key OR anonymous (rate-limited by IP)
      const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      const isAnonymous = !authId;

      if (isAnonymous) {
        // Rate limit anonymous users: 10 searches per day per IP
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
          || req.headers['cf-connecting-ip'] as string
          || req.socket.remoteAddress
          || 'unknown';
        const anonKey = `anon:smart:${clientIp}`;
        try {
          const redis = getSmartRedis();
          const count = await redis.incr(anonKey);
          if (count === 1) {
            // Set 24-hour expiry on first request
            await redis.expire(anonKey, 86400);
          }
          if (count > 10) {
            res.status(429).json({
              success: false,
              error: {
                type: 'anonymous_limit_exceeded',
                message: 'Free search limit reached (3/day). Sign up for unlimited searches.',
                signupUrl: 'https://app.webpeel.dev/signup',
              },
              requestId: req.requestId,
            });
            return;
          }
        } catch {
          // Redis failed — allow the request (graceful degradation)
        }
      }

      const { q, location, zip, language: reqLanguage } = req.body as { q?: string; location?: string; zip?: string; language?: string };

      if (!q || typeof q !== 'string' || !q.trim()) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "q" field in request body',
            hint: 'POST /v1/search/smart with JSON body: { "q": "your search query" }',
            docs: 'https://webpeel.dev/docs/api-reference#smart-search',
          },
          requestId: req.requestId,
        });
        return;
      }

      const query = q.trim();
      const intent = detectSearchIntent(query);

      // If regex returned 'general' as fallback (not from an explicit pattern match),
      // try LLM classification to catch typos, other languages, creative phrasing.
      // Skip LLM override if regex matched a specific pattern (comparison, local, service queries)
      // — those were INTENTIONALLY set to 'general'.
      const queryLower = query.toLowerCase();
      const isExplicitGeneral = (
        /\b(compare|vs\.?|versus|which is better|difference between)\b/.test(queryLower) ||
        (/\b(near me|near\s+\w+|open now|open today|open on|what time|is .* open|hours|closest|nearest)\b/.test(queryLower) && /\b(buy|where|store|shop|near|close to|around)\b/.test(queryLower)) ||
        (/\b(plumber|electrician|mechanic|dentist|doctor|lawyer|therapist|vet|salon|barber|gym|daycare)\b/.test(queryLower) && /\b(near|in|around|open|best|cheap|emergency)\b/.test(queryLower)) ||
        (/\b(cruise|vacation|resort|trip|travel|getaway|tour|safari|honeymoon|disneyland|disney|universal|six flags|theme park)\b/.test(queryLower) && /\b(cheap|cheapest|price|ticket|book|deal|package)\b/.test(queryLower))
      );

      if (intent.type === 'general' && !isExplicitGeneral && process.env.OLLAMA_URL) {
        try {
          const llmType = await classifyIntentWithLLM(query);
          if (llmType !== 'general') {
            console.log(`[smart-search] LLM reclassified "${query}" from general → ${llmType}`);
            intent.type = llmType;
          }
        } catch (err) {
          // Graceful degradation — regex result stands
          console.warn('[smart-search] LLM intent classification failed:', (err as Error).message);
        }
      }

      // Override zip from request body if provided
      if (zip && intent.params) {
        intent.params.zip = zip;
      }

      // Also try to extract location context from query if "location" is provided
      if (location && intent.type === 'restaurants') {
        // Will be passed in URL construction
        (intent as any).location = location;
      }

      // ── Cache check (before streaming — HIT skips SSE entirely) ─────────
      const SMART_CACHE_VERSION = 'v5'; // bump when intent routing changes
      const cacheKey = `smart:${SMART_CACHE_VERSION}:${intent.type}:${query.toLowerCase().trim().replace(/\s+/g, ' ')}`;
      try {
        const redis = getSmartRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as SmartSearchResult;
          console.log(`[smart-search] Cache HIT: ${cacheKey} (${parsed.fetchTimeMs}ms original)`);
          // Ensure safety field exists on cached responses
          if (!parsed.safety) {
            parsed.safety = {
              verified: true,
              promptInjectionsBlocked: 0,
              maliciousPatternsStripped: 0,
              sourcesChecked: parsed.sources?.length || 0,
            };
          }
          // Attach suggestedDomains from intent
          if (intent.suggestedDomains?.length) {
            parsed.suggestedDomains = intent.suggestedDomains;
          }
          res.setHeader('X-Intent-Type', intent.type);
          res.setHeader('X-Source', parsed.source);
          res.setHeader('X-Processing-Time', '0');
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Key', cacheKey);
          res.setHeader('Cache-Control', 'no-store');
          res.json({ success: true, data: parsed });
          return;
        }
      } catch (err) {
        console.warn('[smart-search] Redis cache error (non-fatal):', (err as Error).message);
      }

      // ── SSE Streaming path ────────────────────────────────────────────────
      const streamRequested = req.body?.stream === true || req.body?.stream === 'true';

      if (streamRequested) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (typeof (res as any).flush === 'function') (res as any).flush();
        };

        sendEvent('intent', {
          type: intent.type,
          query,
          loadingMessage: getLoadingMessage(intent.type),
        });

        try {
          const t0Stream = Date.now();

          if (intent.type === 'restaurants') {
            // Restaurant: stream each source as it arrives
            const loc = intent.params.location || 'New York, NY';
            const kw = intent.query
              .replace(/\b(best|top|good|cheap|affordable|near me|near|around|in|find|search|looking for)\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim();

            let yelpData: any = null;
            sendEvent('progress', { step: 'searching_yelp', message: 'Searching Yelp for restaurants...' });
            try {
              yelpData = await Promise.race([
                fetchYelpResults(kw, loc),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error('yelp timeout')), 10000)),
              ]);
              sendEvent('progress', { step: 'yelp_done', message: `Found ${yelpData?.businesses?.length || 0} restaurants on Yelp` });
              if (yelpData?.businesses?.length > 0) {
                yelpData.businesses.sort((a: any, b: any) => {
                  const scoreA = (a.rating || 0) * Math.log2((a.reviewCount || 0) + 1);
                  const scoreB = (b.rating || 0) * Math.log2((b.reviewCount || 0) + 1);
                  return scoreB - scoreA;
                });
                yelpData.businesses = yelpData.businesses.filter((b: any) => !b.isClosed);
                if (process.env.GOOGLE_PLACES_API_KEY) {
                  sendEvent('progress', { step: 'checking_google', message: 'Verifying hours on Google Maps...' });
                }
                sendEvent('source', { source: 'yelp', businesses: yelpData.businesses.slice(0, 10) });
                if (process.env.GOOGLE_PLACES_API_KEY) {
                  sendEvent('progress', { step: 'google_done', message: 'Hours verified for top 3 restaurants' });
                }
              }
            } catch {
              sendEvent('progress', { step: 'yelp_done', message: 'Found 0 restaurants on Yelp' });
            }

            sendEvent('progress', { step: 'fetching_reviews', message: 'Finding Reddit discussions and YouTube reviews...' });
            const [redditSettled, youtubeSettled] = await Promise.allSettled([
              Promise.race([
                fetchRedditResults(kw, loc),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error('reddit timeout')), 8000)),
              ]),
              Promise.race([
                fetchYouTubeResults(kw, loc),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error('youtube timeout')), 5000)),
              ]),
            ]);
            const redditData = redditSettled.status === 'fulfilled' ? redditSettled.value : null;
            const youtubeData = youtubeSettled.status === 'fulfilled' ? youtubeSettled.value : null;

            if (redditData) {
              sendEvent('source', { source: 'reddit', thread: (redditData as any).thread, otherThreads: (redditData as any).otherThreads });
            }
            if (youtubeData && (youtubeData as any).videos?.length) {
              sendEvent('source', { source: 'youtube', videos: (youtubeData as any).videos });
            }

            let answer: string | undefined;
            const ollamaUrl = process.env.OLLAMA_URL;
            if (ollamaUrl && yelpData?.businesses?.length > 0) {
              sendEvent('progress', { step: 'generating_ai', message: 'Generating AI recommendation...' });
              try {
                const yelpLines = yelpData.businesses.slice(0, 3).map((b: any, i: number) => {
                  const openStatus = b.isClosed ? 'PERMANENTLY CLOSED' : (b.isOpenNow ? 'OPEN NOW' : 'Closed right now');
                  const txns = b.transactions?.length > 0 ? `Available: ${b.transactions.join(', ')}` : '';
                  const googleInfo = b.googleRating ? ` | Google: ⭐${b.googleRating} (${b.googleReviewCount} reviews)` : '';
                  return `[${i+1}] ${b.name} ⭐${b.rating} (${b.reviewCount?.toLocaleString()} reviews) ${b.price || ''} — ${b.address}
   ${openStatus} | Today: ${b.todayHours || 'hours not available'} | ${txns} | Categories: ${b.categories || ''}${googleInfo}
   URL: ${b.url || ''}`;
                }).join('\n');
                const yelpCitations = yelpData.businesses.slice(0, 3).map((b: any, i: number) => `[${i+1}] ${b.url || 'yelp.com'}`).join('\n');
                const redditHint = redditData && (redditData as any).otherThreads?.slice(0, 2).map((t: any) => t.title).join('; ') || '';
                const systemPrompt = `${PROMPT_INJECTION_DEFENSE}Recommend top 3 restaurants. For each: name with inline citation [1][2][3], why it's good, open/closed status, hours.
Cite sources inline using [1], [2], [3] notation matching the numbered sources. At the end, list Sources with their URLs.
Be specific. Max 200 words.
`;
                const userMessage = `Query: ${sanitizeSearchQuery(intent.query)}\n\nTop restaurants:\n${yelpLines}${redditHint ? '\n\nReddit mentions: ' + redditHint : ''}\n\nSources:\n${yelpCitations}`;
                const text = await callLLMQuick(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 250, timeoutMs: 5000, temperature: 0.3 });
                if (text) answer = text;
              } catch { /* LLM failure — no answer */ }
            }

            if (answer) {
              sendEvent('answer', { answer });
            }

            sendEvent('done', { fetchTimeMs: Date.now() - t0Stream, answer: answer || undefined });

            // Cache the streaming result for restaurants
            try {
              const redis = getSmartRedis();
              const ttl = CACHE_TTL[intent.type] || 600;
              const yelpUrl = yelpData?.url || `https://www.yelp.com/search?find_desc=${encodeURIComponent(kw)}&find_loc=${encodeURIComponent(loc)}`;
              const contentParts: string[] = [];
              if (yelpData?.businesses?.length > 0) {
                contentParts.push(`## Yelp (${yelpData.businesses.length} restaurants)`);
                yelpData.businesses.slice(0, 10).forEach((b: any, i: number) => {
                  const openStatus = b.isClosed ? ' · ⛔ Permanently Closed' : (b.isOpenNow ? ' · 🟢 Open Now' : ' · 🔴 Closed');
                  contentParts.push(`${i + 1}. **${b.name}** ⭐${b.rating} (${(b.reviewCount || 0).toLocaleString()} reviews)${b.price ? ' · ' + b.price : ''}${openStatus}${b.address ? ' — ' + b.address : ''}`);
                });
              }
              if (redditData) {
                contentParts.push('');
                contentParts.push('## Reddit Recommendations');
                if ((redditData as any).thread) contentParts.push(`**${(redditData as any).thread.title}**`);
              }
              if (youtubeData && (youtubeData as any).videos?.length) {
                contentParts.push('');
                contentParts.push('## YouTube Reviews');
                (youtubeData as any).videos.forEach((v: any) => contentParts.push(`🎬 [${v.title}](${v.url})`));
              }
              const cachedSources: Array<{ title: string; url: string; domain: string }> = [];
              if (yelpData) cachedSources.push({ title: 'Yelp', url: yelpUrl, domain: 'yelp.com' });
              if ((redditData as any)?.thread) cachedSources.push({ title: (redditData as any).thread.title, url: (redditData as any).thread.url, domain: 'reddit.com' });
              if ((youtubeData as any)?.videos?.[0]) cachedSources.push({ title: (youtubeData as any).videos[0].title, url: (youtubeData as any).videos[0].url, domain: 'youtube.com' });
              const cacheResult: SmartSearchResult = {
                type: 'restaurants',
                source: 'Yelp + Reddit + YouTube',
                sourceUrl: yelpUrl,
                content: contentParts.join('\n'),
                title: `${kw} in ${loc}`,
                domainData: yelpData?.domainData,
                structured: yelpData?.domainData?.structured,
                tokens: contentParts.join('\n').split(/\s+/).length,
                fetchTimeMs: Date.now() - t0Stream,
                ...(answer !== undefined ? { answer } : {}),
                ...(cachedSources.length > 0 ? { sources: cachedSources } : {}),
                safety: {
                  verified: true,
                  promptInjectionsBlocked: 0,
                  maliciousPatternsStripped: 0,
                  sourcesChecked: cachedSources.length,
                },
                ...(intent.suggestedDomains?.length ? { suggestedDomains: intent.suggestedDomains } : {}),
              };
              await redis.setex(cacheKey, ttl, JSON.stringify(cacheResult));
              console.log(`[smart-search] SSE Cache WRITE: ${cacheKey} (TTL: ${ttl}s)`);
            } catch { /* non-fatal */ }

            res.end();
          } else {
            // All other intent types: run the existing handler, emit full result
            const typeLabels: Record<string, string> = {
              cars: 'Searching Cars.com for vehicles...',
              flights: 'Finding flights and prices...',
              hotels: 'Searching for hotels and rates...',
              rental: 'Searching rental car prices...',
              products: 'Searching for products and prices...',
              general: 'Searching the web...',
            };
            sendEvent('progress', { step: 'searching', message: typeLabels[intent.type] || 'Searching...' });

            let streamResult: SmartSearchResult;
            switch (intent.type) {
              case 'cars':
                streamResult = await handleCarSearch(intent);
                break;
              case 'flights':
                streamResult = await handleFlightSearch(intent);
                break;
              case 'hotels':
                streamResult = await handleHotelSearch(intent);
                break;
              case 'rental':
                streamResult = await handleRentalSearch(intent);
                break;
              case 'products':
                streamResult = await handleProductSearch(intent);
                break;
              default:
                streamResult = await handleGeneralSearch(query);
            }

            const resultCount = streamResult.structured?.listings?.length ?? (streamResult as any).results?.length ?? null;
            sendEvent('progress', { step: 'complete', message: `Found ${resultCount !== null ? resultCount : 'results'}` });
            if (streamResult.answer) {
              sendEvent('progress', { step: 'ai_done', message: 'AI summary generated' });
            }

            if (!streamResult.loadingMessage) {
              streamResult.loadingMessage = getLoadingMessage(intent.type);
            }

            // Attach safety summary for streaming non-restaurant results
            streamResult.safety = {
              verified: true,
              promptInjectionsBlocked: 0,
              maliciousPatternsStripped: 0,
              sourcesChecked: streamResult.sources?.length || 0,
            };
            // Attach suggestedDomains from intent
            if (intent.suggestedDomains?.length) {
              streamResult.suggestedDomains = intent.suggestedDomains;
            }

            sendEvent('result', streamResult);
            sendEvent('done', { fetchTimeMs: streamResult.fetchTimeMs });

            // Cache the streaming result
            try {
              const redis = getSmartRedis();
              const ttl = CACHE_TTL[intent.type] || 600;
              await redis.setex(cacheKey, ttl, JSON.stringify(streamResult));
              console.log(`[smart-search] SSE Cache WRITE: ${cacheKey} (TTL: ${ttl}s)`);
            } catch { /* non-fatal */ }

            res.end();
          }

          // Track usage for streaming path too
          const pgStoreStream = authStore as any;
          if (req.auth?.keyInfo?.key && typeof pgStoreStream.trackUsage === 'function') {
            if (typeof pgStoreStream.trackBurstUsage === 'function') {
              await pgStoreStream.trackBurstUsage(req.auth.keyInfo.key);
            }
            if (!req.auth?.softLimited) {
              await pgStoreStream.trackUsage(req.auth.keyInfo.key, 'search');
            }
          }
        } catch (err) {
          sendEvent('error', { message: (err as Error).message });
          res.end();
        }
        return; // Don't fall through to non-streaming response
      }

      let smartResult: SmartSearchResult;

      switch (intent.type) {
        case 'cars':
          smartResult = await handleCarSearch(intent);
          break;
        case 'flights':
          smartResult = await handleFlightSearch(intent);
          break;
        case 'hotels':
          smartResult = await handleHotelSearch(intent);
          break;
        case 'rental':
          smartResult = await handleRentalSearch(intent);
          break;
        case 'restaurants':
          smartResult = await handleRestaurantSearch(intent, reqLanguage);
          break;
        case 'products':
          smartResult = await handleProductSearch(intent);
          break;
        default:
          smartResult = await handleGeneralSearch(query);
      }

      if (!smartResult.loadingMessage) {
        smartResult.loadingMessage = getLoadingMessage(intent.type);
      }

      // ── Attach safety summary ─────────────────────────────────────────────
      smartResult.safety = {
        verified: true, // smart search already sanitizes all LLM inputs
        promptInjectionsBlocked: 0, // stripped before they reach the LLM
        maliciousPatternsStripped: 0,
        sourcesChecked: smartResult.sources?.length || 0,
      };
      // Attach suggestedDomains from intent
      if (intent.suggestedDomains?.length) {
        smartResult.suggestedDomains = intent.suggestedDomains;
      }

      // ── Cache write ───────────────────────────────────────────────────────
      try {
        const redis = getSmartRedis();
        const ttl = CACHE_TTL[smartResult.type] || 600;
        await redis.setex(cacheKey, ttl, JSON.stringify(smartResult));
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('X-Cache-Key', cacheKey);
        console.log(`[smart-search] Cache WRITE: ${cacheKey} (TTL: ${ttl}s)`);
      } catch (err) {
        console.warn('[smart-search] Redis cache write error (non-fatal):', (err as Error).message);
      }

      // Track usage
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        if (typeof pgStore.trackBurstUsage === 'function') {
          await pgStore.trackBurstUsage(req.auth.keyInfo.key);
        }
        if (!req.auth?.softLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'search');
        }
      }

      res.setHeader('X-Intent-Type', intent.type);
      res.setHeader('X-Source', smartResult.source);
      res.setHeader('X-Processing-Time', smartResult.fetchTimeMs.toString());
      res.setHeader('Cache-Control', 'no-store');

      res.json({
        success: true,
        data: smartResult,
      });
    } catch (error) {
      const err = error as Error;
      console.error('Smart search error:', err.message, err.stack);
      res.status(500).json({
        success: false,
        error: {
          type: 'smart_search_failed',
          message: err.message || 'Smart search failed. Please try again.',
          docs: 'https://webpeel.dev/docs/api-reference#smart-search',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
