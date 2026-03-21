import type { DomainExtractResult } from './types.js';
import { stripHtml, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 19. Dev.to extractor
// ---------------------------------------------------------------------------

export async function devtoExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
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

