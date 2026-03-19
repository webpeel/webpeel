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
import '../types.js'; // Augments Express.Request with requestId, auth
import { AuthStore } from '../auth-store.js';
import { peel } from '../../index.js';
import {
  getBestSearchProvider,
  type WebSearchResult,
} from '../../core/search-provider.js';
import { getSourceCredibility } from '../../core/source-credibility.js';
import { callLLM } from '../../core/llm-provider.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SearchIntent {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  query: string;
  params: Record<string, string>;
}

export interface SmartSearchResult {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
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
  answer?: string;  // AI-synthesized answer (markdown)
  sources?: Array<{ title: string; url: string; domain: string }>; // peeled sources
  timing?: { searchMs: number; peelMs: number; llmMs: number }; // per-phase timing
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
    const priceValue = priceMatch ? priceMatch[1].replace(/,/g, '') : '';
    // Find all 5-digit numbers, pick the one that isn't the price
    const allZips = [...q.matchAll(/\b(\d{5})\b/g)].map(m => m[1]);
    const finalZip = allZips.find(z => z !== priceValue) || '10001';
    return {
      type: 'cars',
      query: q,
      params: {
        maxPrice: priceValue,
        zip: finalZip,
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

  // Restaurants: food/dining/cuisine + location/quality signal
  if (
    /\b(restaurant|restaurants|food|eat|eating|dinner|lunch|pizza|sushi|burger|burgers|cafe|bar|bars|bistro|brunch|breakfast|ramen|tacos|taco|thai|chinese|italian|mexican|indian|korean|japanese|vietnamese|pho|bbq|barbecue|wings|noodles|steak|steakhouse|seafood|diner|bakery|dessert|ice cream|coffeeshop|coffee shop|pub|gastropub|buffet|deli|dim sum|curry|shawarma|falafel|gyro|bagel|donut|doughnut|waffle|pancake|oyster|lobster|crab|clam|fish)\b/.test(q) &&
    /\b(in|near|best|top|good|cheap|affordable|around|nearby)\b/.test(q)
  ) {
    // Try to extract location from query: "best X in [location]"
    const locMatch = q.match(/\b(?:in|near|around)\s+(.+?)(?:\s+(?:under|below|for|with|that|which).*)?$/i);
    const location = locMatch ? locMatch[1].trim() : '';
    return { type: 'restaurants', query: q, params: { location } };
  }

  // Products: shopping intent + product category keywords
  if (
    /\b(buy|shop|shopping|purchase|order|cheap|cheapest|best price|under \$|price|deal|discount|sale)\b/.test(q) ||
    /\b(shoes|sneakers|boots|sandals|heels|loafers|watch|watches|headphones|earbuds|earphones|laptop|laptops|phone|phones|iphone|android|tablet|camera|skincare|face wash|facewash|moisturizer|serum|shampoo|conditioner|sunscreen|sunblock|backpack|bag|jacket|hoodie|shirt|pants|jeans|shorts|dress|coat|glasses|sunglasses|keyboard|mouse|monitor|charger|cable|speaker|bluetooth|tv|television|mattress|pillow|sheets|towel|desk|chair|lamp|wallet|purse|handbag|belt|socks|underwear|perfume|cologne|makeup|lipstick|foundation|mascara|blush|toner)\b/.test(q)
  ) {
    return { type: 'products', query: q, params: {} };
  }

  return { type: 'general', query: q, params: {} };
}

// ─── Intent Handlers ───────────────────────────────────────────────────────

async function handleCarSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build a clean keyword: strip buying signals, price amounts, and common noise words
  const keyword = intent.query
    .replace(/\b(buy|cheap|under|budget|price|used|new|for sale|listing|deal|car|cars|best|good|find|search|looking for|want|need)\b/gi, '')
    .replace(/[$]\d[\d,]*/g, '')             // strip $30000, $30,000 etc.
    .replace(/\b\d{4,}\b/g, '')              // strip standalone 4+ digit numbers (prices, not model years)
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
    // Proxy provides full HTML; skip browser render for speed (10s vs 25s)
    const result = await peel(url, { timeout: 25000 });
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

  // Try Google Flights first (likely skeleton but worth trying)
  try {
    const result = await peel(gfUrl, { timeout: 12000 });
    const contentLen = result.content?.trim().length ?? 0;
    const hasFlightData = contentLen > 500 && (result.domainData?.structured?.listings?.length > 0);
    if (hasFlightData) {
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
    }
  } catch (_err) { /* fall through */ }

  // Fast fallback: search flight booking sites via SearXNG
  const { provider: searchProvider } = getBestSearchProvider();
  const searchResults = await searchProvider.searchWeb(`${intent.query} site:google.com/flights OR site:kayak.com OR site:expedia.com OR site:skyscanner.com`, { count: 8 });
  const links = searchResults.slice(0, 6);
  const content = `# ✈️ Flights — ${intent.query}\n\n*Search across booking sites:*\n\n${links.map((r, i) =>
    `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet || ''}`
  ).join('\n\n')}\n\n---\n[Search on Google Flights](${gfUrl}) · [Kayak](https://www.kayak.com/flights) · [Expedia](https://www.expedia.com/Flights)`;

  return {
    type: 'flights',
    source: 'Flight Search',
    sourceUrl: gfUrl,
    content,
    title: `Flights — ${intent.query}`,
    structured: { listings: [] },
    results: links as any,
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
  };
}

async function handleHotelSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const ghUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(intent.query)}`;

  try {
    const result = await peel(ghUrl, { timeout: 20000 });
    const contentLen = result.content?.trim().length ?? 0;
    const hasHotelData = contentLen > 500 && (result.domainData?.structured?.listings?.length > 0);
    if (hasHotelData) {
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
    }
    throw new Error('Google Hotels returned skeleton content');
  } catch (_err) {
    // Fast fallback via SearXNG
    const { provider: searchProvider } = getBestSearchProvider();
    const searchResults = await searchProvider.searchWeb(`${intent.query} site:booking.com OR site:hotels.com OR site:expedia.com OR site:airbnb.com`, { count: 8 });
    const links = searchResults.slice(0, 6);
    const content = `# 🏨 Hotels — ${intent.query}\n\n*Search across booking sites:*\n\n${links.map((r, i) =>
      `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet || ''}`
    ).join('\n\n')}\n\n---\n[Booking.com](https://www.booking.com) · [Hotels.com](https://www.hotels.com) · [Expedia](https://www.expedia.com/Hotels)`;
    return {
      type: 'hotels',
      source: 'Hotel Search',
      sourceUrl: ghUrl,
      content,
      title: `Hotels — ${intent.query}`,
      structured: { listings: [] },
      results: links as any,
      tokens: content.split(' ').length,
      fetchTimeMs: Date.now() - t0,
    };
  }
}

async function handleRentalSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build Kayak car rental URL: /cars/<location>/<date-range>
  // For simplicity, use a search-style URL that will browser-render fine
  const encodedQuery = encodeURIComponent(intent.query.replace(/\b(rent|rental|car|a|vehicle|suv)\b/gi, '').trim() || intent.query);
  const kayakUrl = `https://www.kayak.com/cars/${encodedQuery}/2025-04-10/2025-04-13/`;

  try {
    const result = await peel(kayakUrl, { timeout: 20000 });
    const contentLen = result.content?.trim().length ?? 0;
    if (contentLen < 100) {
      throw new Error('Kayak returned empty/skeleton content');
    }
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
      loadingMessage: 'Searching for rental cars...',
    };
  } catch (_err) {
    console.warn(`Kayak rental failed, falling back to general search: ${(_err as Error).message}`);
    const fallback = await handleGeneralSearch(intent.query);
    return {
      ...fallback,
      type: 'rental',
      loadingMessage: 'Showing search results for car rentals',
    };
  }
}

async function handleRestaurantSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();

  // Extract clean search term for find_desc (strip noise words but keep meaningful terms)
  const desc = intent.query
    .replace(/\b(best|top|good|cheap|affordable|near me|near|around|in|find|search|looking for)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Use parsed location from intent params, or default to New York, NY
  const location = intent.params.location || 'New York, NY';

  const yelpUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(desc)}&find_loc=${encodeURIComponent(location)}`;

  try {
    // Yelp works via proxy without browser render (same as Cars.com)
    const result = await peel(yelpUrl, { timeout: 20000 });
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

async function handleProductSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build clean product keyword (strip noise words)
  const keyword = intent.query
    .replace(/\b(buy|shop|shopping|purchase|order|deal|discount|sale|price|cheap|cheapest|best price|under)\b/gi, '')
    .replace(/\$\d[\d,]*/g, '')
    .replace(/\s+/g, ' ')
    .trim() || intent.query;

  // Use SearXNG to search for products — it aggregates Google Shopping, Amazon, etc.
  const { provider: searchProvider } = getBestSearchProvider();
  const searchQuery = `${keyword} buy site:amazon.com OR site:bestbuy.com OR site:walmart.com OR site:target.com`;
  const rawResults = await searchProvider.searchWeb(searchQuery, { count: 12 });

  // Parse structured product listings from search results
  const listings = rawResults
    .filter(r => r.url && (
      r.url.includes('amazon.com') ||
      r.url.includes('bestbuy.com') ||
      r.url.includes('walmart.com') ||
      r.url.includes('target.com') ||
      r.url.includes('zappos.com') ||
      r.url.includes('rei.com')
    ))
    .map(r => {
      // Extract price from snippet/title using regex
      const priceMatch = (r.snippet || r.title || '').match(/\$[\d,]+(?:\.\d{2})?/);
      const price = priceMatch ? priceMatch[0] : undefined;
      // Extract rating from snippet
      const ratingMatch = (r.snippet || '').match(/(\d+(?:\.\d)?)\s*(?:out of 5|stars?|★)/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;
      // Extract review count
      const reviewMatch = (r.snippet || '').match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const reviewCount = reviewMatch ? reviewMatch[1].replace(/,/g, '') : undefined;
      // Determine store
      const domain = new URL(r.url).hostname.replace('www.', '');
      const store = domain.split('.')[0];
      return {
        title: r.title,
        price,
        rating,
        reviewCount,
        url: r.url,
        snippet: r.snippet,
        store,
      };
    })
    .slice(0, 10);

  const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
  const content = listings.length > 0
    ? `# 🛍️ Products — ${keyword}\n\n${listings.map((l, i) =>
        `${i + 1}. **${l.title}** — ${l.price || 'see price'} [${l.store}](${l.url})\n   ${l.snippet || ''}`
      ).join('\n\n')}`
    : `# 🛍️ Products — ${keyword}\n\nNo structured listings found. Try a more specific query.`;

  return {
    type: 'products',
    source: listings.length > 0 ? 'Shopping' : 'Web',
    sourceUrl: amazonUrl,
    content,
    title: `${keyword} — Shopping`,
    structured: { listings },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
  };
}

async function handleGeneralSearch(query: string): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const { provider: searchProvider } = getBestSearchProvider();
  const rawResults: WebSearchResult[] = await searchProvider.searchWeb(query, { count: 10 });
  const searchMs = Date.now() - t0;

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

  // Enrich top 3 results (reduced from 5) with peel() for richer content
  const tPeel = Date.now();
  const top3 = results.slice(0, 3);
  const enriched = await Promise.allSettled(
    top3.map(async (r) => {
      try {
        const peeled = await peel(r.url, { timeout: 8000, maxTokens: 1500 });
        return { url: r.url, content: peeled.content?.substring(0, 1500), title: r.title, fetchTimeMs: peeled.elapsed };
      } catch {
        return { url: r.url, content: null, title: r.title, fetchTimeMs: 0 };
      }
    })
  );
  const peelMs = Date.now() - tPeel;

  // Check if any peel succeeded; if none did, skip LLM and return raw results
  const anyPeelSucceeded = enriched.some(
    (s) => s.status === 'fulfilled' && s.value.content !== null
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

  // Build sources array from successfully peeled results
  const sources = enriched
    .filter((s): s is PromiseFulfilledResult<{ url: string; content: string | null; title: string; fetchTimeMs: number }> =>
      s.status === 'fulfilled' && s.value.content !== null)
    .map((s) => ({
      title: s.value.title,
      url: s.value.url,
      domain: getDomain(s.value.url),
    }));

  // ── AI Synthesis via Qwen/Ollama ──────────────────────────────────────
  let answer: string | undefined;
  let llmMs = 0;

  const ollamaUrl = process.env.OLLAMA_URL;
  // Only call LLM if at least one page was successfully peeled
  if (ollamaUrl && anyPeelSucceeded) {
    try {
      // Build numbered source content for the LLM
      const sourceContent = enriched
        .map((s, i) => {
          if (s.status !== 'fulfilled' || !(s.value as any).content) return null;
          const v = s.value as any;
          return `[${i + 1}] ${v.title}\nURL: ${v.url}\n\n${v.content?.substring(0, 1200) || ''}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      const systemPrompt = `You answer search queries using source content. Be specific: include real names, addresses, phone numbers, prices, hours from the sources. Use markdown bold and bullet points. Cite with [1], [2]. Add a 💡 Tip at the end if relevant. Be concise (150-250 words). Don't make up data.`;

      const userMessage = `Query: ${query}\n\nSources:\n\n${sourceContent}`;

      const tLlm = Date.now();

      // Use AbortController for 10s max LLM timeout
      const llmAbort = new AbortController();
      const llmTimer = setTimeout(() => llmAbort.abort(), 10000);

      try {
        const llmResult = await callLLM(
          {
            provider: 'ollama',
            endpoint: process.env.OLLAMA_URL,
            apiKey: process.env.OLLAMA_SECRET,
            model: process.env.OLLAMA_MODEL,
          },
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            maxTokens: 800,
            temperature: 0.3,
            signal: llmAbort.signal,
          }
        );
        if (llmResult.text) {
          answer = llmResult.text;
        }
      } finally {
        clearTimeout(llmTimer);
      }

      llmMs = Date.now() - tLlm;
    } catch (err) {
      // Graceful degradation: LLM failure → return raw results without answer
      console.warn('General search LLM synthesis failed (graceful fallback):', (err as Error).message);
    }
  }

  return {
    type: 'general',
    source: 'Web Search',
    sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    content,
    results,
    tokens: content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    timing: { searchMs, peelMs, llmMs },
  };
}

// ─── Loading message by intent type ────────────────────────────────────────

function getLoadingMessage(type: SearchIntent['type']): string {
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
        case 'products':
          smartResult = await handleProductSearch(intent);
          break;
        default:
          smartResult = await handleGeneralSearch(query);
      }

      // Add loading message hint for frontend UX (use handler's if already set)
      if (!smartResult.loadingMessage) {
        smartResult.loadingMessage = getLoadingMessage(intent.type);
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
