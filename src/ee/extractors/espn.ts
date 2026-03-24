import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 36. ESPN extractor — live scores, standings, schedules via ESPN public API
// ---------------------------------------------------------------------------

/** Map ESPN URL path prefixes to sport/league identifiers for the API. */
function matchESPN(url: string): { sport: string; league: string; type: string; param?: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.includes('espn.com')) return null;

  const path = u.pathname.toLowerCase();

  // Map URL path prefixes to [sport, league]
  const sportMap: Record<string, [string, string]> = {
    '/nba': ['basketball', 'nba'],
    '/wnba': ['basketball', 'wnba'],
    '/nfl': ['football', 'nfl'],
    '/mlb': ['baseball', 'mlb'],
    '/nhl': ['hockey', 'nhl'],
    '/college-football': ['football', 'college-football'],
    '/mens-college-basketball': ['basketball', 'mens-college-basketball'],
    '/womens-college-basketball': ['basketball', 'womens-college-basketball'],
    '/soccer': ['soccer', 'eng.1'],
    '/mma': ['mma', 'ufc'],
  };

  for (const [prefix, [sport, league]] of Object.entries(sportMap)) {
    if (path.startsWith(prefix)) {
      // Override soccer league if explicitly in URL path (e.g. /soccer/scoreboard/_/league/usa.1)
      let resolvedLeague = league;
      if (sport === 'soccer') {
        const leagueMatch = path.match(/\/league\/([^/?#]+)/);
        if (leagueMatch) resolvedLeague = leagueMatch[1];
      }
      if (path.includes('standings')) return { sport, league: resolvedLeague, type: 'standings' };
      if (path.includes('/team/') || path.includes('/teams/')) {
        const nameMatch = path.split('/name/')[1]?.split('/')[0];
        return { sport, league: resolvedLeague, type: 'team', param: nameMatch };
      }
      if (path.includes('scores') || path.includes('scoreboard')) return { sport, league: resolvedLeague, type: 'scoreboard' };
      return { sport, league: resolvedLeague, type: 'scoreboard' }; // default to scoreboard
    }
  }

  // Unknown path (e.g. /about, /fantasy, /watch) — return null so pipeline
  // falls through to browser rendering instead of showing wrong sport data.
  // Only the root path / is treated as NBA scoreboard.
  if (path === '/' || path === '') {
    return { sport: 'basketball', league: 'nba', type: 'scoreboard' };
  }
  return null;
}

/** Sport emoji mapping. */
function espnSportEmoji(sport: string, league: string): string {
  if (league === 'nba' || league === 'wnba') return '🏀';
  if (sport === 'football') return '🏈';
  if (sport === 'baseball') return '⚾';
  if (sport === 'hockey') return '🏒';
  if (sport === 'soccer') return '⚽';
  if (sport === 'mma' || league === 'ufc') return '🥊';
  return '🏆';
}

/** Format a UTC ISO date string to "7:30 PM ET" style. */
function fmtEspnTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';
  } catch {
    return isoDate;
  }
}

/** Format today's date nicely: "March 18, 2026". */
function fmtTodayESPN(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function fetchEspnScoreboard(sport: string, league: string): Promise<string | null> {
  try {
    const apiUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
    const data = await fetchJson(apiUrl);
    const events: any[] = data?.events || [];
    const emoji = espnSportEmoji(sport, league);
    const leagueName = data?.leagues?.[0]?.name || league.toUpperCase();
    const today = fmtTodayESPN();

    if (events.length === 0) {
      return `# ${emoji} ${leagueName} Scoreboard — ${today}\n\n*No games scheduled today.*`;
    }

    const rows = events.map((e: any) => {
      const comp = e.competitions?.[0] || {};
      const status = comp.status?.type || {};
      const competitors: any[] = comp.competitors || [];

      // Away team first, home team second (standard display)
      const away = competitors.find((c: any) => c.homeAway === 'away') || competitors[0];
      const home = competitors.find((c: any) => c.homeAway === 'home') || competitors[1];

      const awayName = away?.team?.displayName || away?.team?.name || '?';
      const homeName = home?.team?.displayName || home?.team?.name || '?';
      const gameLabel = `${awayName} at ${homeName}`;

      let scoreStr = '-';
      let statusStr = '';

      const state = status.state || 'pre';
      const description = status.description || 'Scheduled';

      if (state === 'pre') {
        scoreStr = '-';
        statusStr = fmtEspnTime(comp.startDate || e.date || '');
      } else if (state === 'in') {
        const awayScore = away?.score ?? '0';
        const homeScore = home?.score ?? '0';
        const awayAbbr = away?.team?.abbreviation || '?';
        const homeAbbr = home?.team?.abbreviation || '?';
        scoreStr = `${awayAbbr} ${awayScore}, ${homeAbbr} ${homeScore}`;
        const period = comp.status?.period ?? '';
        const clock = comp.status?.displayClock ?? '';
        statusStr = period && clock ? `Q${period} ${clock}` : 'Live';
      } else {
        const awayScore = away?.score ?? '0';
        const homeScore = home?.score ?? '0';
        const awayAbbr = away?.team?.abbreviation || '?';
        const homeAbbr = home?.team?.abbreviation || '?';
        scoreStr = `${awayAbbr} ${awayScore}, ${homeAbbr} ${homeScore}`;
        statusStr = description || 'Final';
      }

      return `| ${gameLabel} | ${scoreStr} | ${statusStr} |`;
    }).join('\n');

    return `# ${emoji} ${leagueName} Scoreboard — ${today}\n\n| Game | Score | Status |\n|------|-------|--------|\n${rows}`;
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'ESPN scoreboard fetch failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchEspnStandings(sport: string, league: string): Promise<string | null> {
  try {
    const apiUrl = `https://site.web.api.espn.com/apis/v2/sports/${sport}/${league}/standings?sort=winpercent:desc`;
    const data = await fetchJson(apiUrl);
    const children: any[] = data?.children || [];
    const emoji = espnSportEmoji(sport, league);
    const leagueName = data?.name || league.toUpperCase();
    const today = fmtTodayESPN();

    if (children.length === 0) return null;

    let output = `# ${emoji} ${leagueName} Standings — ${today}\n\n`;

    for (const conf of children) {
      const confName = conf.name || conf.abbreviation || 'Conference';
      const entries: any[] = conf.standings?.entries || [];

      output += `## ${confName}\n\n`;
      output += `| # | Team | W | L | PCT | Streak |\n`;
      output += `|---|------|---|---|-----|--------|\n`;

      // Sort by playoff seed
      const sorted = entries.slice().sort((a: any, b: any) => {
        const seedA = a.stats?.find((s: any) => s.name === 'playoffSeed')?.value ?? 99;
        const seedB = b.stats?.find((s: any) => s.name === 'playoffSeed')?.value ?? 99;
        return seedA - seedB;
      });

      for (const entry of sorted) {
        const team = entry.team?.displayName || '?';
        const stats: any[] = entry.stats || [];
        const getDisplay = (name: string) => stats.find((s: any) => s.name === name)?.displayValue || '?';
        const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value ?? '?';

        const seed = getStat('playoffSeed');
        const wins = getDisplay('wins');
        const losses = getDisplay('losses');
        const pct = getDisplay('winPercent');
        const streak = getDisplay('streak');

        output += `| ${seed} | ${team} | ${wins} | ${losses} | ${pct} | ${streak} |\n`;
      }

      output += '\n';
    }

    return output.trim();
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'ESPN standings fetch failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function espnExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const match = matchESPN(url);
  if (!match) return null;

  const { sport, league, type } = match;
  const domain = 'espn.com';

  if (type === 'standings') {
    const content = await fetchEspnStandings(sport, league);
    if (!content) return null;
    return {
      domain,
      type: 'standings',
      structured: { sport, league, dataType: 'standings' },
      cleanContent: content,
    };
  }

  if (type === 'team') {
    // Try to get team info from the teams API
    try {
      const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams`;
      const teamsData = await fetchJson(teamsUrl);
      const teams: any[] = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];

      const param = match.param?.toLowerCase();
      const teamEntry = param
        ? teams.find((t: any) => {
            const td = t.team || t;
            return td.abbreviation?.toLowerCase() === param ||
              td.slug?.toLowerCase() === param ||
              td.displayName?.toLowerCase().includes(param);
          })
        : teams[0];

      if (teamEntry) {
        const td = teamEntry.team || teamEntry;
        const emoji = espnSportEmoji(sport, league);
        const content = `# ${emoji} ${td.displayName}\n\n**League:** ${league.toUpperCase()}\n\n*For live scores and standings, use:*\n- \`webpeel "https://espn.com/${league}/scoreboard"\`\n- \`webpeel "https://espn.com/${league}/standings"\``;
        return {
          domain,
          type: 'team',
          structured: { sport, league, teamName: td.displayName, abbreviation: td.abbreviation },
          cleanContent: content,
        };
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'ESPN team fetch failed:', e instanceof Error ? e.message : e);
    }
    // Fallback to scoreboard
  }

  // Default: scoreboard
  const content = await fetchEspnScoreboard(sport, league);
  if (!content) return null;
  return {
    domain,
    type: 'scoreboard',
    structured: { sport, league, dataType: 'scoreboard' },
    cleanContent: content,
  };
}

