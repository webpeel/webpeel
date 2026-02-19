/**
 * Tests for the hotel-search module.
 *
 * All tests use pure helper functions — no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDate,
  addDays,
  toKayakSlug,
  buildSourceUrls,
  parsePrice,
  parseRating,
  deduplicateHotels,
  sortHotels,
  type HotelResult,
} from '../core/hotel-search.js';

// ── Date parsing ─────────────────────────────────────────────────────────────

describe('parseDate', () => {
  // Fixed "today" for deterministic tests: 2026-02-18 (Wednesday)
  const BASE = new Date('2026-02-18T12:00:00Z');

  it('returns ISO date unchanged', () => {
    expect(parseDate('2026-02-20', BASE)).toBe('2026-02-20');
  });

  it('handles "today"', () => {
    expect(parseDate('today', BASE)).toBe('2026-02-18');
  });

  it('handles "tomorrow"', () => {
    expect(parseDate('tomorrow', BASE)).toBe('2026-02-19');
  });

  it('handles "next friday" from Wednesday', () => {
    // Base is Wednesday 2026-02-18; next Friday = 2026-02-20
    expect(parseDate('next friday', BASE)).toBe('2026-02-20');
  });

  it('handles "next monday" from Wednesday', () => {
    // Next Monday from Wed 2026-02-18 = 2026-02-23
    expect(parseDate('next monday', BASE)).toBe('2026-02-23');
  });

  it('handles "next sunday" from Wednesday', () => {
    // Next Sunday from Wed 2026-02-18 = 2026-02-22
    expect(parseDate('next sunday', BASE)).toBe('2026-02-22');
  });

  it('handles "next wednesday" (same weekday → 7 days ahead)', () => {
    // From Wednesday: same day → skip to next week (7 days)
    expect(parseDate('next wednesday', BASE)).toBe('2026-02-25');
  });

  it('throws on unrecognised date string', () => {
    expect(() => parseDate('not-a-date', BASE)).toThrow(/Unrecognized date format/);
  });

  it('is case-insensitive for relative strings', () => {
    expect(parseDate('Tomorrow', BASE)).toBe('2026-02-19');
    expect(parseDate('TOMORROW', BASE)).toBe('2026-02-19');
    expect(parseDate('Next Friday', BASE)).toBe('2026-02-20');
  });
});

describe('addDays', () => {
  it('adds 1 day', () => {
    expect(addDays('2026-02-18', 1)).toBe('2026-02-19');
  });

  it('crosses month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('adds 7 days', () => {
    expect(addDays('2026-02-18', 7)).toBe('2026-02-25');
  });
});

// ── URL building ──────────────────────────────────────────────────────────────

describe('toKayakSlug', () => {
  it('converts single-part destination', () => {
    expect(toKayakSlug('Manhattan')).toBe('Manhattan');
  });

  it('replaces spaces with hyphens within each part', () => {
    expect(toKayakSlug('Long Island City')).toBe('Long-Island-City');
  });

  it('preserves comma and processes each part separately', () => {
    expect(toKayakSlug('Manhattan, New York')).toBe('Manhattan,New-York');
  });

  it('handles multi-word city and state', () => {
    expect(toKayakSlug('Long Island City, New York')).toBe('Long-Island-City,New-York');
  });
});

describe('buildSourceUrls', () => {
  const checkin = '2026-02-20';
  const checkout = '2026-02-21';

  it('returns kayak, booking, and google URLs', () => {
    const urls = buildSourceUrls('Manhattan', checkin, checkout);
    const names = urls.map(u => u.name);
    expect(names).toContain('kayak');
    expect(names).toContain('booking');
    expect(names).toContain('google');
  });

  it('builds correct Kayak URL', () => {
    const urls = buildSourceUrls('Manhattan', checkin, checkout);
    const kayak = urls.find(u => u.name === 'kayak');
    expect(kayak).toBeDefined();
    expect(kayak!.url).toBe(`https://www.kayak.com/hotels/Manhattan/${checkin}/${checkout}?sort=price_a`);
  });

  it('builds correct Booking.com URL', () => {
    const urls = buildSourceUrls('Manhattan', checkin, checkout);
    const booking = urls.find(u => u.name === 'booking');
    expect(booking).toBeDefined();
    expect(booking!.url).toContain('booking.com/searchresults.html');
    expect(booking!.url).toContain('checkin=' + checkin);
    expect(booking!.url).toContain('checkout=' + checkout);
    expect(booking!.url).toContain('order=price');
  });

  it('builds correct Google Travel URL', () => {
    const urls = buildSourceUrls('Manhattan', checkin, checkout);
    const google = urls.find(u => u.name === 'google');
    expect(google).toBeDefined();
    expect(google!.url).toContain('google.com/travel/hotels/');
    expect(google!.url).toContain('Manhattan');
  });

  it('encodes destination with spaces in Booking.com URL', () => {
    const urls = buildSourceUrls('New York City', checkin, checkout);
    const booking = urls.find(u => u.name === 'booking');
    expect(booking!.url).toContain('New%20York%20City');
  });

  it('replaces spaces with + in Google URL', () => {
    const urls = buildSourceUrls('New York City', checkin, checkout);
    const google = urls.find(u => u.name === 'google');
    expect(google!.url).toContain('New+York+City');
  });
});

// ── Price parsing ─────────────────────────────────────────────────────────────

describe('parsePrice', () => {
  it('parses USD dollar sign', () => {
    expect(parsePrice('$119')).toBe(119);
  });

  it('parses with comma separators', () => {
    expect(parsePrice('$1,299')).toBe(1299);
  });

  it('parses GBP pounds', () => {
    expect(parsePrice('£85')).toBe(85);
  });

  it('parses EUR euros', () => {
    expect(parsePrice('€95')).toBe(95);
  });

  it('parses "US$200" prefix', () => {
    expect(parsePrice('US$200')).toBe(200);
  });

  it('parses bare number string', () => {
    expect(parsePrice('150')).toBe(150);
  });

  it('returns null for empty string', () => {
    expect(parsePrice('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parsePrice('Call for rates')).toBeNull();
  });

  it('parses price with surrounding text', () => {
    expect(parsePrice('From $89/night')).toBe(89);
  });
});

// ── Rating parsing ────────────────────────────────────────────────────────────

describe('parseRating', () => {
  it('parses "Scored 8.4"', () => {
    expect(parseRating('Scored 8.4')).toBe(8.4);
  });

  it('parses "4.2/5"', () => {
    expect(parseRating('4.2/5')).toBe(4.2);
  });

  it('parses "4.2/5 (1.4K reviews)"', () => {
    expect(parseRating('4.2/5 (1.4K reviews)')).toBe(4.2);
  });

  it('parses standalone "8.3"', () => {
    expect(parseRating('8.3')).toBe(8.3);
  });

  it('parses "Very Good 8.6"', () => {
    expect(parseRating('Very Good 8.6')).toBe(8.6);
  });

  it('parses "9.0/10"', () => {
    expect(parseRating('9.0/10')).toBe(9.0);
  });

  it('returns null for empty string', () => {
    expect(parseRating('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseRating('No rating yet')).toBeNull();
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

function makeHotel(partial: Partial<HotelResult>): HotelResult {
  return {
    name: partial.name ?? 'Test Hotel',
    price: partial.price ?? null,
    priceDisplay: partial.priceDisplay ?? '',
    rating: partial.rating ?? null,
    ratingDisplay: partial.ratingDisplay ?? '',
    source: partial.source ?? 'kayak',
    link: partial.link ?? '',
    location: partial.location,
    image: partial.image,
  };
}

describe('deduplicateHotels', () => {
  it('returns unique hotels when no duplicates', () => {
    const hotels = [
      makeHotel({ name: 'Hotel A' }),
      makeHotel({ name: 'Hotel B' }),
    ];
    expect(deduplicateHotels(hotels)).toHaveLength(2);
  });

  it('removes exact-name duplicates keeping the richer entry', () => {
    const hotels = [
      makeHotel({ name: 'Grand Hotel', price: null, rating: null, source: 'kayak' }),
      makeHotel({ name: 'Grand Hotel', price: 150, rating: 8.5, source: 'booking' }),
    ];
    const result = deduplicateHotels(hotels);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('booking');
    expect(result[0]!.price).toBe(150);
  });

  it('keeps the entry with lower price on tie', () => {
    const hotels = [
      makeHotel({ name: 'Grand Hotel', price: 200, rating: 8.5, source: 'kayak' }),
      makeHotel({ name: 'Grand Hotel', price: 150, rating: 8.0, source: 'booking' }),
    ];
    const result = deduplicateHotels(hotels);
    expect(result).toHaveLength(1);
    expect(result[0]!.price).toBe(150);
  });

  it('deduplicates case-insensitively', () => {
    const hotels = [
      makeHotel({ name: 'grand hotel', price: 100, source: 'kayak' }),
      makeHotel({ name: 'Grand Hotel', price: 90, source: 'booking' }),
    ];
    const result = deduplicateHotels(hotels);
    expect(result).toHaveLength(1);
  });

  it('deduplicates with extra whitespace normalisation', () => {
    const hotels = [
      makeHotel({ name: 'Hotel  A', source: 'kayak' }),
      makeHotel({ name: 'Hotel A', source: 'booking' }),
    ];
    expect(deduplicateHotels(hotels)).toHaveLength(1);
  });
});

// ── Sorting ───────────────────────────────────────────────────────────────────

describe('sortHotels', () => {
  const hotels: HotelResult[] = [
    makeHotel({ name: 'Cheap No Rating', price: 50, rating: null }),
    makeHotel({ name: 'Expensive High Rating', price: 200, rating: 9.5 }),
    makeHotel({ name: 'Mid Price Mid Rating', price: 120, rating: 7.0 }),
    makeHotel({ name: 'No Price Good Rating', price: null, rating: 8.5 }),
  ];

  it('sorts by price ascending, nulls last', () => {
    const sorted = sortHotels(hotels, 'price');
    expect(sorted[0]!.name).toBe('Cheap No Rating');
    expect(sorted[1]!.name).toBe('Mid Price Mid Rating');
    expect(sorted[2]!.name).toBe('Expensive High Rating');
    expect(sorted[3]!.name).toBe('No Price Good Rating');
  });

  it('sorts by rating descending, nulls last', () => {
    const sorted = sortHotels(hotels, 'rating');
    expect(sorted[0]!.name).toBe('Expensive High Rating');
    expect(sorted[1]!.name).toBe('No Price Good Rating');
    expect(sorted[2]!.name).toBe('Mid Price Mid Rating');
    expect(sorted[3]!.name).toBe('Cheap No Rating'); // null rating goes last
  });

  it('sorts by value (rating/price) descending, nulls last', () => {
    // Expensive High Rating: 9.5/200 = 0.0475
    // Mid Price Mid Rating: 7.0/120 = 0.0583 (highest value!)
    // Cheap No Rating: no rating → null
    // No Price Good Rating: no price → null
    const sorted = sortHotels(hotels, 'value');
    expect(sorted[0]!.name).toBe('Mid Price Mid Rating');
    expect(sorted[1]!.name).toBe('Expensive High Rating');
    // nulls last
    expect(sorted[2]!.name === 'Cheap No Rating' || sorted[2]!.name === 'No Price Good Rating').toBe(true);
    expect(sorted[3]!.name === 'Cheap No Rating' || sorted[3]!.name === 'No Price Good Rating').toBe(true);
  });

  it('does not mutate the original array', () => {
    const origFirst = hotels[0]!.name;
    sortHotels(hotels, 'price');
    expect(hotels[0]!.name).toBe(origFirst);
  });
});

// ── searchHotels (mocked) ─────────────────────────────────────────────────────

describe('searchHotels (mocked)', () => {
  beforeEach(() => {
    vi.mock('../index.js', () => ({
      peel: vi.fn().mockResolvedValue({
        content: '<html><body><ul><li><a href="/hotel-a">Cozy Inn — $89</a></li></ul></body></html>',
        url: 'https://example.com',
        title: 'Test',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
        quality: 0.8,
        fingerprint: 'abc123',
        contentType: 'html',
      }),
    }));

    vi.mock('../core/extract-listings.js', () => ({
      extractListings: vi.fn().mockReturnValue([
        { title: 'Cozy Inn', price: '$89', link: '/hotel-a', rating: '8.2' },
        { title: 'Budget Hotel', price: '$65', link: '/hotel-b', rating: '' },
      ]),
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns a valid HotelSearchResult structure', async () => {
    const { searchHotels } = await import('../core/hotel-search.js');

    const result = await searchHotels({
      destination: 'Manhattan',
      checkin: '2026-02-20',
      checkout: '2026-02-21',
      sources: ['booking'],
    });

    expect(result).toHaveProperty('destination', 'Manhattan');
    expect(result).toHaveProperty('checkin', '2026-02-20');
    expect(result).toHaveProperty('checkout', '2026-02-21');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('sources');
    expect(result).toHaveProperty('elapsed');
    expect(Array.isArray(result.results)).toBe(true);
    expect(Array.isArray(result.sources)).toBe(true);
  });

  it('auto-calculates checkout when not provided', async () => {
    const { searchHotels } = await import('../core/hotel-search.js');

    const result = await searchHotels({
      destination: 'Manhattan',
      checkin: '2026-02-20',
      sources: ['booking'],
    });

    expect(result.checkout).toBe('2026-02-21');
  });

  it('respects the sources filter', async () => {
    const { searchHotels } = await import('../core/hotel-search.js');

    const result = await searchHotels({
      destination: 'Manhattan',
      checkin: '2026-02-20',
      checkout: '2026-02-21',
      sources: ['booking'],
    });

    const sourceNames = result.sources.map(s => s.name);
    expect(sourceNames).toContain('booking');
    expect(sourceNames).not.toContain('kayak');
    expect(sourceNames).not.toContain('google');
  });
});
