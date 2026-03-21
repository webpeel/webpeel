import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// 35. TradingView extractor — stock/index data via TradingView Scanner API
// ---------------------------------------------------------------------------

export async function tradingViewExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'tradingview.com';

  const scannerHeaders = {
    'Origin': 'https://www.tradingview.com',
    'Referer': 'https://www.tradingview.com/',
    'Content-Type': 'application/json',
  };

  // Helper: format price
  const fmtPrice = (v: number) => {
    if (v == null) return '?';
    if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(2)}T`;
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
    return v.toFixed(2);
  };

  const fmtChange = (c: number) => {
    if (c == null) return '';
    const sign = c >= 0 ? '+' : '';
    return `${sign}${c.toFixed(2)}%`;
  };

  // --- Symbol page: /symbols/<TICKER>/ or /chart?symbol=<TICKER> ---
  const symbolMatch = path.match(/^\/symbols\/([^/?#]+)\/?/);
  const chartSymbolParam = urlObj.searchParams.get('symbol');

  let ticker = symbolMatch?.[1] || chartSymbolParam || null;

  if (ticker) {
    ticker = ticker.toUpperCase().replace(/-/g, '');

    try {
      // Try symbol search to resolve exchange
      const searchResp = await fetch(
        `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(ticker)}&hl=0&lang=en&type=stock,fund,crypto,futures,forex&limit=5`,
        {
          headers: {
            'User-Agent': 'webpeel/0.21 (https://webpeel.dev)',
            'Origin': 'https://www.tradingview.com',
            'Referer': 'https://www.tradingview.com/',
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      const searchData: any[] = await searchResp.json().catch(() => []);

      // Find exact match
      const exactMatch = searchData.find(s => s.symbol === ticker || s.symbol.replace(/<\/?em>/g, '') === ticker);
      const symbolInfo = exactMatch || searchData[0];

      if (symbolInfo) {
        const exchange = symbolInfo.source_id || symbolInfo.exchange || 'NASDAQ';
        // Fetch quote data via scanner
        const scannerUrl = exchange === 'CRYPTO' || exchange === 'COINBASE' || exchange === 'BINANCE'
          ? 'https://scanner.tradingview.com/crypto/scan'
          : 'https://scanner.tradingview.com/america/scan';

        const scanBody = {
          filter: [{ left: 'name', operation: 'equal', right: symbolInfo.symbol?.replace(/<\/?em>/g, '') || ticker }],
          columns: ['name', 'description', 'close', 'open', 'high', 'low', 'volume', 'change', 'change_abs', 'market_cap_basic', 'sector', 'industry', 'country', 'currency'],
          range: [0, 1],
        };

        const scanResp = await fetch(scannerUrl, {
          method: 'POST',
          headers: { ...scannerHeaders, 'User-Agent': 'webpeel/0.21 (https://webpeel.dev)' },
          body: JSON.stringify(scanBody),
          signal: AbortSignal.timeout(10000),
        });
        const scanData = await scanResp.json().catch(() => null);
        const row = scanData?.data?.[0]?.d;

        if (row) {
          const [name, desc, close, open, high, low, volume, changePct, changeAbs, mktCap, sector, industry, country, currency] = row;
          const currStr = currency || 'USD';
          const mktCapStr = mktCap ? fmtPrice(mktCap) : null;

          const structured: Record<string, any> = {
            symbol: name,
            description: desc,
            price: close,
            open,
            high,
            low,
            volume,
            change_pct: changePct,
            change_abs: changeAbs,
            market_cap: mktCap,
            sector,
            industry,
            country,
            currency: currStr,
            exchange,
            fetchedAt: new Date().toISOString(),
          };

          const changeStr = fmtChange(changePct);
          const changeIcon = (changePct ?? 0) >= 0 ? '📈' : '📉';

          const cleanContent = `# ${changeIcon} TradingView: ${desc || name} (${name})

## Quote
- **Price:** ${close?.toFixed(2) ?? '?'} ${currStr}
- **Change:** ${changeStr} (${changeAbs?.toFixed(2) ?? '?'} ${currStr})
- **Open:** ${open?.toFixed(2) ?? '?'} | **High:** ${high?.toFixed(2) ?? '?'} | **Low:** ${low?.toFixed(2) ?? '?'}
- **Volume:** ${fmtPrice(volume ?? 0)}
${mktCapStr ? `- **Market Cap:** ${mktCapStr} ${currStr}` : ''}

## Details
${sector ? `- **Sector:** ${sector}` : ''}
${industry ? `- **Industry:** ${industry}` : ''}
${country ? `- **Country:** ${country}` : ''}
- **Exchange:** ${exchange}

---
*Source: [TradingView](https://www.tradingview.com/symbols/${name}/) · Data via TradingView Scanner API*`;

          return { domain, type: 'symbol', structured, cleanContent };
        }
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'TradingView symbol fetch failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Markets overview page or fallback: show major indices ---
  try {
    // Fetch major indices + top stocks
    const scanBody = {
      filter: [
        { left: 'name', operation: 'in_range', right: ['SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'] },
      ],
      columns: ['name', 'description', 'close', 'change', 'volume', 'market_cap_basic'],
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, 20],
    };

    const resp = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { ...scannerHeaders, 'User-Agent': 'webpeel/0.21 (https://webpeel.dev)' },
      body: JSON.stringify(scanBody),
      signal: AbortSignal.timeout(10000),
    });

    const data = await resp.json().catch(() => null);
    const rows: any[] = data?.data || [];

    if (rows.length > 0) {
      const tableRows = rows.map((row: any) => {
        const [name, desc, close, changePct] = row.d;
        const changeStr = changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '?%';
        const icon = (changePct ?? 0) >= 0 ? '🟢' : '🔴';
        return `| ${name} | ${desc} | ${close?.toFixed(2) ?? '?'} | ${icon} ${changeStr} |`;
      }).join('\n');

      const structured: Record<string, any> = {
        symbols: rows.map((r: any) => ({
          symbol: r.d[0],
          description: r.d[1],
          price: r.d[2],
          change_pct: r.d[3],
        })),
        fetchedAt: new Date().toISOString(),
      };

      const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });

      const cleanContent = `# 📈 TradingView — Market Overview

*As of ${now} ET*

| Symbol | Name | Price | Change |
|--------|------|-------|--------|
${tableRows}

---
*Source: [TradingView](https://www.tradingview.com/markets/) · Data via TradingView Scanner API*`;

      return { domain, type: 'markets', structured, cleanContent };
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'TradingView markets fetch failed:', e instanceof Error ? e.message : e);
  }

  return null;
}

