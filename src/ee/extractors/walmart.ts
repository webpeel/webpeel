import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 11. Walmart extractor (Walmart frontend search API)
// ---------------------------------------------------------------------------

export async function walmartExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  // Extract item ID from URL patterns:
  // /ip/Product-Name/1234567 or /ip/1234567
  const itemMatch = url.match(/\/ip\/(?:.*\/)?(\d+)/);
  if (!itemMatch) return null;
  const itemId = itemMatch[1];

  // Try Walmart's BE API (used by their frontend, sometimes accessible)
  const apiUrl = `https://www.walmart.com/orchestra/snb/graphql/Search?query=${itemId}&page=1&affinityOverride=default&limit=1`;

  try {
    const response = await fetchJson(apiUrl, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.walmart.com/',
    });

    if (response?.data?.search?.searchResult?.itemStacks?.[0]?.items?.[0]) {
      const item = response.data.search.searchResult.itemStacks[0].items[0];

      const lines: string[] = [];
      lines.push(`# ${item.name}`);
      if (item.priceInfo?.currentPrice?.price) {
        lines.push(`**Price:** $${item.priceInfo.currentPrice.price}`);
      }
      if (item.averageRating) {
        lines.push(`**Rating:** ${item.averageRating}/5 (${item.numberOfReviews || 0} reviews)`);
      }
      if (item.shortDescription) lines.push(item.shortDescription);

      const structured = {
        name: item.name,
        price: item.priceInfo?.currentPrice?.price,
        rating: item.averageRating,
        reviewCount: item.numberOfReviews,
        image: item.imageInfo?.thumbnailUrl,
        itemId: itemId,
        inStock: item.availabilityStatusV2?.value === 'IN_STOCK',
      };

      return { domain: 'walmart.com', type: 'product', structured, cleanContent: lines.join('\n') };
    }
    return null;
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Walmart API failed:', e instanceof Error ? e.message : e);
    return null; // API not accessible, fall through to other methods
  }
}

