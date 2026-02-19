/**
 * Hotel search module — searches multiple travel sites and returns sorted hotel listings.
 *
 * Sources: Kayak, Booking.com, Google Travel
 * All sources are fetched in parallel; failures are captured per-source without
 * crashing the overall search.
 */

import { peel } from '../index.js';
import { extractListings } from './extract-listings.js';
import { findSchemaForUrl, extractWithSchema } from './schema-extraction.js';
import type { PageAction } from '../types.js';

// ── Public Types ──────────────────────────────────────────────────────────────

export interface HotelSearchOptions {
  /** Destination name, e.g. "Manhattan" or "Long Island City, New York" */
  destination: string;
  /** ISO date "2026-02-20" or relative string like "tomorrow" or "next friday" */
  checkin: string;
  /** ISO date or relative string. Defaults to checkin + 1 day if omitted. */
  checkout?: string;
  /** Sort order: price (default), rating, or value (rating/price ratio) */
  sort?: 'price' | 'rating' | 'value';
  /** Max results to return. Default: 20 */
  limit?: number;
  /** Specific sources to use. Default: all (kayak, booking, google) */
  sources?: string[];
  /** Use stealth mode for all sources */
  stealth?: boolean;
  /** Suppress progress output */
  silent?: boolean;
}

export interface HotelResult {
  name: string;
  /** Numeric price in USD (null if unknown) */
  price: number | null;
  /** "$119" as shown on the source */
  priceDisplay: string;
  /** Numeric rating (null if unknown) */
  rating: number | null;
  /** "8.4" or "4.2/5" as shown on the source */
  ratingDisplay: string;
  source: string;
  link: string;
  location?: string;
  image?: string;
}

export interface HotelSearchResult {
  destination: string;
  checkin: string;
  checkout: string;
  totalResults: number;
  results: HotelResult[];
  sources: { name: string; count: number; status: 'ok' | 'blocked' | 'error'; error?: string }[];
  elapsed: number;
}

// ── Date Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a date string (ISO or relative) into an ISO date string (YYYY-MM-DD).
 *
 * Supported relative formats:
 *   - "tomorrow" → today + 1 day
 *   - "next <weekday>" → next occurrence of that weekday
 *   - ISO date "2026-02-20" → returned as-is
 */
export function parseDate(input: string, baseDate?: Date): string {
  const base = baseDate ?? new Date();

  // Normalise
  const normalised = input.trim().toLowerCase();

  if (normalised === 'today') {
    return toIsoDate(base);
  }

  if (normalised === 'tomorrow') {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }

  // "next <weekday>"
  const nextMatch = normalised.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextMatch) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = weekdays.indexOf(nextMatch[1]!);
    const d = new Date(base);
    const currentDay = d.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    d.setDate(d.getDate() + daysUntil);
    return toIsoDate(d);
  }

  // Try ISO date (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }

  // Fallback: try to parse as a generic date string
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    return toIsoDate(parsed);
  }

  throw new Error(`Unrecognized date format: "${input}"`);
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Add N days to an ISO date string and return the new ISO date string. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── URL Builders ──────────────────────────────────────────────────────────────

/**
 * Convert a destination name to a Kayak-friendly slug.
 * e.g. "Manhattan, New York" → "Manhattan,New-York"
 * e.g. "Long Island City" → "Long-Island-City"
 */
export function toKayakSlug(destination: string): string {
  return destination
    .split(',')
    .map(part => part.trim().replace(/\s+/g, '-'))
    .join(',');
}

export interface SourceUrl {
  name: string;
  url: string;
}

/**
 * Build the search URL for each source.
 */
export function buildSourceUrls(
  destination: string,
  checkin: string,
  checkout: string,
): SourceUrl[] {
  const kayakSlug = toKayakSlug(destination);
  const bookingDest = encodeURIComponent(destination);
  const googleDest = destination.replace(/\s+/g, '+');

  const expediaDest = encodeURIComponent(destination);

  return [
    {
      name: 'kayak',
      url: `https://www.kayak.com/hotels/${kayakSlug}/${checkin}/${checkout}?sort=price_a`,
    },
    {
      name: 'booking',
      url: `https://www.booking.com/searchresults.html?ss=${bookingDest}&checkin=${checkin}&checkout=${checkout}&order=price`,
    },
    {
      name: 'google',
      url: `https://www.google.com/travel/hotels/${googleDest}`,
    },
    {
      name: 'expedia',
      url: `https://www.expedia.com/Hotel-Search?destination=${expediaDest}&startDate=${checkin}&endDate=${checkout}&sort=PRICE_LOW_TO_HIGH`,
    },
  ];
}

// ── Price & Rating Parsers ────────────────────────────────────────────────────

/**
 * Parse a price display string into a numeric USD value.
 * Returns null if unparseable.
 *
 * Examples:
 *   "$119"     → 119
 *   "$1,299"   → 1299
 *   "£85"      → 85  (GBP treated as USD approximation)
 *   "€95"      → 95
 *   "US$200"   → 200
 */
export function parsePrice(raw: string): number | null {
  if (!raw) return null;
  // Remove currency symbols and "US$" prefix, commas, whitespace
  const cleaned = raw.replace(/US\$|[$£€¥₹]/g, '').replace(/,/g, '').trim();
  // Extract first number
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  return isNaN(n) ? null : n;
}

/**
 * Parse a rating string into a numeric value.
 * Returns null if unparseable.
 *
 * Examples:
 *   "Scored 8.4"      → 8.4
 *   "4.2/5"           → 4.2
 *   "4.2/5 (1.4K)"    → 4.2
 *   "8.3"             → 8.3
 *   "Very Good 8.6"   → 8.6
 */
export function parseRating(raw: string): number | null {
  if (!raw) return null;

  // "Scored N.N" or "Very Good N.N" etc.
  const scoredMatch = raw.match(/(\d+(?:\.\d+)?)\s*\/\s*\d/);
  if (scoredMatch) {
    const n = parseFloat(scoredMatch[1]!);
    return isNaN(n) ? null : n;
  }

  // Extract last number (handles "Scored 8.4", "Very Good 8.6", standalone "8.3")
  const numMatch = raw.match(/(\d+(?:\.\d+)?)/g);
  if (!numMatch) return null;

  // Take the last number that looks like a rating (0–10 scale or 0–5 scale)
  for (let i = numMatch.length - 1; i >= 0; i--) {
    const n = parseFloat(numMatch[i]!);
    if (!isNaN(n) && n >= 0 && n <= 10) return n;
  }

  return null;
}

// ── Result Normalisation ──────────────────────────────────────────────────────

/**
 * Map an extracted listing item to a HotelResult, tagged with the source name.
 */
function normaliseToHotelResult(
  item: { title?: string; price?: string; rating?: string; link?: string; image?: string; description?: string; [key: string]: string | undefined },
  sourceName: string,
): HotelResult | null {
  const name = item.title?.trim();
  if (!name) return null;

  const priceDisplay = item.price ?? '';
  const ratingDisplay = item.rating ?? '';

  return {
    name,
    price: parsePrice(priceDisplay),
    priceDisplay,
    rating: parseRating(ratingDisplay),
    ratingDisplay,
    source: sourceName,
    link: item.link ?? '',
    location: item.description?.trim() || undefined,
    image: item.image || undefined,
  };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Deduplicate hotel results by name (case-insensitive).
 * When duplicates exist, keep the one with the most data (price + rating),
 * with lowest price as a tiebreaker.
 */
export function deduplicateHotels(hotels: HotelResult[]): HotelResult[] {
  const byName = new Map<string, HotelResult>();

  for (const hotel of hotels) {
    const key = hotel.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, hotel);
      continue;
    }

    // Score = number of non-null data fields
    const scoreNew = (hotel.price !== null ? 1 : 0) + (hotel.rating !== null ? 1 : 0);
    const scoreOld = (existing.price !== null ? 1 : 0) + (existing.rating !== null ? 1 : 0);

    if (scoreNew > scoreOld) {
      byName.set(key, hotel);
    } else if (scoreNew === scoreOld) {
      // Tiebreak: prefer the one with lower price (or keep existing if equal)
      if (hotel.price !== null && (existing.price === null || hotel.price < existing.price)) {
        byName.set(key, hotel);
      }
    }
  }

  return Array.from(byName.values());
}

// ── Sorting ───────────────────────────────────────────────────────────────────

/**
 * Sort hotel results.
 * - price: ascending, nulls last
 * - rating: descending, nulls last
 * - value: rating/price ratio, descending, nulls last
 */
export function sortHotels(hotels: HotelResult[], sort: 'price' | 'rating' | 'value'): HotelResult[] {
  const sorted = [...hotels];

  switch (sort) {
    case 'price':
      sorted.sort((a, b) => {
        if (a.price === null && b.price === null) return 0;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      });
      break;

    case 'rating':
      sorted.sort((a, b) => {
        if (a.rating === null && b.rating === null) return 0;
        if (a.rating === null) return 1;
        if (b.rating === null) return -1;
        return b.rating - a.rating;
      });
      break;

    case 'value': {
      const valueOf = (h: HotelResult): number | null => {
        if (h.price === null || h.price === 0 || h.rating === null) return null;
        return h.rating / h.price;
      };
      sorted.sort((a, b) => {
        const va = valueOf(a);
        const vb = valueOf(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
      break;
    }
  }

  return sorted;
}

// ── Main Function ─────────────────────────────────────────────────────────────

const DEFAULT_SOURCES = ['kayak', 'booking', 'google', 'expedia'];
const SIMPLE_TIMEOUT = 15_000;
const BROWSER_TIMEOUT = 30_000;
const EXPEDIA_TIMEOUT = 60_000;

/**
 * Search multiple travel sites for hotels and return sorted, deduplicated results.
 */
export async function searchHotels(options: HotelSearchOptions): Promise<HotelSearchResult> {
  const startTime = Date.now();

  // ── Parse dates ────────────────────────────────────────────────────────────
  const checkin = parseDate(options.checkin);
  const rawCheckout = options.checkout;
  const checkout = rawCheckout ? parseDate(rawCheckout) : addDays(checkin, 1);

  const destination = options.destination;
  const sort = options.sort ?? 'price';
  const limit = options.limit ?? 20;
  const allowedSources = new Set((options.sources ?? DEFAULT_SOURCES).map(s => s.toLowerCase()));
  const useGlobalStealth = options.stealth ?? false;

  // ── Build source URLs ──────────────────────────────────────────────────────
  const allSourceUrls = buildSourceUrls(destination, checkin, checkout).filter(s =>
    allowedSources.has(s.name),
  );

  // ── Fetch all sources in parallel ──────────────────────────────────────────
  const settled = await Promise.allSettled(
    allSourceUrls.map(async (src) => {
      const isKayak = src.name === 'kayak';
      const isBooking = src.name === 'booking';
      const isExpedia = src.name === 'expedia';

      const useStealth = useGlobalStealth || isKayak || isExpedia;
      const useRender = useStealth || isBooking;
      const timeout = isExpedia ? EXPEDIA_TIMEOUT : (useRender ? BROWSER_TIMEOUT : SIMPLE_TIMEOUT);

      // Expedia is a SPA — wait for property listings to appear before extracting
      const actions: PageAction[] | undefined = isExpedia
        ? [{ type: 'waitForSelector', selector: "[data-stid='property-listing'], li.uitk-spacing" }]
        : undefined;

      const result = await peel(src.url, {
        format: 'html',
        render: useRender,
        stealth: useStealth,
        timeout,
        ...(actions ? { actions } : {}),
      });

      // Prefer CSS schema extraction when a schema is available for this source
      const schema = findSchemaForUrl(src.url);
      const hotels: HotelResult[] = [];

      if (schema) {
        const schemaItems = extractWithSchema(result.content, schema, src.url);
        for (const item of schemaItems) {
          const mapped = {
            title: typeof item.title === 'string' ? item.title : undefined,
            price: typeof item.price === 'string' ? item.price : undefined,
            rating: typeof item.rating === 'string' ? item.rating : undefined,
            link: typeof item.link === 'string' ? item.link : undefined,
            image: typeof item.image === 'string' ? item.image : undefined,
            description: typeof item.location === 'string' ? item.location : undefined,
          };
          const hotel = normaliseToHotelResult(mapped, src.name);
          if (hotel) hotels.push(hotel);
        }
      }

      // Fall back to generic extraction if schema yielded nothing
      if (hotels.length === 0) {
        const listings = extractListings(result.content, src.url);
        for (const item of listings) {
          const hotel = normaliseToHotelResult(item, src.name);
          if (hotel) hotels.push(hotel);
        }
      }

      return { name: src.name, hotels };
    }),
  );

  // ── Collect per-source status and results ──────────────────────────────────
  const sourceStats: HotelSearchResult['sources'] = [];
  const allHotels: HotelResult[] = [];

  for (let i = 0; i < allSourceUrls.length; i++) {
    const src = allSourceUrls[i]!;
    const outcome = settled[i]!;

    if (outcome.status === 'fulfilled') {
      const { hotels } = outcome.value;
      sourceStats.push({ name: src.name, count: hotels.length, status: 'ok' });
      allHotels.push(...hotels);
    } else {
      const errMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      const isBlocked =
        errMsg.toLowerCase().includes('blocked') ||
        errMsg.toLowerCase().includes('403') ||
        errMsg.toLowerCase().includes('cloudflare');
      sourceStats.push({
        name: src.name,
        count: 0,
        status: isBlocked ? 'blocked' : 'error',
        error: errMsg,
      });
    }
  }

  // ── Deduplicate, sort, limit ───────────────────────────────────────────────
  const unique = deduplicateHotels(allHotels);
  const sorted = sortHotels(unique, sort);
  const results = sorted.slice(0, limit);

  const elapsed = Date.now() - startTime;

  return {
    destination,
    checkin,
    checkout,
    totalResults: results.length,
    results,
    sources: sourceStats,
    elapsed,
  };
}
