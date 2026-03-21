import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Facebook Marketplace extractor (login-wall fallback)
// ---------------------------------------------------------------------------

export async function facebookMarketplaceExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const u = new URL(url);
  if (!u.pathname.includes('/marketplace')) return null;

  const query = u.searchParams.get('query') || '';
  const maxPrice = u.searchParams.get('maxPrice') || '';
  const minPrice = u.searchParams.get('minPrice') || '';
  // Extract location segment: /marketplace/nyc/search → "nyc"
  const locationMatch = u.pathname.match(/\/marketplace\/([^/]+)(?:\/|$)/);
  const location = (locationMatch?.[1] && locationMatch[1] !== 'search' && locationMatch[1] !== 'category') ? locationMatch[1] : '';

  const priceRange = [minPrice && `$${minPrice}`, maxPrice && `$${maxPrice}`].filter(Boolean).join(' – ');

  const lines: string[] = [
    `# 🛒 Facebook Marketplace`,
    '',
    `**Search:** ${query || 'Browse all'}`,
    ...(location ? [`**Location:** ${location}`] : []),
    ...(priceRange ? [`**Price range:** ${priceRange}`] : []),
    '',
    '> ⚠️ Facebook Marketplace requires authentication. WebPeel cannot access listings directly.',
    '',
    '**Alternative searches that work:**',
  ];

  if (query) {
    const clUrl = `https://newyork.craigslist.org/search/sss?query=${encodeURIComponent(query)}${maxPrice ? '&max_price=' + maxPrice : ''}`;
    const carsUrl = `https://www.cars.com/shopping/results/?keyword=${encodeURIComponent(query)}&list_price_max=${maxPrice || ''}&zip=10001&stock_type=used`;
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}${maxPrice ? '&_udhi=' + maxPrice : ''}&LH_BIN=1`;
    lines.push(
      `- \`webpeel "${clUrl}"\` — Craigslist`,
      `- \`webpeel "${carsUrl}"\` — Cars.com`,
      `- \`webpeel "${ebayUrl}"\` — eBay`,
    );
  }

  lines.push('', '*Tip: Craigslist and Cars.com return full structured results with WebPeel.*');

  return {
    domain: 'facebook.com',
    type: 'blocked',
    structured: {
      query,
      location,
      minPrice,
      maxPrice,
      reason: 'authentication required',
      alternatives: ['craigslist', 'cars.com', 'ebay'],
    },
    cleanContent: lines.join('\n'),
  };
}

