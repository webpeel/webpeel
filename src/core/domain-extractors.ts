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
  match: (hostname: string) => boolean;
  extractor: DomainExtractor;
}> = [
  { match: (h) => h === 'twitter.com' || h === 'x.com' || h === 'www.twitter.com' || h === 'www.x.com', extractor: twitterExtractor },
  { match: (h) => h === 'reddit.com' || h === 'www.reddit.com' || h === 'old.reddit.com', extractor: redditExtractor },
  { match: (h) => h === 'github.com' || h === 'www.github.com', extractor: githubExtractor },
  { match: (h) => h === 'news.ycombinator.com', extractor: hackerNewsExtractor },
];

/**
 * Returns the domain extractor for a URL, or null if none matches.
 */
export function getDomainExtractor(url: string): DomainExtractor | null {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    for (const entry of REGISTRY) {
      if (entry.match(host)) return entry.extractor;
    }
  } catch {
    // Invalid URL — no extractor
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
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'reddit.com';

  // Detect page type
  const isPost = /\/r\/[^/]+\/comments\//.test(path);
  const isSubreddit = /^\/r\/[^/]+\/?$/.test(path);
  const isUser = /^\/(u|user)\/[^/]+/.test(path);

  const type = isPost ? 'post' : isSubreddit ? 'subreddit' : isUser ? 'user' : 'listing';

  if (isPost) {
    // Fetch post data via Reddit JSON API
    const jsonUrl = url.split('?')[0].replace(/\/?$/, '') + '.json?limit=25&sort=top';
    const data = await fetchJson(jsonUrl, { 'User-Agent': 'WebPeel/1.0' });
    if (!Array.isArray(data) || data.length < 2) return null;

    const postData = data[0]?.data?.children?.[0]?.data;
    if (!postData) return null;

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
    const jsonUrl = url.split('?')[0].replace(/\/?$/, '') + '.json?limit=15';
    const data = await fetchJson(jsonUrl, { 'User-Agent': 'WebPeel/1.0' });
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
    const structured = { subreddit: `r/${subredditName}`, posts };

    const cleanContent = `## 📋 r/${subredditName} — Hot Posts

${posts.map((p: any, i: number) => `${i + 1}. **${p.title}**\n   ${p.author} | ↑ ${p.score} | 💬 ${p.commentCount}${p.flair ? ` | ${p.flair}` : ''}\n   ${p.url}`).join('\n\n')}`;

    return { domain, type, structured, cleanContent };
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

  const ghHeaders = { Accept: 'application/vnd.github.v3+json' };

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
        readmeText = Buffer.from(readmeData.content, 'base64').toString('utf-8').slice(0, 500);
      } catch { /* ignore */ }
    }

    const structured: Record<string, any> = {
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

${structured.readme ? `### README (excerpt)\n\n${structured.readme}` : ''}`;

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

    const structured = { stories };
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
