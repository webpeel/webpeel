import type { DomainExtractResult } from './types.js';
import { stripHtml, unixToIso, fetchJson } from './shared.js';

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

export async function hackerNewsExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
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

    // Comment items — fetch parent story for context
    if (storyData.type === 'comment') {
      const parentId = storyData.parent;
      let parentTitle = '';
      if (parentId) {
        try {
          const parentData = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${parentId}.json`);
          parentTitle = parentData?.title || '';
          // Walk up to root story if parent is also a comment
          if (!parentTitle && parentData?.parent) {
            const rootData = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${parentData.parent}.json`);
            parentTitle = rootData?.title || '';
          }
        } catch { /* non-fatal */ }
      }
      const text = storyData.text ? stripHtml(storyData.text) : '';
      const titleStr = parentTitle ? `Comment on: ${parentTitle}` : 'HN Comment';
      const cleanContent = `## 🟠 ${titleStr}\n\n**Author:** ${storyData.by || '[deleted]'} | **Posted:** ${unixToIso(storyData.time)}\n\n${text}`;
      return { domain: 'news.ycombinator.com', type: 'comment', structured: { title: titleStr, author: storyData.by, text }, cleanContent };
    }

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
        domain: s.url ? (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '',
      }));

    const structured = { title: 'Hacker News — Front Page', stories };
    // Compact format: title (domain) | score pts | N comments
    const cleanContent = `## 🟠 Hacker News — Front Page

${stories.map((s: any, i: number) =>
  `${i + 1}. **${s.title}**${s.domain ? ` (${s.domain})` : ''} — ↑${s.score} · 💬${s.commentCount}`
).join('\n')}`;

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

