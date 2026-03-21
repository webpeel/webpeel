import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { stripHtml } from './shared.js';

// ---------------------------------------------------------------------------
// 31. Product Hunt extractor (RSS/Atom feed)
// ---------------------------------------------------------------------------

export async function productHuntExtractor(_html: string, _url: string): Promise<DomainExtractResult | null> {
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

