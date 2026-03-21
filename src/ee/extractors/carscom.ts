import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Cars.com extractor — structured parsing via data-vehicle-details JSON attrs
// ---------------------------------------------------------------------------

export async function carsComExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    const u = new URL(url);
    const keyword = u.searchParams.get('keyword') || '';
    const maxPrice = u.searchParams.get('list_price_max') || '';
    const minPrice = u.searchParams.get('list_price_min') || '';
    const zip = u.searchParams.get('zip') || '';
    const stockType = u.searchParams.get('stock_type') || '';

    // Individual vehicle detail page
    if (u.pathname.includes('/vehicledetail/')) {
      const title = $('h1').first().text().trim() ||
        $('title').text().trim().split(' | ')[0];
      if (!title) return null;

      const price = $('[class*="price"]').first().text().trim();
      const mileage = $('[class*="mileage"]').first().text().trim();

      return {
        domain: 'cars.com',
        type: 'listing',
        structured: { title, price, mileage, url },
        cleanContent: [
          `# 🚗 ${title}`,
          price && `**Price:** ${price}`,
          mileage && `**Mileage:** ${mileage}`,
          `\n[View listing](${url})`,
        ].filter(Boolean).join('\n'),
      };
    }

    // Search results page — Cars.com embeds JSON in fuse-card data-vehicle-details
    const listings: Array<Record<string, any>> = [];

    $('fuse-card[data-vehicle-details]').each((_: any, el: any) => {
      try {
        const raw = $(el).attr('data-vehicle-details');
        if (!raw) return;
        const v = JSON.parse(raw);
        const listingId = v.listingId || $(el).attr('data-listing-id') || '';
        const cardLink = $(el).find('card-gallery').attr('card-link') || (listingId ? `/vehicledetail/${listingId}/` : '');
        const title = `${v.stockType || 'Used'} ${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`.trim();
        const price = v.price ? `$${Number(v.price).toLocaleString()}` : '';
        const mileage = v.mileage ? `${Number(v.mileage).toLocaleString()} mi` : '';
        const bodyStyle = v.bodyStyle || '';
        const fuelType = v.fuelType || '';
        const sellerZip = v.seller?.zip || '';
        if (title && title !== 'Used  ') {
          listings.push({ title, price, mileage, bodyStyle, fuelType, url: cardLink, sellerZip });
        }
      } catch { /* skip malformed */ }
    });

    if (listings.length === 0) return null; // Let pipeline handle it

    // Extract dealer names from page HTML (text_style:"small", font_color:"grey")
    const dealerPattern = /"text":"([^"]{3,50})","on_click_interactions":\[\],"text_style":"small","font_color":"grey/g;
    const dealerNames: string[] = [];
    let _dm: RegExpExecArray | null;
    while ((_dm = dealerPattern.exec(html)) !== null) {
      const name = _dm[1];
      if (!name.match(/^\d|^Used|^New|mi\)|^Review|^\$/)) dealerNames.push(name);
    }

    // Extract locations: "City, ST (X mi)" (e.g., "Ridgefield, NJ (8 mi)")
    const locPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s[A-Z]{2}\s\(\d+\s*mi\))/g;
    const locationList: string[] = [];
    let _lm: RegExpExecArray | null;
    while ((_lm = locPattern.exec(html)) !== null) {
      locationList.push(_lm[1]);
    }

    // Match dealers and locations to listings (they appear in page order)
    for (let i = 0; i < listings.length; i++) {
      if (i < dealerNames.length) listings[i].dealer = dealerNames[i];
      if (i < locationList.length) listings[i].location = locationList[i];
    }

    const priceRange = [minPrice && `$${minPrice}`, maxPrice && `$${maxPrice}`].filter(Boolean).join(' – ');
    const header = [
      `# 🚗 Cars.com — ${keyword || 'Vehicle Search'}`,
      '',
      keyword && `**Search:** ${keyword}`,
      zip && `**Location:** ZIP ${zip}`,
      priceRange && `**Price:** up to $${maxPrice}`,
      stockType && `**Stock:** ${stockType}`,
      `**Results:** ${listings.length} listings`,
      '',
    ].filter(Boolean).join('\n');

    const rows = listings.slice(0, 20).map((l, i) => {
      const parts = [
        `${i + 1}. **${l.title}**`,
        l.price,
        l.mileage,
        l.bodyStyle,
      ].filter(Boolean);
      const line = parts.join(' · ');
      const details: string[] = [];
      if (l.location) details.push(`📍 ${l.location}`);
      if (l.dealer) details.push(`🏪 ${l.dealer}`);
      if (l.url) details.push(`🔗 [View listing](https://www.cars.com${l.url})`);
      return line + (details.length ? '\n   ' + details.join(' · ') : '');
    });

    return {
      domain: 'cars.com',
      type: 'search',
      structured: { keyword, zip, minPrice, maxPrice, stockType, count: listings.length, listings },
      cleanContent: header + rows.join('\n'),
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Cars.com extractor error:', e instanceof Error ? e.message : e);
    return null;
  }
}

