import { peel } from '../../../../index.js';
import { getBestSearchProvider, type WebSearchResult } from '../../../../core/search-provider.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag, getStoreInfo, parsePrice, cleanProductTitle } from '../utils.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleProductSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build clean product keyword (strip noise words)
  const keyword = intent.query
    .replace(/\b(buy|shop|shopping|purchase|order|deal|discount|sale|price|cheap|cheapest|best price|under)\b/gi, '')
    .replace(/\$\d[\d,]*/g, '')
    .replace(/\s+/g, ' ')
    .trim() || intent.query;

  // Parallel site-specific searches
  const { provider: searchProvider } = getBestSearchProvider();
  const isBulk = /\b(bulk|wholesale|1000|500|case|pallet|box of|pack of|carton)\b/i.test(intent.query);
  const isGrocery = intent.params.isGrocery === 'true' || /\b(grocery|milk|eggs|bread|butter|cheese|chicken|produce)\b/i.test(intent.query);
  const isCollectible = /\b(pokemon|pokémon|magic\s*the\s*gathering|mtg|yu-?gi-?oh|trading\s*card|tcg|baseball\s*card|sports\s*card|collectible\s*card|figurine|funko|hot\s*wheels|lego\s*set|vintage\s*toy|action\s*figure|comic\s*book|vinyl\s*record|rare\s*coin|stamp\s*collection)\b/i.test(intent.query);

  let rawResults: WebSearchResult[];
  let redditResults: WebSearchResult[];

  if (isCollectible) {
    const [tcgSettled, ebaySettled, etsySettled, fbAmazonSettled, redditSettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} price site:tcgplayer.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:ebay.com sold`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:etsy.com OR site:mercari.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} price site:facebook.com/marketplace OR site:amazon.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} cheapest reddit where to buy`, { count: 3 }),
    ]);
    rawResults = [
      ...(tcgSettled.status === 'fulfilled' ? tcgSettled.value : []),
      ...(ebaySettled.status === 'fulfilled' ? ebaySettled.value : []),
      ...(etsySettled.status === 'fulfilled' ? etsySettled.value : []),
      ...(fbAmazonSettled.status === 'fulfilled' ? fbAmazonSettled.value : []),
    ];
    redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];
  } else if (isGrocery) {
    // Search grocery-specific sites
    const [instacartSettled, walmartGrocerySettled, freshSettled, redditGrocerySettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} price site:instacart.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:walmart.com/grocery OR site:walmart.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:freshdirect.com OR site:wholefoodsmarket.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} cheapest grocery store reddit`, { count: 3 }),
    ]);
    rawResults = [
      ...(instacartSettled.status === 'fulfilled' ? instacartSettled.value : []),
      ...(walmartGrocerySettled.status === 'fulfilled' ? walmartGrocerySettled.value : []),
      ...(freshSettled.status === 'fulfilled' ? freshSettled.value : []),
    ];
    redditResults = redditGrocerySettled.status === 'fulfilled' ? redditGrocerySettled.value : [];
  } else {
    const [amazonSettled, walmartSettled, bestbuySettled, targetSettled, redditSettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} site:amazon.com ${isBulk ? '' : 'price'}`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} site:walmart.com price`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} site:bestbuy.com OR site:target.com price`, { count: 2 }),
      isBulk
        ? searchProvider.searchWeb(`${keyword} wholesale bulk site:uline.com OR site:alibaba.com OR site:staples.com OR site:webstaurantstore.com`, { count: 3 })
        : searchProvider.searchWeb(`${keyword} site:ebay.com OR site:etsy.com price`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} reddit review best worth it`, { count: 2 }),
    ]);
    rawResults = [
      ...(amazonSettled.status === 'fulfilled' ? amazonSettled.value : []),
      ...(walmartSettled.status === 'fulfilled' ? walmartSettled.value : []),
      ...(bestbuySettled.status === 'fulfilled' ? bestbuySettled.value : []),
      ...(targetSettled.status === 'fulfilled' ? targetSettled.value : []),
    ];
    redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];
  }

  // Parse structured product listings from search results
  // DEEP SCRAPE: Visit top marketplace pages to extract real prices (collectibles only)
  let uniqueListings: Array<{title: string; price: string; priceValue: number; url: string; source: string; condition?: string}> = [];
  if (isCollectible) {
    const scrapableUrls = rawResults
      .filter(r => r.url && (
        r.url.includes('tcgplayer.com') ||
        r.url.includes('ebay.com') ||
        r.url.includes('amazon.com') ||
        r.url.includes('etsy.com') ||
        r.url.includes('mercari.com')
      ))
      .slice(0, 4)
      .map(r => r.url);

    const deepResults = await Promise.allSettled(
      scrapableUrls.map(url =>
        peel(url, { render: false, timeout: 5000 })
          .then(result => ({ url, content: result.content, title: result.title, tokens: result.tokens }))
          .catch(() => null)
      )
    );

    const deepListings: Array<{title: string; price: string; priceValue: number; url: string; source: string; condition?: string}> = [];

    for (const settled of deepResults) {
      if (settled.status !== 'fulfilled' || !settled.value) continue;
      const { url, content: pageContent } = settled.value;
      if (!pageContent) continue;

      const sourceName = url.includes('tcgplayer') ? 'TCGPlayer'
        : url.includes('ebay') ? 'eBay'
        : url.includes('amazon') ? 'Amazon'
        : url.includes('etsy') ? 'Etsy'
        : url.includes('mercari') ? 'Mercari'
        : new URL(url).hostname;

      const lines = pageContent.split('\n');
      for (const line of lines) {
        const pm = line.match(/\$(\d{1,6}(?:\.\d{2})?)/);
        if (!pm) continue;
        const price = parseFloat(pm[1]);
        if (price < 0.5 || price > 50000) continue;

        const titleText = line.replace(/\$[\d,.]+/g, '').replace(/[|·\-–—]/g, ' ').trim().slice(0, 100);
        if (titleText.length < 5) continue;

        const conditionMatch = line.match(/\b(Near Mint|NM|Lightly Played|LP|Moderately Played|MP|Heavily Played|HP|Damaged|DMG|New|Used|Like New|Good|Very Good|Excellent)\b/i);

        deepListings.push({
          title: titleText,
          price: '$' + price.toFixed(2),
          priceValue: price,
          url,
          source: sourceName,
          condition: conditionMatch ? conditionMatch[1] : undefined,
        });
      }
    }

    deepListings.sort((a, b) => a.priceValue - b.priceValue);
    const seen = new Set<string>();
    uniqueListings = deepListings.filter(l => {
      const key = l.price + l.source;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }

  let listings = rawResults
    .filter(r => r.url && getStoreInfo(r.url) !== null)
    .map(r => {
      const storeInfo = getStoreInfo(r.url)!;
      const textToSearch = `${r.title || ''} ${r.snippet || ''}`;

      // Extract price from snippet/title
      const price = parsePrice(textToSearch);

      // Extract rating from snippet
      const ratingMatch = (r.snippet || '').match(/(\d+(?:\.\d)?)\s*(?:out of 5|stars?|★)/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

      // Extract review count
      const reviewMatch = (r.snippet || '').match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const reviewCount = reviewMatch ? reviewMatch[1].replace(/,/g, '') : undefined;

      // Clean up title
      const title = cleanProductTitle(r.title || '');

      // Extract brand from title — common patterns: "Brand Name Product..." or known brands
      const KNOWN_BRANDS = /\b(Sony|Bose|Apple|Samsung|LG|JBL|Sennheiser|Audio-Technica|Beats|Jabra|Anker|Soundcore|AKG|Shure|Skullcandy|Plantronics|HyperX|SteelSeries|Razer|Corsair|Logitech|Dell|HP|Lenovo|Asus|Acer|MSI|Microsoft|Google|Amazon|Kindle|Echo|Ring|Roku|Dyson|iRobot|Roomba|Ninja|KitchenAid|Instant Pot|Keurig|Breville|Philips|Panasonic|Canon|Nikon|GoPro|DJI|Fitbit|Garmin|Xiaomi|OnePlus|Nothing|Motorola|Nokia|TCL|Hisense|Vizio|Sonos|Marshall|Bang & Olufsen|B&O|Nike|Adidas|New Balance|Puma|Under Armour|North Face|Patagonia|Columbia|Levi's|Oakley|Ray-Ban|Gucci|Coach|Kate Spade|Michael Kors|Samsonite|Osprey|Yeti|Hydro Flask|Stanley|Weber|Traeger|DeWalt|Makita|Milwaukee|Bosch|Black\+Decker|Craftsman|Ryobi)\b/i;
      const brandMatch = (r.title || '').match(KNOWN_BRANDS);
      const brand = brandMatch ? brandMatch[1] : undefined;

      // Image from SearXNG (imageUrl field if available)
      const image = (r as any).imageUrl ?? undefined;

      return {
        title,
        brand,
        price,
        rating,
        reviewCount,
        url: addAffiliateTag(r.url),
        snippet: r.snippet,
        store: storeInfo.store,
        image,
      };
    })
    .slice(0, 10);

  // Replace listings with deep-scraped results for collectibles (if any found)
  if (isCollectible && uniqueListings.length > 0) {
    listings = uniqueListings.map(l => ({
      title: l.title,
      brand: undefined,
      price: l.price,
      rating: undefined,
      reviewCount: undefined,
      url: l.url,
      snippet: l.condition ? `Condition: ${l.condition}` : '',
      store: l.source,
      image: undefined,
    }));
  }

  const amazonUrl = addAffiliateTag(`https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`);
  const content = listings.length > 0
    ? `# 🛍️ Products — ${keyword}\n\n${listings.map((l, i) =>
        `${i + 1}. **${l.title}** — ${l.price || 'see price'} [${l.store}](${l.url})\n   ${l.snippet || ''}`
      ).join('\n\n')}`
    : `# 🛍️ Products — ${keyword}\n\nNo structured listings found. Try a more specific query.`;

  // AI synthesis: recommend best value option
  let answer: string | undefined;
  try {
    const productInfo = listings.length > 0
      ? listings.slice(0, 5).map(l => `${l.brand ? l.brand + ' ' : ''}${l.title}: ${l.price || 'N/A'} at ${l.store}${l.rating ? `, ${l.rating}★` : ''}${l.reviewCount ? ` (${l.reviewCount} reviews)` : ''}`).join(', ')
      : 'no specific listings found';
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const deepPriceInfo = uniqueListings.length > 0
      ? '\n\nReal prices found:\n' + uniqueListings.slice(0, 5).map((l, i) => `${i + 1}. ${l.title} — ${l.price} on ${l.source}${l.condition ? ` (${l.condition})` : ''}`).join('\n')
      : '';
    const aiPrompt = isCollectible
      ? `${PROMPT_INJECTION_DEFENSE}You are a collectibles price expert. The user wants: "${sanitizeSearchQuery(intent.query)}". Products found: ${productInfo}.${deepPriceInfo} Reddit says: ${redditSnippets || 'none'}. List the cheapest options with exact prices, condition (near mint/lightly played/etc), and which store. Be specific with dollar amounts. Max 200 words. Cite sources inline as [1], [2], [3].`
      : `${PROMPT_INJECTION_DEFENSE}You are a shopping advisor. The user wants: "${sanitizeSearchQuery(intent.query)}". Products found: ${productInfo}. Reddit says: ${redditSnippets || 'no reviews'}. ${listings.length > 0 ? 'Recommend the best value option. Mention the brand name, specific model, price, and store. Be specific.' : 'Give general buying advice with specific brand and model recommendations based on Reddit.'} Max 200 words. Cite sources inline as [1], [2], [3].`;
    const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
    if (aiText && aiText.length > 20) answer = aiText;
  } catch (err) {
    console.warn('[product-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
  }

  return {
    type: 'products',
    source: listings.length > 0 ? 'Shopping + Reddit' : 'Web',
    sourceUrl: amazonUrl,
    content,
    title: `${keyword} — Shopping`,
    structured: { listings },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'shopping', count: listings.length } as any,
      { type: 'reddit', threads: redditResults.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}
