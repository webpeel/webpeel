/**
 * Vertical search — specialized endpoints for shopping, news, images, videos.
 * Uses Google vertical search pages + cheerio parsing.
 */

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

// ── Shopping Search ────────────────────────────────────────────────────────

export async function searchShopping(opts: VerticalSearchOptions): Promise<ShoppingResult[]> {
  const { query, count = 10, country, language } = opts;

  // Strategy: Use Google Shopping via peel() with render
  const { peel } = await import('../index.js');
  const params = new URLSearchParams({
    q: query,
    tbm: 'shop', // Google Shopping mode
    num: String(Math.min(count * 2, 40)),
  });
  if (country) params.set('gl', country.toLowerCase());
  if (language) params.set('hl', language);

  const url = `https://www.google.com/search?${params}`;

  try {
    const result = await peel(url, {
      render: true,
      stealth: true,
      format: 'html',
      wait: 3000,
      timeout: 15000,
    });
    const html = result.content || '';
    if (!html || html.length < 500) return [];

    const $ = load(html);
    const items: ShoppingResult[] = [];

    // Google Shopping result selectors
    $('.sh-dgr__content, .sh-dlr__list-result, .mnr-c .pla-unit, [data-docid], .KZmu8e').each((_, elem) => {
      const el = $(elem);
      const title = el.find('.tAxDx, .pymv4e, h3, .Xjkr3b').first().text().trim();
      const price = el.find('.a8Pemb, .e10twf, .HRLxBb, .kHxwFf').first().text().trim();
      const store = el.find('.aULzUe, .LbUacb, .dD8iuc, .IuHnof').first().text().trim();
      const link = el.find('a[href]').first().attr('href') || '';
      const img = el.find('img').first().attr('src') || '';
      const ratingText = el.find('.Rsc7Yb, .yi40Hd').first().text().trim();
      const reviewText = el.find('.QhqGkb, .RDApEe').first().text().trim();

      if (title && (price || store)) {
        items.push({
          title,
          price: price || undefined,
          store: store || 'Unknown',
          url: link.startsWith('http')
            ? link
            : link.startsWith('/')
              ? `https://www.google.com${link}`
              : link,
          imageUrl: img.startsWith('http') ? img : undefined,
          rating: parseFloat(ratingText) || undefined,
          reviewCount: parseInt(reviewText.replace(/[^0-9]/g, '')) || undefined,
        });
      }
    });

    return items.slice(0, count);
  } catch {
    return [];
  }
}

// ── News Search ────────────────────────────────────────────────────────────

export async function searchNews(opts: VerticalSearchOptions): Promise<NewsResult[]> {
  const { query, count = 10, language, freshness } = opts;

  const { peel } = await import('../index.js');
  const params = new URLSearchParams({
    q: query,
    tbm: 'nws', // Google News mode
    num: String(Math.min(count * 2, 40)),
  });
  if (language) params.set('hl', language);
  if (freshness === 'day') params.set('tbs', 'qdr:d');
  else if (freshness === 'week') params.set('tbs', 'qdr:w');
  else if (freshness === 'month') params.set('tbs', 'qdr:m');

  const url = `https://www.google.com/search?${params}`;

  try {
    const result = await peel(url, {
      render: true,
      stealth: true,
      format: 'html',
      wait: 3000,
      timeout: 15000,
    });
    const html = result.content || '';
    if (!html || html.length < 500) return [];

    const $ = load(html);
    const items: NewsResult[] = [];

    // Google News result selectors
    $('.WlydOe, .JJZKK, .SoaBEf, .dbsr, [jscontroller="d0DtYd"]').each((_, elem) => {
      const el = $(elem);
      const title = el.find('[role="heading"], .mCBkyc, .nDgy9d, .JheGif').first().text().trim();
      const link = el.find('a[href^="http"]').first().attr('href') || '';
      const source = el.find('.NUnG9d, .CEMjEf, .XTjFC, .wEwyrc').first().text().trim();
      const date = el.find('.OSrXXb, .WG9SHc, .f').first().text().trim();
      const snippet = el.find('.GI74Re, .Y3v8qd, .VwiC3b').first().text().trim();
      const img = el.find('img[src^="http"]').first().attr('src') || '';

      if (title && link) {
        items.push({
          title,
          url: link,
          source: source || 'Unknown',
          date: date || undefined,
          snippet: snippet || undefined,
          imageUrl: img || undefined,
        });
      }
    });

    return items.slice(0, count);
  } catch {
    return [];
  }
}

// ── Image Search ────────────────────────────────────────────────────────────

export async function searchImages(opts: VerticalSearchOptions): Promise<ImageResult[]> {
  const { query, count = 20 } = opts;

  // Use Bing Images (more scrape-friendly than Google Images)
  const { peel } = await import('../index.js');
  const params = new URLSearchParams({ q: query, form: 'HDRSC2', first: '1' });
  const url = `https://www.bing.com/images/search?${params}`;

  try {
    const result = await peel(url, { render: true, wait: 2000, timeout: 15000 });
    const html = result.content || '';
    if (!html || html.length < 500) return [];

    const $ = load(html);
    const items: ImageResult[] = [];

    // Bing Images selectors
    $('.iusc, .imgpt, [data-idx]').each((_, elem) => {
      const el = $(elem);
      // Bing stores image data in a JSON attribute 'm'
      const mData = el.attr('m');
      if (mData) {
        try {
          const m = JSON.parse(mData);
          items.push({
            title: m.t || el.find('img').attr('alt') || '',
            url: m.purl || '',
            imageUrl: m.murl || m.turl || '',
            width: m.w || undefined,
            height: m.h || undefined,
            source: m.desc || undefined,
          });
        } catch {
          /* skip malformed JSON */
        }
      } else {
        // Fallback: direct img extraction
        const img = el.find('img');
        const imgSrc = img.attr('src') || img.attr('data-src') || '';
        const title = img.attr('alt') || '';
        if (imgSrc && imgSrc.startsWith('http')) {
          items.push({
            title,
            url: el.find('a[href]').first().attr('href') || '',
            imageUrl: imgSrc,
          });
        }
      }
    });

    return items.slice(0, count);
  } catch {
    return [];
  }
}

// ── Video Search ────────────────────────────────────────────────────────────

export async function searchVideos(opts: VerticalSearchOptions): Promise<VideoResult[]> {
  const { query, count = 10 } = opts;

  const { peel } = await import('../index.js');
  const params = new URLSearchParams({
    q: query,
    tbm: 'vid', // Google Videos mode
    num: String(Math.min(count * 2, 20)),
  });

  const url = `https://www.google.com/search?${params}`;

  try {
    const result = await peel(url, {
      render: true,
      stealth: true,
      format: 'html',
      wait: 3000,
      timeout: 15000,
    });
    const html = result.content || '';
    if (!html || html.length < 500) return [];

    const $ = load(html);
    const items: VideoResult[] = [];

    // Google Video result selectors
    $('[data-surl], .dXiKIc, .g, .RzdJxc').each((_, elem) => {
      const el = $(elem);
      const title = el.find('h3, .fc9yUc, [aria-label]').first().text().trim();
      const link = el.find('a[href^="http"]').first().attr('href') || '';
      const duration = el.find('.J1mWY, .FGpTBd, .vdur').first().text().trim();
      const date = el.find('.OSrXXb, .f').first().text().trim();
      const channel = el.find('.pcJO7e, .GlPvmc').first().text().trim();
      const thumb = el.find('img[src^="http"]').first().attr('src') || '';

      if (title && link && !link.includes('google.com/search')) {
        items.push({
          title,
          url: link,
          platform: link.includes('youtube')
            ? 'YouTube'
            : link.includes('vimeo')
              ? 'Vimeo'
              : 'Web',
          duration: duration || undefined,
          date: date || undefined,
          channel: channel || undefined,
          thumbnailUrl: thumb || undefined,
        });
      }
    });

    return items.slice(0, count);
  } catch {
    return [];
  }
}
