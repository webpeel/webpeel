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
// @ts-ignore — ioredis CJS/ESM interop
import IoRedisModule from 'ioredis';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IoRedis: any = (IoRedisModule as any).default ?? IoRedisModule;
import type { Redis as RedisType } from 'ioredis';
import {
  getBestSearchProvider,
  type WebSearchResult,
} from '../../core/search-provider.js';
import { getSourceCredibility } from '../../core/source-credibility.js';
// callLLM import removed — using direct Ollama fetch for lower latency

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
  restaurants: 180,   // update frequently
  cars: 300,
  products: 300,
  flights: 600,
  hotels: 600,
  rental: 600,
  general: 600,
};

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

  // Google Flights is an SPA — always returns skeleton HTML. Skip peel entirely.
  // Go straight to instant fallback with direct booking links.
  const content = `# ✈️ Flights — ${intent.query}

*Search major booking sites for the best deals:*

1. **[Google Flights](${gfUrl})**  
   Direct link to Google Flights search

2. **[Kayak](https://www.kayak.com/flights?a=help)**  
   Compare prices across all airlines

3. **[Expedia](https://www.expedia.com/Flights)**  
   Flights, hotels, bundles

4. **[Skyscanner](https://www.skyscanner.com/)**  
   Popular international flight search

5. **[Momondo](https://www.momondo.com/)**  
   Meta-search with lowest prices

---
`;

  return {
    type: 'flights',
    source: 'Flight Search',
    sourceUrl: gfUrl,
    content,
    title: `Flights — ${intent.query}`,
    structured: { listings: [] },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
  };
}

async function handleHotelSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const ghUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(intent.query)}`;

  // Google Hotels is an SPA — always returns skeleton HTML. Skip peel entirely.
  // Go straight to instant fallback with direct booking links.
  {
    const content = `# 🏨 Hotels — ${intent.query}

*Search major booking sites:*

1. **[Booking.com](https://www.booking.com)**  
   Largest selection, competitive prices

2. **[Hotels.com](https://www.hotels.com)**  
   Free night rewards program

3. **[Expedia](https://www.expedia.com/Hotels)**  
   Bundle with flights for discounts

4. **[Airbnb](https://www.airbnb.com)**  
   Apartments, houses, unique stays

5. **[Google Hotels](${ghUrl})**  
   Compare prices across all sites

---
`;
    return {
      type: 'hotels',
      source: 'Hotel Search',
      sourceUrl: ghUrl,
      content,
      title: `Hotels — ${intent.query}`,
      structured: { listings: [] },
      tokens: content.split(' ').length,
      fetchTimeMs: Date.now() - t0,
    };
  }
}

async function handleRentalSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  // Kayak is an SPA — always returns skeleton HTML. Skip peel entirely.
  // Go straight to general search fallback.
  const fallback = await handleGeneralSearch(intent.query);
  return {
    ...fallback,
    type: 'rental',
    loadingMessage: 'Showing search results for car rentals',
  };
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

// Known shopping domains and their display names / badge colors
const SHOPPING_DOMAINS: Array<{ pattern: string; name: string }> = [
  { pattern: 'amazon.com',      name: 'Amazon' },
  { pattern: 'bestbuy.com',     name: 'Best Buy' },
  { pattern: 'walmart.com',     name: 'Walmart' },
  { pattern: 'target.com',      name: 'Target' },
  { pattern: 'zappos.com',      name: 'Zappos' },
  { pattern: 'rei.com',         name: 'REI' },
  { pattern: 'nordstrom.com',   name: 'Nordstrom' },
  { pattern: 'macys.com',       name: "Macy's" },
  { pattern: 'sephora.com',     name: 'Sephora' },
  { pattern: 'ulta.com',        name: 'Ulta' },
  { pattern: 'homedepot.com',   name: 'Home Depot' },
  { pattern: 'lowes.com',       name: "Lowe's" },
  { pattern: 'ebay.com',        name: 'eBay' },
  { pattern: 'etsy.com',        name: 'Etsy' },
];

function getStoreInfo(url: string): { store: string; domain: string } | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    for (const s of SHOPPING_DOMAINS) {
      if (hostname === s.pattern || hostname.endsWith('.' + s.pattern)) {
        return { store: s.name, domain: s.pattern };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a price string from a snippet/title.
 * Handles:
 *   - "$19.99"
 *   - "$7.98 - $24.99"  → returns "from $7.98"
 *   - "from $12"
 *   - "$199"
 * Returns undefined if no price found.
 */
function parsePrice(text: string): string | undefined {
  if (!text) return undefined;

  // Match a price range: $X - $Y or $X to $Y
  const rangeMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*[-–—to]+\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (rangeMatch) {
    const lo = rangeMatch[1].replace(/,/g, '');
    return `from $${parseFloat(lo).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  }

  // "from $XX"
  const fromMatch = text.match(/from\s+\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (fromMatch) {
    const val = parseFloat(fromMatch[1].replace(/,/g, ''));
    return `from $${val.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  }

  // Plain "$XX.XX" or "$XX"
  const plainMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (plainMatch) {
    const val = parseFloat(plainMatch[1].replace(/,/g, ''));
    if (isNaN(val)) return undefined;
    // Don't treat things like "$10000000" as a price (likely not a retail price)
    if (val > 50000) return undefined;
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: val % 1 !== 0 ? 2 : 0 })}`;
  }

  return undefined;
}

/**
 * Clean up retailer-prefixed titles.
 * Removes "Amazon.com: ", "Amazon.com : ", "Amazon.com - ", etc.
 */
function cleanProductTitle(title: string): string {
  return title
    .replace(/^amazon\.com\s*[:\-–—]\s*/i, '')
    .replace(/^walmart\s*[:\-–—]\s*/i, '')
    .replace(/^target\s*[:\-–—]\s*/i, '')
    .replace(/^best\s*buy\s*[:\-–—]\s*/i, '')
    .replace(/^ebay\s*[:\-–—]\s*/i, '')
    .trim();
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
  const searchQuery = `${keyword} buy site:amazon.com OR site:bestbuy.com OR site:walmart.com OR site:target.com OR site:rei.com OR site:nordstrom.com OR site:sephora.com OR site:homedepot.com`;
  const rawResults = await searchProvider.searchWeb(searchQuery, { count: 15 });

  // Parse structured product listings from search results
  const listings = rawResults
    .filter(r => r.url && getStoreInfo(r.url) !== null)
    .map(r => {
      const storeInfo = getStoreInfo(r.url)!;
      const textToSearch = `${r.title || ''} ${r.snippet || ''}`;

      // Extract price from snippet/title
      const price = parsePrice(textToSearch);

      // Extract rating from snippet
      const ratingMatch = (r.snippet || '').match(/(\d+(?:\.\d)?)\s*(?:out of 5|stars?|★)/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

      // Extract review count
      const reviewMatch = (r.snippet || '').match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const reviewCount = reviewMatch ? reviewMatch[1].replace(/,/g, '') : undefined;

      // Clean up title
      const title = cleanProductTitle(r.title || '');

      // Image from SearXNG (imageUrl field if available)
      const image = (r as any).imageUrl ?? undefined;

      return {
        title,
        price,
        rating,
        reviewCount,
        url: r.url,
        snippet: r.snippet,
        store: storeInfo.store,
        image,
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

  // Enrich top 2 results only — fast 5s timeout so LLM has time to run
  const tPeel = Date.now();
  const top2 = results.slice(0, 2);
  const enriched = await Promise.allSettled(
    top2.map(async (r) => {
      try {
        const peeled = await peel(r.url, { timeout: 5000, maxTokens: 1000 });
        return { url: r.url, content: peeled.content?.substring(0, 1000), title: r.title, fetchTimeMs: peeled.elapsed };
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

      // Use AbortController for 20s max LLM timeout (Qwen needs ~5-8s for synthesis)
      const llmAbort = new AbortController();
      const llmTimer = setTimeout(() => llmAbort.abort(), 20000);

      try {
        const ollamaEndpoint = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
        const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
        const ollamaSecret = process.env.OLLAMA_SECRET;

        // Use Node.js http module directly — fetch() has socket hang issues with Ollama on K8s
        const ollamaText = await new Promise<string>((resolve, reject) => {
          const body = JSON.stringify({
            model: ollamaModel,
            prompt: `${systemPrompt}\n\n${userMessage}`,
            stream: false,
            think: false,
            options: { num_predict: 200, temperature: 0.3 },
          });

          const urlObj = new URL(`${ollamaEndpoint}/api/generate`);
          const opts = {
            hostname: urlObj.hostname,
            port: parseInt(urlObj.port || '80'),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              ...(ollamaSecret ? { 'Authorization': `Bearer ${ollamaSecret}` } : {}),
            },
            timeout: 18000,
          };

          // Kill if abort fires
          llmAbort.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));

          const http = require('http') as typeof import('http');
          const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              try {
                const json = JSON.parse(Buffer.concat(chunks).toString());
                resolve(String(json?.response || '').trim());
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timeout')); });
          req.write(body);
          req.end();
        });

        let text = ollamaText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        console.log(`[smart-search] Ollama answered: ${text.length} chars`);
        if (text) {
          answer = text;
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

      // ── Redis cache check ─────────────────────────────────────────────────
      const cacheKey = `smart:${intent.type}:${query.toLowerCase().trim()}`;
      let cacheHit = false;
      try {
        const redis = getSmartRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached) as SmartSearchResult;
          res.setHeader('X-Intent-Type', intent.type);
          res.setHeader('X-Source', cachedData.source);
          res.setHeader('X-Processing-Time', '0');
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('Cache-Control', 'no-store');
          res.json({ success: true, data: cachedData });
          return;
        }
      } catch (_cacheErr) {
        // Redis unavailable — proceed without cache
      }

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

      // ── Cache result in Redis ─────────────────────────────────────────────
      if (!cacheHit) {
        try {
          const redis = getSmartRedis();
          const ttl = CACHE_TTL[intent.type] ?? 300;
          await redis.setex(cacheKey, ttl, JSON.stringify(smartResult));
        } catch (_cacheErr) {
          // Redis unavailable — skip caching silently
        }
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
