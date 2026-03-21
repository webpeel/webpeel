import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 13. Medium Articles extractor
// ---------------------------------------------------------------------------

export async function mediumExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
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

