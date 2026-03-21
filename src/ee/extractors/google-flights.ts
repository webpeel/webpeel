import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Google Flights extractor
// ---------------------------------------------------------------------------
export async function googleFlightsExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  if (!url.includes('/travel/flights')) return null;

  // Google Flights is a SPA. The _html parameter is usually readability-processed markdown
  // (from the pipeline's post-fetch processing), which looks like:
  //   -   7:15 PM
  //       7:15 PM on Sat, Apr 4
  //        – 10:29 PM
  //       United
  //       3 hr 14 min
  //       EWR
  //       ...
  //       $188
  //
  // This markdown is much easier to parse than raw HTML.
  
  let text = _html;
  
  // If this is raw HTML (contains <!DOCTYPE or <html), strip HTML tags
  if (text.includes('<!DOCTYPE') || text.includes('<html')) {
    text = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\n{2,}/g, '\n');
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  interface Flight {
    departTime: string;
    arriveTime: string;
    departDate: string;
    airline: string;
    duration: string;
    fromAirport: string;
    toAirport: string;
    stops: string;
    price: number;
    priceStr: string;
    bags: string;
  }

  const AIRLINES = ['United', 'Delta', 'American', 'JetBlue', 'Spirit', 'Frontier', 'Southwest', 'Breeze', 'Alaska', 'Hawaiian', 'Sun Country', 'Avelo'];
  const flights: Flight[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect departure time
    const departMatch = line.match(/^(?:-\s+)?(\d{1,2}:\d{2}\s*[AP]M)$/);
    if (!departMatch) continue;

    const departTime = departMatch[1];
    let departDate = '', arriveTime = '', airline = '', duration = '';
    let fromAirport = '', toAirport = '', stops = '', bags = '';
    let price = 0;

    for (let j = i + 1; j < Math.min(i + 45, lines.length); j++) {
      const l = lines[j];

      // Date
      const dateM = l.match(/on\s+(\w+,\s+\w+\s+\d+)/);
      if (dateM && !departDate) { departDate = dateM[1]; continue; }

      // Arrival time
      const arrM = l.match(/^[–\-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)$/) || l.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+on\s/);
      if (arrM && !arriveTime && departTime) { arriveTime = arrM[1]; continue; }

      // Arrival time: also check for "10:29 PM on Sat, Apr 4" pattern (second occurrence)
      if (!arriveTime && l.match(/^\d{1,2}:\d{2}\s*[AP]M\s+on\s/)) {
        const m = l.match(/^(\d{1,2}:\d{2}\s*[AP]M)/);
        if (m) { arriveTime = m[1]; continue; }
      }

      // Airline
      if (!airline) {
        for (const a of AIRLINES) {
          if (l === a || l.startsWith(a + 'Operated') || l.startsWith(a + ' ')) { airline = a; break; }
        }
        if (airline) continue;
      }

      // Duration
      if (!duration && l.match(/^\d+\s+hr\s+\d+\s+min$/)) { duration = l; continue; }

      // Airport codes
      if (l.match(/^[A-Z]{3}$/) && !fromAirport) { fromAirport = l; continue; }
      if (l.match(/^[A-Z]{3}$/) && fromAirport && !toAirport && l !== fromAirport) { toAirport = l; continue; }

      // Stops
      if (!stops && (l === 'Nonstop' || l.match(/^\d+\s+stop/))) { stops = l; continue; }

      // Bags
      if (l.includes('carry-on bag') && !bags) {
        bags = l.includes('not included') ? 'Carry-on NOT included (extra fee)' : 'Carry-on included';
        continue;
      }

      // Price — first occurrence only
      const priceM = l.match(/^\$(\d[\d,]*)$/);
      if (priceM && !price) { price = parseInt(priceM[1].replace(',', '')); break; }
    }

    if (departTime && arriveTime && airline && price) {
      flights.push({ departTime, arriveTime, departDate, airline, duration, fromAirport, toAirport, stops: stops || 'Unknown', price, priceStr: `$${price}`, bags });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = flights.filter(f => {
    const key = `${f.departTime}-${f.airline}-${f.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) return null;
  unique.sort((a, b) => a.price - b.price);

  // Helper: get airline booking URL
  function getAirlineBookingUrl(airline: string, from: string, to: string, dateStr: string): string {
    const fromUp = from.toUpperCase();
    const toUp = to.toUpperCase();

    // Airline homepages — direct booking pages (deep links don't work without session/cookies)
    const urlMap: Record<string, string> = {
      'United':      `https://www.united.com`,
      'Delta':       `https://www.delta.com`,
      'JetBlue':     `https://www.jetblue.com`,
      'American':    `https://www.aa.com`,
      'Spirit':      `https://www.spirit.com`,
      'Frontier':    `https://www.flyfrontier.com`,
      'Southwest':   `https://www.southwest.com`,
      'Breeze':      `https://www.flybreeze.com`,
      'Alaska':      `https://www.alaskaair.com`,
      'Hawaiian':    `https://www.hawaiianairlines.com`,
      'Sun Country': `https://www.suncountry.com`,
      'Avelo':       `https://www.aveloair.com`,
    };
    return urlMap[airline] || `https://www.google.com/travel/flights?q=${encodeURIComponent(`${airline} flights ${fromUp} to ${toUp} ${dateStr}`)}`;
  }

  // Parse route from URL
  const u = new URL(url);
  const query = (u.searchParams.get('q') || '').replace(/Flights?\s+(from\s+)?/i, '').replace(/\s+one\s+way/i, '').trim();

  const md: string[] = [
    `# ✈️ Flights — ${query || 'Search Results'}`,
    '',
    `*${unique.length} flights found · Source: [Google Flights](${url})*`,
    `*Prices include taxes + fees for 1 adult. Book directly via airline.*`,
    '',
  ];

  for (let idx = 0; idx < unique.length; idx++) {
    const f = unique[idx];
    const bookingUrl = getAirlineBookingUrl(f.airline, f.fromAirport, f.toAirport, f.departDate);
    md.push(`## ${idx + 1}. ${f.airline} — ${f.priceStr}`);
    md.push(`🕐 Depart **${f.departTime}** → Arrive **${f.arriveTime}**${f.departDate ? ` · ${f.departDate}` : ''}`);
    md.push(`🛫 ${f.fromAirport} → ${f.toAirport} · ${f.duration} · ${f.stops}`);
    if (f.bags) md.push(`🧳 ${f.bags}`);
    md.push(`🔍 [See price on Google Flights](${url})`);
    md.push(`🛒 [Book on ${f.airline}](${bookingUrl})`);
    md.push('');
  }

  md.push('---');
  md.push(`📌 *All prices verified via [Google Flights](${url}). Click "See price" to confirm, then book directly with the airline.*`);

  return {
    domain: 'google.com/travel/flights',
    type: 'flights',
    structured: { flights: unique, route: query, source: 'Google Flights', sourceUrl: url },
    cleanContent: md.join('\n'),
  };
}

