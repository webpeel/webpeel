import { localSearch } from '../../../../core/local-search.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';
import { fetchYelpResults } from '../sources/yelp.js';
import { fetchRedditResults } from '../sources/reddit.js';
import { fetchYouTubeResults } from '../sources/youtube.js';

export async function handleRestaurantSearch(intent: SearchIntent, requestLanguage?: string): Promise<SmartSearchResult> {
  const t0 = Date.now();

  const location = intent.params.location || 'New York, NY';
  const keyword = intent.query
    .replace(/\b(best|top|good|cheap|affordable|near me|near|around|in|find|search|looking for)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Run ALL data sources in parallel for speed ──────────────────────────
  // Previously sequential: localSearch → Yelp → Reddit+YouTube = 20-30s
  // Now parallel: everything races at once = 8-10s max
  const hasPlacesKey = !!process.env.GOOGLE_PLACES_API_KEY;

  const [localSearchSettled, yelpSettled, redditSettled, youtubeSettled] = await Promise.allSettled([
    // Google Places (primary when key available)
    hasPlacesKey
      ? Promise.race([
          localSearch({ query: keyword || intent.query, location, language: requestLanguage, limit: 10 }),
          new Promise<null>((_, rej) => setTimeout(() => rej(new Error('local search timeout')), 8000)),
        ])
      : Promise.resolve(null),
    // Yelp (secondary / fallback)
    Promise.race([
      fetchYelpResults(keyword, location).then(v => v),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('yelp timeout')), 8000)),
    ]),
    // Reddit (best-effort supplementary)
    Promise.race([
      fetchRedditResults(keyword, location),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('reddit timeout')), 6000)),
    ]),
    // YouTube (best-effort supplementary)
    Promise.race([
      fetchYouTubeResults(keyword, location),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('youtube timeout')), 5000)),
    ]),
  ]);

  const googlePlacesData = localSearchSettled.status === 'fulfilled' ? localSearchSettled.value : null;
  if (googlePlacesData && googlePlacesData.results?.length > 0) {
    console.log(`[smart-search] localSearch() returned ${googlePlacesData.results.length} results from ${googlePlacesData.source}`);
  }
  // Skip Yelp data if Google Places already has enough results
  const skipYelp = googlePlacesData && googlePlacesData.results?.length >= 5;
  const yelpData = (!skipYelp && yelpSettled.status === 'fulfilled') ? yelpSettled.value : null;

  const redditData = redditSettled.status === 'fulfilled' ? redditSettled.value : null;
  const youtubeData = youtubeSettled.status === 'fulfilled' ? youtubeSettled.value : null;

  // Re-rank: composite score = rating * log2(reviewCount + 1)
  // This naturally surfaces high-rated places with meaningful review volume
  if (yelpData && yelpData.businesses.length > 0) {
    yelpData.businesses.sort((a: any, b: any) => {
      const scoreA = (a.rating || 0) * Math.log2((a.reviewCount || 0) + 1);
      const scoreB = (b.rating || 0) * Math.log2((b.reviewCount || 0) + 1);
      return scoreB - scoreA;
    });

    // For "best" queries, filter to minimum 50 reviews
    const isBestQuery = /\b(best|top|highest rated)\b/i.test(intent.query);
    if (isBestQuery) {
      const filtered = yelpData.businesses.filter((b: any) => (b.reviewCount || 0) >= 50);
      if (filtered.length >= 3) {
        yelpData.businesses = filtered;
      }
    }

    // Remove permanently closed businesses
    yelpData.businesses = yelpData.businesses.filter((b: any) => !b.isClosed);
  }

  // ── Build markdown content from all sources ──────────────────────────
  const contentParts: string[] = [];

  // Google Places section (shown first when available — higher quality data)
  if (googlePlacesData && googlePlacesData.results.length > 0) {
    const priceLevelStr = (lvl?: number) => lvl !== undefined ? '$'.repeat(Math.max(1, lvl)) : '';
    contentParts.push(`## Google Places (${googlePlacesData.results.length} results)`);
    googlePlacesData.results.slice(0, 10).forEach((b: any, i: number) => {
      const name     = b.name || 'Unknown';
      const rating   = b.rating    ? `⭐${b.rating}` : '';
      const reviews  = b.reviewCount ? `(${b.reviewCount.toLocaleString()} reviews)` : '';
      const price    = b.priceLevel !== undefined ? ` · ${priceLevelStr(b.priceLevel)}` : '';
      const openStatus = b.isOpen === true ? ' · 🟢 Open Now' : (b.isOpen === false ? ' · 🔴 Closed' : '');
      const todayHours = b.hours?.length > 0 ? ` · 🕐 ${b.hours[0]}` : '';
      const mapsLink = b.googleMapsUrl ? ` · [📍 Maps](${b.googleMapsUrl})` : '';
      const addr     = b.address || '';
      contentParts.push(`${i + 1}. **${name}** ${rating} ${reviews}${price}${openStatus}${todayHours}${mapsLink}${addr ? ` — ${addr}` : ''}`);
    });
    contentParts.push('');
  }

  // Yelp section
  if (yelpData) {
    const businesses = yelpData.businesses;
    if (businesses.length > 0) {
      contentParts.push(`## Yelp (${businesses.length} restaurants)`);
      businesses.slice(0, 10).forEach((b: any, i: number) => {
        const name    = b.name || b.title || 'Unknown';
        const rating  = b.rating  ? `⭐${b.rating}` : '';
        const reviews = b.reviewCount ? `(${b.reviewCount.toLocaleString()} reviews)` : '';
        const address = b.address || b.location || '';
        const price   = b.price   ? ` · ${b.price}` : '';
        const openStatus = b.isClosed ? ' · ⛔ Permanently Closed' : (b.isOpenNow ? ' · 🟢 Open Now' : ' · 🔴 Closed');
        const todayHours = b.todayHours && b.todayHours !== 'Closed today' ? ` · 🕐 ${b.todayHours}` : (b.todayHours === 'Closed today' ? ' · 🕐 Closed today' : '');
        const txns = b.transactions?.length > 0 ? ` · ${b.transactions.map((t: string) => t === 'delivery' ? '🚗 Delivery' : t === 'pickup' ? '📦 Pickup' : t).join(' ')}` : '';
        const mapsLink = b.googleMapsUrl ? ` · [📍 Google Maps](${b.googleMapsUrl})` : '';
        contentParts.push(`${i + 1}. **${name}** ${rating} ${reviews}${price}${openStatus}${todayHours}${txns}${mapsLink}${address ? ` — ${address}` : ''}`);
      });
    } else if (yelpData.content) {
      contentParts.push(`## Yelp\n${yelpData.content.substring(0, 800)}`);
    }
  }

  // Reddit section
  if (redditData) {
    contentParts.push('');
    contentParts.push('## Reddit Recommendations');
    if (redditData.thread) {
      contentParts.push(`**${redditData.thread.title}**`);
      if (redditData.thread.content) {
        contentParts.push(redditData.thread.content.substring(0, 600));
      }
    }
    if (redditData.otherThreads.length > 0) {
      contentParts.push('');
      redditData.otherThreads.slice(0, 3).forEach(t => {
        contentParts.push(`- [${t.title}](${t.url}) — ${t.snippet || ''}`);
      });
    }
  }

  // YouTube section
  if (youtubeData && youtubeData.videos.length > 0) {
    contentParts.push('');
    contentParts.push('## YouTube Reviews');
    youtubeData.videos.forEach(v => {
      contentParts.push(`🎬 [${v.title}](${v.url}) — ${v.snippet || ''}`);
    });
  }

  const combinedContent = contentParts.join('\n');

  // ── Build sources array for dashboard tabs ────────────────────────────
  const sources: Array<{ title: string; url: string; domain: string }> = [];
  if (googlePlacesData) sources.push({ title: 'Google Places', url: `https://maps.google.com/?q=${encodeURIComponent(keyword + ' ' + location)}`, domain: 'google.com' });
  if (yelpData)    sources.push({ title: 'Yelp',    url: yelpData.url,                     domain: 'yelp.com' });
  if (redditData?.thread) sources.push({ title: redditData.thread.title, url: redditData.thread.url, domain: 'reddit.com' });
  if (youtubeData?.videos[0]) sources.push({ title: youtubeData.videos[0].title, url: youtubeData.videos[0].url, domain: 'youtube.com' });

  // ── AI Synthesis (uses Groq/OpenAI/Glama/Ollama — callLLMQuick picks best) ──
  // Uses whichever data source returned results: Google Places OR Yelp
  // NOTE: K8s OLLAMA_URL is port 11435 but Ollama runs on 11434 — fix in K8s secrets
  let answer: string | undefined;

  // Build restaurant lines from whichever source has data
  const hasGoogleData = googlePlacesData && googlePlacesData.results?.length > 0;
  const hasYelpData = yelpData && yelpData.businesses?.length > 0;

  if (hasGoogleData || hasYelpData) {
    try {
      let restaurantLines: string;
      let citations: string;

      if (hasGoogleData) {
        // Format Google Places results for LLM
        const priceLevelStr = (lvl?: number) => lvl !== undefined ? '$'.repeat(Math.max(1, lvl)) : '';
        restaurantLines = googlePlacesData!.results.slice(0, 3).map((b: any, i: number) => {
          const openStatus = b.isOpen === true ? 'OPEN NOW' : (b.isOpen === false ? 'Closed right now' : 'hours unknown');
          const hours = b.hours?.length > 0 ? b.hours[0] : 'not available';
          const price = b.priceLevel !== undefined ? priceLevelStr(b.priceLevel) : '';
          return `[${i+1}] ${b.name} ⭐${b.rating || '?'} (${(b.reviewCount || 0).toLocaleString()} reviews) ${price} — ${b.address || ''}
   ${openStatus} | Today: ${hours} | Categories: ${b.categories || b.types?.join(', ') || ''}
   URL: ${b.googleMapsUrl || 'google.com/maps'}`;
        }).join('\n');
        citations = googlePlacesData!.results.slice(0, 3).map((b: any, i: number) =>
          `[${i+1}] ${b.googleMapsUrl || 'google.com/maps'}`
        ).join('\n');
      } else {
        // Format Yelp results for LLM
        restaurantLines = yelpData!.businesses.slice(0, 3).map((b: any, i: number) => {
          const openStatus = b.isClosed ? 'PERMANENTLY CLOSED' : (b.isOpenNow ? 'OPEN NOW' : 'Closed right now');
          const txns = b.transactions?.length > 0 ? `Available: ${b.transactions.join(', ')}` : '';
          const googleInfo = b.googleRating ? ` | Google: ⭐${b.googleRating} (${b.googleReviewCount} reviews)` : '';
          return `[${i+1}] ${b.name} ⭐${b.rating} (${b.reviewCount?.toLocaleString()} reviews) ${b.price || ''} — ${b.address}
   ${openStatus} | Today: ${b.todayHours || 'hours not available'} | ${txns} | Categories: ${b.categories || ''}${googleInfo}
   URL: ${b.url || ''}`;
        }).join('\n');
        citations = yelpData!.businesses.slice(0, 3).map((b: any, i: number) => `[${i+1}] ${b.url || 'yelp.com'}`).join('\n');
      }

      const redditHint = redditData?.otherThreads?.slice(0,2).map((t: any) => t.title).join('; ') || '';
      const systemPrompt = `${PROMPT_INJECTION_DEFENSE}Recommend top 3 restaurants. For each: name with inline citation [1][2][3], why it's good, open/closed status, hours.
Cite sources inline using [1], [2], [3] notation matching the numbered sources. At the end, list Sources with their URLs.
Be specific. Max 200 words.
`;
      const userMessage = `Query: ${sanitizeSearchQuery(intent.query)}\n\nTop restaurants:\n${restaurantLines}${redditHint ? '\n\nReddit mentions: ' + redditHint : ''}\n\nSources:\n${citations}`;
      const text = await callLLMQuick(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
      if (text) answer = text;
    } catch (err) {
      console.warn('[restaurant-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
    }
  }

  // If ALL sources completely failed, surface an error
  if (!googlePlacesData && !yelpData && !redditData && !youtubeData) {
    throw new Error('All restaurant sources failed');
  }

  const yelpUrl = yelpData?.url || `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;

  // Build source label based on what we actually used
  const sourceLabel = [
    googlePlacesData ? 'Google Places' : null,
    yelpData ? 'Yelp' : null,
    redditData ? 'Reddit' : null,
    youtubeData ? 'YouTube' : null,
  ].filter(Boolean).join(' + ') || 'Yelp + Reddit + YouTube';

  // Merge structured data: prefer Google Places, fall back to Yelp
  const structuredData = googlePlacesData
    ? { businesses: googlePlacesData.results, googlePlaces: true }
    : yelpData?.domainData?.structured;

  return {
    type: 'restaurants',
    source: sourceLabel,
    sourceUrl: yelpUrl,
    content: combinedContent,
    title: `${keyword} in ${location}`,
    domainData: googlePlacesData ? { structured: structuredData } : yelpData?.domainData,
    structured: structuredData,
    tokens: combinedContent.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    ...(sources.length > 0 ? { sources } : {}),
  };
}
