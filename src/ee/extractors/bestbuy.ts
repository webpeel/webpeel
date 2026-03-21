import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 10. Best Buy extractor (Best Buy Products API)
// ---------------------------------------------------------------------------

export async function bestBuyExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return null; // No API key, skip

  // Extract SKU from URL: /site/.../6587822.p → 6587822
  const skuMatch = url.match(/\/(\d{7,})\.p/);
  if (!skuMatch) return null;
  const sku = skuMatch[1];

  const apiUrl = `https://api.bestbuy.com/v1/products/${sku}.json?apiKey=${apiKey}&show=sku,name,salePrice,regularPrice,onSale,shortDescription,longDescription,image,largeFrontImage,url,customerReviewAverage,customerReviewCount,categoryPath,manufacturer,modelNumber,upc,freeShipping,inStoreAvailability,onlineAvailability,condition,features.feature`;

  try {
    const data = await fetchJson(apiUrl);
    if (!data || data.error) return null;

    // Build clean markdown
    const lines: string[] = [];
    lines.push(`# ${data.name}`);
    lines.push('');
    if (data.onSale) {
      lines.push(`**Sale Price:** $${data.salePrice} (was $${data.regularPrice})`);
    } else {
      lines.push(`**Price:** $${data.regularPrice}`);
    }
    lines.push(`**SKU:** ${data.sku}`);
    if (data.manufacturer) lines.push(`**Brand:** ${data.manufacturer}`);
    if (data.modelNumber) lines.push(`**Model:** ${data.modelNumber}`);
    if (data.customerReviewAverage) {
      lines.push(`**Rating:** ${data.customerReviewAverage}/5 (${data.customerReviewCount} reviews)`);
    }
    lines.push(`**Availability:** ${data.onlineAvailability ? 'In Stock Online' : 'Out of Stock Online'} | ${data.inStoreAvailability ? 'Available In Store' : 'Not Available In Store'}`);
    if (data.freeShipping) lines.push('**Free Shipping:** Yes');
    lines.push('');
    if (data.shortDescription) lines.push(data.shortDescription);
    lines.push('');
    if (data.longDescription) lines.push(data.longDescription);
    if (data.features?.feature) {
      lines.push('');
      lines.push('## Features');
      for (const f of data.features.feature) {
        lines.push(`- ${f}`);
      }
    }

    const structured = {
      sku: data.sku,
      name: data.name,
      price: data.salePrice || data.regularPrice,
      regularPrice: data.regularPrice,
      onSale: data.onSale,
      brand: data.manufacturer,
      model: data.modelNumber,
      upc: data.upc,
      rating: data.customerReviewAverage,
      reviewCount: data.customerReviewCount,
      image: data.largeFrontImage || data.image,
      url: data.url,
      inStock: data.onlineAvailability,
      freeShipping: data.freeShipping,
      condition: data.condition,
      category: data.categoryPath?.map((c: any) => c.name).join(' > '),
    };

    return { domain: 'bestbuy.com', type: 'product', structured, cleanContent: lines.join('\n') };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Best Buy API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

