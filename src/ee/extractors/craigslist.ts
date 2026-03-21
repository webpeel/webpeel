import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// 20. Craigslist extractor
// ---------------------------------------------------------------------------

export async function craigslistExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Detect if it's a listing page or individual post
    // Individual post: /xxx/yyy/d/title/12345678.html
    const isPost = /\/d\/[^/]+\/\d+\.html/.test(path) || /\/\d{10,}\.html/.test(path);

    if (isPost) {
      const title = $('#titletextonly').text().trim() ||
        $('span#titletextonly').text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        $('h2.postingtitle').text().trim() || '';

      if (!title) return null;

      const price = $('.price').first().text().trim() ||
        $('[class*="price"]').first().text().trim() || '';

      const location = $('.postingtitletext small').text().trim().replace(/[()]/g, '') ||
        $('#map').attr('data-address') || '';

      const postDate = $('#display-date time').attr('datetime') ||
        $('time.date').first().attr('datetime') ||
        $('p.postinginfo time').first().attr('datetime') || '';

      // Body text
      const bodyEl = $('#postingbody');
      bodyEl.find('.print-information, .QR-code').remove();
      const bodyText = bodyEl.text().trim()
        .replace(/QR Code Link to This Post/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Images
      const images: string[] = [];
      $('img.slide').each((_: any, el: any) => {
        const src = $(el).attr('src') || '';
        if (src && !images.includes(src)) images.push(src);
      });
      $('img[id^="ii"]').each((_: any, el: any) => {
        const src = $(el).attr('src') || '';
        if (src && !images.includes(src)) images.push(src);
      });

      // Attributes
      const attrs: Record<string, string> = {};
      $('.attrgroup span').each((_: any, el: any) => {
        const text = $(el).text().trim();
        const parts = text.split(':');
        if (parts.length === 2) attrs[parts[0].trim()] = parts[1].trim();
      });

      const structured: Record<string, any> = {
        title, price, location, postDate,
        bodyText, images, attributes: attrs, url,
      };

      const priceLine = price ? `\n**Price:** ${price}` : '';
      const locationLine = location ? `\n**Location:** ${location}` : '';
      const dateLine = postDate ? `\n**Posted:** ${postDate.split('T')[0]}` : '';
      const attrsSection = Object.keys(attrs).length
        ? `\n\n## Details\n\n${Object.entries(attrs).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}`
        : '';
      const imagesLine = images.length ? `\n\n📷 ${images.length} image${images.length > 1 ? 's' : ''}` : '';

      const cleanContent = `# 📋 ${title}${priceLine}${locationLine}${dateLine}${attrsSection}${imagesLine}\n\n${bodyText.substring(0, 3000)}`;

      return { domain: 'craigslist.org', type: 'listing', structured, cleanContent };
    }

    // Listing page (search results)
    const pageTitle = $('title').text().trim() ||
      $('meta[property="og:title"]').attr('content') || 'Craigslist Listings';

    const listings: Array<Record<string, string>> = [];
    $('.result-row, li.cl-static-search-result, .cl-search-result').each((_: any, el: any) => {
      const titleEl = $(el).find('a.titlestring, a[class*="title"], .result-title').first();
      const postTitle = titleEl.text().trim();
      const postUrl = titleEl.attr('href') || '';
      const postPrice = $(el).find('.result-price, [class*="price"]').first().text().trim();
      const postHood = $(el).find('.result-hood, [class*="hood"]').first().text().trim().replace(/[()]/g, '');
      if (postTitle) {
        listings.push({ title: postTitle, url: postUrl, price: postPrice, location: postHood });
      }
    });

    if (!listings.length) return null;

    const structured: Record<string, any> = { pageTitle, listings, url };

    const listMd = listings.slice(0, 20).map((l, i) =>
      `${i + 1}. **${l.title}**${l.price ? ` — ${l.price}` : ''}${l.location ? ` (${l.location})` : ''}${l.url ? `\n   ${l.url}` : ''}`
    ).join('\n\n');

    const cleanContent = `# 📋 ${pageTitle}\n\n${listMd}`;

    return { domain: 'craigslist.org', type: 'search', structured, cleanContent };
  } catch {
    return null;
  }
}


