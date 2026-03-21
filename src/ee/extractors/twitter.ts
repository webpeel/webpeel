import type { DomainExtractResult } from './types.js';
import { tryParseJson, stripHtml, fetchJson } from './shared.js';

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

export async function twitterExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
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

