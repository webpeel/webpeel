import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

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

export async function nytimesExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  return extractNewsArticle(html, url, 'nytimes.com');
}

export async function bbcExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  return extractNewsArticle(html, url, 'bbc.com');
}

export async function cnnExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const u = new URL(url);

    // For homepage — use CNN Lite which has actual headline links
    if (u.pathname === '/' || u.pathname === '' || u.hostname === 'lite.cnn.com') {
      const liteResp = await fetch('https://lite.cnn.com', { headers: { 'User-Agent': 'webpeel/0.21' } });
      if (liteResp.ok) {
        const liteHtml = await liteResp.text();
        const headlines: string[] = [];
        const matches = liteHtml.matchAll(/<a[^>]+href="([^"]*)"[^>]*>([^<]+)<\/a>/g);
        for (const m of matches) {
          const href = m[1].trim();
          const text = m[2].trim();
          // CNN Lite article links contain year patterns like /2026/
          if (/\/20\d\d\//.test(href) && text.length > 10) {
            const fullUrl = href.startsWith('http') ? href : `https://www.cnn.com${href}`;
            headlines.push(`- [${text}](${fullUrl})`);
          }
        }
        if (headlines.length > 5) {
          return {
            domain: 'cnn.com',
            type: 'headlines',
            structured: { headlines: headlines.length, source: 'cnn-lite' },
            cleanContent: `# 📰 CNN — Top Headlines\n\n${headlines.slice(0, 20).join('\n')}\n\n---\n*Source: CNN Lite*`,
          };
        }
      }
    }

    // For article pages — try CNN Lite version of the same URL
    if (/\/20\d\d\//.test(u.pathname)) {
      const liteUrl = `https://lite.cnn.com${u.pathname}`;
      const liteResp = await fetch(liteUrl, { headers: { 'User-Agent': 'webpeel/0.21' } });
      if (liteResp.ok) {
        const liteHtml = await liteResp.text();
        const { load } = await import('cheerio');
        const $l = load(liteHtml);
        const title = $l('h1').first().text().trim();
        const paragraphs: string[] = [];
        $l('p').each((_: any, el: any) => {
          const text = $l(el).text().trim();
          if (text.length > 20) paragraphs.push(text);
        });
        if (title && paragraphs.length > 0) {
          return {
            domain: 'cnn.com',
            type: 'article',
            structured: { title, paragraphs: paragraphs.length, source: 'cnn-lite' },
            cleanContent: `# ${title}\n\n${paragraphs.join('\n\n')}\n\n---\n*Source: CNN*`,
          };
        }
      }
    }
  } catch { /* fall through to standard extractor */ }

  // Fallback to standard news article extractor (works if HTML has content)
  return extractNewsArticle(html, url, 'cnn.com');
}

