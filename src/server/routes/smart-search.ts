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
 * - general    → SearXNG with smart enrichment (peel() for top 2)
 */

import { Router, Request, Response } from 'express';
import { AuthStore } from '../auth-store.js';
import { peel } from '../../index.js';
import {
  getBestSearchProvider,
  type WebSearchResult,
} from '../../core/search-provider.js';
import { getSourceCredibility } from '../../core/source-credibility.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SearchIntent {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'general';
  query: string;
  params: Record<string, string>;
}

export interface SmartSearchResult {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'general';
  source: string;
  sourceUrl: string;
  content: string;
  title?: string;
  domainData?: any;
  structured?: any;
  results?: any[];  // for general search
  tokens: number;
  fetchTimeMs: number;
  loadingMessage?: string; // intent-aware UX hint
}

// ─── Intent Detection ──────────────────────────────────────────────────────

export function detectSearchIntent(query: string): SearchIntent {
  const q = query.toLowerCase();

  // Cars: vehicle name/type + buying signals
  if (
    /\b(car|cars|vehicle|sedan|suv|truck|honda|toyota|tesla|bmw|ford|chevy|chevrolet|nissan|hyundai|kia|mazda|subaru|lexus|audi|mercedes|volkswagen|jeep|dodge|ram|buick|cadillac|gmc|chrysler|acura|infiniti|volvo|porsche|mini|fiat|mitsubishi)\b/.test(q) &&
    /\b(buy|cheap|under|budget|price|used|new|for sale|listing|deal)\b/.test(q)
  ) {
    const priceMatch = q.match(/(?:under|\$|budget|max)\s*\$?(\d[\d,]*)/);
    const zipMatch = q.match(/\b(\d{5})\b/);
    return {
      type: 'cars',
      query: q,
      params: {
        maxPrice: priceMatch ? priceMatch[1].replace(/,/g, '') : '',
        zip: zipMatch ? zipMatch[1] : '10001',
      },
    };
  }

  // Flights: "flight", "fly", city-to-city patterns with dates
  if (
    /\b(flight|flights|fly|flying|airline|plane)\b/.test(q) ||
    (/\b(from|to)\b.*\b(to|from)\b/.test(q) && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2})\b/.test(q))
  ) {
    return { type: 'flights', query: q, params: {} };
  }

  // Hotels: "hotel", "stay", "accommodation", etc. + location signal
  if (
    /\b(hotel|hotels|motel|stay|accommodation|lodging|inn|resort|airbnb|hostel)\b/.test(q) &&
    /\b(in|near|at|around|cheap|best|book)\b/.test(q)
  ) {
    return { type: 'hotels', query: q, params: {} };
  }

  // Car rental: "rent a car", "car rental", "rental car"
  if (
    /\b(rent|rental)\b.*\b(car|vehicle|suv)\b/.test(q) ||
    /\bcar\s+rental\b/.test(q)
  ) {
    return { type: 'rental', query: q, params: {} };
  }

  // Restaurants: food/dining + location/quality signal
  if (
    /\b(restaurant|restaurants|food|eat|dinner|lunch|pizza|sushi|burger|cafe|bar|bistro|brunch|breakfast)\b/.test(q) &&
    /\b(in|near|best|top|good|cheap)\b/.test(q)
  ) {
    return { type: 'restaurants', query: q, params: {} };
  }

  return { type: 'general', query: q, params: {} };
}

// ─── Intent Handlers ───────────────────────────────────────────────────────

async function handleCarSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build a clean keyword: strip the common car/buy/deal words to surface the actual vehicle name
  const keyword = intent.query
    .replace(/\b(buy|cheap|under|budget|price|used|new|for sale|listing|deal|car|cars)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const params = new URLSearchParams({
    keyword,
    sort: 'list_price',
    stock_type: 'all',
    zip: intent.params.zip || '10001',
    maximum_distance: '50',
  });
  if (intent.params.maxPrice) params.set('list_price_max', intent.params.maxPrice);

  const url = `https://www.cars.com/shopping/results/?${params.toString()}`;

  try {
    const result = await peel(url, { render: true, timeout: 25000 });
    return {
      type: 'cars',
      source: 'Cars.com',
      sourceUrl: url,
      content: result.content,
      title: result.title,
      domainData: result.domainData,
      structured: result.domainData?.structured,
      tokens: result.tokens,
      fetchTimeMs: Date.now() - t0,
    };
  } catch (err) {
    throw new Error(`Cars.com search failed: ${(err as Error).message}`);
  }
}

async function handleFlightSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const gfUrl = `https://www.google.com/travel/flights?q=Flights+${encodeURIComponent(intent.query)}+one+way`;

  try {
    const result = await peel(gfUrl, { render: true, timeout: 30000 });
    return {
      type: 'flights',
      source: 'Google Flights',
      sourceUrl: gfUrl,
      content: result.content,
      title: result.title,
      domainData: result.domainData,
      structured: result.domainData?.structured,
      tokens: result.tokens,
      fetchTimeMs: Date.now() - t0,
    };
  } catch (err) {
    throw new Error(`Google Flights search failed: ${(err as Error).message}`);
  }
}

async function handleHotelSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const ghUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(intent.query)}`;

  try {
    const result = await peel(ghUrl, { render: true, timeout: 30000 });
    return {
      type: 'hotels',
      source: 'Google Hotels',
      sourceUrl: ghUrl,
      content: result.content,
      title: result.title,
      domainData: result.domainData,
      structured: result.domainData?.structured,
      tokens: result.tokens,
      fetchTimeMs: Date.now() - t0,
    };
  } catch (err) {
    throw new Error(`Google Hotels search failed: ${(err as Error).message}`);
  }
}

async function handleRentalSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build Kayak car rental URL: /cars/<location>/<date-range>
  // For simplicity, use a search-style URL that will browser-render fine
  const encodedQuery = encodeURIComponent(intent.query.replace(/\b(rent|rental|car|a|vehicle|suv)\b/gi, '').trim() || intent.query);
  const kayakUrl = `https://www.kayak.com/cars/${encodedQuery}/2025-04-10/2025-04-13/`;

  try {
    const result = await peel(kayakUrl, { render: true, timeout: 30000 });
    return {
      type: 'rental',
      source: 'Kayak',
      sourceUrl: kayakUrl,
      content: result.content,
      title: result.title,
      domainData: result.domainData,
      structured: result.domainData?.structured,
      tokens: result.tokens,
      fetchTimeMs: Date.now() - t0,
    };
  } catch (err) {
    throw new Error(`Kayak car rental search failed: ${(err as Error).message}`);
  }
}

async function handleRestaurantSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const yelpUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(
    intent.query.replace(/\b(best|top|good|cheap|near me)\b/gi, '').trim()
  )}&find_loc=${encodeURIComponent('New York, NY')}`;

  try {
    const result = await peel(yelpUrl, { render: true, timeout: 25000 });
    return {
      type: 'restaurants',
      source: 'Yelp',
      sourceUrl: yelpUrl,
      content: result.content,
      title: result.title,
      domainData: result.domainData,
      structured: result.domainData?.structured,
      tokens: result.tokens,
      fetchTimeMs: Date.now() - t0,
    };
  } catch (err) {
    throw new Error(`Yelp search failed: ${(err as Error).message}`);
  }
}

async function handleGeneralSearch(query: string): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const { provider: searchProvider } = getBestSearchProvider();
  const rawResults: WebSearchResult[] = await searchProvider.searchWeb(query, { count: 10 });

  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  const tierOrder: Record<string, number> = { official: 0, established: 1, community: 2, new: 3, suspicious: 4 };
  let results = rawResults
    .map((r) => {
      const cred = getSourceCredibility(r.url);
      return {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        domain: getDomain(r.url),
        credibility: cred,
      };
    })
    .sort((a, b) => {
      const aTier = tierOrder[a.credibility?.tier || 'new'] ?? 3;
      const bTier = tierOrder[b.credibility?.tier || 'new'] ?? 3;
      return aTier - bTier;
    })
    .map((r, i) => ({ ...r, rank: i + 1 })) as any[];

  // Enrich top 2 results with peel() for richer content
  const top2 = results.slice(0, 2);
  const enriched = await Promise.allSettled(
    top2.map(async (r) => {
      try {
        const peeled = await peel(r.url, { render: true, timeout: 15000, maxTokens: 2000 });
        return { url: r.url, content: peeled.content?.substring(0, 1500), fetchTimeMs: peeled.elapsed };
      } catch {
        return { url: r.url, content: null, fetchTimeMs: 0 };
      }
    })
  );

  for (const settled of enriched) {
    if (settled.status === 'fulfilled' && settled.value.content) {
      const match = results.find((r: any) => r.url === settled.value.url);
      if (match) {
        match.content = settled.value.content;
        match.fetchTimeMs = settled.value.fetchTimeMs;
      }
    }
  }

  const content = results
    .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');

  return {
    type: 'general',
    source: 'Web Search',
    sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    content,
    results,
    tokens: content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
  };
}

// ─── Loading message by intent type ────────────────────────────────────────

function getLoadingMessage(type: SearchIntent['type']): string {
  const msgs: Record<string, string> = {
    cars: 'Searching cars on Cars.com…',
    flights: 'Finding flights on Google Flights…',
    hotels: 'Looking up hotels on Google Hotels…',
    rental: 'Searching rental cars on Kayak…',
    restaurants: 'Finding restaurants on Yelp…',
    general: 'Searching the web…',
  };
  return msgs[type] || 'Searching…';
}

// ─── Router ────────────────────────────────────────────────────────────────

export function createSmartSearchRouter(authStore: AuthStore): Router {
  const router = Router();

  router.post('/v1/search/smart', async (req: Request, res: Response) => {
    try {
      // Require authentication
      const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (!authId) {
        res.status(401).json({
          success: false,
          error: {
            type: 'authentication_required',
            message: 'API key required. Get one free at https://app.webpeel.dev',
            docs: 'https://webpeel.dev/docs/api-reference#authentication',
          },
          requestId: req.requestId,
        });
        return;
      }

      const { q, location, zip } = req.body as { q?: string; location?: string; zip?: string };

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

      // Override zip from request body if provided
      if (zip && intent.params) {
        intent.params.zip = zip;
      }

      // Also try to extract location context from query if "location" is provided
      if (location && intent.type === 'restaurants') {
        // Will be passed in URL construction
        (intent as any).location = location;
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
          smartResult = await handleRestaurantSearch(intent);
          break;
        default:
          smartResult = await handleGeneralSearch(query);
      }

      // Add loading message hint for frontend UX
      smartResult.loadingMessage = getLoadingMessage(intent.type);

      // Track usage
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.key && typeof pgStore.trackUsage === 'function') {
        if (typeof pgStore.trackBurstUsage === 'function') {
          await pgStore.trackBurstUsage(req.auth.keyInfo.key);
        }
        if (!req.auth?.softLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'smart-search');
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
