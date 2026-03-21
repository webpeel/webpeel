import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 14. Substack Posts extractor
// ---------------------------------------------------------------------------

export async function substackExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
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

