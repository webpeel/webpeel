import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// eBay extractor — clean up noisy search results
// ---------------------------------------------------------------------------

export async function ebayExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    const u = new URL(url);

    // Individual item page
    if (u.pathname.startsWith('/itm/')) {
      const title = $('h1').first().text().trim();
      if (!title) return null;

      const price = $('[class*="price"]').not('[class*="shipping"]').first().text().trim();
      const condition = $('[class*="condition"]').first().text().trim();

      return {
        domain: 'ebay.com',
        type: 'listing',
        structured: { title, price, condition, url },
        cleanContent: [
          `# 🛍 ${title}`,
          price && `**Price:** ${price}`,
          condition && `**Condition:** ${condition}`,
          `\n[View on eBay](${url})`,
        ].filter(Boolean).join('\n'),
      };
    }

    // Search results page
    const keyword = u.searchParams.get('_nkw') || '';
    const maxPrice = u.searchParams.get('_udhi') || '';
    const minPrice = u.searchParams.get('_udlo') || '';

    const listings: Array<Record<string, string>> = [];

    // eBay search results use li[data-listingid] + .s-card__title / .s-card__price
    $('li[data-listingid]').each((_: any, el: any) => {
      const titleRaw = $(el).find('.s-card__title').text().trim()
        .replace(/Opens in a new window or tab/g, '')
        .replace(/^New Listing\s*/i, '')
        .trim();
      if (!titleRaw || titleRaw === 'Shop on eBay') return;
      const title = titleRaw;

      const price = $(el).find('.s-card__price').first().text().trim();
      // .s-card__subtitle contains "DealerNameCondition" as merged text — extract condition keyword
      const subtitleText = $(el).find('.s-card__subtitle').text().trim();
      const conditionKeywords = ['Pre-Owned', 'Brand New', 'Open Box', 'Refurbished', 'For Parts'];
      const condition = conditionKeywords.find((k) => subtitleText.includes(k)) || '';

      // Get clean URL — extract /itm/<id> and strip tracking params
      let href = '';
      const itemLink = $(el).find('a[href*="/itm/"]').first().attr('href') || '';
      const itmMatch = itemLink.match(/(https?:\/\/[^/]*\/itm\/\d+)/);
      if (itmMatch) href = itmMatch[1];
      const listingId = $(el).attr('data-listingid') || '';
      if (!href && listingId) href = `https://www.ebay.com/itm/${listingId}`;

      listings.push({ title, price, condition, url: href });
    });

    if (listings.length === 0) return null; // Let pipeline handle it

    const priceRange = [minPrice && `$${minPrice}`, maxPrice && `$${maxPrice}`].filter(Boolean).join(' – ');
    const header = [
      `# 🛍 eBay — ${keyword || 'Search Results'}`,
      '',
      keyword && `**Search:** ${keyword}`,
      priceRange && `**Price:** up to $${maxPrice}`,
      `**Results:** ${listings.length} listings`,
      '',
    ].filter(Boolean).join('\n');

    const rows = listings.slice(0, 20).map((l, i) => {
      const parts = [
        `${i + 1}. **${l.title}**`,
        l.price,
        l.condition && `[${l.condition}]`,
        l.url && `[→](${l.url})`,
      ].filter(Boolean);
      return parts.join(' · ');
    });

    return {
      domain: 'ebay.com',
      type: 'search',
      structured: { keyword, minPrice, maxPrice, count: listings.length, listings },
      cleanContent: header + rows.join('\n'),
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'eBay extractor error:', e instanceof Error ? e.message : e);
    return null;
  }
}

