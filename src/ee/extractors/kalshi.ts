import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 34. Kalshi extractor — prediction market data via Kalshi Elections API
// ---------------------------------------------------------------------------

export async function kalshiExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'kalshi.com';

  // Helper: format Kalshi dollar price (they use dollars like 0.78 = 78¢ = 78%)
  const fmtPct = (v: number | string | null | undefined) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (n == null || isNaN(n)) return '?%';
    return (n * 100).toFixed(0) + '%';
  };

  const fmtVol = (v: number | string | null | undefined) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (n == null || isNaN(n) || n === 0) return '$0';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  // --- Specific market/event page: /markets/<ticker> or /events/<ticker> ---
  const tickerMatch = path.match(/^\/(?:markets|events)\/([^/?#]+)/);
  if (tickerMatch) {
    const ticker = tickerMatch[1].toUpperCase();
    try {
      // Try fetching the specific event by ticker
      const data = await fetchJson(
        `https://api.elections.kalshi.com/trade-api/v2/events/${ticker}?with_nested_markets=true`
      );

      const event = data?.event;
      if (event) {
        const markets: any[] = event.markets || [];

        const structured: Record<string, any> = {
          title: event.title,
          ticker: event.event_ticker,
          category: event.category,
          markets: markets.map((m: any) => ({
            title: m.title,
            ticker: m.ticker,
            yes_bid: m.yes_bid_dollars,
            yes_ask: m.yes_ask_dollars,
            volume: m.volume_fp,
            volume_24h: m.volume_24h_fp,
            last_price: m.last_price_dollars,
            expiration: m.expiration_time,
          })),
        };

        const marketsMd = markets.map((m: any) => {
          const yesBid = fmtPct(m.yes_bid_dollars);
          const yesAsk = fmtPct(m.yes_ask_dollars);
          const vol = fmtVol(m.volume_fp);
          const vol24 = fmtVol(m.volume_24h_fp);
          const expiry = m.expiration_time ? m.expiration_time.slice(0, 10) : '?';
          return `- **${m.title}**\n  Yes: ${yesBid}–${yesAsk} | Vol: ${vol} | Vol 24h: ${vol24} | Expires: ${expiry}`;
        }).join('\n\n');

        const cleanContent = `# 🎯 Kalshi: ${event.title}

**Category:** ${event.category || 'General'} | **Ticker:** ${event.event_ticker}

## Markets

${marketsMd || '*No active markets found.*'}

---
*Source: [Kalshi](https://kalshi.com/markets/${ticker.toLowerCase()}) · Data via Kalshi Trade API*`;

        return { domain, type: 'event', structured, cleanContent };
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Kalshi event fetch failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Main page or /markets: show top open events ---
  try {
    const data = await fetchJson(
      'https://api.elections.kalshi.com/trade-api/v2/events?limit=20&status=open&with_nested_markets=true'
    );

    const events: any[] = data?.events || [];
    if (events.length > 0) {
      const rows = events.slice(0, 15).map((e: any) => {
        const markets: any[] = e.markets || [];
        const firstMkt = markets[0];
        const yesBid = firstMkt ? fmtPct(firstMkt.yes_bid_dollars) : '?%';
        const vol24 = firstMkt ? fmtVol(firstMkt.volume_24h_fp) : '$0';
        const mktCount = markets.length > 1 ? ` (+${markets.length - 1} more)` : '';
        return `| ${e.title} | ${yesBid}${mktCount} | ${vol24} | ${e.category || '?'} |`;
      }).join('\n');

      const structured: Record<string, any> = {
        events: events.slice(0, 15).map((e: any) => ({
          title: e.title,
          ticker: e.event_ticker,
          category: e.category,
          markets: (e.markets || []).length,
        })),
        fetchedAt: new Date().toISOString(),
      };

      const cleanContent = `# 🎯 Kalshi — Top Open Events

| Event | Yes Price | Vol 24h | Category |
|-------|-----------|---------|----------|
${rows}

---
*Source: [Kalshi](https://kalshi.com/markets) · Data via Kalshi Trade API*`;

      return { domain, type: 'markets', structured, cleanContent };
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Kalshi markets fetch failed:', e instanceof Error ? e.message : e);
  }

  return null;
}

