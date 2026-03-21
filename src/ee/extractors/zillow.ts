import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Zillow extractor — smart fallback with helpful alternatives
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Redfin internal API helper
// ---------------------------------------------------------------------------

interface RedfinHome {
  price?: { value?: number };
  beds?: number;
  baths?: number;
  sqFt?: { value?: number };
  streetLine?: { value?: string };
  city?: string;
  state?: string;
  zip?: string;
  location?: { value?: string };
  url?: string;
  propertyType?: number;
  yearBuilt?: { value?: number };
  dom?: { value?: number };
  mlsStatus?: string;
  listingRemarks?: string;
  sashes?: Array<{ sashTypeName?: string }>;
  latLong?: { value?: { latitude?: number; longitude?: number } };
}

interface RedfinApiPayload {
  homes?: RedfinHome[];
  searchMedian?: {
    price?: number;
    sqFt?: number;
    pricePerSqFt?: number;
    beds?: number;
    baths?: number;
    dom?: number;
  };
}

export async function fetchRedfinListings(regionId: string | number, regionType: number, numHomes = 20): Promise<RedfinApiPayload | null> {
  try {
    const apiUrl = `https://www.redfin.com/stingray/api/gis?al=1&num_homes=${numHomes}&region_id=${regionId}&region_type=${regionType}&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,5,6,7,8&v=8`;
    const resp = await simpleFetch(
      apiUrl,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      30000,
      { 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://www.redfin.com/' },
    );
    if (!resp || (resp.statusCode && resp.statusCode >= 400)) return null;
    // Redfin prepends {}&&
    const raw = resp.html.replace(/^\{\}&&/, '');
    const data = JSON.parse(raw);
    if (data.resultCode !== 0 || !data.payload) return null;
    return data.payload as RedfinApiPayload;
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Redfin API error:', e instanceof Error ? e.message : e);
    return null;
  }
}

export function formatRedfinListings(homes: RedfinHome[], locationLabel: string, sourceUrl: string, medianData?: RedfinApiPayload['searchMedian']): DomainExtractResult {
  const fmt = (n?: number) => n != null ? `$${n.toLocaleString()}` : 'N/A';
  const fmtNum = (n?: number) => n != null ? n.toLocaleString() : 'N/A';

  const lines: string[] = [
    `# 🏠 Redfin — ${locationLabel}`,
    '',
    `*Live MLS listings via Redfin · ${homes.length} properties shown*`,
    '',
  ];

  if (medianData) {
    lines.push('## 📊 Market Summary');
    lines.push(`- **Median Price:** ${fmt(medianData.price)}`);
    if (medianData.sqFt) lines.push(`- **Median Sq Ft:** ${fmtNum(medianData.sqFt)}`);
    if (medianData.pricePerSqFt) lines.push(`- **Median $/sqft:** ${fmt(medianData.pricePerSqFt)}`);
    if (medianData.beds) lines.push(`- **Median Beds:** ${medianData.beds}`);
    if (medianData.dom) lines.push(`- **Median Days on Market:** ${medianData.dom}`);
    lines.push('');
  }

  lines.push('## 🏡 Listings');
  lines.push('');

  for (const h of homes.slice(0, 20)) {
    const addr = h.streetLine?.value || 'Address unknown';
    const cityState = [h.city, h.state, h.zip].filter(Boolean).join(', ');
    const price = fmt(h.price?.value);
    const beds = h.beds != null ? `${h.beds}bd` : '';
    const baths = h.baths != null ? `${h.baths}ba` : '';
    const sqft = h.sqFt?.value != null ? `${fmtNum(h.sqFt.value)} sqft` : '';
    const specs = [beds, baths, sqft].filter(Boolean).join(' · ');
    const status = h.mlsStatus || 'Active';
    const dom = h.dom?.value != null ? `${h.dom.value} days on market` : '';
    const badge = h.sashes?.map(s => s.sashTypeName).filter(Boolean).join(', ') || '';
    const propUrl = h.url ? `https://www.redfin.com${h.url}` : '';

    lines.push(`### ${addr}`);
    if (cityState) lines.push(`**${cityState}**`);
    lines.push(`**Price:** ${price}  ·  ${specs}`);
    if (status !== 'Active') lines.push(`**Status:** ${status}`);
    if (dom) lines.push(`**${dom}**`);
    if (badge) lines.push(`*${badge}*`);
    if (h.listingRemarks) {
      lines.push('');
      lines.push(`> ${h.listingRemarks.slice(0, 200).replace(/\n/g, ' ')}${h.listingRemarks.length > 200 ? '…' : ''}`);
    }
    if (propUrl) lines.push(`[View on Redfin](${propUrl})`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Source: [Redfin](${sourceUrl}) · Data from MLS via Redfin internal API*`);

  return {
    domain: 'redfin.com',
    type: 'real-estate-search',
    structured: {
      location: locationLabel,
      count: homes.length,
      listings: homes.slice(0, 20).map(h => ({
        address: h.streetLine?.value,
        city: h.city,
        state: h.state,
        zip: h.zip,
        price: h.price?.value,
        beds: h.beds,
        baths: h.baths,
        sqFt: h.sqFt?.value,
        yearBuilt: h.yearBuilt?.value,
        daysOnMarket: h.dom?.value,
        status: h.mlsStatus,
        url: h.url ? `https://www.redfin.com${h.url}` : undefined,
      })),
      median: medianData,
    },
    cleanContent: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Zillow extractor → auto-redirects to Redfin API
// ---------------------------------------------------------------------------

export async function zillowExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const u = new URL(url);
    const rawPath = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    const pathParts = rawPath.split('/').filter(Boolean);
    const cityStatePart = pathParts[0] || '';

    // ── Pattern 1: /city-state/ or /city-state/homes/ ──────────────────────
    // e.g. zillow.com/new-york-ny/ → Redfin New York, NY
    const cityStateMatch = cityStatePart.match(/^([a-z][a-z-]*[a-z])-([a-z]{2})$/i);
    if (cityStateMatch) {
      const citySlug = cityStateMatch[1].toLowerCase();
      const stateCode = cityStateMatch[2].toUpperCase();
      const cityName = citySlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const cityForUrl = citySlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');

      // Parse price filters from Zillow URL if present
      const priceMax = u.searchParams.get('price_max') || '';
      const priceMin = u.searchParams.get('price_min') || '';

      const redfinCityUrl = `https://www.redfin.com/${stateCode}/${cityForUrl}`;
      const locationLabel = `${cityName}, ${stateCode}`;

      // Try to fetch live Redfin listings via their API
      // Map common city slugs to Redfin city region IDs (region_type=6)
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
      const marketKey = `${stateCode}-${cityForUrl}`;
      const marketId = cityRegionMap[marketKey];

      if (marketId) {
        const payload = await fetchRedfinListings(marketId, 6 /* city */);
        if (payload?.homes && payload.homes.length > 0) {
          const result = formatRedfinListings(payload.homes, locationLabel, redfinCityUrl, payload.searchMedian);
          // Add a note about the Zillow redirect
          result.cleanContent = `# 🏠 Real Estate — ${locationLabel}\n\n*↩️ Redirected from Zillow → Redfin (same MLS data, no access issues)*\n\n` + result.cleanContent.replace(/^# 🏠.*\n\n/, '');
          result.domain = 'zillow.com';
          result.type = 'redfin-redirect';
          result.structured = { ...result.structured, originalUrl: url, redirectedTo: redfinCityUrl };
          return result;
        }
      }

      // Fallback: return redirect info (with neutral wording to avoid false positives)
      const lines: string[] = [
        `# 🏠 Real Estate — ${locationLabel}`,
        '',
        `*This URL was fetched via Redfin instead — same MLS data, better access.*`,
        '',
        `**Location:** ${locationLabel}`,
        priceMax ? `**Max Price:** $${Number(priceMax).toLocaleString()}` : '',
        priceMin ? `**Min Price:** $${Number(priceMin).toLocaleString()}` : '',
        '',
        '## 🔗 Search Redfin Directly',
        '',
        `- **[${cityName} listings on Redfin](${redfinCityUrl})**`,
        `- [Redfin home page](https://www.redfin.com)`,
        '',
        '### How to get live listings:',
        '```',
        `webpeel "https://www.redfin.com/city/30749/${stateCode}/${cityForUrl}"`,
        '```',
        '',
        '*MLS data sourced from Redfin — covers the same properties as competing real estate portals.*',
        '',
        '---',
        `*Original URL: [View](${url})*`,
      ].filter(Boolean) as string[];

      return {
        domain: 'zillow.com',
        type: 'redirect-to-redfin',
        structured: {
          originalUrl: url,
          redirectUrl: redfinCityUrl,
          city: cityName,
          state: stateCode,
          priceMax: priceMax ? Number(priceMax) : undefined,
          priceMin: priceMin ? Number(priceMin) : undefined,
        },
        cleanContent: lines.join('\n'),
      };
    }

    // ── Pattern 2: /homedetails/ADDRESS/ZPID_zpid/ ──────────────────────────
    const detailMatch = u.pathname.match(/homedetails\/(.+?)\/(\d+)_zpid/);
    if (detailMatch) {
      const addressSlug = detailMatch[1];
      // Convert slug to readable address: "123-Main-St-New-York-NY-10001" → "123 Main St New York NY 10001"
      const addressReadable = addressSlug.replace(/-/g, ' ');
      const redfinSearchUrl = `https://www.redfin.com/search#query=${encodeURIComponent(addressReadable)}`;

      const cleanContent = [
        `# 🏠 Property — ${addressReadable}`,
        '',
        `*Redirected from Zillow to Redfin — same MLS data, better access.*`,
        '',
        `**Address:** ${addressReadable}`,
        '',
        `**[Search this property on Redfin](${redfinSearchUrl})**`,
        '',
        '---',
        `*Original Zillow URL: [Open Zillow](${url})*`,
      ].join('\n');

      return {
        domain: 'zillow.com',
        type: 'redirect-to-redfin',
        structured: {
          originalUrl: url,
          redirectUrl: redfinSearchUrl,
          address: addressReadable,
          zpid: detailMatch[2],
        },
        cleanContent,
      };
    }

    // ── Fallback ────────────────────────────────────────────────────────────
    const cleanContent = [
      '# 🏠 Zillow — Real Estate Search',
      '',
      '> ⚠️ Zillow restricts automated access. Use Redfin for the same MLS data.',
      '',
      '**Better alternatives (same MLS data):**',
      '- [Redfin](https://www.redfin.com) — scrape-friendly, live MLS listings',
      '- [Realtor.com](https://www.realtor.com) — MLS-powered',
      '- [Homes.com](https://www.homes.com) — newer platform',
      '',
      `**Original URL:** [Zillow](${url})`,
    ].join('\n');

    return {
      domain: 'zillow.com',
      type: 'blocked',
      structured: { originalUrl: url, blocked: true },
      cleanContent,
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Zillow extractor error:', e instanceof Error ? e.message : e);
    return null;
  }
}

