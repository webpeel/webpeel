import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// 37. Sports betting sites — helpful redirect message
// ---------------------------------------------------------------------------

export async function sportsBettingExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  let brandName = 'Sports Betting Site';
  let domain = 'sportsbook';
  try {
    const hostname = new URL(url).hostname.replace('www.', '').replace('sportsbook.', '');
    domain = hostname;
    if (hostname.includes('draftkings')) brandName = 'DraftKings Sportsbook';
    else if (hostname.includes('fanduel')) brandName = 'FanDuel Sportsbook';
    else if (hostname.includes('betmgm')) brandName = 'BetMGM Sportsbook';
  } catch { /* ignore */ }

  const cleanContent = `# ⚠️ ${brandName}

${brandName} requires authentication and geo-verification. WebPeel cannot scrape live odds directly.

**For live sports odds, use these alternatives:**
- \`webpeel "https://espn.com/nba/scoreboard"\` — Live scores and schedules
- \`webpeel "https://polymarket.com"\` — Prediction market prices
- The Odds API (theOddsApi.com) — Aggregated odds from all sportsbooks (requires API key)

**For team schedules and standings:**
- \`webpeel "https://espn.com/nba/standings"\` — NBA standings
- \`webpeel "https://espn.com/nfl/scoreboard"\` — NFL scores
- \`webpeel "https://espn.com/mlb/scoreboard"\` — MLB scores`;

  return {
    domain,
    type: 'blocked',
    structured: { site: brandName, reason: 'authentication and geo-verification required' },
    cleanContent,
  };
}

