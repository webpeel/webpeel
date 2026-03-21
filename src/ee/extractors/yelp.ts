import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Yelp extractor — parse JSON-LD + meta from stealth-rendered HTML
// ---------------------------------------------------------------------------

export async function yelpExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const YELP_API_KEY = process.env.YELP_API_KEY;

  // Helper to call Yelp Fusion API
  async function yelpFetch(path: string, params?: Record<string, string>): Promise<any> {
    const base = 'https://api.yelp.com/v3';
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(`${base}${path}${qs}`, {
      headers: { 'Authorization': `Bearer ${YELP_API_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Yelp API ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const searchParams = parsed.searchParams;

    // ----------------------------------------------------------------
    // If no API key, fall back to the legacy HTML-scraping approach
    // ----------------------------------------------------------------
    if (!YELP_API_KEY) {
      // Legacy fallback: minimal result pointing user to Yelp
      const term = searchParams.get('find_desc') || searchParams.get('cflt') || 'businesses';
      const loc = searchParams.get('find_loc') || '';
      const isBiz = pathname.startsWith('/biz/');
      const cleanContent = isBiz
        ? `# Yelp Business\n\n*No YELP_API_KEY configured — visit [Yelp](${url}) for details.*`
        : `# 🔍 Yelp Search: ${term}${loc ? ` in ${loc}` : ''}\n\n*No YELP_API_KEY configured — [View on Yelp](${url})*`;
      return {
        domain: 'yelp.com',
        type: isBiz ? 'business' : 'search',
        structured: { url },
        cleanContent,
      };
    }

    // ----------------------------------------------------------------
    // Business page: /biz/<alias>
    // ----------------------------------------------------------------
    if (pathname.startsWith('/biz/')) {
      const alias = pathname.replace('/biz/', '').split('?')[0].split('#')[0];

      let biz: any;
      try {
        biz = await yelpFetch(`/businesses/${alias}`);
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel] Yelp biz fetch failed:', e instanceof Error ? e.message : e);
        return null;
      }

      // Fetch reviews (best-effort)
      let reviews: any[] = [];
      try {
        const revData = await yelpFetch(`/businesses/${alias}/reviews`, { limit: '3' });
        reviews = revData.reviews || [];
      } catch { /* reviews are optional */ }

      const name = biz.name || alias;
      const rating = biz.rating != null ? biz.rating.toFixed(1) : '?';
      const reviewCount = biz.review_count ?? 0;
      const addr = biz.location;
      const address = addr
        ? [addr.address1, addr.city, addr.state, addr.zip_code].filter(Boolean).join(', ')
        : '';
      const phone = biz.display_phone || biz.phone || '';
      const price = biz.price || '';
      const categories = (biz.categories || []).map((c: any) => c.title).join(' | ');
      const yelpUrl = biz.url || url;

      // Hours
      let hoursStr = '';
      if (biz.hours && biz.hours.length > 0) {
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dayMap: Record<number, string[]> = {};
        for (const slot of biz.hours[0].open || []) {
          const fmt = (t: string) => {
            const h = parseInt(t.slice(0, 2), 10);
            const m = t.slice(2);
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${m} ${period}`;
          };
          const day = slot.day as number;
          if (!dayMap[day]) dayMap[day] = [];
          dayMap[day].push(`${fmt(slot.start)}–${fmt(slot.end)}`);
        }
        hoursStr = Object.entries(dayMap)
          .map(([d, times]) => `${dayNames[parseInt(d, 10)]}: ${times.join(', ')}`)
          .join(' | ');
      }

      const lines: string[] = [
        `# ${name} ⭐ ${rating} (${reviewCount.toLocaleString()} reviews)`,
        '',
      ];
      if (address) lines.push(`📍 ${address}`);
      if (categories) lines.push(`🏷️ ${categories}${price ? ` | 💰 ${price}` : ''}`);
      else if (price) lines.push(`💰 ${price}`);
      if (phone) lines.push(`📞 ${phone}`);
      if (hoursStr) lines.push(`🕐 ${hoursStr}`);
      if (biz.is_closed === true) lines.push(`⚠️ *Permanently closed*`);
      lines.push('');

      if (reviews.length > 0) {
        for (const rev of reviews) {
          const stars = '⭐'.repeat(Math.round(rev.rating || 0));
          const text = (rev.text || '').replace(/\n+/g, ' ').trim().slice(0, 200);
          lines.push(`> ${stars} — ${text}${(rev.text || '').length > 200 ? '…' : ''}`);
          lines.push('');
        }
      }

      lines.push(`[View on Yelp](${yelpUrl})`);

      return {
        domain: 'yelp.com',
        type: 'business',
        structured: { name, rating: parseFloat(rating), reviewCount, address, phone, price, categories, url: yelpUrl },
        cleanContent: lines.join('\n'),
      };
    }

    // ----------------------------------------------------------------
    // Search / Category URL: /search?find_desc=...&find_loc=...
    //                        /search?cflt=restaurants&find_loc=...
    // ----------------------------------------------------------------
    const findDesc = searchParams.get('find_desc') || '';
    const cflt = searchParams.get('cflt') || '';
    const findLoc = searchParams.get('find_loc') || '';

    if (!findLoc && !findDesc && !cflt) {
      // Not a recognized pattern
      return null;
    }

    const apiParams: Record<string, string> = { limit: '10' };
    if (findLoc) apiParams.location = findLoc;
    if (findDesc) apiParams.term = findDesc;
    if (cflt && !findDesc) apiParams.categories = cflt;

    let data: any;
    try {
      data = await yelpFetch('/businesses/search', apiParams);
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel] Yelp search failed:', e instanceof Error ? e.message : e);
      return null;
    }

    const businesses: any[] = data.businesses || [];
    const total = data.total ?? businesses.length;

    // Build header
    const searchLabel = findDesc || cflt || 'Businesses';
    const locationLabel = findLoc || '';
    const emoji = cflt === 'restaurants' || findDesc?.toLowerCase().includes('restaurant') ? '🍽️'
      : findDesc?.toLowerCase().includes('pizza') ? '🍕'
      : findDesc?.toLowerCase().includes('coffee') || findDesc?.toLowerCase().includes('cafe') ? '☕'
      : findDesc?.toLowerCase().includes('bar') ? '🍺'
      : '🔍';

    const titleParts = [searchLabel.charAt(0).toUpperCase() + searchLabel.slice(1)];
    if (locationLabel) titleParts.push(`in ${locationLabel}`);

    const lines: string[] = [
      `# ${emoji} Yelp — ${titleParts.join(' ')}`,
      '',
      `*${businesses.length} of ${total.toLocaleString()} results via Yelp Fusion API*`,
      '',
    ];

    for (let i = 0; i < businesses.length; i++) {
      const b = businesses[i];
      const bName = b.name || 'Unknown';
      const bRating = b.rating != null ? b.rating.toFixed(1) : '?';
      const bReviews = b.review_count ?? 0;
      const bAddr = b.location;
      const bAddress = bAddr
        ? [bAddr.address1, bAddr.city, bAddr.state, bAddr.zip_code].filter(Boolean).join(', ')
        : '';
      const bPhone = b.display_phone || '';
      const bPrice = b.price || '';
      const bCategories = (b.categories || []).map((c: any) => c.title).join(' | ');
      const bUrl = b.url || '';
      const bSnippet = b.snippet_text || '';

      lines.push(`## ${i + 1}. ${bName} ⭐ ${bRating} (${bReviews.toLocaleString()} reviews)`);
      if (bAddress) lines.push(`📍 ${bAddress}`);
      const tagLine = [bCategories && `🏷️ ${bCategories}`, bPrice && `💰 ${bPrice}`].filter(Boolean).join(' | ');
      if (tagLine) lines.push(tagLine);
      if (bPhone) lines.push(`📞 ${bPhone}`);
      if (bSnippet) lines.push(`> ${bSnippet.replace(/\n+/g, ' ').trim().slice(0, 150)}`);
      if (bUrl) lines.push(`[View on Yelp](${bUrl})`);
      lines.push('');
    }

    if (businesses.length === 0) {
      lines.push(`*No results found for "${searchLabel}"${locationLabel ? ` in ${locationLabel}` : ''}.*`);
    }

    return {
      domain: 'yelp.com',
      type: 'search',
      structured: { query: searchLabel, location: locationLabel, total, count: businesses.length, businesses },
      cleanContent: lines.join('\n'),
    };

  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Yelp extractor error:', e instanceof Error ? e.message : e);
    return null;
  }
}

