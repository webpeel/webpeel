import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// 32. Substack root extractor (substack.com homepage)
// ---------------------------------------------------------------------------

export async function substackRootExtractor(_html: string, _url: string): Promise<DomainExtractResult | null> {
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

