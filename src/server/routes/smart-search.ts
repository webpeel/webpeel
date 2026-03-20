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
import http from 'http';
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

const METRO_ZIPS: Record<string, string> = {
  'new york': '10001', 'nyc': '10001', 'manhattan': '10001',
  'brooklyn': '11201', 'queens': '11101', 'bronx': '10451',
  'long island': '11501', 'nassau': '11501', 'suffolk': '11701',
  'jersey city': '07302', 'newark': '07102',
  'los angeles': '90001', 'la': '90001',
  'chicago': '60601', 'houston': '77001', 'phoenix': '85001',
  'philadelphia': '19101', 'san antonio': '78201',
  'san diego': '92101', 'dallas': '75201', 'austin': '78701',
  'miami': '33101', 'atlanta': '30301', 'boston': '02101',
  'seattle': '98101', 'denver': '80201', 'portland': '97201',
  'las vegas': '89101', 'detroit': '48201', 'minneapolis': '55401',
  'san francisco': '94101', 'sf': '94101', 'bay area': '94101',
  'washington dc': '20001', 'dc': '20001',
  'tampa': '33601', 'orlando': '32801', 'charlotte': '28201',
  'san jose': '95101', 'columbus': '43201', 'indianapolis': '46201',
  'nashville': '37201', 'memphis': '38101', 'baltimore': '21201',
  'milwaukee': '53201', 'sacramento': '95801', 'pittsburgh': '15201',
  'st louis': '63101', 'kansas city': '64101', 'cleveland': '44101',
  'raleigh': '27601', 'salt lake city': '84101',
};

export function detectSearchIntent(query: string): SearchIntent {
  const q = query.toLowerCase();

  // Car rental: "rent a car", "car rental", "rental car" — MUST be before cars/buy check
  // Also matches brand names with rent: "rent a Tesla", "rent a BMW"
  const VEHICLE_WORDS = /\b(car|cars|vehicle|suv|sedan|truck|honda|toyota|tesla|bmw|ford|chevy|chevrolet|nissan|hyundai|kia|mazda|subaru|lexus|audi|mercedes|volkswagen|jeep|dodge|ram|buick|cadillac|gmc|chrysler|acura|infiniti|volvo|porsche|mini|fiat|mitsubishi)\b/;
  if (
    (/\b(rent|rental|renting)\b/.test(q) && VEHICLE_WORDS.test(q)) ||
    /\bcar\s+rental\b/.test(q)
  ) {
    return { type: 'rental', query: q, params: {} };
  }

  // Cars: vehicle name/type + buying signals
  if (
    /\b(car|cars|vehicle|sedan|suv|truck|honda|toyota|tesla|bmw|ford|chevy|chevrolet|nissan|hyundai|kia|mazda|subaru|lexus|audi|mercedes|volkswagen|jeep|dodge|ram|buick|cadillac|gmc|chrysler|acura|infiniti|volvo|porsche|mini|fiat|mitsubishi)\b/.test(q) &&
    /\b(buy|cheap|cheapest|under|budget|price|used|new|for sale|listing|deal)\b/.test(q)
  ) {
    const priceMatch = q.match(/(?:under|\$|budget|max)\s*\$?(\d[\d,]*)/);
    const priceValue = priceMatch ? priceMatch[1].replace(/,/g, '') : '';
    // Extract location: "in <location>" or "near <location>"
    const locMatch = q.match(/\b(?:in|near|around)\s+([a-z\s]+?)(?:\s+(?:under|below|for|cheap|budget|\$).*)?$/i);
    const locationText = locMatch ? locMatch[1].trim() : '';
    // Map location to zip
    let zip = '';
    if (locationText) {
      // Try exact match first, then partial
      zip = METRO_ZIPS[locationText] || '';
      if (!zip) {
        for (const [metro, z] of Object.entries(METRO_ZIPS)) {
          if (locationText.includes(metro) || metro.includes(locationText)) {
            zip = z;
            break;
          }
        }
      }
    }
    // Fall back to any 5-digit zip in the query
    if (!zip) {
      const allZips = [...q.matchAll(/\b(\d{5})\b/g)].map(m => m[1]);
      zip = allZips.find(z => z !== priceValue) || '10001';
    }
    return {
      type: 'cars',
      query: q,
      params: {
        maxPrice: priceValue,
        zip,
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

// ─── Shared Ollama Helper ──────────────────────────────────────────────────

/**
 * Quick Ollama call for internal use (intent classification, short synthesis).
 * Uses Node.js http module (not fetch) because fetch has socket hang issues with Ollama on K8s.
 * Returns empty string on failure (graceful degradation).
 */
async function callOllamaQuick(prompt: string, opts?: { maxTokens?: number; timeoutMs?: number; temperature?: number }): Promise<string> {
  const ollamaEndpoint = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
  if (!ollamaEndpoint) return '';

  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
  const ollamaSecret = process.env.OLLAMA_SECRET;
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const maxTokens = opts?.maxTokens ?? 100;
  const temperature = opts?.temperature ?? 0.3;

  const body = JSON.stringify({
    model: ollamaModel,
    prompt,
    stream: false,
    think: false,
    options: { num_predict: maxTokens, temperature },
  });

  try {
    const rawText = await new Promise<string>((resolve, reject) => {
      const urlObj = new URL(`${ollamaEndpoint}/api/generate`);
      const reqOpts = {
        hostname: urlObj.hostname,
        port: parseInt(urlObj.port || '80'),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(ollamaSecret ? { Authorization: `Bearer ${ollamaSecret}` } : {}),
        },
        timeout: timeoutMs,
      };

      const timer = setTimeout(() => req.destroy(new Error('callOllamaQuick timeout')), timeoutMs);
      const req = http.request(reqOpts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            resolve(String(json?.response || '').trim());
          } catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.on('timeout', () => { req.destroy(); reject(new Error('callOllamaQuick timeout')); });
      req.write(body);
      req.end();
    });

    return rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch (err) {
    console.warn('[smart-search] callOllamaQuick failed:', (err as Error).message);
    return '';
  }
}

/**
 * LLM-based intent classification via Qwen.
 * Called when regex returns 'general' to catch typos, other languages, creative phrasing.
 * Fast: 3s timeout, ~50 tokens output.
 */
async function classifyIntentWithLLM(query: string): Promise<SearchIntent['type']> {
  const prompt = `Classify this search query into exactly one category. Reply with ONLY the category name, nothing else.

Categories:
- cars: buying/shopping for vehicles (NOT renting)
- flights: air travel, booking flights
- hotels: accommodation, lodging, stays
- rental: renting vehicles (car rental, rent a car)
- restaurants: food, dining, eating out
- products: shopping for non-vehicle products
- general: anything else (news, how-to, information)

Query: "${query}"

Category:`;

  const result = await callOllamaQuick(prompt, { maxTokens: 10, timeoutMs: 3000, temperature: 0.1 });
  const cleaned = result.toLowerCase().trim().replace(/[^a-z]/g, '');

  const validTypes = ['cars', 'flights', 'hotels', 'rental', 'restaurants', 'products', 'general'];
  // Fuzzy match: "restaurant" → "restaurants", "car" → "cars"
  const match = validTypes.find(t => cleaned.startsWith(t.replace(/s$/, '')));
  return (match || 'general') as SearchIntent['type'];
}

// ─── Intent Handlers ───────────────────────────────────────────────────────

async function handleCarSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build a clean keyword: strip buying signals, price amounts, and common noise words
  // NOTE: keep "car"/"cars" — they're needed for Cars.com search!
  const keyword = intent.query
    .replace(/\b(buy|cheap|cheapest|under|budget|price|used|new|for sale|listing|deal|best|good|find|search|looking for|want|need|in|near|around)\b/gi, '')
    .replace(/[$]\d[\d,]*/g, '')             // strip $30000, $30,000 etc.
    .replace(/\b\d{4,}\b/g, '')              // strip standalone 4+ digit numbers (prices, not model years)
    // Remove location words that were already extracted to zip
    .replace(/\b(long island|nassau|suffolk|manhattan|brooklyn|queens|bronx|nyc|new york|los angeles|chicago|houston|miami|boston|seattle|san francisco|washington dc)\b/gi, '')
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

  const carSearchUrl = `https://www.cars.com/shopping/results/?${params.toString()}`;

  // Run Cars.com peel and Reddit search in parallel
  const [carsSettled, redditSettled] = await Promise.allSettled([
    peel(carSearchUrl, { timeout: 25000 }),
    getBestSearchProvider().provider.searchWeb(`${keyword} reddit review reliable problems`, { count: 5 }),
  ]);

  if (carsSettled.status === 'rejected') {
    throw new Error(`Cars.com search failed: ${(carsSettled.reason as Error)?.message}`);
  }

  const result = carsSettled.value;
  let carListings: any[] = result.domainData?.structured?.listings || [];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Fallback: if Cars.com extraction failed, search for car listings via web search
  if (carListings.length === 0) {
    const { provider } = getBestSearchProvider();
    const fallbackQuery = `${keyword || 'car'} for sale ${intent.params.zip ? `near ${intent.params.zip}` : ''} ${intent.params.maxPrice ? `under $${intent.params.maxPrice}` : ''} site:cars.com OR site:autotrader.com OR site:cargurus.com OR site:carfax.com`;
    const searchResults = await provider.searchWeb(fallbackQuery, { count: 10 });

    // Build listings from search results
    carListings = searchResults
      .filter(r => r.url && r.title)
      .map(r => {
        const price = parsePrice(r.title + ' ' + (r.snippet || ''));
        return {
          title: r.title?.replace(/\s*[-|].*$/, '').trim() || 'Car Listing',
          price,
          url: r.url,
          snippet: r.snippet || '',
          source: new URL(r.url).hostname.replace('www.', ''),
        };
      })
      .slice(0, 8);
  }

  // AI synthesis: summarize top listings + Reddit input
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const listingSummary = carListings.slice(0, 5).map((l: any) =>
      `${l.title || l.name || 'Car'}: ${l.price || 'price N/A'}, ${l.mileage || ''} miles`
    ).join(', ');
    const redditSnippets = redditResults.slice(0, 2).map(r => r.snippet || '').join(' ');
    const aiPrompt = `You are a car buying advisor. The user searched: "${intent.query}". Here are the top listings: ${listingSummary || 'no listings found'}. Reddit says: ${redditSnippets || 'no community input'}. Give a 2-3 sentence recommendation about the best value. Mention specific prices and models. Max 80 words.`;
    const aiText = await callOllamaQuick(aiPrompt, { maxTokens: 120, timeoutMs: 15000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  const content = carListings.length > 0
    ? `# 🚗 Cars — ${intent.query}\n\n${carListings.map((l: any, i: number) =>
        `${i + 1}. **${l.title || l.name}** — ${l.price || 'see price'}${l.mileage ? ` · ${String(l.mileage).replace(/\s*mi$/i, '')} mi` : ''}\n   ${l.snippet || ''}`
      ).join('\n\n')}`
    : result.content;

  return {
    type: 'cars',
    source: 'Cars.com + Reddit',
    sourceUrl: carSearchUrl,
    content,
    title: result.title,
    domainData: result.domainData,
    structured: result.domainData?.structured,
    tokens: result.tokens,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'cars', url: carSearchUrl, count: carListings.length } as any,
      { type: 'reddit', threads: redditResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}

async function handleFlightSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const gfUrl = `https://www.google.com/travel/flights?q=Flights+${encodeURIComponent(intent.query)}+one+way`;

  // Search for actual flight prices + Reddit tips in parallel
  const { provider: searchProvider } = getBestSearchProvider();
  const [flightSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(`flights ${intent.query} cheapest price`, { count: 8 }),
    searchProvider.searchWeb(`${intent.query} flights reddit tips cheap`, { count: 3 }),
  ]);
  const flightResults = flightSettled.status === 'fulfilled' ? flightSettled.value : [];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Build content from search results + static booking links as fallback
  const searchSection = flightResults.length > 0
    ? `## 🔍 Flight Results\n\n${flightResults.slice(0, 6).map((r, i) =>
        `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet || ''}`
      ).join('\n\n')}\n\n`
    : '';

  const content = `# ✈️ Flights — ${intent.query}

${searchSection}## 📌 Book Directly

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

  // AI synthesis from search results + Reddit tips
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const flightInfo = flightResults.slice(0, 5).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `You are a flight booking advisor. The user searched: "${intent.query}". Here are web results about flights: ${flightInfo || 'no results found'}. Reddit tips: ${redditSnippets || 'none'}. Give a 2-3 sentence tip about finding the cheapest flights for this route. Mention booking sites and timing advice. Max 80 words.`;
    const aiText = await callOllamaQuick(aiPrompt, { maxTokens: 130, timeoutMs: 15000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'flights',
    source: 'Flight Search',
    sourceUrl: gfUrl,
    content,
    title: `Flights — ${intent.query}`,
    structured: { listings: flightResults.slice(0, 6).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
  };
}

async function handleHotelSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const ghUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(intent.query)}`;

  // Extract location from query: "hotels in boston" → "boston"
  const hotelLocMatch = intent.query.match(/\b(?:in|near|at|around)\s+(.+?)(?:\s+(?:under|below|for|cheap|\$|from|per).*)?$/i);
  const hotelLocation = hotelLocMatch ? hotelLocMatch[1].trim() : intent.query.replace(/\b(hotel|hotels|motel|stay|accommodation|lodging|inn|resort|airbnb|hostel|book|cheap|best)\b/gi, '').trim();

  // Search for actual hotel prices + Reddit tips in parallel
  const { provider: searchProvider } = getBestSearchProvider();
  const [hotelSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(`hotel ${hotelLocation} price per night cheapest 2025 site:kayak.com OR site:booking.com OR site:expedia.com OR site:hotels.com OR site:tripadvisor.com OR site:hoteltonight.com`, { count: 10 }),
    searchProvider.searchWeb(`best hotel ${hotelLocation} reddit tips deal`, { count: 3 }),
  ]);
  const hotelResults = hotelSettled.status === 'fulfilled' ? hotelSettled.value : [];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Parse prices and sort by price
  const parsedHotels = hotelResults
    .map(r => {
      const textToSearch = `${r.title || ''} ${r.snippet || ''}`;
      const price = parsePrice(textToSearch);
      const priceValue = extractPriceValue(price);
      return { ...r, price, priceValue };
    })
    .sort((a, b) => {
      const aVal = a.priceValue ?? Infinity;
      const bVal = b.priceValue ?? Infinity;
      return aVal - bVal;
    });

  // Build content from search results + static booking links as fallback
  const searchSection = parsedHotels.length > 0
    ? `## 🔍 Hotel Results\n\n${parsedHotels.slice(0, 6).map((r, i) =>
        `${i + 1}. **[${r.title}](${r.url})**${r.price ? ` — ${r.price}/night` : ''}\n   ${r.snippet || ''}`
      ).join('\n\n')}\n\n`
    : '';

  const content = `# 🏨 Hotels — ${intent.query}

${searchSection}## 📌 Book Directly

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

  // AI synthesis from search results + Reddit tips
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const hotelInfo = parsedHotels.slice(0, 5).map(r => `${r.title}${r.price ? `: ${r.price}/night` : ''} — ${r.snippet || ''}`).join('\n');
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `You are a hotel booking advisor. The user searched: "${intent.query}". Here are hotels found: ${hotelInfo || 'no results found'}. Reddit tips: ${redditSnippets || 'none'}. Give a 2-3 sentence recommendation. Mention the best value option and price if available. Max 80 words.`;
    const aiText = await callOllamaQuick(aiPrompt, { maxTokens: 130, timeoutMs: 15000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'hotels',
    source: 'Hotel Search',
    sourceUrl: ghUrl,
    content,
    title: `Hotels — ${intent.query}`,
    structured: { listings: parsedHotels.slice(0, 6).map(r => ({ title: r.title, url: r.url, snippet: r.snippet, price: r.price })) },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
  };
}

async function handleRentalSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();

  // Extract location from query
  const locMatch = intent.query.match(/\b(?:in|at|near|from|around)\s+(.+?)(?:\s+(?:for|under|from|to|between|\$|cheap|best).*)?$/i);
  const location = locMatch ? locMatch[1].trim() : '';

  // Extract dates if present
  const dateMatch = intent.query.match(/(?:from|between)\s+(\w+\s+\d+)\s+(?:to|and|through|-)\s+(\w+\s+\d+)/i);
  const dates = dateMatch ? { from: dateMatch[1], to: dateMatch[2] } : null;

  // Extract budget if present
  const budgetMatch = intent.query.match(/(?:under|\$|budget|max|cheaper than)\s*\$?(\d+)/i);
  const budget = budgetMatch ? budgetMatch[1] : null;

  const { provider: searchProvider } = getBestSearchProvider();

  // Search for aggregator results that include prices + Reddit tips
  const [aggregatorSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(
      `car rental ${location || 'near me'} ${dates ? `${dates.from} to ${dates.to}` : ''} price per day cheapest`,
      { count: 12 }
    ),
    searchProvider.searchWeb(`car rental ${location || ''} reddit tips best deal cheapest`, { count: 4 }),
  ]);

  const rentalResults = aggregatorSettled.status === 'fulfilled' ? aggregatorSettled.value : [];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Known aggregators and direct providers
  const RENTAL_SITES: Record<string, { name: string; type: 'aggregator' | 'direct' }> = {
    'kayak.com': { name: 'Kayak', type: 'aggregator' },
    'priceline.com': { name: 'Priceline', type: 'aggregator' },
    'cheapflights.com': { name: 'Cheapflights', type: 'aggregator' },
    'momondo.com': { name: 'Momondo', type: 'aggregator' },
    'skyscanner.com': { name: 'Skyscanner', type: 'aggregator' },
    'trip.com': { name: 'Trip.com', type: 'aggregator' },
    'carrentals.com': { name: 'CarRentals.com', type: 'aggregator' },
    'rentalcars.com': { name: 'RentalCars.com', type: 'aggregator' },
    'stressfreecarrental.com': { name: 'StressFree', type: 'aggregator' },
    'happycar.com': { name: 'HappyCar', type: 'aggregator' },
    'enterprise.com': { name: 'Enterprise', type: 'direct' },
    'hertz.com': { name: 'Hertz', type: 'direct' },
    'avis.com': { name: 'Avis', type: 'direct' },
    'budget.com': { name: 'Budget', type: 'direct' },
    'turo.com': { name: 'Turo', type: 'direct' },
    'sixt.com': { name: 'Sixt', type: 'direct' },
    'nationalcar.com': { name: 'National', type: 'direct' },
    'alamo.com': { name: 'Alamo', type: 'direct' },
    'costcotravel.com': { name: 'Costco Travel', type: 'direct' },
    'expedia.com': { name: 'Expedia', type: 'aggregator' },
  };

  const getSiteInfo = (url: string): { company: string; siteType: 'aggregator' | 'direct' } | null => {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      for (const [domain, info] of Object.entries(RENTAL_SITES)) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return { company: info.name, siteType: info.type };
        }
      }
      return null;
    } catch { return null; }
  };

  // Deduplicate by company — keep the most location-specific URL per company
  const seen = new Map<string, typeof rentalResults[0]>();
  for (const r of rentalResults) {
    const siteInfo = getSiteInfo(r.url);
    if (!siteInfo) continue;
    const existing = seen.get(siteInfo.company);
    // Prefer URLs that mention the location (more specific = better)
    const locLower = (location || '').toLowerCase().replace(/\s+/g, '');
    const urlLower = r.url.toLowerCase().replace(/[\s-]/g, '');
    const isLocationSpecific = locLower && urlLower.includes(locLower.substring(0, 5));
    if (!existing || isLocationSpecific) {
      seen.set(siteInfo.company, r);
    }
  }

  const listings = [...seen.entries()]
    .map(([company, r]) => {
      const siteInfo = getSiteInfo(r.url)!;
      // Extract price from BOTH title and snippet; prefer title (more prominent = more accurate)
      const titlePrice = parsePrice(r.title || '');
      const snippetPrice = parsePrice(r.snippet || '');
      const price = titlePrice || snippetPrice;
      const priceValue = extractPriceValue(price);
      return {
        name: r.title?.replace(/\s*[-|–—].*$/, '').trim() || `${company} Car Rental`,
        company,
        siteType: siteInfo.siteType,
        url: r.url,
        snippet: r.snippet || '',
        price,
        priceValue,
      };
    });

  // Sort: aggregators with prices first (lowest price first), then aggregators without prices, then direct providers
  listings.sort((a, b) => {
    const aVal = a.priceValue ?? Infinity;
    const bVal = b.priceValue ?? Infinity;
    if (aVal !== bVal) return aVal - bVal;
    if (a.siteType !== b.siteType) return a.siteType === 'aggregator' ? -1 : 1;
    return 0;
  });

  const topListings = listings.slice(0, 6);

  // Also add direct booking links for major providers if they didn't appear in search
  const searchLocation = encodeURIComponent(location || 'New York');
  const directLinks = [
    { company: 'Kayak', siteType: 'aggregator' as const, url: `https://www.kayak.com/cars/${searchLocation}`, name: 'Compare all rental companies' },
    { company: 'Enterprise', siteType: 'direct' as const, url: `https://www.enterprise.com/en/car-rental/locations/us.html`, name: 'Enterprise Rent-A-Car' },
    { company: 'Hertz', siteType: 'direct' as const, url: `https://www.hertz.com/rentacar/reservation/`, name: 'Hertz Car Rental' },
    { company: 'Avis', siteType: 'direct' as const, url: `https://www.avis.com/en/home`, name: 'Avis Car Rental' },
    { company: 'Budget', siteType: 'direct' as const, url: `https://www.budget.com/en/home`, name: 'Budget Car Rental' },
  ].filter(d => !topListings.some(l => l.company === d.company));

  const allListings = [
    ...topListings,
    ...directLinks.map(d => ({ ...d, snippet: '', price: undefined, priceValue: undefined })),
  ];

  // Build markdown content
  const content = `# 🔑 Car Rentals${location ? ` — ${location}` : ''}${dates ? ` (${dates.from} to ${dates.to})` : ''}\n\n` +
    allListings.map((l, i) => `${i + 1}. **${l.name}** — ${l.company}${l.price ? ` · ${l.price}/day` : ''}${l.siteType === 'aggregator' ? ' *(compares prices)*' : ''}\n   ${l.snippet}`).join('\n\n');

  // AI synthesis: use extracted prices + Reddit tips
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const priceInfo = allListings.filter(l => l.price).map(l => `${l.company}: ${l.price}/day`).join(', ');
    const redditContent = redditResults.slice(0, 3).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `You are a car rental advisor. The user wants to rent a car${location ? ' in ' + location : ''}.${dates ? ` Dates: ${dates.from} to ${dates.to}.` : ''}${budget ? ` Budget: $${budget}/day.` : ''} Here are the best prices found: ${priceInfo || 'prices not yet available'}. Based on these prices and Reddit tips, give a 2-3 sentence recommendation. Mention the cheapest option. Max 60 words.\n\nReddit:\n${redditContent}`;
    const aiText = await callOllamaQuick(aiPrompt, { maxTokens: 100, timeoutMs: 15000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'rental',
    source: 'Car Rentals + Reddit',
    sourceUrl: `https://www.kayak.com/cars/${searchLocation}`,
    content,
    title: `Car Rentals${location ? ` in ${location}` : ''}`,
    structured: { listings: allListings },
    tokens: content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    loadingMessage: 'Searching for rental cars...',
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'rental', count: topListings.length } as any,
      { type: 'reddit', threads: redditResults.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}

// ─── Restaurant source fetchers ───────────────────────────────────────────

async function fetchYelpResults(keyword: string, location: string) {
  const YELP_API_KEY = process.env.YELP_API_KEY;
  if (!YELP_API_KEY) {
    // Fallback to peel if no API key
    const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
    const result = await peel(url, { timeout: 8000 });
    return {
      source: 'yelp' as const,
      url,
      businesses: (result.domainData?.structured?.businesses || []) as any[],
      content: result.content,
      domainData: result.domainData,
    };
  }

  const params = new URLSearchParams({
    term: keyword || 'restaurants',
    location: location,
    sort_by: 'rating',
    limit: '20',
  });

  const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
    headers: { 'Authorization': `Bearer ${YELP_API_KEY}` },
  });

  if (!res.ok) throw new Error(`Yelp API ${res.status}`);
  const data = await res.json();
  const businesses = (data.businesses || []).map((b: any) => ({
    name: b.name,
    rating: b.rating,
    reviewCount: b.review_count,
    address: b.location ? [b.location.address1, b.location.city, b.location.state].filter(Boolean).join(', ') : '',
    price: b.price || '',
    categories: (b.categories || []).map((c: any) => c.title).join(', '),
    url: b.url || '',
    phone: b.display_phone || '',
    image_url: b.image_url || '',
    distance: b.distance,
  }));

  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
  return {
    source: 'yelp' as const,
    url,
    businesses,
    content: '',
    domainData: { structured: { businesses } },
  };
}

async function fetchRedditResults(keyword: string, location: string) {
  const { provider } = getBestSearchProvider();
  const results = await provider.searchWeb(
    `${keyword} ${location} site:reddit.com`,
    { count: 5 }
  );
  if (results.length === 0) {
    return { source: 'reddit' as const, thread: null, otherThreads: [] };
  }
  const topThread = results[0];
  try {
    const peeled = await peel(topThread.url, { timeout: 5000 });
    return {
      source: 'reddit' as const,
      thread: {
        title: topThread.title,
        url: topThread.url,
        content: peeled.content?.substring(0, 1000),
        structured: peeled.domainData?.structured,
      },
      otherThreads: results.slice(1).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    };
  } catch {
    return {
      source: 'reddit' as const,
      thread: null,
      otherThreads: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    };
  }
}

async function fetchYouTubeResults(keyword: string, location: string) {
  const { provider } = getBestSearchProvider();
  const results = await provider.searchWeb(
    `${keyword} ${location} food review site:youtube.com`,
    { count: 3 }
  );
  return {
    source: 'youtube' as const,
    videos: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}

async function handleRestaurantSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();

  const location = intent.params.location || 'New York, NY';
  const keyword = intent.query
    .replace(/\b(best|top|good|cheap|affordable|near me|near|around|in|find|search|looking for)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Launch Yelp first (fast API, ~500ms) — it has the main data for AI synthesis.
  // Reddit/YouTube run in parallel alongside Ollama so slow Reddit peel (can hit 403→browser→15s)
  // doesn't delay the AI summary past the 30s server timeout.
  const yelpSettled = await Promise.race([
    fetchYelpResults(keyword, location).then(v => ({ status: 'fulfilled' as const, value: v })),
    new Promise<{ status: 'rejected'; reason: string }>(res => setTimeout(() => res({ status: 'rejected', reason: 'timeout' }), 10000)),
  ]);
  const yelpData = yelpSettled.status === 'fulfilled' ? yelpSettled.value : null;

  // Reddit + YouTube run concurrently (best-effort, capped at 8s)
  const [redditSettled, youtubeSettled] = await Promise.allSettled([
    Promise.race([
      fetchRedditResults(keyword, location),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('reddit timeout')), 8000)),
    ]),
    Promise.race([
      fetchYouTubeResults(keyword, location),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('youtube timeout')), 5000)),
    ]),
  ]);

  const redditData = redditSettled.status === 'fulfilled' ? redditSettled.value : null;
  const youtubeData = youtubeSettled.status === 'fulfilled' ? youtubeSettled.value : null;

  // Re-rank: composite score = rating * log2(reviewCount + 1)
  // This naturally surfaces high-rated places with meaningful review volume
  if (yelpData && yelpData.businesses.length > 0) {
    yelpData.businesses.sort((a: any, b: any) => {
      const scoreA = (a.rating || 0) * Math.log2((a.reviewCount || 0) + 1);
      const scoreB = (b.rating || 0) * Math.log2((b.reviewCount || 0) + 1);
      return scoreB - scoreA;
    });

    // For "best" queries, filter to minimum 50 reviews
    const isBestQuery = /\b(best|top|highest rated)\b/i.test(intent.query);
    if (isBestQuery) {
      const filtered = yelpData.businesses.filter((b: any) => (b.reviewCount || 0) >= 50);
      if (filtered.length >= 3) {
        yelpData.businesses = filtered;
      }
    }
  }

  // ── Build markdown content from all sources ──────────────────────────
  const contentParts: string[] = [];

  // Yelp section
  if (yelpData) {
    const businesses = yelpData.businesses;
    if (businesses.length > 0) {
      contentParts.push(`## Yelp (${businesses.length} restaurants)`);
      businesses.slice(0, 10).forEach((b: any, i: number) => {
        const name    = b.name || b.title || 'Unknown';
        const rating  = b.rating  ? `⭐${b.rating}` : '';
        const reviews = b.reviewCount ? `(${b.reviewCount.toLocaleString()} reviews)` : '';
        const address = b.address || b.location || '';
        const price   = b.price   ? ` · ${b.price}` : '';
        contentParts.push(`${i + 1}. **${name}** ${rating} ${reviews}${price}${address ? ` — ${address}` : ''}`);
      });
    } else if (yelpData.content) {
      contentParts.push(`## Yelp\n${yelpData.content.substring(0, 800)}`);
    }
  }

  // Reddit section
  if (redditData) {
    contentParts.push('');
    contentParts.push('## Reddit Recommendations');
    if (redditData.thread) {
      contentParts.push(`**${redditData.thread.title}**`);
      if (redditData.thread.content) {
        contentParts.push(redditData.thread.content.substring(0, 600));
      }
    }
    if (redditData.otherThreads.length > 0) {
      contentParts.push('');
      redditData.otherThreads.slice(0, 3).forEach(t => {
        contentParts.push(`- [${t.title}](${t.url}) — ${t.snippet || ''}`);
      });
    }
  }

  // YouTube section
  if (youtubeData && youtubeData.videos.length > 0) {
    contentParts.push('');
    contentParts.push('## YouTube Reviews');
    youtubeData.videos.forEach(v => {
      contentParts.push(`🎬 [${v.title}](${v.url}) — ${v.snippet || ''}`);
    });
  }

  const combinedContent = contentParts.join('\n');

  // ── Build sources array for dashboard tabs ────────────────────────────
  const sources: Array<{ title: string; url: string; domain: string }> = [];
  if (yelpData)    sources.push({ title: 'Yelp',    url: yelpData.url,                     domain: 'yelp.com' });
  if (redditData?.thread) sources.push({ title: redditData.thread.title, url: redditData.thread.url, domain: 'reddit.com' });
  if (youtubeData?.videos[0]) sources.push({ title: youtubeData.videos[0].title, url: youtubeData.videos[0].url, domain: 'youtube.com' });

  // ── AI Synthesis via Qwen/Ollama (optional) ───────────────────────────
  // Build a Yelp-only summary first (fast, doesn't wait for Reddit)
  // then enrich with Reddit/YouTube if they arrived
  let answer: string | undefined;
  const ollamaUrl = process.env.OLLAMA_URL;

  if (ollamaUrl && yelpData && yelpData.businesses.length > 0) {
    try {
      const yelpLines = yelpData.businesses.slice(0, 8).map((b: any, i: number) =>
        `${i+1}. ${b.name} ⭐${b.rating} (${b.reviewCount?.toLocaleString()} reviews)${b.price ? ' ' + b.price : ''}${b.address ? ' — ' + b.address : ''}`
      ).join('\n');
      const redditHint = redditData?.otherThreads?.slice(0,2).map((t: any) => t.title).join('; ') || '';
      const systemPrompt = `Synthesize restaurant recommendations. Results are ranked by rating × review volume. Mention specific names, ratings, and review counts. Be specific. Max 150 words.`;
      const userMessage = `Query: ${intent.query}\n\nTop restaurants:\n${yelpLines}${redditHint ? '\n\nReddit mentions: ' + redditHint : ''}`;
      const text = await callOllamaQuick(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 180, timeoutMs: 25000, temperature: 0.3 });
      if (text) answer = text;
    } catch (err) {
      console.warn('[restaurant-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
    }
  }

  // If Yelp completely failed and others also failed, surface an error
  if (!yelpData && !redditData && !youtubeData) {
    throw new Error('All restaurant sources failed');
  }

  const yelpUrl = yelpData?.url || `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;

  return {
    type: 'restaurants',
    source: 'Yelp + Reddit + YouTube',
    sourceUrl: yelpUrl,
    content: combinedContent,
    title: `${keyword} in ${location}`,
    domainData: yelpData?.domainData,
    structured: yelpData?.domainData?.structured,
    tokens: combinedContent.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    ...(sources.length > 0 ? { sources } : {}),
  };
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
 * Extract numeric price value from a formatted price string (for sorting).
 * Returns the lowest price value found (e.g. "from $23" → 23).
 */
function extractPriceValue(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const match = priceStr.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : undefined;
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

  // Use SearXNG to search for products and Reddit reviews in parallel
  const { provider: searchProvider } = getBestSearchProvider();
  const searchQuery = `${keyword} buy site:amazon.com OR site:bestbuy.com OR site:walmart.com OR site:target.com OR site:rei.com OR site:nordstrom.com OR site:sephora.com OR site:homedepot.com`;

  const [rawSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(searchQuery, { count: 15 }),
    getBestSearchProvider().provider.searchWeb(`${keyword} reddit review best worth it`, { count: 4 }),
  ]);

  const rawResults = rawSettled.status === 'fulfilled' ? rawSettled.value : [];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

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

  // AI synthesis: recommend best value option
  let answer: string | undefined;
  if (process.env.OLLAMA_URL && listings.length > 0) {
    const productInfo = listings.slice(0, 5).map(l =>
      `${l.title}: ${l.price || 'N/A'} at ${l.store}${l.rating ? `, ${l.rating}★` : ''}`
    ).join(', ');
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `You are a shopping advisor. The user wants: "${intent.query}". Products found: ${productInfo}. Reddit says: ${redditSnippets || 'no reviews'}. Recommend the best value option. Mention price and store. Max 80 words.`;
    const aiText = await callOllamaQuick(aiPrompt, { maxTokens: 120, timeoutMs: 15000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'products',
    source: listings.length > 0 ? 'Shopping + Reddit' : 'Web',
    sourceUrl: amazonUrl,
    content,
    title: `${keyword} — Shopping`,
    structured: { listings },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'shopping', count: listings.length } as any,
      { type: 'reddit', threads: redditResults.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
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

  // Enrich top 5 results — 6s timeout so LLM has more to work with
  const tPeel = Date.now();
  const top5 = results.slice(0, 5);
  const enriched = await Promise.allSettled(
    top5.map(async (r) => {
      try {
        const peeled = await peel(r.url, { timeout: 6000, maxTokens: 2000 });
        return {
          url: r.url,
          content: peeled.content?.substring(0, 2000),
          title: peeled.title || r.title,
          fetchTimeMs: peeled.elapsed,
          metadata: peeled.metadata,
          structured: peeled.domainData?.structured,
        };
      } catch {
        return { url: r.url, content: null, title: r.title, fetchTimeMs: 0, metadata: undefined, structured: undefined };
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

  // Build sources array from successfully peeled results (all 5)
  const sources = enriched
    .filter((s) => s.status === 'fulfilled' && s.value.content !== null)
    .map((s) => {
      const v = (s as PromiseFulfilledResult<any>).value;
      return {
        title: v.title,
        url: v.url,
        domain: getDomain(v.url),
      };
    });

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
          // Include structured data if available
          const structuredInfo = v.structured ? `\nKey data: ${JSON.stringify(v.structured).substring(0, 300)}` : '';
          return `[${i + 1}] ${v.title}\nURL: ${v.url}${structuredInfo}\n\n${v.content?.substring(0, 1500) || ''}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      const systemPrompt = `Answer the query using these sources. Be specific with names, numbers, dates, and prices. Bold key facts. Cite sources as [1], [2], etc. If sources disagree, note the difference. Max 150 words.`;

      // Truncate source content to 2000 chars total
      const truncatedSources = sourceContent.substring(0, 2000);
      const userMessage = `Query: ${query}\n\nSources:\n${truncatedSources}`;

      const tLlm = Date.now();

      const text = await callOllamaQuick(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 200, timeoutMs: 20000, temperature: 0.3 });
      console.log(`[smart-search] Ollama answered: ${text.length} chars`);
      if (text) {
        answer = text;
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

      // If regex couldn't classify (general), try LLM classification
      // This catches typos, other languages, creative phrasing
      if (intent.type === 'general' && process.env.OLLAMA_URL) {
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
