/**
 * Domain-aware structured extractors for WebPeel.
 *
 * When peel() fetches a URL that matches a known domain, the relevant
 * extractor fires and returns clean structured data + a markdown summary.
 *
 * Supported domains:
 *  - twitter.com / x.com  — tweets, threads, profiles
 *  - reddit.com            — posts with comments (via JSON API)
 *  - github.com            — repos, issues, PRs, users (via GitHub API)
 *  - news.ycombinator.com  — stories with comments (via HN Firebase API)
 */

import { simpleFetch } from './fetcher.js';
import { getYouTubeTranscript } from './youtube.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve Reddit share URLs (/s/CODE) to their actual destination.
 * These are short redirect links that point to the real post URL.
 */
async function resolveRedditShareUrl(url: string): Promise<string> {
  const urlObj = new URL(url);
  // Match /r/subreddit/s/CODE or /s/CODE patterns
  if (!urlObj.pathname.includes('/s/')) return url;

  try {
    const { default: https } = await import('https');
    const { default: http } = await import('http');

    return new Promise<string>((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(
        url,
        {
          headers: { 'User-Agent': 'WebPeel/0.17.1 (web data platform; https://webpeel.dev) Node.js' },
          timeout: 10000,
        },
        (res) => {
          // Follow redirect (one hop)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            resolve(redirectUrl);
          } else {
            resolve(url); // No redirect, return original
          }
          res.resume(); // Consume response
        }
      );
      req.on('error', () => resolve(url));
      req.on('timeout', () => {
        req.destroy();
        resolve(url);
      });
    });
  } catch {
    return url; // On any error, return original URL
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DomainExtractResult {
  /** Canonical domain name (e.g. 'twitter.com') */
  domain: string;
  /** Page type within the domain (e.g. 'tweet', 'thread', 'repo', 'issue') */
  type: string;
  /** Domain-specific structured data */
  structured: Record<string, any>;
  /** Clean markdown representation of the content */
  cleanContent: string;
  /** Raw HTML size in characters (from the actual HTML page fetched by the extractor) */
  rawHtmlSize?: number;
}

/** An extractor receives the raw HTML and original URL, may make API calls. */
export type DomainExtractor = (
  html: string,
  url: string
) => Promise<DomainExtractResult | null>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: Array<{
  match: (hostname: string, url?: string) => boolean;
  extractor: DomainExtractor;
}> = [
  { match: (h) => h === 'twitter.com' || h === 'x.com' || h === 'www.twitter.com' || h === 'www.x.com', extractor: twitterExtractor },
  { match: (h) => h === 'reddit.com' || h === 'www.reddit.com' || h === 'old.reddit.com', extractor: redditExtractor },
  { match: (h) => h === 'github.com' || h === 'www.github.com', extractor: githubExtractor },
  { match: (h) => h === 'news.ycombinator.com', extractor: hackerNewsExtractor },
  { match: (h) => h === 'en.wikipedia.org' || h === 'www.wikipedia.org' || /\w+\.wikipedia\.org/.test(h), extractor: wikipediaExtractor },
  { match: (h) => h === 'youtube.com' || h === 'www.youtube.com' || h === 'youtu.be', extractor: youtubeExtractor },
  { match: (h) => h === 'arxiv.org' || h === 'export.arxiv.org', extractor: arxivExtractor },
  { match: (h) => h === 'stackoverflow.com' || h === 'www.stackoverflow.com', extractor: stackOverflowExtractor },
  { match: (h) => h === 'www.npmjs.com' || h === 'npmjs.com', extractor: npmExtractor },
  { match: (h) => h === 'www.bestbuy.com' || h === 'bestbuy.com', extractor: bestBuyExtractor },
  { match: (h) => h === 'www.walmart.com' || h === 'walmart.com', extractor: walmartExtractor },
  { match: (h) => h === 'www.amazon.com' || h === 'amazon.com', extractor: amazonExtractor },
  { match: (h) => h === 'medium.com' || h === 'www.medium.com' || h.endsWith('.medium.com'), extractor: mediumExtractor },
  { match: (h) => h.endsWith('.substack.com'), extractor: substackExtractor },
  { match: (h) => h === 'www.allrecipes.com' || h === 'allrecipes.com', extractor: allrecipesExtractor },
  { match: (h) => h === 'www.imdb.com' || h === 'imdb.com', extractor: imdbExtractor },
  { match: (h) => h === 'www.linkedin.com' || h === 'linkedin.com', extractor: linkedinExtractor },
  { match: (h) => h === 'pypi.org' || h === 'www.pypi.org', extractor: pypiExtractor },
  { match: (h) => h === 'dev.to' || h === 'www.dev.to', extractor: devtoExtractor },
  { match: (h) => h === 'craigslist.org' || h === 'www.craigslist.org' || h.endsWith('.craigslist.org'), extractor: craigslistExtractor },
  // ── New extractors ────────────────────────────────────────────────────────
  { match: (h) => h === 'open.spotify.com', extractor: spotifyExtractor },
  { match: (h) => h === 'tiktok.com' || h === 'www.tiktok.com' || h === 'vm.tiktok.com', extractor: tiktokExtractor },
  { match: (h) => h === 'pinterest.com' || h === 'www.pinterest.com' || h.endsWith('.pinterest.com'), extractor: pinterestExtractor },
  { match: (h) => h === 'nytimes.com' || h === 'www.nytimes.com', extractor: nytimesExtractor },
  { match: (h) => h === 'bbc.com' || h === 'www.bbc.com' || h === 'bbc.co.uk' || h === 'www.bbc.co.uk', extractor: bbcExtractor },
  { match: (h) => h === 'cnn.com' || h === 'www.cnn.com', extractor: cnnExtractor },
  { match: (h) => h === 'twitch.tv' || h === 'www.twitch.tv' || h === 'clips.twitch.tv', extractor: twitchExtractor },
  { match: (h) => h === 'soundcloud.com' || h === 'www.soundcloud.com', extractor: soundcloudExtractor },
  { match: (h) => h === 'instagram.com' || h === 'www.instagram.com', extractor: instagramExtractor },
  { match: (h) => h === 'www.producthunt.com' || h === 'producthunt.com', extractor: productHuntExtractor },
  { match: (h) => h === 'substack.com' || h === 'www.substack.com', extractor: substackRootExtractor },
  { match: (_h, url = '') => /\.pdf(\?|$|#)/i.test(url) || /\/pdf\//i.test(url), extractor: pdfExtractor },
];

/**
 * Returns the domain extractor for a URL, or null if none matches.
 */
export function getDomainExtractor(url: string): DomainExtractor | null {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    for (const entry of REGISTRY) {
      if (entry.match(host, url)) return entry.extractor;
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
  }
  return null;
}

/**
 * Convenience: run the extractor for the URL (if one exists).
 * Returns null when no extractor matches or extraction fails.
 */
export async function extractDomainData(
  html: string,
  url: string
): Promise<DomainExtractResult | null> {
  const extractor = getDomainExtractor(url);
  if (!extractor) return null;
  try {
    return await extractor(html, url);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe JSON parse — returns null on failure. */
function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Strip HTML tags from a string. */
function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

/** Format a Unix timestamp (seconds) as ISO 8601. */
function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** Fetch JSON from a URL using simpleFetch (reuses WebPeel's HTTP stack). */
async function fetchJson(url: string, customHeaders?: Record<string, string>): Promise<any> {
  const result = await simpleFetch(url, undefined, 15000, {
    Accept: 'application/json',
    ...customHeaders,
  });
  return tryParseJson(result.html);
}

/** Fetch JSON with exponential backoff retry on 429 / rate-limit errors. */
async function fetchJsonWithRetry(
  url: string,
  headers?: Record<string, string>,
  retries = 2,
  baseDelayMs = 1000
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchJson(url, headers);
      return result;
    } catch (e: any) {
      // Retry on rate-limit or transient errors
      if (attempt < retries && (e.message?.includes('429') || e.message?.includes('rate') || e.message?.includes('Too Many'))) {
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Twitter / X extractor
// ---------------------------------------------------------------------------

/** Recursively search an object for a value matching predicate (BFS). */
function deepFind(obj: any, predicate: (v: any) => boolean, depth = 0): any {
  if (depth > 12 || obj === null || typeof obj !== 'object') return null;
  if (predicate(obj)) return obj;
  for (const val of Object.values(obj)) {
    const found = deepFind(val, predicate, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Detect tweet type from __NEXT_DATA__ and extract all tweet data. */
function parseTweetFromNextData(nextData: any): Record<string, any> | null {
  // Walk the tree to find a tweet_results.result structure
  const tweetResult = deepFind(
    nextData,
    (v) => v?.tweet_results?.result?.legacy?.full_text !== undefined
  );
  if (!tweetResult) return null;

  const result = tweetResult.tweet_results.result;
  return parseTweetResult(result);
}

function parseTweetResult(result: any): Record<string, any> | null {
  const legacy = result?.legacy;
  if (!legacy) return null;

  const userLegacy = result?.core?.user_results?.result?.legacy ||
    result?.user_results?.result?.legacy;

  const author = {
    name: userLegacy?.name || '',
    handle: '@' + (userLegacy?.screen_name || ''),
    verified: userLegacy?.verified || result?.core?.user_results?.result?.is_blue_verified || false,
  };

  const metrics = {
    likes: legacy.favorite_count ?? 0,
    retweets: legacy.retweet_count ?? 0,
    replies: legacy.reply_count ?? 0,
    views: Number(result?.views?.count ?? 0),
  };

  // Media
  const mediaItems: string[] = [];
  const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
  for (const m of mediaEntities) {
    if (m.media_url_https) mediaItems.push(m.media_url_https);
  }

  // Quoted tweet
  let quotedTweet: Record<string, any> | null = null;
  if (result.quoted_status_result) {
    const qLegacy = result.quoted_status_result?.result?.legacy;
    const qUserLegacy = result.quoted_status_result?.result?.core?.user_results?.result?.legacy;
    if (qLegacy) {
      quotedTweet = {
        text: qLegacy.full_text || qLegacy.text || '',
        author: {
          name: qUserLegacy?.name || '',
          handle: '@' + (qUserLegacy?.screen_name || ''),
        },
        timestamp: qLegacy.created_at ? new Date(qLegacy.created_at).toISOString() : undefined,
      };
    }
  }

  return {
    author,
    text: legacy.full_text || legacy.text || '',
    timestamp: legacy.created_at ? new Date(legacy.created_at).toISOString() : undefined,
    metrics,
    media: mediaItems,
    quotedTweet,
  };
}

async function twitterExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  const isTweet = pathParts.includes('status');
  const type = isTweet ? 'tweet' : 'profile';
  const domain = 'twitter.com';

  // --- Try FxTwitter API first (works from datacenter IPs, no auth needed) ---
  const username = pathParts[0] || '';

  if (isTweet) {
    const statusId = pathParts[pathParts.indexOf('status') + 1];
    if (statusId && username) {
      try {
        const fxUrl = `https://api.fxtwitter.com/${username}/status/${statusId}`;
        const fxData = await fetchJson(fxUrl);
        if (fxData && fxData.code === 200 && fxData.tweet) {
          const t = fxData.tweet;
          const structured: Record<string, any> = {
            author: {
              name: t.author?.name || '',
              handle: '@' + (t.author?.screen_name || ''),
              verified: t.author?.verified || false,
            },
            text: t.text || '',
            timestamp: t.created_at ? new Date(t.created_at).toISOString() : undefined,
            metrics: {
              likes: t.likes ?? 0,
              retweets: t.retweets ?? 0,
              replies: t.replies ?? 0,
              views: t.views ?? 0,
            },
            media: (t.media?.all || []).map((m: any) => m.url).filter(Boolean),
            quotedTweet: t.quote ? {
              text: t.quote.text || '',
              author: { name: t.quote.author?.name || '', handle: '@' + (t.quote.author?.screen_name || '') },
            } : null,
            source: 'fxtwitter',
          };

          const authorLine = `**${structured.author.name}** (${structured.author.handle})`;
          const timeLine = structured.timestamp ? `\n*${structured.timestamp}*` : '';
          const metricsLine = `\n\n💬 ${structured.metrics.replies}  🔁 ${structured.metrics.retweets}  ❤️ ${structured.metrics.likes}${structured.metrics.views ? `  👁 ${structured.metrics.views}` : ''}`;
          const mediaLine = structured.media.length ? `\n\n📷 Media: ${structured.media.join(', ')}` : '';
          const quotedLine = structured.quotedTweet
            ? `\n\n> **Quoted tweet by ${structured.quotedTweet.author?.name || 'unknown'}:** ${structured.quotedTweet.text}`
            : '';

          const cleanContent = `## 🐦 Tweet by ${authorLine}${timeLine}\n\n${structured.text}${quotedLine}${metricsLine}${mediaLine}`;

          return { domain, type, structured, cleanContent };
        }
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'FxTwitter API failed:', e instanceof Error ? e.message : e);
      }
    }
  }

  // --- Try FxTwitter for profiles ---
  if (!isTweet && username) {
    try {
      const fxUrl = `https://api.fxtwitter.com/${username}`;
      const fxData = await fetchJson(fxUrl);
      if (fxData && fxData.code === 200 && fxData.user) {
        const u = fxData.user;
        const structured: Record<string, any> = {
          title: `${u.name || ''} (@${u.screen_name || ''}) on X/Twitter`,
          name: u.name || '',
          handle: '@' + (u.screen_name || ''),
          bio: u.description || '',
          followers: u.followers ?? 0,
          following: u.following ?? 0,
          tweets: u.tweets ?? 0,
          likes: u.likes ?? 0,
          verified: u.verification?.verified || false,
          location: u.location || '',
          created: u.joined || undefined,
          avatarUrl: u.avatar_url || null,
          bannerUrl: u.banner_url || null,
          website: (typeof u.website === 'object' ? u.website?.url : u.website) || null,
          source: 'fxtwitter',
        };

        // Try to fetch recent tweets from Twitter's public syndication endpoint
        // NOTE: simpleFetch sends too many Sec-* headers that trigger 429. Use https directly.
        let recentTweets = '';
        try {
          const { default: httpsModule } = await import('https');
          const syndicationHtml = await new Promise<string>((resolve, reject) => {
            const req = httpsModule.request({
              hostname: 'syndication.twitter.com',
              path: `/srv/timeline-profile/screen-name/${u.screen_name}`,
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
            }, (res) => {
              if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
              let body = '';
              res.on('data', (chunk: Buffer) => body += chunk.toString());
              res.on('end', () => resolve(body));
            });
            req.on('error', reject);
            setTimeout(() => req.destroy(new Error('timeout')), 12000);
            req.end();
          });
          if (syndicationHtml) {
            // Parse __NEXT_DATA__ JSON from the syndication page for rich tweet data
            const nextDataMatch = syndicationHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
            if (nextDataMatch) {
              const nextData = tryParseJson(nextDataMatch[1]);
              const entries: any[] = nextData?.props?.pageProps?.timeline?.entries || [];
              const tweetSections: string[] = [];
              for (const entry of entries) {
                if (tweetSections.length >= 8) break;
                const tweet = entry?.content?.tweet;
                if (!tweet?.full_text) continue;
                const text: string = tweet.full_text.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                // Skip retweets and pure-URL-only tweets without media
                if (text.startsWith('RT @')) continue;
                const media: any[] = tweet.extended_entities?.media || tweet.entities?.media || [];
                const isUrlOnly = /^https?:\/\/t\.co\/\S+$/.test(text.trim()) || /^https?:\/\/t\.co\/\S+\s*$/.test(text.trim());
                if (isUrlOnly && media.length === 0) continue;
                // Format date
                const dateStr = tweet.created_at ? (() => {
                  try { return new Date(tweet.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return tweet.created_at; }
                })() : '';
                const likes: number = tweet.favorite_count ?? 0;
                const retweets: number = tweet.retweet_count ?? 0;
                const replies: number = tweet.reply_count ?? 0;
                const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
                const mediaLine = media.length > 0 ? `\n📷 ${media.map((m: any) => m.media_url_https || m.media_url).filter(Boolean).join(', ')}` : '';
                // Clean t.co URLs from text when they have real media
                const cleanText = media.length > 0 ? text.replace(/https?:\/\/t\.co\/\S+/g, '').trim() : text;
                tweetSections.push(`### ${dateStr}\n${cleanText}${mediaLine}\n♻️ ${fmtNum(retweets)} | ❤️ ${fmtNum(likes)} | 💬 ${fmtNum(replies)}`);
              }
              if (tweetSections.length > 0) {
                recentTweets = '\n\n## Recent Tweets\n\n' + tweetSections.join('\n\n---\n\n');
              }
            } else {
              // Fallback: simple regex extraction without metrics
              const tweetMatches = [...syndicationHtml.matchAll(/"full_text":"((?:[^"\\]|\\.)*)"/g)];
              const tweets = tweetMatches
                .slice(0, 5)
                .map(m => m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim())
                .filter(t => t.length > 10 && !t.startsWith('RT @'));
              if (tweets.length > 0) {
                recentTweets = '\n\n## Recent Tweets\n\n' + tweets.map(t => `> ${t}`).join('\n\n');
              }
            }
          }
        } catch { /* syndication optional */ }

        const websiteLine = structured.website ? `\n🌐 ${structured.website}` : '';
        const joinedLine = structured.created ? `\n📅 Joined: ${structured.created}` : '';
        const likesLine = structured.likes ? `  |  ❤️ Likes: ${structured.likes?.toLocaleString() || 0}` : '';
        const cleanContent = `# @${(structured.handle || '').replace('@', '')} on X/Twitter\n\n**${structured.name}**${structured.verified ? ' ✓' : ''}\n\n${structured.bio || ''}\n\n📍 ${structured.location || 'N/A'}${websiteLine}${joinedLine}\n👥 Followers: ${structured.followers?.toLocaleString() || 0} | Following: ${structured.following?.toLocaleString() || 0} | Tweets: ${structured.tweets?.toLocaleString() || 0}${likesLine}${recentTweets}`;

        return { domain, type: 'profile', structured, cleanContent };
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'FxTwitter profile API failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Try __NEXT_DATA__ JSON (SSR data) ---
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  let structured: Record<string, any> | null = null;

  if (nextDataMatch) {
    const nextData = tryParseJson(nextDataMatch[1]);
    if (nextData) {
      if (isTweet) {
        const tweetData = parseTweetFromNextData(nextData);
        if (tweetData) {
          structured = tweetData;
        }
      } else {
        // Profile page — extract user info
        const userResult = deepFind(nextData, (v) => v?.user_results?.result?.legacy?.screen_name);
        if (userResult) {
          const uLegacy = userResult.user_results.result.legacy;
          structured = {
            name: uLegacy.name || '',
            handle: '@' + (uLegacy.screen_name || ''),
            bio: uLegacy.description || '',
            followers: uLegacy.followers_count ?? 0,
            following: uLegacy.friends_count ?? 0,
            tweets: uLegacy.statuses_count ?? 0,
            verified: userResult.user_results.result.is_blue_verified || uLegacy.verified || false,
            location: uLegacy.location || '',
            created: uLegacy.created_at ? new Date(uLegacy.created_at).toISOString() : undefined,
          };
        }
      }
    }
  }

  // --- Fallback: parse DOM for tweet text if __NEXT_DATA__ parsing failed ---
  if (!structured && isTweet) {
    // Try to extract from og: tags or article body
    const ogDescMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (ogDescMatch || ogTitleMatch) {
      const authorRaw = (ogTitleMatch?.[1] || '').replace(' on X', '').replace(' on Twitter', '').trim();
      const text = ogDescMatch?.[1] ? decodeURIComponent(ogDescMatch[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&')) : '';
      structured = {
        author: { name: authorRaw, handle: '', verified: false },
        text: stripHtml(text),
        timestamp: undefined,
        metrics: { likes: 0, retweets: 0, replies: 0, views: 0 },
        media: [],
        quotedTweet: null,
      };
    }
  }

  if (!structured) return null;

  // Build clean markdown
  let cleanContent: string;
  if (type === 'tweet') {
    const s = structured;
    const authorLine = s.author?.handle
      ? `**${s.author.name}** (${s.author.handle})`
      : `**${s.author?.name || 'Unknown'}**`;
    const timeLine = s.timestamp ? `\n*${s.timestamp}*` : '';
    const metricsLine = s.metrics
      ? `\n\n💬 ${s.metrics.replies}  🔁 ${s.metrics.retweets}  ❤️ ${s.metrics.likes}${s.metrics.views ? `  👁 ${s.metrics.views}` : ''}`
      : '';
    const mediaLine = s.media?.length ? `\n\n📷 Media: ${s.media.join(', ')}` : '';
    const quotedLine = s.quotedTweet
      ? `\n\n> **Quoted tweet by ${s.quotedTweet.author?.name || 'unknown'}:** ${s.quotedTweet.text}`
      : '';
    const threadLine = s.thread?.length ? '\n\n**Thread:**\n' + s.thread.map((t: any, i: number) => `${i + 2}. ${t.text}`).join('\n') : '';

    cleanContent = `## 🐦 Tweet by ${authorLine}${timeLine}\n\n${s.text}${quotedLine}${threadLine}${metricsLine}${mediaLine}`;
  } else {
    const s = structured;
    cleanContent = `## 🐦 @${(s.handle || '').replace('@', '')} on X/Twitter\n\n**${s.name}**\n${s.bio || ''}\n\n📍 ${s.location || 'N/A'}  |  👥 ${s.followers?.toLocaleString() || 0} followers  |  Following: ${s.following?.toLocaleString() || 0}  |  Tweets: ${s.tweets?.toLocaleString() || 0}`;
  }

  return { domain, type, structured, cleanContent };
}

// ---------------------------------------------------------------------------
// 2. Reddit extractor
// ---------------------------------------------------------------------------

interface RedditComment {
  author: string;
  text: string;
  score: number;
  replies: RedditComment[];
}

function parseRedditComment(data: any, depth: number): RedditComment | null {
  if (!data || data.kind === 'more') return null;
  const d = data.kind === 't1' ? data.data : data;
  if (!d || !d.body) return null;

  const replies: RedditComment[] = [];
  if (depth > 0 && d.replies && d.replies.data?.children) {
    for (const child of d.replies.data.children) {
      const c = parseRedditComment(child, depth - 1);
      if (c) replies.push(c);
    }
    // Sort replies by score
    replies.sort((a, b) => b.score - a.score);
    replies.splice(3); // max 3 replies per level
  }

  return {
    author: `u/${d.author || '[deleted]'}`,
    text: d.body || '',
    score: d.score || 0,
    replies,
  };
}

async function redditExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  // Resolve Reddit share URLs (/s/CODE) to actual post URLs before any processing
  let workingUrl = url;
  if (url.includes('/s/')) {
    const resolved = await resolveRedditShareUrl(url);
    if (resolved !== url) {
      if (process.env.DEBUG) console.debug('[webpeel]', `Reddit share URL resolved: ${url} → ${resolved}`);
      workingUrl = resolved;
    }
  }

  const urlObj = new URL(workingUrl);
  const path = urlObj.pathname;
  const domain = 'reddit.com';

  // Normalize old.reddit.com → www.reddit.com for JSON API
  const normalizedUrl = workingUrl.replace(/old\.reddit\.com/, 'www.reddit.com');

  const REDDIT_UA = { 'User-Agent': 'WebPeel/0.17.1 (web data platform; https://webpeel.dev) Node.js' };

  // Detect page type
  const isPost = /\/r\/[^/]+\/comments\//.test(path) || /^\/comments\//.test(path);
  const isGallery = /\/gallery\//.test(path);
  // Subreddit with any sort/filter: /r/sub, /r/sub/, /r/sub/hot, /r/sub/top, /r/sub/new, /r/sub/rising
  const isSubreddit = /^\/r\/[^/]+\/?$/.test(path) || /^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?$/.test(path);
  const isUser = /^\/(u|user)\/[^/]+/.test(path);
  // Home/popular/all pages
  const isHomeListing = /^\/(hot|new|top|rising|controversial|best|popular|all)\/?$/.test(path) || path === '/' || path === '';

  const type = isPost || isGallery ? 'post' : isSubreddit ? 'subreddit' : isUser ? 'user' : isHomeListing ? 'listing' : 'listing';

  if (isGallery) {
    // Gallery posts: fetch the gallery JSON and extract the post data
    const galleryJsonUrl = normalizedUrl.split('?')[0].replace(/\/?$/, '') + '.json?limit=25&sort=top';
    const requestedGallerySub = path.match(/\/r\/([^/]+)/)?.[1] || 'unknown';
    let galleryData: any;
    try {
      galleryData = await fetchJsonWithRetry(galleryJsonUrl, REDDIT_UA);
    } catch (e) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found or has been deleted', subreddit: `r/${requestedGallerySub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedGallerySub} could not be found. It may have been deleted or removed.`,
      };
    }
    if (!Array.isArray(galleryData) || galleryData.length < 1) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found', subreddit: `r/${requestedGallerySub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedGallerySub} could not be found. It may have been deleted or removed.`,
      };
    }
    const postData = galleryData[0]?.data?.children?.[0]?.data;
    if (!postData) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found', subreddit: `r/${requestedGallerySub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedGallerySub} could not be found. It may have been deleted or removed.`,
      };
    }
    // Validate subreddit matches the request
    const actualGallerySub = postData.subreddit?.toLowerCase();
    if (requestedGallerySub !== 'unknown' && actualGallerySub && requestedGallerySub.toLowerCase() !== actualGallerySub) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found in requested subreddit', requestedSubreddit: `r/${requestedGallerySub}`, actualSubreddit: `r/${actualGallerySub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post was not found in r/${requestedGallerySub}. It may have been deleted or moved.`,
      };
    }

    const structured: Record<string, any> = {
      subreddit: `r/${postData.subreddit || ''}`,
      title: postData.title || '',
      author: `u/${postData.author || '[deleted]'}`,
      score: postData.score ?? 0,
      upvoteRatio: postData.upvote_ratio ?? 1,
      url: postData.url || url,
      selftext: postData.selftext || '',
      commentCount: postData.num_comments ?? 0,
      created: unixToIso(postData.created_utc),
      flair: postData.link_flair_text || null,
      comments: [],
      isGallery: true,
    };

    const cleanContent = `## 📋 ${structured.subreddit}: ${structured.title}

**Posted by** ${structured.author} | Score: ${structured.score} | ${structured.commentCount} comments
*${structured.created}*

*(Gallery post)*`;

    return { domain, type: 'post', structured, cleanContent };
  }

  if (isPost) {
    // Fetch post data via Reddit JSON API
    const jsonUrl = normalizedUrl.split('?')[0].replace(/\/?$/, '') + '.json?limit=25&sort=top';
    const requestedPostSub = path.match(/\/r\/([^/]+)/)?.[1] || 'unknown';
    let data: any;
    try {
      data = await fetchJsonWithRetry(jsonUrl, REDDIT_UA);
    } catch (e) {
      // Post not found or API error — return a "not found" result
      // instead of null (which would trigger browser fallback with wrong content)
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found or has been deleted', subreddit: `r/${requestedPostSub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedPostSub} could not be found. It may have been deleted or removed.`,
      };
    }
    if (!Array.isArray(data) || data.length < 2) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found', subreddit: `r/${requestedPostSub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedPostSub} could not be found. It may have been deleted or removed.`,
      };
    }

    const postData = data[0]?.data?.children?.[0]?.data;
    if (!postData) {
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found', subreddit: `r/${requestedPostSub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post at r/${requestedPostSub} could not be found. It may have been deleted or removed.`,
      };
    }

    // CRITICAL: Validate subreddit matches the request (prevents cross-subreddit ID reuse exploits)
    const actualPostSub = postData.subreddit?.toLowerCase();
    if (requestedPostSub !== 'unknown' && actualPostSub && requestedPostSub.toLowerCase() !== actualPostSub) {
      // Reddit reused the post ID in a different subreddit — return error instead of wrong content
      return {
        domain,
        type: 'post',
        structured: { error: 'Post not found in requested subreddit', requestedSubreddit: `r/${requestedPostSub}`, actualSubreddit: `r/${actualPostSub}` },
        cleanContent: `## ❌ Reddit Post Not Found\n\nThe post was not found in r/${requestedPostSub}. It may have been deleted or moved.`,
      };
    }

    // Parse top comments (max 20)
    const commentChildren: any[] = data[1]?.data?.children || [];
    const comments: RedditComment[] = [];
    for (const child of commentChildren) {
      const c = parseRedditComment(child, 3);
      if (c) comments.push(c);
      if (comments.length >= 20) break;
    }
    comments.sort((a, b) => b.score - a.score);

    const structured: Record<string, any> = {
      subreddit: `r/${postData.subreddit}`,
      title: postData.title || '',
      author: `u/${postData.author || '[deleted]'}`,
      score: postData.score ?? 0,
      upvoteRatio: postData.upvote_ratio ?? 1,
      url: postData.url || url,
      selftext: postData.selftext || '',
      commentCount: postData.num_comments ?? 0,
      created: unixToIso(postData.created_utc),
      flair: postData.link_flair_text || null,
      comments,
    };

    // Build clean markdown
    const commentsMd = comments.slice(0, 10).map(c => {
      const repliesMd = c.replies.slice(0, 2).map(r =>
        `  > **${r.author}** (${r.score}): ${r.text.slice(0, 200)}`
      ).join('\n');
      return `**${c.author}** (score: ${c.score})\n${c.text.slice(0, 300)}${repliesMd ? '\n' + repliesMd : ''}`;
    }).join('\n\n---\n\n');

    const selftextSection = structured.selftext
      ? `\n\n${structured.selftext.slice(0, 1000)}`
      : '';

    const cleanContent = `## 📋 ${structured.subreddit}: ${structured.title}

**Posted by** ${structured.author} | Score: ${structured.score} (${Math.round(structured.upvoteRatio * 100)}% upvoted) | ${structured.commentCount} comments
${structured.flair ? `**Flair:** ${structured.flair}` : ''}
*${structured.created}*${selftextSection}

---

### Top Comments

${commentsMd || '*No comments found.*'}`;

    return { domain, type, structured, cleanContent };
  }

  if (isSubreddit) {
    // Fetch subreddit listing
    // Preserve query params (especially t=day, t=week etc. for sorted views)
    const queryString = urlObj.search || '';
    const sortMatch = path.match(/\/r\/[^/]+\/(hot|new|top|rising|controversial|best)/);
    const sortPath = sortMatch ? `/${sortMatch[1]}` : '';
    const baseSubUrl = normalizedUrl.match(/\/r\/[^/]+/)?.[0] || normalizedUrl.split('?')[0];
    const jsonUrl = `https://www.reddit.com${baseSubUrl}${sortPath}.json?limit=15${queryString ? '&' + queryString.slice(1) : ''}`;
    const data = await fetchJsonWithRetry(jsonUrl, REDDIT_UA);
    if (!data?.data?.children) return null;

    const posts = data.data.children
      .filter((c: any) => c.kind === 't3')
      .map((c: any) => {
        const d = c.data;
        return {
          title: d.title || '',
          author: `u/${d.author || '[deleted]'}`,
          score: d.score ?? 0,
          commentCount: d.num_comments ?? 0,
          url: `https://reddit.com${d.permalink}`,
          flair: d.link_flair_text || null,
        };
      });

    const subredditName = posts[0]?.url?.match(/\/r\/([^/]+)\//)?.[1] || path.match(/\/r\/([^/]+)/)?.[1] || '';
    const structured = { title: `r/${subredditName} — Top Posts`, subreddit: `r/${subredditName}`, posts };

    const cleanContent = `## 📋 r/${subredditName} — Hot Posts

${posts.map((p: any, i: number) => `${i + 1}. **${p.title}**\n   ${p.author} | ↑ ${p.score} | 💬 ${p.commentCount}${p.flair ? ` | ${p.flair}` : ''}\n   ${p.url}`).join('\n\n')}`;

    return { domain, type, structured, cleanContent };
  }

  if (isHomeListing) {
    const sortMatch = path.match(/\/(hot|new|top|rising|controversial|best|popular|all)/);
    const sortType = sortMatch ? sortMatch[1] : 'hot';
    const queryString = urlObj.search || '';
    const jsonUrl = `https://www.reddit.com/${sortType}.json?limit=15${queryString ? '&' + queryString.slice(1) : ''}`;

    const data = await fetchJsonWithRetry(jsonUrl, REDDIT_UA);
    if (!data?.data?.children) return null;

    const posts = data.data.children
      .filter((c: any) => c.kind === 't3')
      .map((c: any) => {
        const d = c.data;
        return {
          title: d.title || '',
          author: `u/${d.author || '[deleted]'}`,
          score: d.score ?? 0,
          commentCount: d.num_comments ?? 0,
          url: `https://reddit.com${d.permalink}`,
          subreddit: `r/${d.subreddit}`,
          flair: d.link_flair_text || null,
        };
      });

    const structured: Record<string, any> = { title: `Reddit — ${sortType.charAt(0).toUpperCase() + sortType.slice(1)} Posts`, sortType, posts, postCount: posts.length };

    const listMd = posts.map((p: any, i: number) => {
      const flairTag = p.flair ? ` | ${p.flair}` : '';
      return `${i + 1}. **${p.title}**\n   ${p.author} in ${p.subreddit} | ↑ ${p.score} | 💬 ${p.commentCount}${flairTag}\n   ${p.url}`;
    }).join('\n\n');

    const cleanContent = `## 📋 Reddit — ${sortType.charAt(0).toUpperCase() + sortType.slice(1)} Posts\n\n${listMd}`;
    return { domain: 'reddit.com', type: 'listing', structured, cleanContent };
  }

  // User or other — fall back to null (let normal HTML extraction handle it)
  return null;
}

// ---------------------------------------------------------------------------
// 3. GitHub extractor
// ---------------------------------------------------------------------------

async function githubExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  const domain = 'github.com';

  if (pathParts.length === 0) return null;

  const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  // Use GITHUB_TOKEN if available for higher rate limits (5000/hr vs 60/hr)
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (ghToken) ghHeaders.Authorization = `token ${ghToken}`;

  // User profile: /username (single segment)
  if (pathParts.length === 1) {
    const username = pathParts[0];
    const userData = await fetchJson(`https://api.github.com/users/${username}`, ghHeaders);
    if (!userData || userData.message === 'Not Found') return null;

    const structured: Record<string, any> = {
      login: userData.login,
      name: userData.name || userData.login,
      bio: userData.bio || '',
      company: userData.company || null,
      location: userData.location || null,
      blog: userData.blog || null,
      followers: userData.followers ?? 0,
      following: userData.following ?? 0,
      publicRepos: userData.public_repos ?? 0,
      created: userData.created_at,
      avatarUrl: userData.avatar_url,
    };

    const cleanContent = `## 👤 GitHub: ${structured.name} (@${structured.login})

${structured.bio ? structured.bio + '\n\n' : ''}📍 ${structured.location || 'N/A'}  |  💼 ${structured.company || 'N/A'}  |  🌐 ${structured.blog || 'N/A'}
👥 ${structured.followers} followers  |  Following: ${structured.following}  |  📦 ${structured.publicRepos} public repos`;

    return { domain, type: 'user', structured, cleanContent };
  }

  const owner = pathParts[0];
  const repo = pathParts[1];

  // Issue: /owner/repo/issues/123
  if (pathParts[2] === 'issues' && pathParts[3]) {
    const issueNumber = pathParts[3];
    const [issueData, commentsData] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, ghHeaders),
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=20`, ghHeaders),
    ]);
    if (!issueData || issueData.message === 'Not Found') return null;

    const comments = Array.isArray(commentsData)
      ? commentsData.map((c: any) => ({
          author: c.user?.login || 'ghost',
          text: c.body || '',
          created: c.created_at,
        }))
      : [];

    const structured: Record<string, any> = {
      repo: `${owner}/${repo}`,
      number: issueData.number,
      title: issueData.title || '',
      author: issueData.user?.login || 'ghost',
      state: issueData.state,
      body: issueData.body || '',
      labels: (issueData.labels || []).map((l: any) => l.name),
      created: issueData.created_at,
      updated: issueData.updated_at,
      commentCount: issueData.comments ?? 0,
      comments,
    };

    const labelStr = structured.labels.length ? structured.labels.join(', ') : 'none';
    const commentsMd = comments.slice(0, 10).map((c: any) =>
      `**@${c.author}** (${c.created}):\n${c.text.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const cleanContent = `## 🐛 Issue #${structured.number}: ${structured.title}

**Repo:** ${structured.repo}  |  **State:** ${structured.state}  |  **Author:** @${structured.author}
**Labels:** ${labelStr}  |  **Created:** ${structured.created}

${structured.body.slice(0, 800)}

---

### Comments (${structured.commentCount})

${commentsMd || '*No comments.*'}`;

    return { domain, type: 'issue', structured, cleanContent };
  }

  // Pull request: /owner/repo/pull/123
  if (pathParts[2] === 'pull' && pathParts[3]) {
    const prNumber = pathParts[3];
    const [prData, commentsData] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, ghHeaders),
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=20`, ghHeaders),
    ]);
    if (!prData || prData.message === 'Not Found') return null;

    const comments = Array.isArray(commentsData)
      ? commentsData.map((c: any) => ({
          author: c.user?.login || 'ghost',
          text: c.body || '',
          created: c.created_at,
        }))
      : [];

    const structured: Record<string, any> = {
      repo: `${owner}/${repo}`,
      number: prData.number,
      title: prData.title || '',
      author: prData.user?.login || 'ghost',
      state: prData.state,
      merged: prData.merged ?? false,
      body: prData.body || '',
      labels: (prData.labels || []).map((l: any) => l.name),
      created: prData.created_at,
      updated: prData.updated_at,
      commentCount: prData.comments ?? 0,
      additions: prData.additions ?? 0,
      deletions: prData.deletions ?? 0,
      changedFiles: prData.changed_files ?? 0,
      headBranch: prData.head?.label || '',
      baseBranch: prData.base?.label || '',
      comments,
    };

    const labelStr = structured.labels.length ? structured.labels.join(', ') : 'none';
    const commentsMd = comments.slice(0, 8).map((c: any) =>
      `**@${c.author}** (${c.created}):\n${c.text.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const cleanContent = `## 🔀 PR #${structured.number}: ${structured.title}

**Repo:** ${structured.repo}  |  **State:** ${structured.state}${structured.merged ? ' (merged)' : ''}  |  **Author:** @${structured.author}
**Labels:** ${labelStr}  |  **${structured.headBranch} → ${structured.baseBranch}**
**Changes:** +${structured.additions} / -${structured.deletions} across ${structured.changedFiles} files

${structured.body.slice(0, 800)}

---

### Comments (${structured.commentCount})

${commentsMd || '*No comments.*'}`;

    return { domain, type: 'pull_request', structured, cleanContent };
  }

  // Repository page: /owner/repo (and no deeper path we handle above)
  if (pathParts.length >= 2) {
    const [repoData, readmeData] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${owner}/${repo}`, ghHeaders),
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/readme`, ghHeaders).catch(() => null),
    ]);
    if (!repoData || repoData.message === 'Not Found') return null;

    // README content is base64 encoded
    let readmeText = '';
    if (readmeData?.content) {
      try {
        readmeText = Buffer.from(readmeData.content, 'base64').toString('utf-8').slice(0, 5000);
      } catch { /* ignore */ }
    }

    const structured: Record<string, any> = {
      title: `${owner}/${repo}`,
      name: `${owner}/${repo}`,
      description: repoData.description || '',
      stars: repoData.stargazers_count ?? 0,
      forks: repoData.forks_count ?? 0,
      language: repoData.language || null,
      topics: repoData.topics || [],
      license: repoData.license?.spdx_id || null,
      openIssues: repoData.open_issues_count ?? 0,
      lastPush: repoData.pushed_at,
      createdAt: repoData.created_at,
      defaultBranch: repoData.default_branch || 'main',
      homepage: repoData.homepage || null,
      archived: repoData.archived || false,
      fork: repoData.fork || false,
      readme: readmeText,
    };

    const topicsStr = structured.topics.length ? structured.topics.join(', ') : 'none';
    const cleanContent = `## 📦 Repository: ${structured.name}

${structured.description || '*No description.*'}

⭐ ${structured.stars.toLocaleString()} stars  |  🍴 ${structured.forks.toLocaleString()} forks  |  💻 ${structured.language || 'N/A'}  |  📜 ${structured.license || 'N/A'}
🏷️ Topics: ${topicsStr}
🔗 ${structured.homepage || 'No homepage'}  |  Last push: ${structured.lastPush}${structured.archived ? '\n⚠️ **ARCHIVED**' : ''}

${structured.readme ? `### README\n\n${structured.readme}` : ''}`;

    return { domain, type: 'repository', structured, cleanContent };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. Hacker News extractor
// ---------------------------------------------------------------------------

interface HNComment {
  author: string;
  text: string;
  time: string;
  replies: HNComment[];
}

async function fetchHNComment(id: number, depth: number): Promise<HNComment | null> {
  if (depth < 0) return null;
  try {
    const data = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (!data || data.deleted || data.dead) return null;
    const text = stripHtml(data.text || '');
    if (!text) return null;

    let replies: HNComment[] = [];
    if (depth > 0 && Array.isArray(data.kids) && data.kids.length > 0) {
      const replyResults = await Promise.all(
        data.kids.slice(0, 5).map((kid: number) => fetchHNComment(kid, depth - 1))
      );
      replies = replyResults.filter(Boolean) as HNComment[];
    }

    return {
      author: data.by || '[deleted]',
      text,
      time: unixToIso(data.time),
      replies,
    };
  } catch {
    return null;
  }
}

async function hackerNewsExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'news.ycombinator.com';

  // Story: ?id=12345 or /item?id=12345
  const itemId = urlObj.searchParams.get('id');

  if (itemId && (path === '/' || path === '/item' || path === '')) {
    const storyData = await fetchJson(
      `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`
    );
    if (!storyData) return null;

    const type = storyData.type === 'story' ? 'story' :
      storyData.type === 'ask' ? 'ask_hn' :
      storyData.type === 'show' ? 'show_hn' :
      storyData.type === 'job' ? 'job' : 'story';

    // Fetch top 15 comments (top-level), 2 levels deep
    const commentIds: number[] = Array.isArray(storyData.kids) ? storyData.kids.slice(0, 15) : [];
    const commentResults = await Promise.all(
      commentIds.map((id) => fetchHNComment(id, 2))
    );
    const comments = commentResults.filter(Boolean) as HNComment[];

    const structured: Record<string, any> = {
      id: storyData.id,
      title: storyData.title || '',
      author: storyData.by || '[deleted]',
      score: storyData.score ?? 0,
      url: storyData.url || `https://news.ycombinator.com/item?id=${storyData.id}`,
      commentCount: storyData.descendants ?? 0,
      created: unixToIso(storyData.time),
      text: storyData.text ? stripHtml(storyData.text) : null,
      comments,
    };

    const commentsMd = comments.slice(0, 10).map(c => {
      const repliesMd = c.replies.slice(0, 3).map(r =>
        `  > **${r.author}**: ${r.text.slice(0, 200)}`
      ).join('\n');
      return `**${c.author}** (${c.time})\n${c.text.slice(0, 300)}${repliesMd ? '\n' + repliesMd : ''}`;
    }).join('\n\n---\n\n');

    const bodySection = structured.text ? `\n\n${structured.text.slice(0, 500)}` : '';

    const cleanContent = `## 🟠 Hacker News: ${structured.title}

**Author:** ${structured.author}  |  **Score:** ${structured.score}  |  **Comments:** ${structured.commentCount}
**Posted:** ${structured.created}
${structured.url !== `https://news.ycombinator.com/item?id=${structured.id}` ? `**Link:** ${structured.url}` : ''}${bodySection}

---

### Top Comments

${commentsMd || '*No comments found.*'}`;

    return { domain, type, structured, cleanContent };
  }

  // Front page / /news — fetch top stories
  if (path === '/' || path === '/news' || path === '') {
    const topIds = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!Array.isArray(topIds)) return null;

    const top30 = topIds.slice(0, 30);
    const storyResults = await Promise.all(
      top30.map((id: number) =>
        fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
      )
    );

    const stories = storyResults
      .filter((s: any) => s && s.title)
      .map((s: any) => ({
        id: s.id,
        title: s.title,
        author: s.by || '[deleted]',
        score: s.score ?? 0,
        commentCount: s.descendants ?? 0,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        hnUrl: `https://news.ycombinator.com/item?id=${s.id}`,
      }));

    const structured = { title: 'Hacker News — Front Page', stories };
    const cleanContent = `## 🟠 Hacker News — Front Page

${stories.map((s: any, i: number) =>
  `${i + 1}. **${s.title}**\n   ↑ ${s.score} | 💬 ${s.commentCount} | by ${s.author}\n   ${s.url}`
).join('\n\n')}`;

    return { domain, type: 'frontpage', structured, cleanContent };
  }

  // User page: ?id=username
  const userId = urlObj.searchParams.get('id');
  if (path === '/user' && userId) {
    const userData = await fetchJson(`https://hacker-news.firebaseio.com/v0/user/${userId}.json`);
    if (!userData) return null;

    const structured: Record<string, any> = {
      id: userData.id,
      karma: userData.karma ?? 0,
      about: userData.about ? stripHtml(userData.about) : '',
      created: unixToIso(userData.created),
      submitted: (userData.submitted || []).length,
    };

    const cleanContent = `## 🟠 HN User: ${structured.id}

**Karma:** ${structured.karma}  |  **Member since:** ${structured.created}
${structured.about ? '\n' + structured.about : ''}`;

    return { domain, type: 'user', structured, cleanContent };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 5. Wikipedia extractor
// ---------------------------------------------------------------------------

/** Remove Wikipedia-specific noise from extracted content. */
function cleanWikipediaContent(content: string): string {
  return content
    // Remove [edit] links
    .replace(/\[edit\]/gi, '')
    // Remove citation brackets [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Remove [citation needed], [verification], etc.
    .replace(/\[(citation needed|verification|improve this article|adding citations[^\]]*|when\?|where\?|who\?|clarification needed|dubious[^\]]*|failed verification[^\]]*|unreliable source[^\]]*)\]/gi, '')
    // Remove [Learn how and when to remove this message]
    .replace(/\[Learn how and when to remove this message\]/gi, '')
    // Clean up excess whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function wikipediaExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Only handle article pages: /wiki/Article_Title
  if (pathParts[0] !== 'wiki' || pathParts.length < 2) return null;

  const articleTitle = decodeURIComponent(pathParts[1]);
  // Skip special pages (contain a colon, e.g. Special:Random, Talk:Article)
  if (articleTitle.includes(':')) return null;

  const lang = urlObj.hostname.split('.')[0] || 'en';
  const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;

  // Wikipedia REST API requires a descriptive User-Agent (https://meta.wikimedia.org/wiki/User-Agent_policy)
  const wikiHeaders = { 'User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me) Node.js', 'Api-User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me)' };

  try {
    const data = await fetchJson(apiUrl, wikiHeaders);
    if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') return null;

    // For full article content, use the mobile-html endpoint (mobile-sections is deprecated)
    let fullContent = '';
    let mobileHtmlSize: number | undefined;
    try {
      const fullUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(articleTitle)}`;
      const fullResult = await simpleFetch(fullUrl, undefined, 15000, {
        ...wikiHeaders,
        'Accept': 'text/html',
      });
      if (fullResult?.html) {
        mobileHtmlSize = fullResult.html.length;
        // Parse sections from the mobile HTML
        const sectionMatches = fullResult.html.match(/<section[^>]*>([\s\S]*?)<\/section>/gi) || [];
        for (const section of sectionMatches) {
          // Extract section heading
          const headingMatch = section.match(/<h[2-6][^>]*id="([^"]*)"[^>]*class="[^"]*pcs-edit-section-title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
          const heading = headingMatch ? stripHtml(headingMatch[2]).trim() : '';
          // Extract paragraphs
          const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
          const sectionText = paragraphs.map((p: string) => stripHtml(p).trim()).filter((t: string) => t.length > 0).join('\n\n');
          if (sectionText) {
            const prefix = heading ? `## ${heading}\n\n` : '';
            fullContent += `\n\n${prefix}${sectionText}`;
          }
        }
      }
    } catch (e) {
      // mobile-html failed — use summary extract as fallback
      if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia mobile-html failed, using summary:', e instanceof Error ? e.message : e);
    }

    // Clean Wikipedia-specific noise
    fullContent = cleanWikipediaContent(fullContent);

    const structured: Record<string, any> = {
      title: data.title || articleTitle.replace(/_/g, ' '),
      description: data.description || '',
      extract: data.extract || '',
      thumbnail: data.thumbnail?.source || null,
      url: data.content_urls?.desktop?.page || url,
      lastModified: data.timestamp || null,
    };

    const cleanContent = `# ${structured.title}\n\n${structured.description ? `*${structured.description}*\n\n` : ''}${fullContent || structured.extract}`;

    return { domain: 'wikipedia.org', type: 'article', structured, cleanContent, rawHtmlSize: mobileHtmlSize };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. YouTube extractor (oEmbed API-first)
// ---------------------------------------------------------------------------

async function youtubeExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  // Helper: wrap a promise with a timeout
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
  }

  // Run transcript fetch and oEmbed fetch in parallel
  // Proxy-based extraction takes 2-5s, but retry logic may need more time
  const transcriptPromise = withTimeout(getYouTubeTranscript(url), 30000);
  const oembedPromise = fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  const noembedPromise = fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(url)}`).catch(() => null);

  // Fetch subscriber count from channel page (lightweight, parallel)
  const subscriberPromise = (async (): Promise<string> => {
    try {
      // Wait for oEmbed to get channel URL, then fetch subscriber count from channel page
      const oembed = await oembedPromise;
      const channelUrl = (oembed as any)?.author_url;
      if (!channelUrl) return '';
      const resp = await fetch(channelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000),
      });
      const html = await resp.text();
      // Look for subscriber count in page metadata (e.g. "4.12M subscribers")
      const subMatch = html.match(/(\d+(?:\.\d+)?[KMBkmb]?)\s*subscribers/i);
      return subMatch ? subMatch[1] + ' subscribers' : '';
    } catch { return ''; }
  })();

  const [transcriptResult, oembedResult, noembedResult, subscriberResult] = await Promise.allSettled([
    transcriptPromise,
    oembedPromise,
    noembedPromise,
    subscriberPromise,
  ]);

  const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
  const oembedData = oembedResult.status === 'fulfilled' ? oembedResult.value : null;
  const noembedData = noembedResult.status === 'fulfilled' ? noembedResult.value : null;
  const subscriberCount = subscriberResult.status === 'fulfilled' ? subscriberResult.value : '';

  if (process.env.DEBUG) {
    if (transcriptResult.status === 'rejected') {
      console.debug('[webpeel]', 'YouTube transcript failed:', transcriptResult.reason instanceof Error ? transcriptResult.reason.message : transcriptResult.reason);
    }
    if (oembedResult.status === 'rejected') {
      console.debug('[webpeel]', 'YouTube oEmbed failed:', oembedResult.reason instanceof Error ? oembedResult.reason.message : oembedResult.reason);
    }
  }

  // If transcript succeeded, build rich content
  if (transcript) {
    const title = transcript.title || oembedData?.title || '';
    const channel = transcript.channel || oembedData?.author_name || '';
    const channelUrl = oembedData?.author_url || `https://www.youtube.com/@${channel}`;
    const description = transcript.description || (noembedData as any)?.description || (oembedData as any)?.description || '';
    const thumbnailUrl = (oembedData as any)?.thumbnail_url || '';
    const publishDate = transcript.publishDate || '';
    const hasTranscript = transcript.segments.length > 0;

    const structured: Record<string, any> = {
      title,
      channel,
      channelUrl,
      subscriberCount: subscriberCount || undefined,
      duration: transcript.duration,
      publishDate,
      language: transcript.language,
      availableLanguages: transcript.availableLanguages,
      transcriptSegments: transcript.segments.length,
      wordCount: transcript.wordCount ?? 0,
      viewCount: transcript.viewCount ?? '',
      likeCount: transcript.likeCount ?? '',
      description,
      thumbnailUrl,
      chapters: transcript.chapters ?? [],
      keyPoints: transcript.keyPoints ?? [],
      source: 'transcript',
    };

    // Format the publish date nicely if it's an ISO date
    let publishStr = '';
    if (publishDate) {
      try {
        const d = new Date(publishDate);
        publishStr = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
      } catch {
        publishStr = publishDate;
      }
    }

    // Format view count (e.g. "1,234,567" → "1.2M views")
    let viewStr = '';
    if (transcript.viewCount) {
      const v = parseInt(transcript.viewCount, 10);
      if (!isNaN(v)) {
        if (v >= 1_000_000) viewStr = `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
        else if (v >= 1_000) viewStr = `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
        else viewStr = `${v.toLocaleString()} views`;
      }
    }

    // Build header line
    const channelPart = subscriberCount ? `${channel} (${subscriberCount})` : channel;
    const headerParts = [`**Channel:** ${channelPart}`];
    if (transcript.duration && transcript.duration !== '0:00') headerParts.push(`**Duration:** ${transcript.duration}`);
    if (viewStr) headerParts.push(`**${viewStr}**`);
    if (publishStr) headerParts.push(`**Published:** ${publishStr}`);
    const headerLine = headerParts.join(' | ');

    const parts: string[] = [];
    parts.push(`# ${title}`);
    parts.push(headerLine);

    /**
     * Strip music note symbols from transcript/caption text.
     * YouTube auto-captions include ♪ and 🎵 as music cues.
     * Patterns cleaned:
     *   [♪♪♪]  →  (removed)
     *   ♪ text ♪  →  text
     *   standalone ♪ / 🎵  →  (removed)
     */
    const cleanMusicNotes = (text: string): string =>
      text
        // Remove bracketed music cues: [♪], [♪♪♪], [🎵🎵🎵], etc.
        .replace(/\[[♪🎵]+\]/g, '')
        // Unwrap ♪ text ♪ → text (keep the words between notes)
        .replace(/♪\s*([^♪]*?)\s*♪/g, (_, inner) => inner.trim())
        // Remove any remaining standalone ♪ or 🎵
        .replace(/[♪🎵]+/g, '')
        // Collapse extra whitespace introduced by removals
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Summary section
    if (transcript.summary && hasTranscript) {
      let summaryText = cleanMusicNotes(transcript.summary);
      summaryText = summaryText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
      parts.push(`## Summary\n\n${summaryText}`);
    } else if (!hasTranscript && transcript.fullText) {
      parts.push(`## Description\n\n${transcript.fullText}`);
    }

    // Key Points section
    if (transcript.keyPoints && transcript.keyPoints.length > 0) {
      const kpLines = transcript.keyPoints.map(kp => `- ${kp}`).join('\n');
      parts.push(`## Key Points\n\n${kpLines}`);
    }

    // Chapters section
    if (transcript.chapters && transcript.chapters.length > 0) {
      const chLines = transcript.chapters.map(ch => `- ${ch.time} — ${ch.title}`).join('\n');
      parts.push(`## Chapters\n\n${chLines}`);
    }

    // Full Transcript section (only if we have real transcript segments)
    // Add intelligent paragraph breaks for readability
    if (hasTranscript) {
      let readableText = cleanMusicNotes(transcript.fullText);
      // Break into paragraphs: after sentence-ending punctuation followed by a capital letter
      readableText = readableText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
      // Collapse any triple+ newlines
      readableText = readableText.replace(/\n{3,}/g, '\n\n');
      parts.push(`## Full Transcript\n\n${readableText}`);
    }

    const cleanContent = parts.join('\n\n');

    return { domain: 'youtube.com', type: 'video', structured, cleanContent };
  }

  // Fall back to oEmbed if transcript failed
  if (oembedData && (oembedData as any).title) {
    const structured: Record<string, any> = {
      title: (oembedData as any).title,
      channel: (oembedData as any).author_name || '',
      channelUrl: (oembedData as any).author_url || '',
      thumbnailUrl: (oembedData as any).thumbnail_url || '',
      description: (noembedData as any)?.description || '',
      type: (oembedData as any).type || 'video',
      source: 'oembed',
    };

    const descSection = structured.description ? `\n\n${structured.description}` : '\n\nYouTube video';
    const cleanContent = `## 🎬 ${structured.title}\n\n**Channel:** [${structured.channel}](${structured.channelUrl})${descSection}`;

    return { domain: 'youtube.com', type: 'video', structured, cleanContent };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 7. ArXiv extractor (ArXiv API)
// ---------------------------------------------------------------------------

async function arxivExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Extract paper ID from URL patterns:
  // /abs/2501.12948, /pdf/2501.12948, /abs/2501.12948v2
  const idMatch = path.match(/\/(abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (!idMatch) return null;

  const paperId = idMatch[2];

  try {
    // Use ArXiv API
    const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}`;
    const result = await simpleFetch(apiUrl, 'WebPeel/0.17.1', 15000, { Accept: 'application/xml' });

    if (!result?.html) return null;
    const xml = result.html;

    // Parse XML (simple regex-based for these known fields)
    const getTag = (tag: string): string => {
      const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? stripHtml(match[1]).trim() : '';
    };
    // getAllTags removed — unused

    // ArXiv Atom feed: <feed><title>query URL</title> ... <entry><title>Paper Title</title>...
    // We must grab the entry title, not the feed title.
    const entryMatch = xml.match(/<entry[\s\S]*?<\/entry>/);
    const entryXml = entryMatch ? entryMatch[0] : xml;
    const getEntryTag = (tag: string): string => {
      const match = entryXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? stripHtml(match[1]).trim() : '';
    };
    const getAllEntryTags = (tag: string): string[] => {
      const matches = [...entryXml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))];
      return matches.map(m => stripHtml(m[1]).trim()).filter(Boolean);
    };

    const title = getEntryTag('title') || getTag('title');
    const summary = getEntryTag('summary') || getTag('summary');
    const published = getEntryTag('published') || getTag('published');
    const updated = getEntryTag('updated') || getTag('updated');
    const authors = getAllEntryTags('name');

    // Extract categories
    const categories = [...xml.matchAll(/category[^>]*term="([^"]+)"/g)].map(m => m[1]);

    // Extract DOI and journal ref if available
    const doi = getTag('arxiv:doi');
    const journalRef = getTag('arxiv:journal_ref');

    if (!title) return null;

    const structured: Record<string, any> = {
      title,
      authors,
      abstract: summary,
      published: published || undefined,
      updated: updated || undefined,
      categories,
      doi: doi || undefined,
      journalRef: journalRef || undefined,
      paperId,
      pdfUrl: `https://arxiv.org/pdf/${paperId}`,
      absUrl: `https://arxiv.org/abs/${paperId}`,
    };

    const authorLine = authors.length <= 5
      ? authors.join(', ')
      : `${authors.slice(0, 5).join(', ')} et al. (${authors.length} authors)`;

    const cleanContent = `# ${title}\n\n**Authors:** ${authorLine}\n**Published:** ${published?.split('T')[0] || 'N/A'}${categories.length ? `\n**Categories:** ${categories.join(', ')}` : ''}${doi ? `\n**DOI:** ${doi}` : ''}${journalRef ? `\n**Journal:** ${journalRef}` : ''}\n\n## Abstract\n\n${summary}\n\n📄 [PDF](${structured.pdfUrl}) | [Abstract](${structured.absUrl})`;

    return { domain: 'arxiv.org', type: 'paper', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'ArXiv API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 8. Stack Overflow extractor (StackExchange API)
// ---------------------------------------------------------------------------

async function stackOverflowExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /questions/12345/optional-slug
  const questionMatch = path.match(/\/questions\/(\d+)/);
  if (!questionMatch) return null;

  const questionId = questionMatch[1];

  try {
    const apiUrl = `https://api.stackexchange.com/2.3/questions/${questionId}?order=desc&sort=votes&site=stackoverflow&filter=withbody`;
    const data = await fetchJson(apiUrl);

    if (!data?.items?.[0]) return null;
    const q = data.items[0];

    // Also fetch answers
    let answers: any[] = [];
    try {
      const answersUrl = `https://api.stackexchange.com/2.3/questions/${questionId}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody&pagesize=5`;
      const answersData = await fetchJson(answersUrl);
      answers = answersData?.items || [];
    } catch { /* answers optional */ }

    const structured: Record<string, any> = {
      title: stripHtml(q.title || ''),
      questionId: q.question_id,
      score: q.score || 0,
      views: q.view_count || 0,
      answerCount: q.answer_count || 0,
      isAnswered: q.is_answered || false,
      tags: q.tags || [],
      askedBy: q.owner?.display_name || 'anonymous',
      askedDate: q.creation_date ? new Date(q.creation_date * 1000).toISOString() : undefined,
      acceptedAnswerId: q.accepted_answer_id || null,
      answers: answers.map(a => ({
        id: a.answer_id,
        score: a.score,
        isAccepted: a.is_accepted || false,
        body: stripHtml(a.body || '').substring(0, 2000),
        author: a.owner?.display_name || 'anonymous',
      })),
    };

    const questionBody = stripHtml(q.body || '').substring(0, 3000);
    const tagLine = structured.tags.length ? `**Tags:** ${structured.tags.join(', ')}` : '';

    let answersContent = '';
    for (const a of structured.answers.slice(0, 3)) {
      const acceptedMark = a.isAccepted ? ' ✅ Accepted' : '';
      answersContent += `\n\n---\n\n### Answer by ${a.author} (Score: ${a.score}${acceptedMark})\n\n${a.body}`;
    }

    const cleanContent = `# ${structured.title}\n\n**Score:** ${structured.score} | **Views:** ${structured.views?.toLocaleString()} | **Answers:** ${structured.answerCount}\n${tagLine}\n**Asked by:** ${structured.askedBy}\n\n## Question\n\n${questionBody}${answersContent}`;

    return { domain: 'stackoverflow.com', type: 'question', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'StackOverflow API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 9. NPM extractor (npm registry API)
// ---------------------------------------------------------------------------

async function npmExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /package/name or /package/@scope/name
  const packageMatch = path.match(/\/package\/((?:@[^/]+\/)?[^/]+)/);
  if (!packageMatch) return null;

  const packageName = packageMatch[1];

  try {
    const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const data = await fetchJson(apiUrl);

    if (!data?.name) return null;

    const latest = data['dist-tags']?.latest;
    const latestVersion = latest ? data.versions?.[latest] : null;

    // Get download counts
    let downloads: any = null;
    try {
      downloads = await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`);
    } catch { /* optional */ }

    const structured: Record<string, any> = {
      title: `${data.name}@${latest || 'unknown'}`,
      name: data.name,
      description: data.description || '',
      version: latest || 'unknown',
      license: latestVersion?.license || data.license || 'N/A',
      homepage: data.homepage || latestVersion?.homepage || null,
      repository: typeof data.repository === 'string' ? data.repository : data.repository?.url || null,
      author: typeof data.author === 'string' ? data.author : data.author?.name || '',
      keywords: data.keywords || [],
      weeklyDownloads: downloads?.downloads || 0,
      dependencies: Object.keys(latestVersion?.dependencies || {}),
      devDependencies: Object.keys(latestVersion?.devDependencies || {}),
      maintainers: (data.maintainers || []).map((m: any) => m.name || m).slice(0, 10),
      created: data.time?.created || undefined,
      modified: data.time?.modified || undefined,
    };

    // Include README if available (some packages have it, some don't)
    let readmeText = data.readme && data.readme.length > 10 ? data.readme.slice(0, 5000) : '';

    // If no README in registry, try fetching from unpkg.com
    if (!readmeText) {
      try {
        const unpkgUrl = `https://unpkg.com/${encodeURIComponent(packageName)}/README.md`;
        const readmeResult = await simpleFetch(unpkgUrl, undefined, 10000);
        if (readmeResult?.html && readmeResult.html.length > 10 && !readmeResult.html.trim().startsWith('<')) {
          readmeText = readmeResult.html.slice(0, 5000);
        }
      } catch { /* README from unpkg optional */ }
    }

    // Add to structured data
    structured.readme = readmeText;

    const keywordsLine = structured.keywords.length ? `\n**Keywords:** ${structured.keywords.join(', ')}` : '';
    // Show ALL dependencies (not capped at 15)
    const depsLine = structured.dependencies.length
      ? `\n**Dependencies (${structured.dependencies.length}):** ${structured.dependencies.join(', ')}`
      : '';
    const devDepsLine = structured.devDependencies.length
      ? `\n**Dev Dependencies (${structured.devDependencies.length}):** ${structured.devDependencies.slice(0, 10).join(', ')}${structured.devDependencies.length > 10 ? '...' : ''}`
      : '';
    const repoLine = structured.repository ? `\n**Repository:** ${structured.repository.replace('git+', '').replace('.git', '')}` : '';
    const homepageLine = structured.homepage ? `\n**Homepage:** ${structured.homepage}` : '';
    const datesLine = structured.created ? `\n**Created:** ${structured.created?.split('T')[0] || 'N/A'} | **Last modified:** ${structured.modified?.split('T')[0] || 'N/A'}` : '';

    const readmeSection = readmeText
      ? `\n\n### README\n\n${readmeText}`
      : '';

    const cleanContent = `# 📦 ${structured.name}@${structured.version}

${structured.description}

**License:** ${structured.license} | **Weekly Downloads:** ${structured.weeklyDownloads?.toLocaleString() || 'N/A'}
**Author:** ${structured.author || 'N/A'} | **Maintainers:** ${structured.maintainers.join(', ') || 'N/A'}${keywordsLine}${depsLine}${devDepsLine}${repoLine}${homepageLine}${datesLine}${readmeSection}`;

    return { domain: 'npmjs.com', type: 'package', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'NPM API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 10. Best Buy extractor (Best Buy Products API)
// ---------------------------------------------------------------------------

async function bestBuyExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return null; // No API key, skip

  // Extract SKU from URL: /site/.../6587822.p → 6587822
  const skuMatch = url.match(/\/(\d{7,})\.p/);
  if (!skuMatch) return null;
  const sku = skuMatch[1];

  const apiUrl = `https://api.bestbuy.com/v1/products/${sku}.json?apiKey=${apiKey}&show=sku,name,salePrice,regularPrice,onSale,shortDescription,longDescription,image,largeFrontImage,url,customerReviewAverage,customerReviewCount,categoryPath,manufacturer,modelNumber,upc,freeShipping,inStoreAvailability,onlineAvailability,condition,features.feature`;

  try {
    const data = await fetchJson(apiUrl);
    if (!data || data.error) return null;

    // Build clean markdown
    const lines: string[] = [];
    lines.push(`# ${data.name}`);
    lines.push('');
    if (data.onSale) {
      lines.push(`**Sale Price:** $${data.salePrice} (was $${data.regularPrice})`);
    } else {
      lines.push(`**Price:** $${data.regularPrice}`);
    }
    lines.push(`**SKU:** ${data.sku}`);
    if (data.manufacturer) lines.push(`**Brand:** ${data.manufacturer}`);
    if (data.modelNumber) lines.push(`**Model:** ${data.modelNumber}`);
    if (data.customerReviewAverage) {
      lines.push(`**Rating:** ${data.customerReviewAverage}/5 (${data.customerReviewCount} reviews)`);
    }
    lines.push(`**Availability:** ${data.onlineAvailability ? 'In Stock Online' : 'Out of Stock Online'} | ${data.inStoreAvailability ? 'Available In Store' : 'Not Available In Store'}`);
    if (data.freeShipping) lines.push('**Free Shipping:** Yes');
    lines.push('');
    if (data.shortDescription) lines.push(data.shortDescription);
    lines.push('');
    if (data.longDescription) lines.push(data.longDescription);
    if (data.features?.feature) {
      lines.push('');
      lines.push('## Features');
      for (const f of data.features.feature) {
        lines.push(`- ${f}`);
      }
    }

    const structured = {
      sku: data.sku,
      name: data.name,
      price: data.salePrice || data.regularPrice,
      regularPrice: data.regularPrice,
      onSale: data.onSale,
      brand: data.manufacturer,
      model: data.modelNumber,
      upc: data.upc,
      rating: data.customerReviewAverage,
      reviewCount: data.customerReviewCount,
      image: data.largeFrontImage || data.image,
      url: data.url,
      inStock: data.onlineAvailability,
      freeShipping: data.freeShipping,
      condition: data.condition,
      category: data.categoryPath?.map((c: any) => c.name).join(' > '),
    };

    return { domain: 'bestbuy.com', type: 'product', structured, cleanContent: lines.join('\n') };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Best Buy API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 11. Walmart extractor (Walmart frontend search API)
// ---------------------------------------------------------------------------

async function walmartExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  // Extract item ID from URL patterns:
  // /ip/Product-Name/1234567 or /ip/1234567
  const itemMatch = url.match(/\/ip\/(?:.*\/)?(\d+)/);
  if (!itemMatch) return null;
  const itemId = itemMatch[1];

  // Try Walmart's BE API (used by their frontend, sometimes accessible)
  const apiUrl = `https://www.walmart.com/orchestra/snb/graphql/Search?query=${itemId}&page=1&affinityOverride=default&limit=1`;

  try {
    const response = await fetchJson(apiUrl, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.walmart.com/',
    });

    if (response?.data?.search?.searchResult?.itemStacks?.[0]?.items?.[0]) {
      const item = response.data.search.searchResult.itemStacks[0].items[0];

      const lines: string[] = [];
      lines.push(`# ${item.name}`);
      if (item.priceInfo?.currentPrice?.price) {
        lines.push(`**Price:** $${item.priceInfo.currentPrice.price}`);
      }
      if (item.averageRating) {
        lines.push(`**Rating:** ${item.averageRating}/5 (${item.numberOfReviews || 0} reviews)`);
      }
      if (item.shortDescription) lines.push(item.shortDescription);

      const structured = {
        name: item.name,
        price: item.priceInfo?.currentPrice?.price,
        rating: item.averageRating,
        reviewCount: item.numberOfReviews,
        image: item.imageInfo?.thumbnailUrl,
        itemId: itemId,
        inStock: item.availabilityStatusV2?.value === 'IN_STOCK',
      };

      return { domain: 'walmart.com', type: 'product', structured, cleanContent: lines.join('\n') };
    }
    return null;
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Walmart API failed:', e instanceof Error ? e.message : e);
    return null; // API not accessible, fall through to other methods
  }
}

// ---------------------------------------------------------------------------
// 12. Amazon Products extractor
// ---------------------------------------------------------------------------

async function amazonExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Extract from JSON-LD first
    let jsonLdData: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLdData) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Product') jsonLdData = parsed;
    });

    // Meta tag fallbacks
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    // HTML selectors
    const title = jsonLdData?.name ||
      $('#productTitle').text().trim() ||
      $('#title').text().trim() ||
      ogTitle;

    if (!title) return null;

    const priceWhole = $('#priceblock_ourprice').text().trim() ||
      $('.a-price .a-offscreen').first().text().trim() ||
      $('[data-asin-price]').first().attr('data-asin-price') || '';

    const rating = jsonLdData?.aggregateRating?.ratingValue ||
      $('#acrPopover .a-size-base.a-color-base').first().text().trim() ||
      $('span[data-hook="rating-out-of-text"]').text().trim() || '';

    const reviewCount = jsonLdData?.aggregateRating?.reviewCount ||
      $('#acrCustomerReviewText').text().replace(/[^0-9,]/g, '').trim() || '';

    const availability = jsonLdData?.offers?.availability?.replace('https://schema.org/', '') ||
      $('#availability span').first().text().trim() || '';

    const description = jsonLdData?.description ||
      $('#feature-bullets .a-list-item').map((_: any, el: any) => $(el).text().trim()).get().join('\n') ||
      $('#productDescription p').text().trim() ||
      ogDescription;

    const features: string[] = [];
    $('#feature-bullets li').each((_: any, el: any) => {
      const text = $(el).text().trim();
      if (text && !text.includes('Make sure this fits')) features.push(text);
    });

    // ASIN from URL
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
    const asin = asinMatch?.[1] || '';

    const structured: Record<string, any> = {
      title,
      price: priceWhole,
      rating,
      reviewCount,
      availability,
      description,
      features,
      asin,
      image: ogImage,
      url,
    };

    const ratingLine = rating ? `\n**Rating:** ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}` : '';
    const priceLine = priceWhole ? `\n**Price:** ${priceWhole}` : '';
    const availLine = availability ? `\n**Availability:** ${availability}` : '';
    const featuresSection = features.length
      ? `\n\n## Features\n\n${features.map(f => `- ${f}`).join('\n')}`
      : '';
    const descSection = description ? `\n\n## Description\n\n${description.substring(0, 1000)}` : '';

    const cleanContent = `# 🛒 ${title}${priceLine}${ratingLine}${availLine}${descSection}${featuresSection}`;

    return { domain: 'amazon.com', type: 'product', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 13. Medium Articles extractor
// ---------------------------------------------------------------------------

async function mediumExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // JSON-LD
    let jsonLdData: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLdData) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'NewsArticle' || parsed?.['@type'] === 'Article') jsonLdData = parsed;
    });

    const title = jsonLdData?.headline ||
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() || '';

    if (!title) return null;

    const author = jsonLdData?.author?.name ||
      $('meta[name="author"]').attr('content') ||
      $('[data-testid="authorName"]').text().trim() ||
      $('a[rel="author"]').first().text().trim() || '';

    const publishDate = jsonLdData?.datePublished ||
      $('meta[property="article:published_time"]').attr('content') || '';

    const readingTime = $('[data-testid="storyReadTime"]').text().trim() ||
      $('span').filter((_: any, el: any) => $(el).text().includes('min read')).first().text().trim() || '';

    const description = jsonLdData?.description ||
      $('meta[property="og:description"]').attr('content') || '';

    // Publication name — subdomain (towardsdatascience.medium.com), meta tags, or breadcrumb
    let publication = '';
    try {
      const urlObj2 = new URL(url);
      const hostname = urlObj2.hostname;
      if (hostname !== 'medium.com' && hostname !== 'www.medium.com' && hostname.endsWith('.medium.com')) {
        publication = hostname.replace('.medium.com', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } catch { /* ignore */ }
    if (!publication) {
      publication = $('[data-testid="publicationName"]').text().trim() ||
        $('a[data-testid="publicationName"]').text().trim() ||
        $('meta[property="article:section"]').attr('content') ||
        $('a[href*="/tag/"]').first().text().trim() || '';
    }

    // Author bio — usually shown in an author card or bio section
    const authorBio = $('[data-testid="authorBio"]').text().trim() ||
      $('p[class*="bio"]').first().text().trim() ||
      $('[aria-label="authorBio"]').text().trim() || '';

    // Clap count — Medium shows clap button with count
    let clapCount = '';
    $('button[data-testid="storyClaps"], button[aria-label*="clap"]').each((_: any, el: any): false | void => {
      const txt = $(el).text().trim();
      if (txt && /\d/.test(txt)) { clapCount = txt; return false; }
    });
    if (!clapCount) {
      // Fallback: find spans that look like clap counts (e.g., "2.4K")
      $('span').filter((_: any, el: any) => {
        const label = $(el).closest('[aria-label]').attr('aria-label') || '';
        return label.toLowerCase().includes('clap');
      }).each((_: any, el: any): false | void => {
        const txt = $(el).text().trim();
        if (txt && /\d/.test(txt)) { clapCount = txt; return false; }
      });
    }

    // Extract article body — Medium puts content in <article> or section
    let articleBody = '';
    const articleEl = $('article').first();
    if (articleEl.length) {
      // Remove nav, aside, buttons, author-card, footer sections
      articleEl.find('nav, aside, button, [data-testid="navbar"], footer, [data-testid="authorCard"]').remove();
      // Get paragraphs and headings
      const parts: string[] = [];
      articleEl.find('h1, h2, h3, h4, p, blockquote, pre, li, figure figcaption').each((_: any, el: any) => {
        const tag = (el as any).name;
        const text = $(el).text().trim();
        if (!text || text.length < 5) return;
        if (tag === 'h1' || tag === 'h2') parts.push(`## ${text}`);
        else if (tag === 'h3' || tag === 'h4') parts.push(`### ${text}`);
        else if (tag === 'blockquote') parts.push(`> ${text}`);
        else if (tag === 'pre') parts.push('```\n' + text + '\n```');
        else if (tag === 'figcaption') parts.push(`*${text}*`);
        else parts.push(text);
      });
      articleBody = parts.join('\n\n');
    }

    // Fallback to og:description if no body
    const contentBody = articleBody || description;

    const structured: Record<string, any> = {
      title,
      author,
      authorBio,
      publishDate,
      readingTime,
      description,
      publication,
      clapCount,
      url,
    };

    const authorLine = author ? `\n**Author:** ${author}` : '';
    const bioLine = authorBio ? `\n**Author Bio:** ${authorBio}` : '';
    const dateLine = publishDate ? `\n**Published:** ${publishDate.split('T')[0]}` : '';
    const timeLine = readingTime ? `\n**Reading time:** ${readingTime}` : '';
    const pubLine = publication ? `\n**Publication:** ${publication}` : '';
    const clapsLine = clapCount ? `\n**Claps:** ${clapCount}` : '';

    // No hard character cap — let the pipeline's budget/maxTokens handle truncation
    const cleanContent = `# ${title}${authorLine}${bioLine}${dateLine}${timeLine}${pubLine}${clapsLine}\n\n${contentBody}`;

    return { domain: 'medium.com', type: 'article', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 14. Substack Posts extractor
// ---------------------------------------------------------------------------

async function substackExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');

    // Handle open.substack.com/pub/{publication}/p/{slug} redirect URLs
    // These are share links that redirect to the actual post. Redirect to the real URL.
    const urlObj = new URL(url);
    let workingHtml = html;
    let workingUrl = url;
    if (urlObj.hostname === 'open.substack.com') {
      const openMatch = urlObj.pathname.match(/\/pub\/([^/]+)\/p\/([^/]+)/);
      if (openMatch) {
        const [, publication, slug] = openMatch;
        const actualUrl = `https://${publication}.substack.com/p/${slug}`;
        try {
          const fetchResult = await simpleFetch(actualUrl, undefined, 15000);
          if (fetchResult?.html && fetchResult.html.length > 500) {
            workingHtml = fetchResult.html;
            workingUrl = actualUrl;
          }
        } catch { /* fall through with original HTML */ }
      }
    }

    const $ = load(workingHtml);

    // JSON-LD
    let jsonLdData: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLdData) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'NewsArticle' || parsed?.['@type'] === 'Article') jsonLdData = parsed;
    });

    const title = jsonLdData?.headline ||
      $('meta[property="og:title"]').attr('content') ||
      $('h1.post-title').first().text().trim() ||
      $('h1').first().text().trim() || '';

    if (!title) return null;

    const author = jsonLdData?.author?.name ||
      $('meta[name="author"]').attr('content') ||
      $('a.author-name').first().text().trim() ||
      $('[class*="author"]').first().text().trim() || '';

    const publishDate = jsonLdData?.datePublished ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('time').first().attr('datetime') || '';

    const publication = $('meta[property="og:site_name"]').attr('content') ||
      $('a.navbar-title-link').text().trim() || new URL(workingUrl).hostname.replace('.substack.com', '');

    const description = jsonLdData?.description ||
      $('meta[property="og:description"]').attr('content') || '';

    // Article content — try multiple Substack CSS patterns
    let articleBody = '';
    const postContent = $('.body.markup, .post-content, article, [class*="post-content"], .available-content').first();
    if (postContent.length) {
      postContent.find('script, style, nav, .paywall, .subscribe-widget, .subscription-widget').remove();
      const parts: string[] = [];
      postContent.find('h1, h2, h3, h4, p, blockquote, pre, li').each((_: any, el: any) => {
        const tag = (el as any).name;
        const text = $(el).text().trim();
        if (!text || text.length < 3) return;
        if (tag === 'h1' || tag === 'h2') parts.push(`## ${text}`);
        else if (tag === 'h3' || tag === 'h4') parts.push(`### ${text}`);
        else if (tag === 'blockquote') parts.push(`> ${text}`);
        else if (tag === 'pre') parts.push('```\n' + text + '\n```');
        else parts.push(text);
      });
      articleBody = parts.join('\n\n');
    }

    // If no article body found, try broader search
    if (!articleBody) {
      const parts: string[] = [];
      $('main p, article p, [class*="content"] p').each((_: any, el: any) => {
        const text = $(el).text().trim();
        if (text && text.length > 20) parts.push(text);
      });
      articleBody = parts.slice(0, 20).join('\n\n');
    }

    const contentBody = articleBody || description;

    // Detect if the post appears paywalled (short content with no article body)
    const isPaywalled = !articleBody && description.length > 0;
    const paywallNote = isPaywalled
      ? '\n\n---\n*⚠️ This post appears to be behind a paywall. Only the preview/description is available. Full content requires a subscription.*'
      : '';

    const structured: Record<string, any> = {
      title,
      author,
      publication,
      publishDate,
      description,
      paywalled: isPaywalled,
      url: workingUrl,
    };

    const authorLine = author ? `\n**Author:** ${author}` : '';
    const pubLine = publication ? `\n**Publication:** ${publication}` : '';
    const dateLine = publishDate ? `\n**Published:** ${publishDate.split('T')[0]}` : '';

    const cleanContent = `# ${title}${authorLine}${pubLine}${dateLine}\n\n${contentBody.substring(0, 8000)}${paywallNote}`;

    return { domain: 'substack.com', type: 'post', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 15. Allrecipes (Recipe Sites) extractor
// ---------------------------------------------------------------------------

async function allrecipesExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Try Schema.org Recipe JSON-LD first
    let recipe: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (recipe) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      // Can be an array or direct object
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        if (item?.['@type'] === 'Recipe' || (Array.isArray(item?.['@type']) && item['@type'].includes('Recipe'))) {
          recipe = item;
          break;
        }
        // Sometimes it's nested in @graph
        if (item?.['@graph']) {
          const graphRecipe = item['@graph'].find((g: any) => g?.['@type'] === 'Recipe');
          if (graphRecipe) { recipe = graphRecipe; break; }
        }
      }
    });

    let title: string;
    let ingredients: string[] = [];
    let instructions: string[] = [];
    let prepTime = '';
    let cookTime = '';
    let totalTime = '';
    let servings = '';
    let rating = '';
    let reviewCount = '';
    let description = '';

    if (recipe) {
      title = recipe.name || '';
      description = recipe.description || '';
      ingredients = (recipe.recipeIngredient || []).map((i: string) => i.trim());
      // Instructions can be strings or HowToStep objects
      const rawInstructions = recipe.recipeInstructions || [];
      for (const step of rawInstructions) {
        if (typeof step === 'string') instructions.push(step.trim());
        else if (step.text) instructions.push(step.text.trim());
        else if (step['@type'] === 'HowToSection' && step.itemListElement) {
          for (const s of step.itemListElement) {
            if (s.text) instructions.push(s.text.trim());
          }
        }
      }
      // Parse ISO 8601 duration (PT30M, PT1H30M)
      const parseDuration = (d: string) => {
        if (!d) return '';
        const h = d.match(/(\d+)H/)?.[1];
        const m = d.match(/(\d+)M/)?.[1];
        return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
      };
      prepTime = parseDuration(recipe.prepTime || '');
      cookTime = parseDuration(recipe.cookTime || '');
      totalTime = parseDuration(recipe.totalTime || '');
      servings = String(recipe.recipeYield || '');
      rating = recipe.aggregateRating?.ratingValue ? String(recipe.aggregateRating.ratingValue) : '';
      reviewCount = recipe.aggregateRating?.reviewCount ? String(recipe.aggregateRating.reviewCount) : '';
    } else {
      // HTML fallback
      title = $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') || '';
      description = $('meta[property="og:description"]').attr('content') || '';
      $('[class*="ingredient"]').each((_: any, el: any) => {
        const text = $(el).text().trim();
        if (text && text.length < 200) ingredients.push(text);
      });
      $('[class*="instruction"] li, [class*="step"] li').each((_: any, el: any) => {
        const text = $(el).text().trim();
        if (text) instructions.push(text);
      });
    }

    if (!title) return null;

    const structured: Record<string, any> = {
      title, description, ingredients, instructions,
      prepTime, cookTime, totalTime, servings, rating, reviewCount, url,
    };

    const timeParts = [
      prepTime ? `Prep: ${prepTime}` : '',
      cookTime ? `Cook: ${cookTime}` : '',
      totalTime ? `Total: ${totalTime}` : '',
    ].filter(Boolean).join(' | ');
    const metaLine = [
      timeParts,
      servings ? `Servings: ${servings}` : '',
      rating ? `Rating: ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}` : '',
    ].filter(Boolean).join(' | ');

    const ingredientsMd = ingredients.length
      ? `## Ingredients\n\n${ingredients.map(i => `- ${i}`).join('\n')}`
      : '';
    const instructionsMd = instructions.length
      ? `## Instructions\n\n${instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    const cleanContent = `# 🍽️ ${title}\n\n${metaLine ? `*${metaLine}*\n\n` : ''}${description ? description + '\n\n' : ''}${ingredientsMd}\n\n${instructionsMd}`.trim();

    return { domain: 'allrecipes.com', type: 'recipe', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 16. IMDB extractor
// ---------------------------------------------------------------------------

async function imdbExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // IMDB uses JSON-LD richly
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLd) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Movie' || parsed?.['@type'] === 'TVSeries' || parsed?.['@type'] === 'TVEpisode') {
        jsonLd = parsed;
      }
    });

    const title = jsonLd?.name ||
      $('meta[property="og:title"]').attr('content')?.replace(/ - IMDb$/, '') ||
      $('h1[data-testid="hero__pageTitle"] span').first().text().trim() || '';

    if (!title) return null;

    const description = jsonLd?.description ||
      $('meta[property="og:description"]').attr('content') ||
      $('p[data-testid="plot"]').text().trim() || '';

    const year = jsonLd?.datePublished?.substring(0, 4) ||
      $('a[href*="releaseinfo"]').first().text().trim() || '';

    const ratingValue = jsonLd?.aggregateRating?.ratingValue ||
      $('[data-testid="hero-rating-bar__aggregate-rating__score"] span').first().text().trim() || '';

    const ratingCount = jsonLd?.aggregateRating?.ratingCount || '';

    const contentType = jsonLd?.['@type'] || 'Movie';

    // Genres
    const genres: string[] = jsonLd?.genre
      ? (Array.isArray(jsonLd.genre) ? jsonLd.genre : [jsonLd.genre])
      : [];
    if (!genres.length) {
      $('[data-testid="genres"] a, a[href*="/search/title?genres"]').each((_: any, el: any) => {
        const g = $(el).text().trim();
        if (g && !genres.includes(g)) genres.push(g);
      });
    }

    // Director
    const director = jsonLd?.director
      ? (Array.isArray(jsonLd.director)
        ? jsonLd.director.map((d: any) => d.name || d).join(', ')
        : jsonLd.director?.name || String(jsonLd.director))
      : $('a[href*="/name/"][class*="ipc-metadata-list-item__list-content-item"]').first().text().trim() || '';

    // Cast — parse HTML first for actor+character pairs, then fall back to JSON-LD
    const castPairs: Array<{ actor: string; character: string }> = [];
    // IMDB new UI: each title-cast-item contains actor link + character link
    $('[data-testid="title-cast-item"]').each((_: any, el: any) => {
      const actorEl = $(el).find('a[href*="/name/nm"]').first();
      const charEl = $(el).find('[data-testid="title-cast-item__character"]').first();
      const actor = actorEl.text().trim();
      // Character name may span multiple elements; clean whitespace
      const character = charEl.text().trim().replace(/\s+/g, ' ').replace(/^\.\.\.$/, '');
      if (actor && actor.length > 1) {
        castPairs.push({ actor, character: character || '' });
      }
    });

    // Fall back to classic cast list (older IMDB page versions)
    const castFromHtml: string[] = [];
    if (!castPairs.length) {
      $('.cast_list td.itemprop a').each((_: any, el: any) => {
        const name = $(el).text().trim();
        if (name && name.length > 1 && !castFromHtml.includes(name)) castFromHtml.push(name);
      });
    }

    // JSON-LD actors as final fallback
    const castFromLd: string[] = jsonLd?.actor
      ? (Array.isArray(jsonLd.actor) ? jsonLd.actor : [jsonLd.actor])
          .map((a: any) => a.name || a)
      : [];

    // Build final cast list: with characters if available (top 10), otherwise names only
    const cast: string[] = castPairs.length > 0
      ? castPairs.slice(0, 10).map(({ actor, character }) =>
          character ? `${actor} as ${character}` : actor)
      : [...new Set([...castFromLd, ...castFromHtml])].slice(0, 10);

    // Runtime
    const runtime = jsonLd?.duration
      ? (() => {
          const m = String(jsonLd.duration).match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (m) return [m[1] ? `${m[1]}h` : '', m[2] ? `${m[2]}m` : ''].filter(Boolean).join(' ');
          return String(jsonLd.duration);
        })()
      : '';

    // Full plot/storyline — try to get the longer version from HTML
    const fullPlot = $('[data-testid="storyline-plot-summary"] span, [data-testid="plot-xl"] span, span[data-testid="plot-l"], #titleStoryLine p, .plot_summary .summary_text').first().text().trim() || description;

    // Additional details: Writers, Keywords, Awards
    const writers: string[] = [];
    $('[data-testid="title-pc-wide-screen"] li[data-testid="title-pc-principal-credit"]:nth-child(2) a, .credit_summary_item:contains("Writer") a').each((_: any, el: any) => {
      const name = $(el).text().trim();
      if (name && !writers.includes(name)) writers.push(name);
    });

    // Keywords — try HTML first, fall back to JSON-LD keywords
    let keywords: string[] = [];
    $('[data-testid="storyline-plot-keywords"] a, .see-more.inline.canwrap span a, a[href*="keyword"]').each((_: any, el: any) => {
      const kw = $(el).text().trim();
      if (kw && kw.length < 30 && !keywords.includes(kw)) keywords.push(kw);
    });
    // Fall back to JSON-LD keywords if HTML didn't yield any
    if (!keywords.length && jsonLd?.keywords) {
      keywords = (typeof jsonLd.keywords === 'string'
        ? jsonLd.keywords.split(',')
        : Array.isArray(jsonLd.keywords) ? jsonLd.keywords : []
      ).map((k: string) => k.trim()).filter(Boolean);
    }

    // Writers — also try JSON-LD creator field
    if (!writers.length && jsonLd?.creator) {
      const creators = Array.isArray(jsonLd.creator) ? jsonLd.creator : [jsonLd.creator];
      for (const c of creators) {
        const name = c?.name || (typeof c === 'string' ? c : '');
        if (name && !writers.includes(name)) writers.push(name);
      }
    }

    // Awards / accolades — try hero accolades chip, then any awards-related link text
    let awardsSummary = '';
    // IMDB new UI: awards accolades chip in the hero section
    const accoladesEl = $('[data-testid="awards-accolades"]');
    if (accoladesEl.length) {
      awardsSummary = accoladesEl.text().trim().replace(/\s+/g, ' ');
    }
    // Fallback: look for per-title awards link (href contains the title ID /tt\d+/awards)
    if (!awardsSummary) {
      const titleMatch = url.match(/\/(tt\d+)/);
      const titleId = titleMatch ? titleMatch[1] : '';
      if (titleId) {
        $(`a[href*="${titleId}"][href*="awards"]`).each((_: any, el: any): false | void => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (text && text.length > 3 && text.length < 200) {
            awardsSummary = text;
            return false; // break
          }
        });
      }
    }
    // Fallback: JSON-LD award field
    if (!awardsSummary && jsonLd?.award) {
      awardsSummary = typeof jsonLd.award === 'string' ? jsonLd.award : '';
    }

    // Content rating & release date from JSON-LD
    const contentRating = jsonLd?.contentRating || '';
    const datePublished = jsonLd?.datePublished || '';

    const structured: Record<string, any> = {
      title, year, contentType, description: fullPlot, ratingValue, ratingCount,
      genres, director, writers, cast, runtime, keywords, contentRating, datePublished, awardsSummary, url,
    };

    const ratingLine = ratingValue ? `⭐ ${ratingValue}/10${ratingCount ? ` (${Number(ratingCount).toLocaleString()} votes)` : ''}` : '';
    const genreLine = genres.length ? genres.join(', ') : '';
    const directorLine = director ? `**Director:** ${director}` : '';
    const writersLine = writers.length ? `**Writers:** ${writers.slice(0, 5).join(', ')}` : '';
    const castLine = cast.length ? `**Cast:** ${cast.join(', ')}` : '';
    const runtimeLine = runtime ? `**Runtime:** ${runtime}` : '';
    const ratedLine = contentRating ? `**Rated:** ${contentRating}` : '';
    const releaseLine = datePublished ? `**Released:** ${datePublished}` : '';
    const keywordsLine = keywords.length ? `\n**Keywords:** ${keywords.slice(0, 10).join(', ')}` : '';
    const awardsLine = awardsSummary ? `**Awards:** ${awardsSummary}` : '';

    const metaParts = [ratingLine, genreLine, runtimeLine, year ? `**Year:** ${year}` : ''].filter(Boolean).join(' | ');

    const detailParts = [directorLine, writersLine, castLine, ratedLine, releaseLine, awardsLine].filter(Boolean).join('\n');

    const cleanContent = `# 🎬 ${title}\n\n${metaParts}\n\n${detailParts}${keywordsLine}\n\n## Plot\n\n${fullPlot}`;

    return { domain: 'imdb.com', type: contentType === 'TVSeries' ? 'tv_show' : 'movie', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 17. LinkedIn extractor
// ---------------------------------------------------------------------------

async function linkedinExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Detect page type from URL first
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const pageType = pathParts[0] === 'company' ? 'company'
      : pathParts[0] === 'in' ? 'profile'
      : pathParts[0] === 'jobs' ? 'job'
      : 'page';

    // Detect if we're on the authwall (LinkedIn redirects unauthenticated requests)
    const isAuthwall = html.includes('authwall') || html.includes('Join LinkedIn') || html.includes('Sign in') && !html.includes('linkedin.com/in/');

    // --- Try parsing meta tags / JSON-LD from the HTML ---
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLd) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Person' || parsed?.['@type'] === 'Organization') jsonLd = parsed;
    });

    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const metaDescription = $('meta[name="description"]').attr('content') || '';

    let name = jsonLd?.name || ogTitle.replace(/ \| LinkedIn$/, '').replace(/Sign Up \| LinkedIn$/, '').trim() || '';
    // When on authwall, discard authwall-specific meta data
    let headline = isAuthwall ? (jsonLd?.jobTitle || '') : (jsonLd?.jobTitle || metaDescription?.split('|')?.[0]?.trim() || ogDescription || '');
    let description = isAuthwall ? (jsonLd?.description || '') : (jsonLd?.description || ogDescription || '');
    let location = $('[class*="location"]').first().text().trim() || jsonLd?.address?.addressLocality || '';

    // --- If authwall or no useful data, try direct HTTPS fetch with minimal headers ---
    // LinkedIn returns rich og: meta tags when fetched with a plain browser UA (no Sec-Fetch-* noise)
    if (!name || isAuthwall || name.toLowerCase().includes('sign up') || name.toLowerCase().includes('linkedin')) {
      try {
        const { default: httpsLI } = await import('https');
        const { gunzip } = await import('zlib');
        const linkedInHtml = await new Promise<string>((resolve, reject) => {
          const req = httpsLI.request({
            hostname: 'www.linkedin.com',
            path: urlObj.pathname,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate',
            },
          }, (res) => {
            if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              const enc = res.headers['content-encoding'] || '';
              if (enc === 'gzip') {
                gunzip(buf, (err, decoded) => err ? reject(err) : resolve(decoded.toString('utf8')));
              } else {
                resolve(buf.toString('utf8'));
              }
            });
          });
          req.on('error', reject);
          setTimeout(() => req.destroy(new Error('timeout')), 10000);
          req.end();
        });
        if (linkedInHtml) {
          const $li = load(linkedInHtml);
          const liOgTitle = $li('meta[property="og:title"]').attr('content') || '';
          const liOgDesc = $li('meta[property="og:description"]').attr('content') || '';
          // Only use if it has real profile data (not authwall)
          if (liOgTitle && !liOgTitle.toLowerCase().includes('sign up') && !liOgTitle.toLowerCase().includes('join linkedin')) {
            // "Name - Headline | LinkedIn" or "Name | LinkedIn"
            const titleParts = liOgTitle.replace(/ \| LinkedIn$/, '').split(/\s*[-–]\s*/);
            if (titleParts[0]) name = titleParts[0].trim();
            if (titleParts[1]) headline = titleParts[1].trim();
            if (liOgDesc) description = liOgDesc;
          }
        }
      } catch { /* direct fetch optional */ }
    }

    if (!name) return null;

    const structured: Record<string, any> = {
      name, headline, description, location, pageType,
      image: ogImage, url,
    };

    const typeLine = pageType === 'company' ? '🏢' : pageType === 'profile' ? '👤' : '🔗';
    const locationLine = location ? `\n📍 ${location}` : '';
    const headlineLine = headline && headline !== name ? `\n*${headline}*` : '';
    const descriptionLine = description ? `\n\n${description}` : '';
    const authNote = '\n\n⚠️ Full LinkedIn profiles require authentication. Use /v1/session to log in first.';

    const cleanContent = `# ${typeLine} ${name} — LinkedIn${headlineLine}${locationLine}${descriptionLine}${authNote}`;

    return { domain: 'linkedin.com', type: pageType, structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 18. PyPI extractor
// ---------------------------------------------------------------------------

async function pypiExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /project/name or /project/name/version/
  const packageMatch = path.match(/\/project\/([^/]+)/);
  if (!packageMatch) return null;

  const packageName = packageMatch[1];

  try {
    const apiUrl = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
    const data = await fetchJson(apiUrl);

    if (!data?.info) return null;
    const info = data.info;

    const structured: Record<string, any> = {
      title: `${info.name} ${info.version}`,
      name: info.name,
      version: info.version,
      description: info.summary || '',
      author: info.author || '',
      authorEmail: info.author_email || '',
      license: info.license || 'N/A',
      homepage: info.home_page || info.project_url || null,
      projectUrls: info.project_urls || {},
      keywords: info.keywords ? info.keywords.split(/[,\s]+/).filter(Boolean) : [],
      requiresPython: info.requires_python || '',
      requiresDist: (info.requires_dist || []).slice(0, 20),
      classifiers: (info.classifiers || []).slice(0, 10),
    };

    // Full description/README from PyPI (info.description is the full README in markdown)
    const fullDescription = info.description && info.description.length > 100 &&
      info.description !== 'UNKNOWN' && info.description !== info.summary
      ? info.description.slice(0, 8000)
      : null;

    // Store full description in structured
    structured.fullDescription = fullDescription;

    const installCmd = `pip install ${info.name}`;
    const keywordsLine = structured.keywords.length ? `\n**Keywords:** ${structured.keywords.join(', ')}` : '';
    const pyVersionLine = structured.requiresPython ? `\n**Requires Python:** ${structured.requiresPython}` : '';
    // Show all dependencies
    const depsLine = structured.requiresDist.length
      ? `\n\n## Dependencies\n\n${structured.requiresDist.map((d: string) => `- ${d}`).join('\n')}`
      : '';

    // Classifiers — extract useful ones (license, status, Python versions)
    const usefulClassifiers = structured.classifiers.filter((c: string) =>
      c.startsWith('Programming Language') || c.startsWith('License') || c.startsWith('Development Status')
    );
    const classifiersSection = usefulClassifiers.length
      ? `\n\n## Classifiers\n\n${usefulClassifiers.map((c: string) => `- ${c}`).join('\n')}`
      : '';

    // Find project URLs
    const projectUrlLines: string[] = [];
    for (const [label, u] of Object.entries(structured.projectUrls)) {
      projectUrlLines.push(`- **${label}:** ${u}`);
    }

    // Full description section (package README from PyPI)
    const descSection = fullDescription
      ? `\n\n## Description\n\n${fullDescription}`
      : '';

    const cleanContent = `# 📦 ${info.name} ${info.version}

${info.summary || ''}

\`\`\`
${installCmd}
\`\`\`

**Author:** ${info.author || 'N/A'} | **License:** ${info.license || 'N/A'}${keywordsLine}${pyVersionLine}

${projectUrlLines.length ? `## Links\n\n${projectUrlLines.join('\n')}\n` : ''}${depsLine}${classifiersSection}${descSection}`;

    return { domain: 'pypi.org', type: 'package', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'PyPI API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 19. Dev.to extractor
// ---------------------------------------------------------------------------

async function devtoExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Try Dev.to article API if we can get the slug from the URL
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // Dev.to article URL: /@username/article-slug-id or /username/article-slug-id
    const slug = pathParts.length >= 2
      ? pathParts.slice(0, 2).join('/').replace(/^@/, '')
      : null;

    // Homepage: no slug → fetch recent top articles from Dev.to API
    if (!slug) {
      try {
        const topArticles = await fetchJson('https://dev.to/api/articles?page=1&per_page=20&top=1');
        if (Array.isArray(topArticles) && topArticles.length > 0) {
          const articles = topArticles.map((a: any) => ({
            title: a.title || '',
            author: a.user?.name || '',
            authorUsername: a.user?.username || '',
            tags: a.tag_list || [],
            reactions: a.public_reactions_count || 0,
            comments: a.comments_count || 0,
            readingTime: a.reading_time_minutes ? `${a.reading_time_minutes} min` : '',
            url: a.url || '',
            publishDate: a.published_at ? a.published_at.split('T')[0] : '',
          }));

          const listMd = articles.map((a: any, i: number) => {
            const tags = a.tags.length ? ` · #${a.tags.slice(0, 3).join(' #')}` : '';
            const stats = `❤️ ${a.reactions} | 💬 ${a.comments}${a.readingTime ? ` | ${a.readingTime}` : ''}`;
            return `${i + 1}. **[${a.title}](${a.url})**\n   by @${a.authorUsername}${tags}\n   ${stats} · ${a.publishDate}`;
          }).join('\n\n');

          const structured: Record<string, any> = {
            title: 'DEV Community — Top Articles',
            articles,
            fetchedAt: new Date().toISOString(),
          };

          const cleanContent = `# 🧑‍💻 DEV Community — Top Articles\n\n*${articles.length} articles from the community*\n\n${listMd}`;
          return { domain: 'dev.to', type: 'listing', structured, cleanContent };
        }
      } catch { /* fall through to HTML */ }
    }

    if (slug) {
      try {
        const apiUrl = `https://dev.to/api/articles/${slug}`;
        const apiData = await fetchJson(apiUrl);
        if (apiData?.title) {
          const structured: Record<string, any> = {
            title: apiData.title,
            author: apiData.user?.name || '',
            authorUsername: apiData.user?.username || '',
            publishDate: apiData.published_at || '',
            tags: apiData.tag_list || [],
            readingTime: apiData.reading_time_minutes ? `${apiData.reading_time_minutes} min read` : '',
            reactions: apiData.public_reactions_count || 0,
            comments: apiData.comments_count || 0,
            description: apiData.description || '',
            url: apiData.url || url,
          };

          const authorLine = structured.author ? `**Author:** ${structured.author} (@${structured.authorUsername})` : '';
          const dateLine = structured.publishDate ? `**Published:** ${structured.publishDate.split('T')[0]}` : '';
          const tagsLine = structured.tags.length ? `**Tags:** ${structured.tags.join(', ')}` : '';
          const statsLine = `❤️ ${structured.reactions} reactions | 💬 ${structured.comments} comments${structured.readingTime ? ` | ⏱️ ${structured.readingTime}` : ''}`;

          const metaParts = [authorLine, dateLine, tagsLine, statsLine].filter(Boolean).join('\n');

          // Use body_html if available for article content
          let articleContent = '';
          if (apiData.body_html) {
            // Strip HTML tags for clean content
            articleContent = stripHtml(apiData.body_html)
              .replace(/\n{3,}/g, '\n\n')
              .substring(0, 8000);
          } else if (apiData.body_markdown) {
            articleContent = apiData.body_markdown.substring(0, 8000);
          }

          const cleanContent = `# ${structured.title}\n\n${metaParts}\n\n${articleContent || structured.description}`;

          return { domain: 'dev.to', type: 'article', structured, cleanContent };
        }
      } catch { /* fall through to HTML */ }
    }

    // HTML fallback
    const title = $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() || '';
    if (!title) return null;

    const author = $('meta[name="author"]').attr('content') ||
      $('[itemprop="name"]').first().text().trim() || '';
    const description = $('meta[property="og:description"]').attr('content') || '';
    const tags: string[] = [];
    $('a[data-no-instant][href*="/t/"]').each((_: any, el: any) => {
      const tag = $(el).text().trim().replace('#', '');
      if (tag) tags.push(tag);
    });

    // Article body
    let articleBody = '';
    const articleEl = $('article#article-body, .crayons-article__main, #article-body').first();
    if (articleEl.length) {
      const parts: string[] = [];
      articleEl.find('h1, h2, h3, h4, p, blockquote, pre, li').each((_: any, el: any) => {
        const tag = (el as any).name;
        const text = $(el).text().trim();
        if (!text || text.length < 3) return;
        if (tag === 'h2') parts.push(`## ${text}`);
        else if (tag === 'h3' || tag === 'h4') parts.push(`### ${text}`);
        else if (tag === 'blockquote') parts.push(`> ${text}`);
        else if (tag === 'pre') parts.push('```\n' + text + '\n```');
        else parts.push(text);
      });
      articleBody = parts.join('\n\n');
    }

    const structured: Record<string, any> = {
      title, author, description, tags, url,
    };

    const authorLine = author ? `\n**Author:** ${author}` : '';
    const tagsLine = tags.length ? `\n**Tags:** ${tags.join(', ')}` : '';

    const cleanContent = `# ${title}${authorLine}${tagsLine}\n\n${articleBody || description}`.substring(0, 10000);

    return { domain: 'dev.to', type: 'article', structured, cleanContent };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 20. Craigslist extractor
// ---------------------------------------------------------------------------

async function craigslistExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Detect if it's a listing page or individual post
    // Individual post: /xxx/yyy/d/title/12345678.html
    const isPost = /\/d\/[^/]+\/\d+\.html/.test(path) || /\/\d{10,}\.html/.test(path);

    if (isPost) {
      const title = $('#titletextonly').text().trim() ||
        $('span#titletextonly').text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        $('h2.postingtitle').text().trim() || '';

      if (!title) return null;

      const price = $('.price').first().text().trim() ||
        $('[class*="price"]').first().text().trim() || '';

      const location = $('.postingtitletext small').text().trim().replace(/[()]/g, '') ||
        $('#map').attr('data-address') || '';

      const postDate = $('#display-date time').attr('datetime') ||
        $('time.date').first().attr('datetime') ||
        $('p.postinginfo time').first().attr('datetime') || '';

      // Body text
      const bodyEl = $('#postingbody');
      bodyEl.find('.print-information, .QR-code').remove();
      const bodyText = bodyEl.text().trim()
        .replace(/QR Code Link to This Post/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Images
      const images: string[] = [];
      $('img.slide').each((_: any, el: any) => {
        const src = $(el).attr('src') || '';
        if (src && !images.includes(src)) images.push(src);
      });
      $('img[id^="ii"]').each((_: any, el: any) => {
        const src = $(el).attr('src') || '';
        if (src && !images.includes(src)) images.push(src);
      });

      // Attributes
      const attrs: Record<string, string> = {};
      $('.attrgroup span').each((_: any, el: any) => {
        const text = $(el).text().trim();
        const parts = text.split(':');
        if (parts.length === 2) attrs[parts[0].trim()] = parts[1].trim();
      });

      const structured: Record<string, any> = {
        title, price, location, postDate,
        bodyText, images, attributes: attrs, url,
      };

      const priceLine = price ? `\n**Price:** ${price}` : '';
      const locationLine = location ? `\n**Location:** ${location}` : '';
      const dateLine = postDate ? `\n**Posted:** ${postDate.split('T')[0]}` : '';
      const attrsSection = Object.keys(attrs).length
        ? `\n\n## Details\n\n${Object.entries(attrs).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}`
        : '';
      const imagesLine = images.length ? `\n\n📷 ${images.length} image${images.length > 1 ? 's' : ''}` : '';

      const cleanContent = `# 📋 ${title}${priceLine}${locationLine}${dateLine}${attrsSection}${imagesLine}\n\n${bodyText.substring(0, 3000)}`;

      return { domain: 'craigslist.org', type: 'listing', structured, cleanContent };
    }

    // Listing page (search results)
    const pageTitle = $('title').text().trim() ||
      $('meta[property="og:title"]').attr('content') || 'Craigslist Listings';

    const listings: Array<Record<string, string>> = [];
    $('.result-row, li.cl-static-search-result, .cl-search-result').each((_: any, el: any) => {
      const titleEl = $(el).find('a.titlestring, a[class*="title"], .result-title').first();
      const postTitle = titleEl.text().trim();
      const postUrl = titleEl.attr('href') || '';
      const postPrice = $(el).find('.result-price, [class*="price"]').first().text().trim();
      const postHood = $(el).find('.result-hood, [class*="hood"]').first().text().trim().replace(/[()]/g, '');
      if (postTitle) {
        listings.push({ title: postTitle, url: postUrl, price: postPrice, location: postHood });
      }
    });

    if (!listings.length) return null;

    const structured: Record<string, any> = { pageTitle, listings, url };

    const listMd = listings.slice(0, 20).map((l, i) =>
      `${i + 1}. **${l.title}**${l.price ? ` — ${l.price}` : ''}${l.location ? ` (${l.location})` : ''}${l.url ? `\n   ${l.url}` : ''}`
    ).join('\n\n');

    const cleanContent = `# 📋 ${pageTitle}\n\n${listMd}`;

    return { domain: 'craigslist.org', type: 'search', structured, cleanContent };
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// 21. Spotify extractor (oEmbed)
// ---------------------------------------------------------------------------

async function spotifyExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    // Detect type from URL path: track, album, playlist, episode, show, artist
    const pathMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    const contentType = pathMatch?.[1] || 'track';
    const spotifyId = pathMatch?.[2] || '';

    const structured: Record<string, any> = {
      title: data.title,
      type: contentType,
      spotifyId,
      provider: 'Spotify',
      thumbnailUrl: data.thumbnail_url || '',
      thumbnailWidth: data.thumbnail_width || 0,
      thumbnailHeight: data.thumbnail_height || 0,
      embedHtml: data.html || '',
    };

    const typeEmoji = contentType === 'track' ? '🎵' : contentType === 'album' ? '💿' : contentType === 'playlist' ? '📋' : contentType === 'episode' ? '🎙️' : contentType === 'artist' ? '🎤' : '🎵';
    const cleanContent = `## ${typeEmoji} Spotify ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}: ${data.title}\n\n**Platform:** Spotify\n**Type:** ${contentType}\n**URL:** ${url}`;

    return { domain: 'open.spotify.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Spotify oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 22. TikTok extractor (oEmbed)
// ---------------------------------------------------------------------------

async function tiktokExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    // TikTok official oEmbed endpoint
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    const structured: Record<string, any> = {
      title: data.title,
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      thumbnailWidth: data.thumbnail_width || 0,
      thumbnailHeight: data.thumbnail_height || 0,
      provider: 'TikTok',
    };

    const cleanContent = `## 🎵 TikTok: ${structured.title}\n\n**Creator:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'tiktok.com', type: 'video', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'TikTok oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 23. Pinterest extractor (oEmbed)
// ---------------------------------------------------------------------------

async function pinterestExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://www.pinterest.com/oembed/?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    // Detect content type from URL
    const isPinPage = /\/pin\//.test(url);
    const isBoardPage = /\/[^/]+\/[^/]+\/?$/.test(new URL(url).pathname) && !isPinPage;
    const contentType = isPinPage ? 'pin' : isBoardPage ? 'board' : 'profile';

    const structured: Record<string, any> = {
      title: data.title,
      description: data.description || '',
      type: contentType,
      thumbnailUrl: data.thumbnail_url || '',
      authorName: data.author_name || '',
      authorUrl: data.author_url || '',
      provider: 'Pinterest',
    };

    const typeEmoji = contentType === 'pin' ? '📌' : contentType === 'board' ? '📋' : '👤';
    const descLine = structured.description ? `\n\n${structured.description}` : '';
    const cleanContent = `## ${typeEmoji} Pinterest ${contentType}: ${structured.title}${descLine}\n\n**By:** [${structured.authorName}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'pinterest.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Pinterest oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 24–26. News article extractor helper (NYTimes / BBC / CNN)
// ---------------------------------------------------------------------------

/** Shared news article extractor using Schema.org JSON-LD + HTML fallbacks. */
async function extractNewsArticle(html: string, url: string, domain: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Try JSON-LD first
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLd) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        if (item?.['@type'] === 'NewsArticle' || item?.['@type'] === 'Article' || item?.['@type'] === 'WebPage') {
          jsonLd = item;
          break;
        }
        if (item?.['@graph']) {
          const g = item['@graph'].find((n: any) => n?.['@type'] === 'NewsArticle' || n?.['@type'] === 'Article');
          if (g) { jsonLd = g; break; }
        }
      }
    });

    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const title = jsonLd?.headline || ogTitle || $('h1').first().text().trim() || '';
    if (!title) return null;

    // Author
    let author = '';
    if (jsonLd?.author) {
      const a = Array.isArray(jsonLd.author) ? jsonLd.author[0] : jsonLd.author;
      author = typeof a === 'string' ? a : a?.name || '';
    }
    if (!author) author = $('meta[name="author"]').attr('content') || $('[itemprop="author"] [itemprop="name"]').first().text().trim() || $('[data-testid="byline"]').first().text().trim() || $('[class*="author"]').first().text().trim() || '';

    // Date
    const publishDate = jsonLd?.datePublished || $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime') || '';
    const modifiedDate = jsonLd?.dateModified || $('meta[property="article:modified_time"]').attr('content') || '';

    // Description / summary
    const description = jsonLd?.description || $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';

    // Section / category
    const section = jsonLd?.articleSection || $('meta[property="article:section"]').attr('content') || '';

    // Keywords / tags
    const keywords: string[] = (() => {
      if (jsonLd?.keywords) {
        return (Array.isArray(jsonLd.keywords) ? jsonLd.keywords : String(jsonLd.keywords).split(',')).map((k: string) => k.trim()).filter(Boolean);
      }
      const kwMeta = $('meta[name="keywords"]').attr('content') || '';
      return kwMeta ? kwMeta.split(',').map(k => k.trim()).filter(Boolean) : [];
    })();

    // Article body — try various content selectors
    let articleBody = '';
    const contentSelectors = [
      'article', '[data-testid="article-body"]', '.article-body', '#article-body',
      '.story-body', '.article__body', '.entry-content', '.post-content',
      'main article', '.content-body', '[itemprop="articleBody"]',
    ];

    for (const selector of contentSelectors) {
      const el = $(selector).first();
      if (!el.length) continue;
      el.find('script, style, nav, aside, .ad, [class*="ad-"], button, figure figcaption').remove();
      const parts: string[] = [];
      el.find('h1, h2, h3, h4, p, blockquote, ul, ol').each((_: any, node: any) => {
        const tag = (node as any).name;
        const text = $(node).text().trim();
        if (!text || text.length < 5) return;
        if (tag === 'h1') return; // Skip — already have title
        if (tag === 'h2') parts.push(`## ${text}`);
        else if (tag === 'h3' || tag === 'h4') parts.push(`### ${text}`);
        else if (tag === 'blockquote') parts.push(`> ${text}`);
        else parts.push(text);
      });
      articleBody = parts.join('\n\n');
      if (articleBody.length > 200) break;
    }

    // Fallback to og:description
    const contentBody = articleBody || description;

    const structured: Record<string, any> = {
      title, author, publishDate, modifiedDate,
      description, section, keywords, url, domain,
    };

    const authorLine = author ? `\n**Author:** ${author}` : '';
    const dateLine = publishDate ? `\n**Published:** ${publishDate.split('T')[0]}` : '';
    const sectionLine = section ? `\n**Section:** ${section}` : '';
    const tagsLine = keywords.length ? `\n**Topics:** ${keywords.slice(0, 8).join(', ')}` : '';

    const cleanContent = `# ${title}${authorLine}${dateLine}${sectionLine}${tagsLine}\n\n${contentBody.substring(0, 10000)}`;

    return { domain, type: 'article', structured, cleanContent };
  } catch {
    return null;
  }
}

async function nytimesExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  return extractNewsArticle(html, url, 'nytimes.com');
}

async function bbcExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  return extractNewsArticle(html, url, 'bbc.com');
}

async function cnnExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  return extractNewsArticle(html, url, 'cnn.com');
}

// ---------------------------------------------------------------------------
// 27. Twitch extractor (noembed / Twitch API)
// ---------------------------------------------------------------------------

async function twitchExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    // Use noembed.com for Twitch clips and channel pages
    const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(noembedUrl);
    if (!data || data.error) return null;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const isClip = pathParts[1] === 'clip' || pathParts[0] === 'clip' || url.includes('clips.twitch.tv');
    const channelName = !isClip ? pathParts[0] : '';
    const contentType = isClip ? 'clip' : 'channel';

    const structured: Record<string, any> = {
      title: data.title || '',
      author: data.author_name || channelName,
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      provider: 'Twitch',
      contentType,
      channelName: channelName || data.author_name || '',
    };

    const typeEmoji = isClip ? '🎬' : '🎮';
    const titleText = structured.title || structured.channelName;
    const cleanContent = `## ${typeEmoji} Twitch ${contentType}: ${titleText}\n\n**Channel:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'twitch.tv', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Twitch oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 28. SoundCloud extractor (oEmbed)
// ---------------------------------------------------------------------------

async function soundcloudExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const isPlaylist = pathParts.includes('sets');
    const contentType = isPlaylist ? 'playlist' : pathParts.length >= 2 ? 'track' : 'profile';

    const structured: Record<string, any> = {
      title: data.title,
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      description: data.description || '',
      contentType,
      provider: 'SoundCloud',
    };

    const typeEmoji = contentType === 'track' ? '🎵' : contentType === 'playlist' ? '📋' : '🎤';
    const descLine = structured.description ? `\n\n${structured.description.substring(0, 500)}` : '';
    const cleanContent = `## ${typeEmoji} SoundCloud ${contentType}: ${structured.title}${descLine}\n\n**Artist:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'soundcloud.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'SoundCloud oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 29. Instagram extractor (oEmbed)
// ---------------------------------------------------------------------------

async function instagramExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  const contentType = pathParts[0] === 'p' ? 'post' : pathParts[0] === 'reel' ? 'reel' : pathParts[0] === 'tv' ? 'igtv' : pathParts.length === 1 ? 'profile' : 'post';

  // --- Profile extraction via Instagram internal API (no auth needed) ---
  if (contentType === 'profile' && pathParts.length === 1) {
    const username = pathParts[0];
    try {
      const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
      const igHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-IG-App-ID': '936619743392459',
        'Accept': '*/*',
        'Referer': 'https://www.instagram.com/',
      };
      const apiResult = await simpleFetch(apiUrl, igHeaders['User-Agent'], 12000, igHeaders);
      const data = tryParseJson(apiResult?.html || '');
      const user = data?.data?.user;
      if (user && user.username) {
        const followers: number = user.edge_followed_by?.count ?? 0;
        const following: number = user.edge_follow?.count ?? 0;
        const postCount: number = user.edge_owner_to_timeline_media?.count ?? 0;
        const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);

        const structured: Record<string, any> = {
          username: user.username,
          fullName: user.full_name || '',
          bio: user.biography || '',
          followers,
          following,
          posts: postCount,
          verified: user.is_verified || false,
          isPrivate: user.is_private || false,
          profilePic: user.profile_pic_url_hd || user.profile_pic_url || '',
          externalUrl: user.external_url || (user.bio_links?.[0]?.url) || '',
          contentType: 'profile',
        };

        // Recent posts
        const edges: any[] = user.edge_owner_to_timeline_media?.edges || [];
        const postSections: string[] = [];
        for (const edge of edges.slice(0, 6)) {
          const node = edge?.node;
          if (!node) continue;
          const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
          const likes: number = node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? 0;
          const comments: number = node.edge_media_to_comment?.count ?? 0;
          const isVideo = node.is_video;
          const mediaType = isVideo ? '🎬' : '📸';
          const timestamp = node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          const imgUrl = node.thumbnail_src || node.display_url || '';
          const captionSnippet = caption ? caption.slice(0, 150) + (caption.length > 150 ? '…' : '') : '';
          postSections.push(`### ${mediaType} ${timestamp}\n${captionSnippet}\n❤️ ${fmtNum(likes)} | 💬 ${fmtNum(comments)}${imgUrl ? `\n🖼 ${imgUrl}` : ''}`);
        }

        const verifiedBadge = structured.verified ? ' ✓' : '';
        const privateBadge = structured.isPrivate ? ' 🔒' : '';
        const bioLine = structured.bio ? `\n\n${structured.bio}` : '';
        const externalLine = structured.externalUrl ? `\n🌐 ${structured.externalUrl}` : '';
        const postsSection = postSections.length > 0 ? '\n\n## Recent Posts\n\n' + postSections.join('\n\n---\n\n') : '';

        const cleanContent = `# @${structured.username} on Instagram${verifiedBadge}${privateBadge}\n\n**${structured.fullName || structured.username}**${bioLine}${externalLine}\n\n👥 ${fmtNum(followers)} Followers | ${fmtNum(following)} Following | ${fmtNum(postCount)} Posts${postsSection}`;

        return { domain: 'instagram.com', type: 'profile', structured, cleanContent };
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Instagram profile API failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Post/Reel/IGTV: Try oEmbed API ---
  try {
    const oembedUrl = `https://graph.facebook.com/v22.0/instagram_oembed?url=${encodeURIComponent(url)}&fields=title,author_name,provider_name,thumbnail_url`;
    const data = await fetchJson(oembedUrl);

    // Also try noembed.com as fallback
    let resolvedData = data;
    if (!data || data.error) {
      const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
      resolvedData = await fetchJson(noembedUrl);
    }
    if (!resolvedData || resolvedData.error) return null;

    const structured: Record<string, any> = {
      title: resolvedData.title || '',
      author: resolvedData.author_name || '',
      authorUrl: resolvedData.author_url || '',
      thumbnailUrl: resolvedData.thumbnail_url || '',
      contentType,
      provider: 'Instagram',
    };

    const typeEmoji = contentType === 'reel' ? '🎬' : contentType === 'post' ? '📸' : '📱';
    const titleText = structured.title || `Instagram ${contentType} by ${structured.author}`;
    const cleanContent = `## ${typeEmoji} Instagram ${contentType}: ${titleText}\n\n**Creator:** @${structured.author.replace('@', '')}\n**URL:** ${url}`;

    return { domain: 'instagram.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Instagram oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 30. PDF extractor (URL-based detection) — downloads and extracts real text
// ---------------------------------------------------------------------------

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const PDF_TRUNCATE_CHARS = 100_000;

async function pdfExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const urlObj = new URL(url);
    const filename = urlObj.pathname.split('/').pop() || 'document.pdf';
    const hostname = urlObj.hostname;

    // Download the PDF
    let buffer: Buffer;
    let finalContentType = 'application/pdf';
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebPeel/1.0)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        if (process.env.DEBUG) console.debug('[webpeel]', `PDF download failed: HTTP ${response.status}`);
        return null; // Let the normal pipeline handle it
      }
      finalContentType = response.headers.get('content-type') || 'application/pdf';
      // Verify it's actually a PDF (content-type or URL)
      const isPdf = finalContentType.toLowerCase().includes('pdf') || /\.pdf(\?|$|#)/i.test(url);
      if (!isPdf) return null;

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (downloadErr) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PDF download error:', downloadErr instanceof Error ? downloadErr.message : downloadErr);
      return null; // Let the normal pipeline handle it
    }

    // Size guard
    if (buffer.length > PDF_MAX_BYTES) {
      if (process.env.DEBUG) console.debug('[webpeel]', `PDF too large (${buffer.length} bytes), falling back to stub`);
      return null;
    }

    // Extract text via pdf-parse
    const { extractPdf } = await import('./pdf.js');
    let pdf: Awaited<ReturnType<typeof extractPdf>>;
    try {
      pdf = await extractPdf(buffer);
    } catch (parseErr) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PDF parse failed:', parseErr instanceof Error ? parseErr.message : parseErr);
      return null; // Let the normal pipeline handle it
    }

    // Normalize whitespace (pdf-parse emits lots of blank lines)
    let text = (pdf.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Truncate very large documents
    let truncated = false;
    if (text.length > PDF_TRUNCATE_CHARS) {
      text = text.slice(0, PDF_TRUNCATE_CHARS);
      truncated = true;
    }

    if (!text) {
      // Scanned/image-only PDF — return a clear message rather than empty content
      const emptyNote = `## 📄 ${filename}\n\n*This PDF appears to be a scanned document (image-only). No extractable text was found.*\n\n**Source:** ${url}`;
      return {
        domain: hostname,
        type: 'pdf',
        structured: { title: filename, url, pages: pdf.pages, contentType: finalContentType },
        cleanContent: emptyNote,
      };
    }

    // Build markdown output
    const titleRaw = (pdf.metadata?.title as string) || '';
    const title = titleRaw || filename.replace(/\.pdf$/i, '') || 'PDF Document';

    const metaParts: string[] = [];
    if (pdf.metadata?.author) metaParts.push(`**Author:** ${pdf.metadata.author}`);
    if (pdf.pages) metaParts.push(`**Pages:** ${pdf.pages}`);
    metaParts.push(`**Source:** ${url}`);

    const header = titleRaw ? `# ${titleRaw}\n\n` : '';
    const metaBlock = metaParts.join(' | ') + '\n\n';
    const truncNote = truncated ? '\n\n*[Content truncated — document exceeds 100,000 characters]*' : '';
    const cleanContent = header + metaBlock + text + truncNote;

    return {
      domain: hostname,
      type: 'pdf',
      structured: {
        title,
        filename,
        url,
        pages: pdf.pages,
        contentType: finalContentType,
        ...pdf.metadata,
      },
      cleanContent,
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'PDF extractor failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 31. Product Hunt extractor (RSS/Atom feed)
// ---------------------------------------------------------------------------

async function productHuntExtractor(_html: string, _url: string): Promise<DomainExtractResult | null> {
  try {
    // Fetch the public Atom feed — no auth required
    const feedResult = await simpleFetch(
      'https://www.producthunt.com/feed',
      'WebPeel/0.17.1 (web data platform; https://webpeel.dev) Node.js',
      15000,
      { Accept: 'application/xml, text/xml, */*' }
    );

    if (!feedResult?.html) return null;
    const xml = feedResult.html;

    // Parse Atom entries (Product Hunt uses Atom, not RSS)
    const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    if (!entryMatches.length) return null;

    interface PHProduct {
      title: string;
      link: string;
      published: string;
      tagline: string;
      author: string;
      directLink: string;
    }

    const products: PHProduct[] = [];

    for (const match of entryMatches) {
      const entry = match[1];

      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/);
      const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);
      const authorMatch = entry.match(/<name>([\s\S]*?)<\/name>/);
      const contentMatch = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/);

      if (!titleMatch) continue;

      const title = stripHtml(titleMatch[1]).trim();
      const link = linkMatch?.[1] || '';
      const published = publishedMatch?.[1]?.trim() || '';
      const author = authorMatch ? stripHtml(authorMatch[1]).trim() : '';

      // Extract tagline from encoded HTML in <content>
      // Content is HTML-encoded: &lt;p&gt;tagline&lt;/p&gt;...
      let tagline = '';
      let directLink = '';
      if (contentMatch) {
        const decoded = contentMatch[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        // First <p> is the tagline
        const taglineMatch = decoded.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/);
        if (taglineMatch) {
          tagline = stripHtml(taglineMatch[1]).trim();
        }

        // Extract direct product link (the "Link" href, not the discussion link)
        const linkHrefMatch = decoded.match(/href="(https:\/\/www\.producthunt\.com\/r\/p\/[^"]+)"/);
        directLink = linkHrefMatch?.[1] || link;
      }

      // Format published date nicely
      let dateStr = '';
      if (published) {
        try {
          const d = new Date(published);
          dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
          dateStr = published.split('T')[0];
        }
      }

      products.push({ title, link, published: dateStr, tagline, author, directLink });
    }

    if (!products.length) return null;

    // Build clean markdown output
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const productList = products.map((p, i) => {
      const taglinePart = p.tagline ? ` — ${p.tagline}` : '';
      const datePart = p.published ? `\n   📅 ${p.published}` : '';
      const authorPart = p.author ? ` by ${p.author}` : '';
      return `${i + 1}. **[${p.title}](${p.link})**${taglinePart}${datePart}${authorPart}`;
    }).join('\n\n');

    const structured: Record<string, any> = {
      products,
      total: products.length,
      fetchedAt: new Date().toISOString(),
      feedUrl: 'https://www.producthunt.com/feed',
    };

    const cleanContent = `# 🚀 Product Hunt — Featured Products\n\n*Fetched ${today} · ${products.length} products*\n\n${productList}\n\n---\n*Source: [Product Hunt Feed](https://www.producthunt.com/feed)*`;

    return { domain: 'producthunt.com', type: 'feed', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Product Hunt extractor failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 32. Substack root extractor (substack.com homepage)
// ---------------------------------------------------------------------------

async function substackRootExtractor(_html: string, _url: string): Promise<DomainExtractResult | null> {
  // The substack.com homepage is a marketing page — not useful to extract.
  // Instead, guide users to fetch individual newsletter posts.
  // Try fetching their public sitemap to surface some featured newsletters.

  // Note: Substack's homepage is JS-rendered; no useful API endpoints are publicly accessible.
  // We return a helpful guide instead of trying to scrape the homepage.

  const structured: Record<string, any> = {
    note: 'Substack root homepage is a JS-rendered marketing page with limited extractable content.',
    tip: 'Fetch individual Substack posts directly for full article content.',
    examples: [
      'https://username.substack.com/p/article-slug',
      'https://stratechery.com/2024/...',
    ],
  };

  const cleanContent = `# 📰 Substack

Substack's homepage is a JS-rendered marketing page — there's not much useful content to extract here.

## ✅ What Works

Individual Substack posts are **fully server-rendered** and extract cleanly. Try:

- \`https://username.substack.com/p/article-title\`
- Any specific newsletter post URL

## 💡 Examples

\`\`\`
https://lethain.substack.com/p/the-art-of-staffing-eng
https://paulgraham.com/articles.html
\`\`\`

## 📋 Finding Newsletters

Browse newsletters at:
- [substack.com/explore](https://substack.com/explore) — discover publications
- [substack.com/leaderboard](https://substack.com/leaderboard) — top newsletters by category

---

*WebPeel works best with individual Substack post URLs, not the root homepage.*`;

  return { domain: 'substack.com', type: 'homepage', structured, cleanContent };
}
