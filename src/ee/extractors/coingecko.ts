import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 38. CoinGecko extractor — crypto prices via free CoinGecko API
// ---------------------------------------------------------------------------

export async function coinGeckoExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'coingecko.com';

  const cgHeaders = {
    'Accept': 'application/json',
    'User-Agent': 'webpeel/0.21 (https://webpeel.dev)',
  };

  // Helper: compact number formatting
  const fmtMoney = (v: number) => {
    if (v == null || isNaN(v)) return '?';
    if (v >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(2)}T`;
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtPrice = (v: number) => {
    if (v == null || isNaN(v)) return '?';
    if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (v >= 1) return `$${v.toFixed(4)}`;
    return `$${v.toFixed(8)}`;
  };

  const fmtChange = (c: number | null | undefined) => {
    if (c == null || isNaN(c)) return '?';
    const sign = c >= 0 ? '+' : '';
    return `${sign}${c.toFixed(1)}%`;
  };

  // Coin detail page: /en/coins/<coin-id>
  const coinMatch = path.match(/^\/en\/coins\/([^/?#]+)\/?/);
  if (coinMatch) {
    const coinId = coinMatch[1].toLowerCase();
    try {
      const apiUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&community_data=false&developer_data=false`;
      const data = await fetchJson(apiUrl, cgHeaders);
      if (!data || data.error) return null;

      const md = data.market_data || {};
      const price = md.current_price?.usd;
      const change24h = md.price_change_percentage_24h;
      const change7d = md.price_change_percentage_7d;
      const marketCap = md.market_cap?.usd;
      const volume = md.total_volume?.usd;
      const ath = md.ath?.usd;
      const circulatingSupply = md.circulating_supply;
      const maxSupply = md.max_supply;
      const name = data.name || coinId;
      const symbol = (data.symbol || '').toUpperCase();
      const description = data.description?.en?.replace(/<[^>]+>/g, '').split('\r\n')[0]?.slice(0, 500) || '';
      const updatedAt = data.last_updated || new Date().toISOString();

      const structuredData: Record<string, any> = {
        id: coinId,
        name,
        symbol,
        price_usd: price,
        change_24h: change24h,
        change_7d: change7d,
        market_cap_usd: marketCap,
        volume_24h_usd: volume,
        ath_usd: ath,
        circulating_supply: circulatingSupply,
        max_supply: maxSupply,
        last_updated: updatedAt,
      };

      let cleanContent = `# 🪙 ${name} (${symbol})\n\n`;
      cleanContent += `## Quote\n`;
      cleanContent += `- **Price:** ${fmtPrice(price)}\n`;
      cleanContent += `- **24h Change:** ${fmtChange(change24h)}\n`;
      if (change7d != null) cleanContent += `- **7d Change:** ${fmtChange(change7d)}\n`;
      cleanContent += `- **Market Cap:** ${fmtMoney(marketCap)}\n`;
      cleanContent += `- **24h Volume:** ${fmtMoney(volume)}\n`;
      if (ath != null) cleanContent += `- **All-Time High:** ${fmtPrice(ath)}\n`;
      if (circulatingSupply) {
        const supply = circulatingSupply >= 1_000_000_000
          ? `${(circulatingSupply / 1_000_000_000).toFixed(2)}B`
          : circulatingSupply >= 1_000_000
          ? `${(circulatingSupply / 1_000_000).toFixed(2)}M`
          : circulatingSupply.toLocaleString();
        cleanContent += `- **Circulating Supply:** ${supply} ${symbol}\n`;
      }

      if (description) {
        cleanContent += `\n## Description\n${description}\n`;
      }

      cleanContent += `\n---\n*Source: CoinGecko API · Updated: ${updatedAt}*`;

      return { domain, type: 'coin', structured: structuredData, cleanContent };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'CoinGecko coin API failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  // Main page / markets overview: coingecko.com or coingecko.com/en
  try {
    const apiUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=15&page=1`;
    const coins = await fetchJson(apiUrl, cgHeaders);
    if (!Array.isArray(coins) || coins.length === 0) return null;

    const rows = coins.slice(0, 15).map((c: any, i: number) => {
      const change = c.price_change_percentage_24h;
      const changeStr = change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : '?';
      return `| ${i + 1} | ${c.name} (${(c.symbol || '').toUpperCase()}) | ${fmtPrice(c.current_price)} | ${changeStr} | ${fmtMoney(c.market_cap)} |`;
    });

    const cleanContent = `# 🪙 CoinGecko — Top Cryptocurrencies\n\n` +
      `| # | Coin | Price | 24h | Market Cap |\n` +
      `|---|------|-------|-----|------------|\n` +
      rows.join('\n') +
      `\n\n---\n*Source: CoinGecko API · Updated: ${new Date().toISOString()}*`;

    return {
      domain,
      type: 'markets',
      structured: { coins: coins.slice(0, 15) },
      cleanContent,
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'CoinGecko markets API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

