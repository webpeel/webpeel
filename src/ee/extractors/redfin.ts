import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { fetchRedfinListings, formatRedfinListings } from './zillow.js';

// ---------------------------------------------------------------------------
// Redfin extractor — live listings via Redfin's internal stingray API
// ---------------------------------------------------------------------------

export async function redfinExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const u = new URL(url);
    const path = u.pathname;

    // ── Pattern 1: /city/{id}/{state}/{city-name} ───────────────────────────
    // e.g. redfin.com/city/30749/NY/New-York
    const cityMatch = path.match(/^\/city\/(\d+)\/([A-Z]{2})\/([^/]+)/);
    if (cityMatch) {
      const regionId = cityMatch[1];
      const stateCode = cityMatch[2];
      const citySlug = cityMatch[3];
      const cityName = citySlug.replace(/-/g, ' ');
      const locationLabel = `${cityName}, ${stateCode}`;

      const payload = await fetchRedfinListings(regionId, 6 /* city */);
      if (payload?.homes && payload.homes.length > 0) {
        return formatRedfinListings(payload.homes, locationLabel, url, payload.searchMedian);
      }
    }

    // ── Pattern 2: /{state}/{city} or /{state}/{city}/filter/... ───────────
    // e.g. redfin.com/NY/New-York or redfin.com/NY/Brooklyn
    const stateCity = path.match(/^\/([A-Z]{2})\/([^/]+)(?:\/|$)/);
    if (stateCity) {
      const stateCode = stateCity[1];
      const citySlug = stateCity[2];
      const cityName = citySlug.replace(/-/g, ' ');
      const locationLabel = `${cityName}, ${stateCode}`;

      // No region ID in URL — use known Redfin city region IDs (region_type=6)
      const cityRegionMap: Record<string, number> = {
        'NY-New-York': 30749, 'NY-Brooklyn': 30749, 'NY-Queens': 30749, 'NY-Bronx': 30749,
        'NY-Staten-Island': 30749, 'NY-Manhattan': 30749,
        'CA-Los-Angeles': 11203, 'CA-San-Francisco': 17151, 'CA-San-Diego': 18142,
        'CA-San-Jose': 17420,
        'TX-Houston': 30772, 'TX-Dallas': 35799, 'TX-Austin': 30818,
        'FL-Miami': 10201, 'FL-Orlando': 13140, 'FL-Tampa': 18280,
        'IL-Chicago': 29470, 'WA-Seattle': 16163, 'MA-Boston': 1826,
        'AZ-Phoenix': 14240, 'PA-Philadelphia': 13364, 'GA-Atlanta': 30756,
        'CO-Denver': 11093, 'MN-Minneapolis': 18959, 'OR-Portland': 14941,
        'NV-Las-Vegas': 32820, 'NC-Charlotte': 3105, 'OH-Columbus': 8528,
      };
      const marketKey = `${stateCode}-${citySlug}`;
      const marketId = cityRegionMap[marketKey];

      if (marketId) {
        const payload = await fetchRedfinListings(marketId, 6 /* city */);
        if (payload?.homes && payload.homes.length > 0) {
          return formatRedfinListings(payload.homes, locationLabel, url, payload.searchMedian);
        }
      }

      // Fallback: return helpful info about what Redfin offers
      const cleanContent = [
        `# 🏠 Redfin — ${locationLabel}`,
        '',
        `*Redfin listing search for ${locationLabel}*`,
        '',
        '> 💡 For the best results, use a city URL with a region ID:',
        `> \`webpeel "https://www.redfin.com/city/{id}/${stateCode}/${citySlug}"\``,
        '',
        `**[Browse ${cityName} on Redfin](${url})**`,
      ].join('\n');

      return {
        domain: 'redfin.com',
        type: 'real-estate-search',
        structured: { city: cityName, state: stateCode },
        cleanContent,
      };
    }

    // ── Pattern 3: Individual property page ─────────────────────────────────
    // e.g. /NY/New-York/123-Main-St-10001/home/12345678
    const propMatch = path.match(/^\/([A-Z]{2})\/([^/]+)\/(.+?)\/home\/(\d+)/);
    if (propMatch) {
      const stateCode = propMatch[1];
      const citySlug = propMatch[2];
      const addressSlug = propMatch[3];
      const propertyId = propMatch[4];
      const address = addressSlug.replace(/-/g, ' ');
      const city = citySlug.replace(/-/g, ' ');

      // Use the Redfin GIS API for a single property by ID
      const apiUrl = `https://www.redfin.com/stingray/api/home/details/aboveTheFold?propertyId=${propertyId}&accessLevel=1`;
      try {
        const resp = await simpleFetch(
          apiUrl,
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          30000,
          { 'Accept': 'application/json', 'Referer': 'https://www.redfin.com/' },
        );
        if (resp && (!resp.statusCode || resp.statusCode < 400)) {
          const raw = resp.html.replace(/^\{\}&&/, '');
          const data = JSON.parse(raw);
          if (data.resultCode === 0 && data.payload) {
            const p = data.payload;
            const price = p.basicInfo?.price?.amount;
            const beds = p.basicInfo?.beds;
            const baths = p.basicInfo?.baths;
            const sqft = p.basicInfo?.sqFt;
            const status = p.basicInfo?.status;
            const desc = p.basicInfo?.description;

            const cleanContent = [
              `# 🏠 ${address}, ${city}, ${stateCode}`,
              '',
              price ? `**Price:** $${Number(price).toLocaleString()}` : '',
              [beds && `${beds} beds`, baths && `${baths} baths`, sqft && `${Number(sqft).toLocaleString()} sqft`].filter(Boolean).join(' · '),
              status ? `**Status:** ${status}` : '',
              '',
              desc ? `## Description\n\n${desc.slice(0, 800)}${desc.length > 800 ? '…' : ''}` : '',
              '',
              `[View on Redfin](${url})`,
            ].filter(Boolean).join('\n');

            return {
              domain: 'redfin.com',
              type: 'property',
              structured: { address, city, state: stateCode, propertyId, price, beds, baths, sqFt: sqft, status },
              cleanContent,
            };
          }
        }
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'Redfin property detail error:', e instanceof Error ? e.message : e);
      }

      // Fallback for property pages
      return {
        domain: 'redfin.com',
        type: 'property',
        structured: { address, city, state: stateCode, propertyId },
        cleanContent: `# 🏠 ${address}, ${city}, ${stateCode}\n\n[View on Redfin](${url})`,
      };
    }

    // ── Pattern 4: Homepage or general search ───────────────────────────────
    // Return info about how to use Redfin extractor
    return {
      domain: 'redfin.com',
      type: 'homepage',
      structured: {},
      cleanContent: [
        '# 🏠 Redfin — Real Estate Listings',
        '',
        'For live MLS listings, use a city or neighborhood URL:',
        '',
        '**City search:**',
        '- `webpeel "https://www.redfin.com/city/30749/NY/New-York"` — NYC listings',
        '- `webpeel "https://www.redfin.com/city/17184/CA/Los-Angeles"` — LA listings',
        '',
        '**State/city search:**',
        '- `webpeel "https://www.redfin.com/NY/New-York"` — NYC',
        '- `webpeel "https://www.redfin.com/CA/San-Francisco"` — SF',
        '',
        '*Redfin uses live MLS data — no bot detection blocks WebPeel.*',
      ].join('\n'),
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Redfin extractor error:', e instanceof Error ? e.message : e);
    return null;
  }
}

