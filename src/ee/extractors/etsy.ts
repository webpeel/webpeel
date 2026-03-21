import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Etsy extractor (bot-block fallback with Google site-search suggestion)
// ---------------------------------------------------------------------------

export async function etsyExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const u = new URL(url);

  // Extract search query from various URL patterns
  // /search?q=handmade+jewelry  OR  /search/handmade-jewelry
  let query = u.searchParams.get('q') || '';
  if (!query) {
    const pathMatch = u.pathname.match(/\/search\/([^?#]+)/);
    if (pathMatch) query = decodeURIComponent(pathMatch[1].replace(/-/g, ' '));
  }
  // Shop page: /shop/ShopName
  const shopMatch = u.pathname.match(/^\/shop\/([^/?#]+)/);
  const shopName = shopMatch?.[1] || '';

  if (!query && !shopName) return null;

  const googleUrl = query
    ? `https://www.google.com/search?q=site:etsy.com+${encodeURIComponent(query)}`
    : `https://www.google.com/search?q=site:etsy.com+${encodeURIComponent(shopName)}`;
  const etsySearchUrl = query ? `https://www.etsy.com/search?q=${encodeURIComponent(query)}` : url;

  const displayTitle = query ? `"${query}"` : `Shop: ${shopName}`;

  const cleanContent = [
    `# 🎨 Etsy — ${displayTitle}`,
    '',
    '> ⚠️ Etsy blocks automated access. WebPeel cannot scrape listings directly.',
    '',
    '**Alternatives that work:**',
    `- \`webpeel "${googleUrl}"\` — Google site:etsy.com results`,
    `- Direct link: [etsy.com/search?q=${encodeURIComponent(query || shopName)}](${etsySearchUrl})`,
    '',
    ...(query ? [
      '**Similar items on open marketplaces:**',
      `- \`webpeel "https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_BIN=1"\` — eBay`,
      `- \`webpeel "https://newyork.craigslist.org/search/sss?query=${encodeURIComponent(query)}"\` — Craigslist`,
    ] : []),
    '',
    '*Etsy Open API v3 (free key at etsy.com/developers) can unlock direct access.*',
  ].join('\n');

  return {
    domain: 'etsy.com',
    type: 'blocked',
    structured: {
      query,
      shopName,
      reason: 'bot-block',
      googleFallback: googleUrl,
    },
    cleanContent,
  };
}

