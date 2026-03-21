/**
 * Domain extractor registry — imports all individual extractors and
 * provides the getDomainExtractor / extractDomainData public API.
 *
 * This file is the entry point for the split extractor architecture.
 * The original domain-extractors.ts re-exports from here for backward compat.
 */

export type { DomainExtractResult, DomainExtractor } from './types.js';

import { twitterExtractor } from './twitter.js';
import { redditExtractor } from './reddit.js';
import { githubExtractor } from './github.js';
import { hackerNewsExtractor } from './hackernews.js';
import { wikipediaExtractor } from './wikipedia.js';
import { youtubeExtractor } from './youtube.js';
import { arxivExtractor } from './arxiv.js';
import { stackOverflowExtractor } from './stackoverflow.js';
import { npmExtractor } from './npm.js';
import { bestBuyExtractor } from './bestbuy.js';
import { walmartExtractor } from './walmart.js';
import { amazonExtractor } from './amazon.js';
import { mediumExtractor } from './medium.js';
import { substackExtractor } from './substack.js';
import { allrecipesExtractor } from './allrecipes.js';
import { imdbExtractor } from './imdb.js';
import { linkedinExtractor } from './linkedin.js';
import { pypiExtractor } from './pypi.js';
import { devtoExtractor } from './devto.js';
import { craigslistExtractor } from './craigslist.js';
import { spotifyExtractor } from './spotify.js';
import { tiktokExtractor } from './tiktok.js';
import { pinterestExtractor } from './pinterest.js';
import { nytimesExtractor, bbcExtractor, cnnExtractor } from './news.js';
import { twitchExtractor } from './twitch.js';
import { soundcloudExtractor } from './soundcloud.js';
import { instagramExtractor } from './instagram.js';
import { pdfExtractor } from './pdf.js';
import { productHuntExtractor } from './producthunt.js';
import { substackRootExtractor } from './substackroot.js';
import { polymarketExtractor } from './polymarket.js';
import { kalshiExtractor } from './kalshi.js';
import { tradingViewExtractor } from './tradingview.js';
import { espnExtractor } from './espn.js';
import { sportsBettingExtractor } from './sportsbetting.js';
import { semanticScholarExtractor } from './semanticscholar.js';
import { pubmedExtractor } from './pubmed.js';
import { coinGeckoExtractor } from './coingecko.js';
import { weatherExtractor } from './weather.js';
import { facebookMarketplaceExtractor } from './facebook.js';
import { etsyExtractor } from './etsy.js';
import { carsComExtractor } from './carscom.js';
import { ebayExtractor } from './ebay.js';
import { yelpExtractor } from './yelp.js';
import { zillowExtractor } from './zillow.js';
import { redfinExtractor } from './redfin.js';
import { googleFlightsExtractor } from './google-flights.js';
import { kayakCarRentalExtractor } from './kayak-cars.js';

import type { DomainExtractor, DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Registry — same order as original domain-extractors.ts
// ---------------------------------------------------------------------------

const REGISTRY: Array<{
  match: (hostname: string, url?: string) => boolean;
  extractor: DomainExtractor;
}> = [
  { match: (h) => h === 'twitter.com' || h === 'x.com' || h === 'www.twitter.com' || h === 'www.x.com', extractor: twitterExtractor },
  { match: (h) => h === 'reddit.com' || h === 'www.reddit.com' || h === 'old.reddit.com', extractor: redditExtractor },
  { match: (h) => h === 'github.com' || h === 'www.github.com', extractor: githubExtractor },
  { match: (h) => h === 'news.ycombinator.com', extractor: hackerNewsExtractor },
  { match: (h) => h === 'en.wikipedia.org' || h === 'www.wikipedia.org' || /\w+\.wikipedia\.org/.test(h), extractor: wikipediaExtractor },
  { match: (h) => h === 'youtube.com' || h === 'www.youtube.com' || h === 'youtu.be', extractor: youtubeExtractor },
  { match: (h) => h === 'arxiv.org' || h === 'export.arxiv.org', extractor: arxivExtractor },
  { match: (h) => h === 'stackoverflow.com' || h === 'www.stackoverflow.com', extractor: stackOverflowExtractor },
  { match: (h) => h === 'www.npmjs.com' || h === 'npmjs.com', extractor: npmExtractor },
  { match: (h) => h === 'www.bestbuy.com' || h === 'bestbuy.com', extractor: bestBuyExtractor },
  { match: (h) => h === 'www.walmart.com' || h === 'walmart.com', extractor: walmartExtractor },
  { match: (h) => h === 'www.amazon.com' || h === 'amazon.com', extractor: amazonExtractor },
  { match: (h) => h === 'medium.com' || h === 'www.medium.com' || h.endsWith('.medium.com'), extractor: mediumExtractor },
  { match: (h) => h.endsWith('.substack.com'), extractor: substackExtractor },
  { match: (h) => h === 'www.allrecipes.com' || h === 'allrecipes.com', extractor: allrecipesExtractor },
  { match: (h) => h === 'www.imdb.com' || h === 'imdb.com', extractor: imdbExtractor },
  { match: (h) => h === 'www.linkedin.com' || h === 'linkedin.com', extractor: linkedinExtractor },
  { match: (h) => h === 'pypi.org' || h === 'www.pypi.org', extractor: pypiExtractor },
  { match: (h) => h === 'dev.to' || h === 'www.dev.to', extractor: devtoExtractor },
  { match: (h) => h === 'craigslist.org' || h === 'www.craigslist.org' || h.endsWith('.craigslist.org'), extractor: craigslistExtractor },
  // ── New extractors ────────────────────────────────────────────────────────
  { match: (h) => h === 'open.spotify.com', extractor: spotifyExtractor },
  { match: (h) => h === 'tiktok.com' || h === 'www.tiktok.com' || h === 'vm.tiktok.com', extractor: tiktokExtractor },
  { match: (h) => h === 'pinterest.com' || h === 'www.pinterest.com' || h.endsWith('.pinterest.com'), extractor: pinterestExtractor },
  { match: (h) => h === 'nytimes.com' || h === 'www.nytimes.com', extractor: nytimesExtractor },
  { match: (h) => h === 'bbc.com' || h === 'www.bbc.com' || h === 'bbc.co.uk' || h === 'www.bbc.co.uk', extractor: bbcExtractor },
  { match: (h) => h === 'cnn.com' || h === 'www.cnn.com', extractor: cnnExtractor },
  { match: (h) => h === 'twitch.tv' || h === 'www.twitch.tv' || h === 'clips.twitch.tv', extractor: twitchExtractor },
  { match: (h) => h === 'soundcloud.com' || h === 'www.soundcloud.com', extractor: soundcloudExtractor },
  { match: (h) => h === 'instagram.com' || h === 'www.instagram.com', extractor: instagramExtractor },
  { match: (h) => h === 'www.producthunt.com' || h === 'producthunt.com', extractor: productHuntExtractor },
  { match: (h) => h === 'substack.com' || h === 'www.substack.com', extractor: substackRootExtractor },
  { match: (_h, url = '') => /\.pdf(\?|$|#)/i.test(url) || /\/pdf\//i.test(url), extractor: pdfExtractor },
  // ── Prediction markets & trading ─────────────────────────────────────────
  { match: (h) => h === 'polymarket.com' || h === 'www.polymarket.com', extractor: polymarketExtractor },
  { match: (h) => h === 'kalshi.com' || h === 'www.kalshi.com', extractor: kalshiExtractor },
  { match: (h) => h === 'tradingview.com' || h === 'www.tradingview.com', extractor: tradingViewExtractor },
  // ── Sports ───────────────────────────────────────────────────────────────
  { match: (h) => h === 'espn.com' || h === 'www.espn.com', extractor: espnExtractor },
  { match: (h) => h === 'draftkings.com' || h === 'www.draftkings.com' || h === 'sportsbook.draftkings.com', extractor: sportsBettingExtractor },
  { match: (h) => h === 'fanduel.com' || h === 'www.fanduel.com' || h === 'sportsbook.fanduel.com', extractor: sportsBettingExtractor },
  { match: (h) => h === 'betmgm.com' || h === 'www.betmgm.com', extractor: sportsBettingExtractor },
  // ── Academic papers ───────────────────────────────────────────────────────
  { match: (h) => h === 'semanticscholar.org' || h === 'www.semanticscholar.org', extractor: semanticScholarExtractor },
  { match: (h) => h === 'pubmed.ncbi.nlm.nih.gov', extractor: pubmedExtractor },
  // ── Crypto ───────────────────────────────────────────────────────────────
  { match: (h) => h === 'coingecko.com' || h === 'www.coingecko.com', extractor: coinGeckoExtractor },
  { match: (h) => h === 'coinmarketcap.com' || h === 'www.coinmarketcap.com', extractor: coinGeckoExtractor },
  // ── Weather ──────────────────────────────────────────────────────────────
  { match: (h) => h === 'open-meteo.com' || h === 'api.open-meteo.com' || h === 'www.open-meteo.com', extractor: weatherExtractor },
  { match: (h) => h === 'weather.com' || h === 'www.weather.com', extractor: weatherExtractor },
  { match: (h) => h === 'accuweather.com' || h === 'www.accuweather.com', extractor: weatherExtractor },
  // ── Marketplaces & Shopping ───────────────────────────────────────────────
  { match: (h) => h === 'facebook.com' || h === 'www.facebook.com', extractor: facebookMarketplaceExtractor },
  { match: (h) => h === 'etsy.com' || h === 'www.etsy.com', extractor: etsyExtractor },
  { match: (h) => h === 'cars.com' || h === 'www.cars.com', extractor: carsComExtractor },
  { match: (h) => h === 'ebay.com' || h === 'www.ebay.com', extractor: ebayExtractor },
  // ── Local / Real Estate ────────────────────────────────────────────────────
  { match: (h) => h === 'yelp.com' || h === 'www.yelp.com', extractor: yelpExtractor },
  { match: (h) => h === 'zillow.com' || h === 'www.zillow.com', extractor: zillowExtractor },
  { match: (h) => h === 'redfin.com' || h === 'www.redfin.com', extractor: redfinExtractor },
  // ── Travel ──────────────────────────────────────────────────────────────
  { match: (h, url = '') => (h === 'www.google.com' || h === 'google.com') && url.includes('/travel/flights'), extractor: googleFlightsExtractor },
  { match: (h, url = '') => (h === 'www.kayak.com' || h === 'kayak.com') && url.includes('/cars/'), extractor: kayakCarRentalExtractor },
];

/**
 * Returns the domain extractor for a URL, or null if none matches.
 */
export function getDomainExtractor(url: string): DomainExtractor | null {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    for (const entry of REGISTRY) {
      if (entry.match(host, url)) return entry.extractor;
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
  }
  return null;
}

/**
 * Returns true if a domain extractor exists for the given URL.
 */
export function hasDomainExtractor(url: string): boolean {
  return getDomainExtractor(url) !== null;
}

// ── Extractor Response Cache ──────────────────────────────────────────────
const EXTRACTOR_CACHE = new Map<string, { result: DomainExtractResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Clear the extractor response cache (used in tests). */
export function clearExtractorCache(): void { EXTRACTOR_CACHE.clear(); }

function getCachedExtractorResult(url: string): DomainExtractResult | null {
  const key = url.replace(/[?#].*$/, '').toLowerCase();
  const entry = EXTRACTOR_CACHE.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.result;
  }
  EXTRACTOR_CACHE.delete(key);
  return null;
}

function setCachedExtractorResult(url: string, result: DomainExtractResult): void {
  const key = url.replace(/[?#].*$/, '').toLowerCase();
  EXTRACTOR_CACHE.set(key, { result, ts: Date.now() });
  if (EXTRACTOR_CACHE.size > 500) {
    const oldest = EXTRACTOR_CACHE.keys().next().value;
    if (oldest) EXTRACTOR_CACHE.delete(oldest);
  }
}

// ── Redis Shared Cache ────────────────────────────────────────────────────
let _redisClient: any = null;
const REDIS_CACHE_PREFIX = 'wp:ext:';
const REDIS_CACHE_TTL_SECS = 300;

/** Inject a Redis client for shared cross-pod caching. */
export function setExtractorRedis(redis: any): void {
  _redisClient = redis;
}

async function getRedisCache(url: string): Promise<DomainExtractResult | null> {
  try {
    if (!_redisClient) return null;
    const key = REDIS_CACHE_PREFIX + url.replace(/[?#].*$/, '').toLowerCase();
    const cached = await _redisClient.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as DomainExtractResult;
  } catch {
    return null;
  }
}

async function setRedisCache(url: string, result: DomainExtractResult): Promise<void> {
  try {
    if (!_redisClient) return;
    const key = REDIS_CACHE_PREFIX + url.replace(/[?#].*$/, '').toLowerCase();
    await _redisClient.set(key, JSON.stringify(result), 'EX', REDIS_CACHE_TTL_SECS);
  } catch {
    // Redis unavailable — in-memory cache still works
  }
}

/**
 * Internal implementation: run the extractor for the URL (if one exists).
 */
async function _extractDomainDataImpl(
  html: string,
  url: string
): Promise<DomainExtractResult | null> {
  const extractor = getDomainExtractor(url);
  if (!extractor) return null;
  try {
    return await extractor(html, url);
  } catch {
    return null;
  }
}

/**
 * Convenience: run the extractor for the URL (if one exists).
 * Wraps _extractDomainDataImpl with a two-tier cache (in-memory + Redis).
 */
export async function extractDomainData(
  html: string,
  url: string
): Promise<DomainExtractResult | null> {
  // 1. Check in-memory cache (fastest — no network)
  const cached = getCachedExtractorResult(url);
  if (cached) return cached;

  // 2. Check Redis cache (shared across all pods)
  const redisCached = await getRedisCache(url);
  if (redisCached) {
    setCachedExtractorResult(url, redisCached);
    return redisCached;
  }

  // 3. Try the real extractor
  const result = await _extractDomainDataImpl(html, url);

  if (result && result.cleanContent.length > 20) {
    setCachedExtractorResult(url, result);
    void setRedisCache(url, result);
    return result;
  }

  // 5. Extractor failed/returned garbage — check for any stale cache entry
  const stale = getCachedExtractorResult(url);
  if (stale) return stale;

  // 6. Genuinely nothing — return null so the pipeline falls back to fetch
  return result;
}
