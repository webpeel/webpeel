/**
 * Extract structured metadata from HTML
 */

import * as cheerio from 'cheerio';
import type { PageMetadata } from '../types.js';

/**
 * Extract page title using fallback chain:
 * og:title → twitter:title → title tag → h1
 */
function extractTitle($: cheerio.CheerioAPI): string {
  // Try Open Graph title
  let title = $('meta[property="og:title"]').attr('content');
  if (title) return title.trim();

  // Try Twitter title
  title = $('meta[name="twitter:title"]').attr('content');
  if (title) return title.trim();

  // Try title tag
  title = $('title').text();
  if (title) return title.trim();

  // Fallback to first h1
  title = $('h1').first().text();
  if (title) return title.trim();

  return '';
}

/**
 * Extract page description using fallback chain:
 * og:description → twitter:description → meta description
 */
function extractDescription($: cheerio.CheerioAPI): string | undefined {
  // Try Open Graph description
  let desc = $('meta[property="og:description"]').attr('content');
  if (desc) return desc.trim();

  // Try Twitter description
  desc = $('meta[name="twitter:description"]').attr('content');
  if (desc) return desc.trim();

  // Try standard meta description
  desc = $('meta[name="description"]').attr('content');
  if (desc) return desc.trim();

  return undefined;
}

/**
 * Extract author from meta tags
 */
function extractAuthor($: cheerio.CheerioAPI): string | undefined {
  // Try article:author
  let author = $('meta[property="article:author"]').attr('content');
  if (author) return author.trim();

  // Try og:article:author
  author = $('meta[property="og:article:author"]').attr('content');
  if (author) return author.trim();

  // Try author meta tag
  author = $('meta[name="author"]').attr('content');
  if (author) return author.trim();

  // Try twitter:creator
  author = $('meta[name="twitter:creator"]').attr('content');
  if (author) return author.trim();

  return undefined;
}

/**
 * Extract publish date from rich meta sources
 * Returns ISO 8601 date string if found
 */
function extractPublishDate($: cheerio.CheerioAPI, _html: string): string | undefined {
  // Try article:published_time
  let published = $('meta[property="article:published_time"]').attr('content');
  if (published) {
    try { return new Date(published).toISOString(); } catch { /* ignore */ }
  }

  // Try meta name="date"
  published = $('meta[name="date"]').attr('content');
  if (published) {
    try { return new Date(published).toISOString(); } catch { /* ignore */ }
  }

  // Try og:updated_time
  published = $('meta[property="og:updated_time"]').attr('content');
  if (published) {
    try { return new Date(published).toISOString(); } catch { /* ignore */ }
  }

  // Try <time pubdate> or <time datetime> with pubdate attribute
  const timeEl = $('time[pubdate], time[datetime][pubdate]').first();
  const datetime = timeEl.attr('datetime') || timeEl.attr('content');
  if (datetime) {
    try { return new Date(datetime).toISOString(); } catch { /* ignore */ }
  }

  // Try JSON-LD datePublished
  $('script[type="application/ld+json"]').each((_, el) => {
    if (published) return;
    try {
      const json = JSON.parse($(el).html() || '{}');
      const date = json.datePublished || json.publishDate || (json['@graph'] && json['@graph'].find?.((n: any) => n.datePublished)?.datePublished);
      if (date) {
        published = new Date(date).toISOString();
      }
    } catch { /* ignore */ }
  });
  if (published) return published;

  return undefined;
}

/**
 * Extract page language
 */
function extractLanguage($: cheerio.CheerioAPI): string | undefined {
  // Try html lang attribute
  const htmlLang = $('html').attr('lang');
  if (htmlLang) return htmlLang.trim();

  // Try Content-Language meta
  const contentLang = $('meta[http-equiv="Content-Language"]').attr('content');
  if (contentLang) return contentLang.trim();

  // Try og:locale (convert underscore to hyphen, e.g. "en_US" → "en-US")
  const ogLocale = $('meta[property="og:locale"]').attr('content');
  if (ogLocale) return ogLocale.trim().replace('_', '-');

  return undefined;
}

/**
 * Count words in visible text (strips HTML tags, splits on whitespace)
 */
function extractWordCount(html: string): number {
  // Remove script and style content
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 0;
  return stripped.split(' ').filter(w => w.length > 0).length;
}

/**
 * Extract published date from meta tags
 * Returns ISO 8601 date string if found
 */
function extractPublished($: cheerio.CheerioAPI): string | undefined {
  // Try article:published_time
  let published = $('meta[property="article:published_time"]').attr('content');
  if (published) {
    try {
      return new Date(published).toISOString();
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'date parse failed:', e instanceof Error ? e.message : e);
    }
  }

  // Try datePublished schema.org
  published = $('meta[itemprop="datePublished"]').attr('content');
  if (published) {
    try {
      return new Date(published).toISOString();
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'date parse failed:', e instanceof Error ? e.message : e);
    }
  }

  return undefined;
}

/**
 * Extract Open Graph image URL
 */
function extractImage($: cheerio.CheerioAPI): string | undefined {
  // Try og:image
  let image = $('meta[property="og:image"]').attr('content');
  if (image) return image.trim();

  // Try twitter:image
  image = $('meta[name="twitter:image"]').attr('content');
  if (image) return image.trim();

  return undefined;
}

/**
 * Extract canonical URL
 */
function extractCanonical($: cheerio.CheerioAPI): string | undefined {
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) return canonical.trim();

  // Fallback to og:url
  const ogUrl = $('meta[property="og:url"]').attr('content');
  if (ogUrl) return ogUrl.trim();

  return undefined;
}

/**
 * Extract all links from page
 * Returns absolute URLs, deduplicated
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, baseUrl);
      
      // SECURITY: Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
        return;
      }

      // Skip anchor-only links (e.g., href="#section")
      const baseNormalized = new URL(baseUrl);
      if (absoluteUrl.hash && 
          absoluteUrl.origin === baseNormalized.origin && 
          absoluteUrl.pathname === baseNormalized.pathname &&
          absoluteUrl.search === baseNormalized.search) {
        return;
      }

      links.add(absoluteUrl.href);
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
    }
  });

  return Array.from(links).sort();
}

/**
 * Extract all images from HTML
 * Resolves relative URLs to absolute and extracts metadata
 * 
 * @param html - HTML to extract images from
 * @param baseUrl - Base URL for resolving relative paths
 * @returns Array of image information, deduplicated by src
 */
export function extractImages(html: string, baseUrl: string): import('../types.js').ImageInfo[] {
  const $ = cheerio.load(html);
  const images = new Map<string, import('../types.js').ImageInfo>();

  // Extract <img> tags
  $('img[src]').each((_, elem) => {
    const $img = $(elem);
    const src = $img.attr('src');
    if (!src) return;

    try {
      const absoluteUrl = new URL(src, baseUrl);
      
      // SECURITY: Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
        return;
      }

      const alt = $img.attr('alt') || '';
      const title = $img.attr('title');
      const widthStr = $img.attr('width');
      const heightStr = $img.attr('height');
      
      const width = widthStr ? parseInt(widthStr, 10) : undefined;
      const height = heightStr ? parseInt(heightStr, 10) : undefined;

      const imageInfo: import('../types.js').ImageInfo = {
        src: absoluteUrl.href,
        alt,
        title,
        width: width && !isNaN(width) ? width : undefined,
        height: height && !isNaN(height) ? height : undefined,
      };

      // Deduplicate by src
      images.set(absoluteUrl.href, imageInfo);
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
    }
  });

  // Extract <picture><source> tags
  $('picture source[srcset]').each((_, elem) => {
    const $source = $(elem);
    const srcset = $source.attr('srcset');
    if (!srcset) return;

    // Parse srcset (format: "url 1x, url 2x" or "url 100w, url 200w")
    const srcsetParts = srcset.split(',').map(s => s.trim());
    srcsetParts.forEach(part => {
      const url = part.split(/\s+/)[0];
      if (!url) return;

      try {
        const absoluteUrl = new URL(url, baseUrl);
        
        // SECURITY: Only allow HTTP and HTTPS protocols
        if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
          return;
        }

        // Try to get alt from parent picture's img
        const alt = $source.closest('picture').find('img').attr('alt') || '';

        const imageInfo: import('../types.js').ImageInfo = {
          src: absoluteUrl.href,
          alt,
        };

        images.set(absoluteUrl.href, imageInfo);
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
      }
    });
  });

  // Extract CSS background images
  $('[style*="background"]').each((_, elem) => {
    const style = $(elem).attr('style');
    if (!style) return;

    // Match url() in CSS
    const urlMatches = style.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
    if (!urlMatches) return;

    urlMatches.forEach(match => {
      const url = match.replace(/url\(['"]?([^'")\s]+)['"]?\)/, '$1');
      if (!url) return;

      try {
        const absoluteUrl = new URL(url, baseUrl);
        
        // SECURITY: Only allow HTTP and HTTPS protocols
        if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
          return;
        }

        const imageInfo: import('../types.js').ImageInfo = {
          src: absoluteUrl.href,
          alt: '', // Background images don't have alt text
        };

        images.set(absoluteUrl.href, imageInfo);
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'url parse failed:', e instanceof Error ? e.message : e);
      }
    });
  });

  return Array.from(images.values());
}

/**
 * Extract all metadata from HTML
 */
export function extractMetadata(html: string, _url: string): { title: string; metadata: PageMetadata } {
  const $ = cheerio.load(html);

  const title = extractTitle($);
  const publishDate = extractPublishDate($, html);
  const language = extractLanguage($);
  const wordCount = extractWordCount(html);
  const metadata: PageMetadata = {
    description: extractDescription($),
    author: extractAuthor($),
    published: extractPublished($),
    image: extractImage($),
    canonical: extractCanonical($),
    ...(publishDate ? { publishDate } : {}),
    ...(language ? { language } : {}),
    wordCount,
  };

  return { title, metadata };
}
