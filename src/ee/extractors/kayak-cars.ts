import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// Kayak Car Rental extractor
// ---------------------------------------------------------------------------
export async function kayakCarRentalExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  if (!url.includes('/cars/')) return null;

  // Rental company homepage URLs
  const rentalCompanyUrls: Record<string, string> = {
    'Hertz': 'https://www.hertz.com',
    'Budget': 'https://www.budget.com',
    'Avis': 'https://www.avis.com',
    'Enterprise': 'https://www.enterprise.com',
    'National': 'https://www.nationalcar.com',
    'Alamo': 'https://www.alamo.com',
    'Dollar': 'https://www.dollar.com',
    'Thrifty': 'https://www.thrifty.com',
    'Sixt': 'https://www.sixt.com',
    'Fox': 'https://www.foxrentacar.com',
    'Payless': 'https://www.paylesscar.com',
    'Turn': 'https://www.turn.com',
    'EconomyBookings': 'https://www.economybookings.com',
    'Priceline': 'https://www.priceline.com',
    'Expedia': 'https://www.expedia.com',
    'Turo': 'https://www.turo.com',
    'KAYAK': 'https://www.kayak.com',
    'Booking.com': 'https://www.booking.com',
    'DiscoverCars': 'https://www.discovercars.com',
    'RentalCars': 'https://www.rentalcars.com',
    'Car Rental 8': 'https://www.carrental8.com',
    'Hotwire': 'https://www.hotwire.com',
  };

  function getCompanyUrl(company: string): string {
    return rentalCompanyUrls[company] || `https://www.kayak.com`;
  }

  // Parse dates from URL: /cars/Location/YYYY-MM-DD/YYYY-MM-DD
  let numDays = 1;
  let pickupDate = '';
  let dropoffDate = '';
  let locationName = '';
  const dateMatch = url.match(/\/cars\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    locationName = decodeURIComponent(dateMatch[1]);
    pickupDate = dateMatch[2];
    dropoffDate = dateMatch[3];
    const pickup = new Date(pickupDate);
    const dropoff = new Date(dropoffDate);
    numDays = Math.max(1, Math.round((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // Format date range for display (e.g. "Apr 1–3")
  function formatDateRange(from: string, to: string): string {
    if (!from || !to) return '';
    const fromDate = new Date(from + 'T12:00:00');
    const toDate = new Date(to + 'T12:00:00');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fromMonth = months[fromDate.getUTCMonth()];
    const toMonth = months[toDate.getUTCMonth()];
    const fromDay = fromDate.getUTCDate();
    const toDay = toDate.getUTCDate();
    if (fromMonth === toMonth) return `${fromMonth} ${fromDay}–${toDay}`;
    return `${fromMonth} ${fromDay}–${toMonth} ${toDay}`;
  }

  // Process content: strip HTML if needed
  let text = _html;
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

  interface CarListing {
    name: string;
    carClass: string;
    totalPrice: number;
    perDayPrice: number;
    company: string;
    location: string;
    distanceFromCenter: string;
    rating: number | null;
    cancellation: string;
    isTuro: boolean;
  }

  const KNOWN_COMPANIES = ['Hertz', 'Budget', 'Avis', 'Enterprise', 'National', 'Alamo', 'Dollar', 'Thrifty', 'Sixt', 'Fox', 'Payless', 'Turn', 'EconomyBookings', 'Priceline', 'Expedia', 'Turo', 'KAYAK', 'Booking.com', 'DiscoverCars', 'RentalCars', 'Car Rental 8', 'Hotwire'];

  const listings: CarListing[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect: "or similar {Class}" — this signals a standard car rental listing
    // The car name is the line BEFORE "or similar"
    const orSimilarMatch = line.match(/^or similar\s+(.+)$/);
    if (orSimilarMatch) {
      const carClass = orSimilarMatch[1].trim();
      const carName = i > 0 ? lines[i - 1] : '';
      if (!carName || carName.length > 60) continue;

      // Look ahead for: pickup location, rating, company, price
      let location = '';
      let distanceFromCenter = '';
      let rating: number | null = null;
      let company = '';
      let totalPrice = 0;
      let cancellation = '';

      for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
        const l = lines[j];

        // Pickup location
        if (!location && l.startsWith('Pick-up')) {
          const locMatch = l.match(/Pick-up (?:city|airport):\s*(.+)/);
          if (locMatch) location = locMatch[1].trim();
          continue;
        }

        // Distance from center
        if (!distanceFromCenter) {
          const distM = l.match(/^([\d.]+)\s+mi\s+from\s+city\s+center/);
          if (distM) { distanceFromCenter = `${distM[1]} mi from city center`; continue; }
        }

        // Rating (number like "9.2", "8.5", "7.2")
        if (rating === null) {
          const ratingM = l.match(/^(\d+\.\d+)$/);
          if (ratingM) { rating = parseFloat(ratingM[1]); continue; }
        }

        // Company from "X offer from {Company}" or "{Company}" line
        if (!company) {
          const offerMatch = l.match(/offer from (.+)$/);
          if (offerMatch) {
            company = offerMatch[1].trim();
            continue;
          }
          // Also detect company name standalone
          for (const c of KNOWN_COMPANIES) {
            if (l === c) { company = c; break; }
          }
          if (company) continue;
        }

        // Cancellation policy
        if (!cancellation && (l.includes('Free cancellation') || l.includes('No free cancellation'))) {
          cancellation = l;
          continue;
        }

        // Price — "$NNN" followed by "Total"
        const priceM = l.match(/^\$(\d[\d,]*)$/);
        if (priceM) {
          const nextLine = lines[j + 1] || '';
          if (nextLine === 'Total' || nextLine.includes('Total')) {
            totalPrice = parseInt(priceM[1].replace(',', ''));
            break;
          }
        }

        // Also catch price on same line
        const inlinePriceM = l.match(/\$(\d[\d,]*)\s*Total/);
        if (inlinePriceM) {
          totalPrice = parseInt(inlinePriceM[1].replace(',', ''));
          break;
        }

        // Stop if we hit another car listing marker
        if (l.match(/^or similar\s/) || l === 'Show more results') break;
      }

      if (carName && totalPrice > 0) {
        const normalizedClass = carClass.replace('Full size', 'Full-size');
        listings.push({
          name: carName,
          carClass: normalizedClass,
          totalPrice,
          perDayPrice: Math.round(totalPrice / numDays),
          company: company || 'Unknown',
          location: location || 'See booking',
          distanceFromCenter,
          rating,
          cancellation,
          isTuro: false,
        });
      }
    }
  }

  // Deduplicate: first prefer listings with real company info over "Unknown"
  // Key by name+price; keep the one with best data
  const byKey = new Map<string, CarListing>();
  for (const c of listings) {
    const key = `${c.name.toLowerCase()}-${c.totalPrice}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
    } else {
      // Prefer non-Unknown company, or same company with more info
      if (existing.company === 'Unknown' && c.company !== 'Unknown') {
        byKey.set(key, c);
      }
    }
  }
  const unique = Array.from(byKey.values());

  if (unique.length === 0) return null;

  // Filter out Unknown company entries if the total found from page suggests more results exist
  // Also filter them only if they have no location info (these are likely ad/promo extractions)
  const knownCompanyListings = unique.filter(c => c.company !== 'Unknown');
  const finalListings = knownCompanyListings.length > 0 ? knownCompanyListings : unique;

  // Sort by price
  finalListings.sort((a, b) => a.totalPrice - b.totalPrice);

  // Get total count from page if mentioned
  let totalFound = unique.length;
  for (const l of lines) {
    const m = l.match(/^(\d+)\s+results?$/);
    if (m) { totalFound = parseInt(m[1]); break; }
    const m2 = l.match(/(\d+)\s+cars?\s+found/);
    if (m2) { totalFound = parseInt(m2[1]); break; }
  }

  // Format location name nicely (e.g. "Punta-Gorda,FL-c34451" → "Punta Gorda, FL")
  function formatLocation(loc: string): string {
    return loc
      .replace(/-c\d+$/, '')           // remove trailing "-c12345"
      .replace(/-/g, ' ')              // hyphens to spaces
      .replace(/,(\S)/g, ', $1');      // ensure space after comma
  }

  const dateRange = formatDateRange(pickupDate, dropoffDate);
  const displayLocation = formatLocation(locationName);
  const daysLabel = numDays === 1 ? '1 day' : `${numDays} days`;

  const md: string[] = [
    `# 🚗 Car Rentals — ${displayLocation} · ${dateRange} (${daysLabel})`,
    '',
    `*${totalFound} cars found · Source: [Kayak](${url})*`,
    `*Free cancellation available on most rentals*`,
    '',
  ];

  for (let idx = 0; idx < finalListings.length; idx++) {
    const c = finalListings[idx];
    md.push(`## ${idx + 1}. ${c.name} (${c.carClass}) — $${c.totalPrice} total · $${c.perDayPrice}/day`);
    if (c.distanceFromCenter) {
      md.push(`📍 ${c.distanceFromCenter}`);
    } else if (c.location && c.location !== 'See booking') {
      md.push(`📍 ${c.location}`);
    }
    const ratingStr = c.rating !== null ? ` · Rating: ${c.rating}` : '';
    md.push(`🏪 via ${c.company}${ratingStr}`);
    if (c.cancellation) md.push(`✅ ${c.cancellation}`);
    md.push(`🔍 [See price on Kayak](${url})`);
    md.push(`🛒 [Book on ${c.company}](${getCompanyUrl(c.company)})`);
    md.push('');
  }

  md.push('---');
  md.push(`📌 *Prices verified via [Kayak](${url}). Click "See price" to confirm current rate, then book with the rental company.*`);

  return {
    domain: 'kayak.com/cars',
    type: 'car-rental',
    structured: {
      cars: finalListings,
      location: displayLocation,
      pickupDate,
      dropoffDate,
      numDays,
      totalFound,
      source: 'Kayak',
      sourceUrl: url,
    },
    cleanContent: md.join('\n'),
  };
}

