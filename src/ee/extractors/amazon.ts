import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 12. Amazon Products extractor
// ---------------------------------------------------------------------------

export async function amazonExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Extract from JSON-LD first
    let jsonLdData: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLdData) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Product') jsonLdData = parsed;
    });

    // Meta tag fallbacks
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    // HTML selectors
    const title = jsonLdData?.name ||
      $('#productTitle').text().trim() ||
      $('#title').text().trim() ||
      ogTitle;

    if (!title) return null;

    const priceWhole = $('#priceblock_ourprice').text().trim() ||
      $('.a-price .a-offscreen').first().text().trim() ||
      $('[data-asin-price]').first().attr('data-asin-price') || '';

    const rating = jsonLdData?.aggregateRating?.ratingValue ||
      $('#acrPopover .a-size-base.a-color-base').first().text().trim() ||
      $('span[data-hook="rating-out-of-text"]').text().trim() || '';

    const reviewCount = jsonLdData?.aggregateRating?.reviewCount ||
      $('#acrCustomerReviewText').text().replace(/[^0-9,]/g, '').trim() || '';

    const availability = jsonLdData?.offers?.availability?.replace('https://schema.org/', '') ||
      $('#availability span').first().text().trim() || '';

    const description = jsonLdData?.description ||
      $('#feature-bullets .a-list-item').map((_: any, el: any) => $(el).text().trim()).get().join('\n') ||
      $('#productDescription p').text().trim() ||
      ogDescription;

    const features: string[] = [];
    $('#feature-bullets li').each((_: any, el: any) => {
      const text = $(el).text().trim();
      if (text && !text.includes('Make sure this fits')) features.push(text);
    });

    // ASIN from URL
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
    const asin = asinMatch?.[1] || '';

    const structured: Record<string, any> = {
      title,
      price: priceWhole,
      rating,
      reviewCount,
      availability,
      description,
      features,
      asin,
      image: ogImage,
      url,
    };

    const ratingLine = rating ? `\n**Rating:** ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}` : '';
    const priceLine = priceWhole ? `\n**Price:** ${priceWhole}` : '';
    const availLine = availability ? `\n**Availability:** ${availability}` : '';
    const featuresSection = features.length
      ? `\n\n## Features\n\n${features.map(f => `- ${f}`).join('\n')}`
      : '';
    const descSection = description ? `\n\n## Description\n\n${description.substring(0, 1000)}` : '';

    const cleanContent = `# 🛒 ${title}${priceLine}${ratingLine}${availLine}${descSection}${featuresSection}`;

    return { domain: 'amazon.com', type: 'product', structured, cleanContent };
  } catch {
    return null;
  }
}

