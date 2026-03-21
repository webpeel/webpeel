import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 33. Polymarket extractor — prediction market data via Gamma API
// ---------------------------------------------------------------------------

export async function polymarketExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'polymarket.com';

  // Helper: format price as percent
  const fmtPct = (p: string | number) => {
    const n = typeof p === 'string' ? parseFloat(p) : p;
    if (isNaN(n)) return '?%';
    return (n * 100).toFixed(1) + '%';
  };

  // Helper: format large dollar amount
  const fmtVol = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (isNaN(n) || n === 0) return '$0';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  // Helper: format date string
  const fmtDate = (d: string) => {
    if (!d) return '?';
    return d.slice(0, 10);
  };

  // --- Specific event page: /event/<slug> ---
  const eventMatch = path.match(/^\/event\/([^/?#]+)/);
  if (eventMatch) {
    const slug = eventMatch[1];
    try {
      // Fetch event by slug from gamma API
      const events = await fetchJson(
        `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}&limit=1`
      );

      if (Array.isArray(events) && events.length > 0) {
        const event = events[0];
        const markets: any[] = event.markets || [];

        const structured: Record<string, any> = {
          title: event.title || slug,
          slug: event.slug,
          volume: event.volume,
          volume24hr: event.volume24hr,
          endDate: event.endDate,
          markets: markets.map((m: any) => ({
            question: m.question,
            outcomes: m.outcomes,
            outcomePrices: m.outcomePrices,
            volume: m.volume,
            volume24hr: m.volume24hr,
            endDate: m.endDate,
            bestBid: m.bestBid,
            bestAsk: m.bestAsk,
            lastTradePrice: m.lastTradePrice,
          })),
        };

        const marketsMd = markets.map((m: any) => {
          const outcomes: string[] = JSON.parse(m.outcomes || '[]');
          const prices: string[] = JSON.parse(m.outcomePrices || '[]');
          const priceStr = outcomes.map((o, i) => `${o}: **${fmtPct(prices[i] ?? 0)}**`).join(' | ');
          const vol24 = m.volume24hr ? ` | Vol 24h: ${fmtVol(m.volume24hr)}` : '';
          const endDate = m.endDate ? ` | Ends: ${fmtDate(m.endDate)}` : '';
          return `- **${m.question}**\n  ${priceStr}${vol24}${endDate}`;
        }).join('\n\n');

        const totalVol24 = fmtVol(event.volume24hr || 0);
        const totalVol = fmtVol(event.volume || 0);

        const cleanContent = `# 📊 Polymarket: ${event.title || slug}

**Volume (24h):** ${totalVol24} | **Total Volume:** ${totalVol} | **Ends:** ${fmtDate(event.endDate)}

## Markets

${marketsMd || '*No active markets found.*'}

---
*Source: [Polymarket](https://polymarket.com/event/${slug}) · Data via Polymarket Gamma API*`;

        return { domain, type: 'event', structured, cleanContent };
      }

      // If event not found by slug, try a keyword search in markets
      const markets = await fetchJson(
        `https://gamma-api.polymarket.com/markets?closed=false&limit=10&order=volume24hr&ascending=false&q=${encodeURIComponent(slug.replace(/-/g, ' '))}`
      );

      if (Array.isArray(markets) && markets.length > 0) {
        return buildPolymarketMarketList(markets, domain, `Search: ${slug}`);
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Polymarket event fetch failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Main page or /markets: show top markets by 24h volume ---
  try {
    const markets = await fetchJson(
      'https://gamma-api.polymarket.com/markets?closed=false&limit=20&order=volume24hr&ascending=false'
    );
    if (Array.isArray(markets)) {
      return buildPolymarketMarketList(markets, domain, 'Top Markets');
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Polymarket markets fetch failed:', e instanceof Error ? e.message : e);
  }

  return null;
}

function buildPolymarketMarketList(markets: any[], domain: string, title: string): DomainExtractResult {
  const fmtPct = (p: string | number) => {
    const n = typeof p === 'string' ? parseFloat(p) : p;
    if (isNaN(n)) return '?%';
    return (n * 100).toFixed(1) + '%';
  };
  const fmtVol = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (isNaN(n) || n === 0) return '$0';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const rows = markets.slice(0, 15).map((m: any) => {
    const outcomes: string[] = (() => { try { return JSON.parse(m.outcomes || '[]'); } catch { return []; } })();
    const prices: string[] = (() => { try { return JSON.parse(m.outcomePrices || '[]'); } catch { return []; } })();

    const yesPrice = outcomes[0] ? fmtPct(prices[0] ?? 0) : '?%';
    const vol24 = fmtVol(m.volume24hr || 0);
    const end = m.endDate ? m.endDate.slice(0, 10) : '?';
    return `| ${m.question} | ${yesPrice} | ${vol24} | ${end} |`;
  }).join('\n');

  const structured: Record<string, any> = {
    markets: markets.slice(0, 15).map((m: any) => ({
      question: m.question,
      slug: m.slug,
      outcomePrices: m.outcomePrices,
      outcomes: m.outcomes,
      volume24hr: m.volume24hr,
      endDate: m.endDate,
    })),
    fetchedAt: new Date().toISOString(),
  };

  const cleanContent = `# 📊 Polymarket — ${title}

| Question | Yes Price | Vol 24h | End Date |
|----------|-----------|---------|----------|
${rows}

---
*Source: [Polymarket](https://polymarket.com) · Data via Polymarket Gamma API*`;

  return { domain, type: 'markets', structured, cleanContent };
}

