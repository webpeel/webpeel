/**
 * Vertical search — specialized endpoints for shopping, news, images, videos.
 * Primary: SearXNG (reliable, structured JSON, no CAPTCHA issues from datacenter).
 * Fallback: Google scraping via peel() (for shopping only).
 */

import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShoppingResult {
  title: string;
  price?: string;
  currency?: string;
  store: string;
  url: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  condition?: string; // "New", "Used", "Refurbished"
}

export interface NewsResult {
  title: string;
  url: string;
  source: string;
  date?: string;
  snippet?: string;
  imageUrl?: string;
  category?: string;
}

export interface ImageResult {
  title: string;
  url: string; // Page URL
  imageUrl: string; // Direct image URL
  width?: number;
  height?: number;
  source?: string;
}

export interface VideoResult {
  title: string;
  url: string;
  platform: string; // "YouTube", "Vimeo", etc.
  duration?: string;
  date?: string;
  thumbnailUrl?: string;
  channel?: string;
  views?: string;
}

export interface VerticalSearchOptions {
  query: string;
  count?: number; // default 10
  country?: string; // ISO 3166-1 (e.g., 'US')
  language?: string; // BCP-47 (e.g., 'en')
  freshness?: string; // 'day', 'week', 'month', 'year'
}

// ── SearXNG helper ─────────────────────────────────────────────────────────

async function searxngSearch(
  query: string,
  category: string,
  count: number = 20,
  language?: string,
): Promise<any[]> {
  const baseUrl = process.env.SEARXNG_URL;
  if (!baseUrl) return [];

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: category,
    safesearch: '0',
  });
  if (language) params.set('language', language);

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?${params}`;
    const res = await undiciFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'WebPeel/1.0' },
    } as any);
    if (!res.ok) return [];
    const data = await res.json() as { results?: any[] };
    return (data.results || []).slice(0, count);
  } catch {
    return [];
  }
}

// ── Shopping Search ────────────────────────────────────────────────────────

export async function searchShopping(opts: VerticalSearchOptions): Promise<ShoppingResult[]> {
  const { query, count = 10, language } = opts;

  // Strategy 1: SearXNG general search with price-aware filtering
  // (SearXNG doesn't have a shopping category that works, but general results
  // from shopping sites contain price data)
  const results = await searxngSearch(`${query} price buy`, 'general', count * 3, language);

  const items: ShoppingResult[] = [];
  for (const r of results) {
    // Look for results from shopping domains or with price content
    const url = r.url || '';
    const content = r.content || '';
    const title = r.title || '';

    const isShoppingSite = /amazon|ebay|walmart|bestbuy|target|etsy|aliexpress|newegg|shopify/i.test(url);
    const hasPrice = /\$[\d,]+(\.\d{2})?|\d+\.\d{2}\s*(USD|EUR|GBP)/.test(content + title);

    if (isShoppingSite || hasPrice) {
      // Extract price from content
      const priceMatch = (content + ' ' + title).match(/\$[\d,]+(?:\.\d{2})?/);
      items.push({
        title: title,
        price: priceMatch ? priceMatch[0] : undefined,
        store: extractStoreName(url),
        url: url,
        imageUrl: r.img_src || r.thumbnail || undefined,
      });
    }

    if (items.length >= count) break;
  }

  // Fallback: if SearXNG returned nothing, try Google Shopping via peel()
  if (items.length === 0) {
    try {
      const { peel } = await import('../index.js');
      const params = new URLSearchParams({ q: query, tbm: 'shop', num: '20' });
      const result = await peel(`https://www.google.com/search?${params}`, {
        render: true, stealth: true, format: 'html', wait: 3000, timeout: 15000,
      });
      const html = result.content || '';
      if (html && html.length > 500) {
        const $ = load(html);
        $('.sh-dgr__content, .mnr-c .pla-unit, [data-docid], .KZmu8e').each((_, elem) => {
          const el = $(elem);
          const t = el.find('.tAxDx, .pymv4e, h3, .Xjkr3b').first().text().trim();
          const p = el.find('.a8Pemb, .e10twf, .HRLxBb, .kHxwFf').first().text().trim();
          const s = el.find('.aULzUe, .LbUacb, .dD8iuc, .IuHnof').first().text().trim();
          if (t) items.push({ title: t, price: p || undefined, store: s || 'Unknown', url: el.find('a[href]').first().attr('href') || '' });
        });
      }
    } catch { /* fallback failed */ }
  }

  return items.slice(0, count);
}

function extractStoreName(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    const nameMap: Record<string, string> = {
      'amazon.com': 'Amazon', 'ebay.com': 'eBay', 'walmart.com': 'Walmart',
      'bestbuy.com': 'Best Buy', 'target.com': 'Target', 'etsy.com': 'Etsy',
      'newegg.com': 'Newegg', 'aliexpress.com': 'AliExpress',
    };
    return nameMap[host] || host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
  } catch { return 'Unknown'; }
}

// ── News Search ────────────────────────────────────────────────────────────

export async function searchNews(opts: VerticalSearchOptions): Promise<NewsResult[]> {
  const { query, count = 10, language, freshness } = opts;

  // Primary: SearXNG news category (tested: 44 results)
  let searchQuery = query;
  if (freshness === 'day') searchQuery += ' today';
  else if (freshness === 'week') searchQuery += ' this week';

  const results = await searxngSearch(searchQuery, 'news', count * 2, language);

  const items: NewsResult[] = results.map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    source: r.engine || extractStoreName(r.url || ''),
    date: r.publishedDate || undefined,
    snippet: r.content || undefined,
    imageUrl: r.img_src || r.thumbnail || undefined,
  })).filter((r: NewsResult) => r.title && r.url);

  return items.slice(0, count);
}

// ── Image Search ────────────────────────────────────────────────────────────

export async function searchImages(opts: VerticalSearchOptions): Promise<ImageResult[]> {
  const { query, count = 20, language } = opts;

  // Primary: SearXNG images category (tested: 566 results)
  const results = await searxngSearch(query, 'images', count * 2, language);

  const items: ImageResult[] = results
    .filter((r: any) => r.img_src || r.thumbnail)
    .map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      imageUrl: r.img_src || r.thumbnail || '',
      width: r.img_format ? parseInt(r.img_format.split('x')[0]) || undefined : undefined,
      height: r.img_format ? parseInt(r.img_format.split('x')[1]) || undefined : undefined,
      source: r.engine || undefined,
    }));

  return items.slice(0, count);
}

// ── Video Search ────────────────────────────────────────────────────────────

export async function searchVideos(opts: VerticalSearchOptions): Promise<VideoResult[]> {
  const { query, count = 10, language } = opts;

  // Primary: SearXNG videos category (tested: 120 results)
  const results = await searxngSearch(query, 'videos', count * 2, language);

  const items: VideoResult[] = results
    .filter((r: any) => r.url)
    .map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      platform: r.url?.includes('youtube') ? 'YouTube' : r.url?.includes('vimeo') ? 'Vimeo' : r.engine || 'Web',
      duration: r.length || undefined,
      date: r.publishedDate || undefined,
      thumbnailUrl: r.thumbnail || r.img_src || undefined,
      channel: r.author || undefined,
    }));

  return items.slice(0, count);
}
