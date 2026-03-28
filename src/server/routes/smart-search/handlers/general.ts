import { peel } from '../../../../index.js';
import {
  getBestSearchProvider,
  type WebSearchResult,
} from '../../../../core/search-provider.js';
import { getSourceCredibility } from '../../../../core/source-credibility.js';
import { splitIntoBlocks, scoreBM25 } from '../../../../core/bm25-filter.js';
import type { SmartSearchResult } from '../types.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleGeneralSearch(query: string): Promise<SmartSearchResult> {
  const t0 = Date.now();

  // Equipment rental / service business enhancement via Google Places
  const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
  const isEquipmentRental = /\b(rent|rental|renting|hire|lease)\b/.test(query) && /\b(forklift|dumpster|pressure washer|generator|excavator|bobcat|crane|scaffolding|tent|truck|van|trailer|equipment|tool|power tool)\b/.test(query);
  const isServiceBusiness = /\b(plumber|electrician|mechanic|dentist|doctor|lawyer|locksmith|handyman|contractor|vet|salon|barber|spa|gym|daycare|moving|storage|cleaning|pest control|roofing|hvac|landscaping)\b/.test(query) && /\b(near|in|around|open|best|cheap|emergency|24.hour)\b/.test(query);
  const isGasStation = /\b(gas|gasoline|fuel|gas station|petrol|diesel)\b/.test(query) && /\b(cheap|cheapest|price|near|closest|best)\b/.test(query);
  const isTravelBooking = /\b(cruise|vacation|resort|all.inclusive|trip|package|tour|excursion|safari|honeymoon|disneyland|disney world|disney cruise|universal|theme park|spring break)\b/.test(query) && /\b(cheap|cheapest|price|ticket|book|deal|cost|per person)\b/.test(query);

  let localBusinesses: any[] = [];

  // ── Try Places API (New) for gas stations (has fuel prices) ──────────────
  if (isGasStation && GOOGLE_PLACES_KEY) {
    try {
      const newApiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.fuelOptions,places.rating,places.userRatingCount,places.currentOpeningHours,places.googleMapsUri,places.location',
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 10 }),
        signal: AbortSignal.timeout(5000),
      });

      if (newApiRes.ok) {
        const data = await newApiRes.json();
        if (data.places?.length > 0) {
          const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayMap: Record<string, string> = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
          const today = shortDays[new Date().getDay()];

          localBusinesses = data.places.map((p: any) => {
            // Parse fuel prices
            const fuelPrices: Record<string, string> = {};
            if (p.fuelOptions?.fuelPrices) {
              for (const fp of p.fuelOptions.fuelPrices) {
                const price = fp.price ? `$${fp.price.units || 0}.${String(fp.price.nanos || 0).padStart(9, '0').substring(0, 2)}` : null;
                if (price) {
                  const typeMap: Record<string, string> = {
                    'REGULAR_UNLEADED': 'Regular',
                    'MIDGRADE': 'Midgrade',
                    'PREMIUM': 'Premium',
                    'DIESEL': 'Diesel',
                    'E85': 'E85',
                  };
                  fuelPrices[typeMap[fp.type] || fp.type] = price;
                }
              }
            }

            // Parse hours
            const hours: Record<string, string> = {};
            if (p.currentOpeningHours?.weekdayDescriptions) {
              for (const desc of p.currentOpeningHours.weekdayDescriptions) {
                const colonIdx = desc.indexOf(':');
                if (colonIdx > 0) {
                  const dayFull = desc.substring(0, colonIdx).trim();
                  const timeStr = desc.substring(colonIdx + 1).trim();
                  if (dayMap[dayFull]) hours[dayMap[dayFull]] = timeStr;
                }
              }
            }

            return {
              name: p.displayName?.text || 'Gas Station',
              address: p.formattedAddress || '',
              rating: p.rating,
              reviewCount: p.userRatingCount || 0,
              isOpenNow: p.currentOpeningHours?.openNow,
              todayHours: hours[today] || '',
              googleMapsUrl: p.googleMapsUri || '',
              fuelPrices,
              latitude: p.location?.latitude,
              longitude: p.location?.longitude,
              businessStatus: 'OPERATIONAL',
            };
          });
          console.log(`[smart-search] Places API (New) returned ${localBusinesses.length} gas stations`);
        }
      }
    } catch { /* New API failed — fall through to legacy */ }
  }

  // ── Legacy Google Places search (used when Places API New is unavailable or non-gas queries) ──
  if (localBusinesses.length === 0 && (isEquipmentRental || isServiceBusiness || isGasStation) && GOOGLE_PLACES_KEY) {
    try {
      // Use Google Places Text Search
      const findRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (findRes.ok) {
        const findData = await findRes.json();
        if (findData.status === 'OK' && findData.results?.length > 0) {
          // Get details for top 3 (hours, phone, etc.)
          const top5 = findData.results.slice(0, 5);
          const details = await Promise.allSettled(
            top5.slice(0, 3).map(async (place: any) => {
              const detailRes = await fetch(
                `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,opening_hours,rating,user_ratings_total,url,formatted_address,website,business_status&key=${GOOGLE_PLACES_KEY}`,
                { signal: AbortSignal.timeout(3000) }
              );
              if (!detailRes.ok) return null;
              const detailData = await detailRes.json();
              return detailData.result || null;
            })
          );

          localBusinesses = top5.map((place: any, i: number) => {
            const detail = details[i]?.status === 'fulfilled' ? details[i].value : null;
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const today = dayNames[new Date().getDay()];
            const todayHours = detail?.opening_hours?.weekday_text?.find((h: string) => {
              const dayMap: Record<string, string> = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
              return Object.entries(dayMap).some(([full, short]) => h.startsWith(full) && short === today);
            })?.split(': ').slice(1).join(': ') || '';

            return {
              name: detail?.name || place.name,
              address: detail?.formatted_address || place.formatted_address || '',
              phone: detail?.formatted_phone_number || '',
              rating: detail?.rating || place.rating,
              reviewCount: detail?.user_ratings_total || place.user_ratings_total || 0,
              isOpenNow: detail?.opening_hours?.open_now ?? place.opening_hours?.open_now,
              todayHours,
              website: detail?.website || '',
              googleMapsUrl: detail?.url || '',
              mapEmbedUrl: `https://www.google.com/maps/embed/v1/place?q=place_id:${place.place_id}&key=${GOOGLE_PLACES_KEY}`,
              latitude: place.geometry?.location?.lat,
              longitude: place.geometry?.location?.lng,
              businessStatus: detail?.business_status || place.business_status || 'OPERATIONAL',
            };
          }).filter((b: any) => b.businessStatus === 'OPERATIONAL');
        }
      }
    } catch { /* Google Places failed — continue with web search */ }
  }

  const { provider: searchProvider } = getBestSearchProvider();
  const rawResults: WebSearchResult[] = await searchProvider.searchWeb(query, { count: 10 });
  const searchMs = Date.now() - t0;

  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  const tierOrder: Record<string, number> = { official: 0, established: 1, community: 2, new: 3, suspicious: 4 };
  let results = rawResults
    .map((r) => {
      const cred = getSourceCredibility(r.url);
      return {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        domain: getDomain(r.url),
        credibility: cred,
      };
    })
    .sort((a, b) => {
      const aTier = tierOrder[a.credibility?.tier || 'new'] ?? 3;
      const bTier = tierOrder[b.credibility?.tier || 'new'] ?? 3;
      return aTier - bTier;
    })
    .map((r, i) => ({ ...r, rank: i + 1 })) as any[];

  // Enrich top 8 results — BM25 highlights keep token budget tight
  const tPeel = Date.now();
  const topResults = results.slice(0, 8);
  console.log(`[smart-search] handleGeneralSearch: enriching ${topResults.length} pages via peel`);
  const enriched = await Promise.allSettled(
    topResults.map(async (r) => {
      try {
        const peeled = await peel(r.url, { timeout: 4000, maxTokens: 2000 });
        return {
          url: r.url,
          content: peeled.content?.substring(0, 2000),
          title: peeled.title || r.title,
          fetchTimeMs: peeled.elapsed,
          metadata: peeled.metadata,
          structured: peeled.domainData?.structured,
        };
      } catch {
        return { url: r.url, content: null, title: r.title, fetchTimeMs: 0, metadata: undefined, structured: undefined };
      }
    })
  );
  const peelMs = Date.now() - tPeel;

  // Check if any peel succeeded; if none did, skip LLM and return raw results
  const anyPeelSucceeded = enriched.some(
    (s) => s.status === 'fulfilled' && s.value.content !== null
  );

  for (const settled of enriched) {
    if (settled.status === 'fulfilled' && settled.value.content) {
      const match = results.find((r: any) => r.url === settled.value.url);
      if (match) {
        match.content = settled.value.content;
        match.fetchTimeMs = settled.value.fetchTimeMs;
      }
    }
  }

  let content = results
    .map((r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');

  // For equipment rentals and gas stations, also search for pricing data
  let pricingInfo = '';
  if (isGasStation) {
    try {
      const locMatch = query.match(/\b(?:in|near|around)\s+([a-z\s]+?)(?:\s+(?:under|below|cheap|\$).*)?$/i);
      const gasLocation = locMatch ? locMatch[1].trim() : 'New York';
      const gasPriceResults = await searchProvider.searchWeb(`gas prices ${gasLocation} per gallon today cheapest gasbuddy`, { count: 3 });
      const gasPrices: string[] = [];
      for (const r of gasPriceResults) {
        const text = `${r.title || ''} ${r.snippet || ''}`;
        const priceMatches = text.match(/\$\d+\.\d{2}/g);
        if (priceMatches) gasPrices.push(...priceMatches);
      }
      if (gasPrices.length > 0) {
        const uniquePrices = [...new Set(gasPrices)].sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)));
        pricingInfo = `\n\n## ⛽ Gas Prices (${gasLocation})\n${uniquePrices.slice(0, 8).map(p => `- ${p}/gal`).join('\n')}`;
        // Add pricing snippets for AI
        for (const r of gasPriceResults.slice(0, 2)) {
          if (r.snippet?.match(/\$/)) {
            (results as any[]).push({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              domain: getDomain(r.url),
              content: r.snippet,
              isPricing: true,
            });
          }
        }
      }
    } catch { /* gas price search failed — non-fatal */ }
  } else if (isTravelBooking) {
    try {
      // Search specifically for prices + comparison across providers
      const travelPriceResults = await searchProvider.searchWeb(`${query} price per person comparison cheapest 2026 site:cruisefever.net OR site:cruisecritic.com OR site:vacationstogo.com OR site:costcotravel.com OR site:kayak.com`, { count: 3 });
      const travelPrices: string[] = [];
      for (const r of travelPriceResults) {
        const text = `${r.title || ''} ${r.snippet || ''}`;
        const priceMatches = text.match(/\$[\d,]+(?:\s*(?:per person|pp|\/person))?/gi);
        if (priceMatches) travelPrices.push(...priceMatches.slice(0, 4));
      }
      if (travelPrices.length > 0) {
        pricingInfo = `\n\n## 💰 Pricing Found\n${[...new Set(travelPrices)].slice(0, 8).map(p => `- ${p}`).join('\n')}`;
      }
      // Peel the top comparison page for detailed data
      const comparisonPage = travelPriceResults[0];
      if (comparisonPage?.url) {
        try {
          const peeled = await peel(comparisonPage.url, { timeout: 6000, maxTokens: 3000 });
          if (peeled.content && peeled.content.length > 200) {
            (results as any[]).push({
              title: comparisonPage.title,
              url: comparisonPage.url,
              snippet: comparisonPage.snippet,
              domain: getDomain(comparisonPage.url),
              content: peeled.content.substring(0, 3000),
              isPricing: true,
            });
          }
        } catch { /* peel failed — use snippet */ }
      }
      // Add remaining results for sources
      for (const r of travelPriceResults.slice(1, 3)) {
        if (r.snippet) {
          (results as any[]).push({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            domain: getDomain(r.url),
            content: r.snippet,
            isPricing: true,
          });
        }
      }
    } catch { /* travel price search failed */ }
  } else if (isEquipmentRental) {
    try {
      const pricingResults = await searchProvider.searchWeb(`${query} cost price per day rate 2025`, { count: 3 });
      const prices: string[] = [];
      for (const r of pricingResults) {
        const text = `${r.title || ''} ${r.snippet || ''}`;
        // Extract price ranges like "$140-$160 per day" or "$210 to $1,200"
        const priceMatches = text.match(/\$[\d,]+(?:\s*[-–to]+\s*\$[\d,]+)?(?:\s*(?:per|\/)\s*(?:day|week|month|hour))?/gi);
        if (priceMatches) {
          prices.push(...priceMatches.slice(0, 3));
        }
      }
      if (prices.length > 0) {
        pricingInfo = `\n\n## 💰 Typical Pricing\n${[...new Set(prices)].slice(0, 6).map(p => `- ${p}`).join('\n')}`;
        // Also add pricing snippets to the sources for AI to reference
        for (const r of pricingResults.slice(0, 2)) {
          if (r.snippet?.match(/\$/)) {
            (results as any[]).push({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              domain: getDomain(r.url),
              content: r.snippet,
              isPricing: true,
            });
          }
        }
      }
    } catch { /* pricing search failed — non-fatal */ }
  }

  // If we found local businesses via Google Places, prepend them
  if (localBusinesses.length > 0) {
    const localContent = localBusinesses.map((b: any, i: number) => {
      const status = b.isOpenNow ? '🟢 Open Now' : '🔴 Closed';
      return `${i + 1}. **${b.name}** ⭐${b.rating || '?'} (${b.reviewCount} reviews) — ${status}${b.todayHours ? ` · 🕐 ${b.todayHours}` : ''}
   📍 ${b.address}${b.phone ? ` · 📞 ${b.phone}` : ''}${b.website ? ` · [Website](${b.website})` : ''}${b.googleMapsUrl ? ` · [📍 Map](${b.googleMapsUrl})` : ''}`;
    }).join('\n\n');

    content = `## 📍 Nearby Businesses\n\n${localContent}${pricingInfo}\n\n---\n\n## 🔍 Web Results\n\n${content}`;

    // Also add to results array for structured rendering
    (results as any[]).unshift(...localBusinesses.map((b: any, i: number) => ({
      title: b.name,
      url: b.googleMapsUrl || b.website || '#',
      snippet: `⭐${b.rating || '?'} (${b.reviewCount} reviews) · ${b.isOpenNow ? '🟢 Open' : '🔴 Closed'}${b.todayHours ? ' · ' + b.todayHours : ''} · ${b.address}${b.phone ? ' · 📞 ' + b.phone : ''}${b.fuelPrices && Object.keys(b.fuelPrices).length > 0 ? ' · ⛽ ' + Object.entries(b.fuelPrices).map(([type, price]: [string, any]) => type + ': ' + price + '/gal').join(' | ') : ''}`,
      domain: 'google.com/maps',
      rank: i + 1,
      isLocalBusiness: true,
      isOpenNow: b.isOpenNow,
      ...(b.fuelPrices && Object.keys(b.fuelPrices).length > 0 ? { fuelPrices: b.fuelPrices } : {}),
    })));
  }

  // Build sources array from successfully peeled results (all 5)
  const sources = enriched
    .filter((s) => s.status === 'fulfilled' && s.value.content !== null)
    .map((s) => {
      const v = (s as PromiseFulfilledResult<any>).value;
      return {
        title: v.title,
        url: v.url,
        domain: getDomain(v.url),
      };
    });

  // ── AI Synthesis (uses Groq/OpenAI/Glama/Ollama — callLLMQuick picks best) ──
  let answer: string | undefined;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
  let llmMs = 0;

  // Only call LLM if at least one page was successfully peeled
  if (anyPeelSucceeded) {
    try {
      // Build numbered source content for the LLM using BM25 highlights
      // Extract only query-relevant passages instead of raw truncation
      const queryTerms = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
      const sourceContent = enriched
        .map((s, i) => {
          if (s.status !== 'fulfilled' || !(s.value as any).content) return null;
          const v = s.value as any;
          // Include structured data if available
          const structuredInfo = v.structured ? `\nKey data: ${JSON.stringify(v.structured).substring(0, 300)}` : '';

          // Use BM25 to extract only the most relevant passages (800 chars max)
          let highlight = '';
          if (v.content) {
            const blocks = splitIntoBlocks(v.content);
            const scores = scoreBM25(blocks, queryTerms);
            // Pair blocks with scores and sort by relevance
            const scored = blocks.map((b: { raw: string; index: number }, idx: number) => ({ raw: b.raw, score: scores[idx] }));
            scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
            // Take top blocks until 800 chars total
            let charBudget = 800;
            const topPassages: string[] = [];
            for (const block of scored) {
              if (charBudget <= 0) break;
              if (block.score <= 0 && topPassages.length > 0) break; // skip zero-score blocks if we have content
              const text = block.raw.substring(0, charBudget);
              topPassages.push(text);
              charBudget -= text.length;
            }
            highlight = topPassages.join('\n\n');
          }

          return `[${i + 1}] ${v.title}\nURL: ${v.url}${structuredInfo}\n\n${highlight}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      const systemPrompt = `${PROMPT_INJECTION_DEFENSE}Answer the query using these sources. Be specific with names, numbers, dates, and prices. Bold key facts. Cite sources inline as [1], [2], [3] etc. At the end, list Sources with their URLs. If sources disagree, note the difference.${isEquipmentRental ? ' IMPORTANT: Include specific rental prices/rates per day or week if available in the sources. Mention the cheapest option.' : ''}${isServiceBusiness ? ' IMPORTANT: Include business hours, phone numbers, and whether they are open now.' : ''}${isGasStation ? ' IMPORTANT: Include gas prices per gallon if available. Mention the cheapest station, its address, and current price. Sort by price.' : ''}${isTravelBooking ? ' IMPORTANT: List specific prices per person for different cruise lines/options. Format as a comparison: cruise line, ship name, duration, departure port, price. Sort cheapest first. Include dates if available.' : ''} Max 200 words.`;

      // BM25 highlights are already lean (~800 chars/source) — allow more total for 8 sources
      const truncatedSources = sourceContent.substring(0, 4000);
      const userMessage = `Query: ${sanitizeSearchQuery(query)}\n\nSources:\n${truncatedSources}`;

      const tLlm = Date.now();

      const text = await callLLMQuick(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
      console.log(`[smart-search] LLM answered: ${text.length} chars`);
      if (text) {
        answer = text;
      }

      llmMs = Date.now() - tLlm;

      // ── Confidence scoring ──────────────────────────────────────────
      // Compute confidence based on source agreement and credibility
      const peeledSources = enriched.filter(
        (s) => s.status === 'fulfilled' && (s as PromiseFulfilledResult<any>).value.content !== null
      );
      const peeledDomains = new Set(
        peeledSources.map((s) => getDomain((s as PromiseFulfilledResult<any>).value.url))
      );
      const hasOfficialSource = results.slice(0, 5).some(
        (r: any) => r.credibility?.tier === 'official' || r.credibility?.tier === 'established'
      );

      if (peeledDomains.size >= 3 && hasOfficialSource) {
        confidence = 'HIGH';
      } else if (peeledDomains.size >= 2) {
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
      }
    } catch (err) {
      // Graceful degradation: LLM failure → return raw results without answer
      console.warn('General search LLM synthesis failed (graceful fallback):', (err as Error).message);
    }
  }

  const mapUrl = localBusinesses.length > 0 && GOOGLE_PLACES_KEY
    ? `https://www.google.com/maps/embed/v1/search?q=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_KEY}`
    : undefined;

  return {
    type: 'general',
    source: 'Web Search',
    sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    content,
    results,
    tokens: content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    timing: { searchMs, peelMs, llmMs },
    ...(mapUrl ? { mapUrl } : {}),
  };
}
