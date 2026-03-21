import type { DomainExtractResult } from './types.js';
import { unixToIso, fetchJsonWithRetry } from './shared.js';

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

export async function redditExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
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

