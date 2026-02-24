/**
 * Readability Engine
 *
 * Extracts the core article content from a web page — like Pocket, Instapaper,
 * or Safari Reader Mode but deterministic, fast, and purpose-built for AI agents.
 *
 * Algorithm:
 *   1. Noise removal — strip nav, footer, aside, ads, cookie banners, etc.
 *   2. Candidate scoring — score block elements by text density, link density,
 *      paragraph count, and structural signals.
 *   3. Best candidate selection — prefer <article> > <main> > highest-scoring div.
 *   4. Post-selection cleaning — remove inline noise (share buttons, etc.).
 *   5. Metadata extraction — title, author, date, site name from meta tags / bylines.
 *   6. Markdown output — via existing htmlToMarkdown().
 */

import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { rawHtmlToMarkdown } from './markdown.js';

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface ReadabilityOptions {
  /** Keep image references in output (default: true) */
  includeImages?: boolean;
  /** Keep hyperlinks in output (default: true) */
  includeLinks?: boolean;
  /** Keep code blocks in output (default: true) */
  includeCode?: boolean;
  /** Keep tables in output (default: true) */
  includeTables?: boolean;
  /** Maximum characters to return (applied after conversion) */
  maxLength?: number;
}

export interface ReadabilityResult {
  /** Article title */
  title: string;
  /** Author name or null */
  author: string | null;
  /** Publication date string or null */
  date: string | null;
  /** Site name or null */
  siteName: string | null;
  /** Clean article content as markdown */
  content: string;
  /** First 2 complete sentences as excerpt */
  excerpt: string;
  /** Estimated word count */
  wordCount: number;
  /** Human-readable reading time, e.g. "5 min read" */
  readingTime: string;
  /** Language code from <html lang> or null */
  language: string | null;
}

// ─── Noise patterns ───────────────────────────────────────────────────────────

/** Tags that are almost always page chrome, not article content */
const NOISE_TAGS = new Set([
  'nav', 'footer', 'aside', 'header',
  'script', 'style', 'noscript', 'iframe', 'form',
]);

/**
 * Class/id patterns that indicate page chrome (case-insensitive).
 * Applied to combined class+id strings.
 */
const NOISE_CLASS_PATTERNS = [
  /\bsidebar\b/,
  /\bmenu\b/,
  /\bnav(bar|igation)?\b/,
  /\bfooter\b/,
  /\bcomment/,
  /\bshare\b/,
  /\bsocial/,
  /\bwidget\b/,
  /\bad(s|vert(isement)?|-unit)?\b/,
  /\bpromo\b/,
  /\bbanner(?!-content)/,
  /\bcookie\b/,
  /\bconsent\b/,
  /\bnewsletter\b/,
  /\bsignup\b/,
  /\bsign-up\b/,
  /\bsubscri/,
  /\brelated\b/,
  /\brecommended\b/,
  /\bpopular\b/,
  /\btrending\b/,
  /\bbreadcrumb/,
  /\bpagination\b/,
  /\btoolbar\b/,
  /\bmodal\b/,
  /\bpopup\b/,
  /\boverlay\b/,
  /\btoast\b/,
  /\bnotification\b/,
  /\bskip-?link\b/,
];

/** aria-role values that indicate page chrome */
const NOISE_ROLES = new Set([
  'navigation', 'banner', 'contentinfo', 'complementary', 'search',
]);

/** Class/id patterns that indicate content (protect from removal) */
const CONTENT_PATTERNS = [
  /\barticle/,
  /\bpost-?content/,
  /\bentry-?content/,
  /\bmain-?content/,
  /\bstory\b/,
  /\bpage-?content/,
  /\bcontent-?area\b/,
  /\bprose\b/,
  /\bmarkdown-?body\b/,
];

/** Inline noise patterns for post-selection cleanup */
const INLINE_NOISE_PATTERNS = [
  /\bshare\b/,
  /\bsocial\b/,
  /\bfollow\b/,
  /\btwitter\b/,
  /\bfacebook\b/,
  /\blinkedin\b/,
  /\binstagram\b/,
  /\bpinterest\b/,
  /\bprint\b/,
  /\bsave\b/,
  /\bbookmark\b/,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClassAndId($el: cheerio.Cheerio<Element>, _$: cheerio.CheerioAPI): string {
  const cls = ($el.attr('class') ?? '').toLowerCase();
  const id = ($el.attr('id') ?? '').toLowerCase();
  return cls + ' ' + id;
}

function isNoise(el: Element, $: cheerio.CheerioAPI): boolean {
  const tagName = (el.tagName ?? '').toLowerCase();

  if (NOISE_TAGS.has(tagName)) return true;

  const $el = $(el);
  const combined = getClassAndId($el, $);

  // Protect elements that match content patterns
  for (const p of CONTENT_PATTERNS) {
    if (p.test(combined)) return false;
  }

  for (const p of NOISE_CLASS_PATTERNS) {
    if (p.test(combined)) return true;
  }

  const role = ($el.attr('role') ?? '').toLowerCase();
  if (NOISE_ROLES.has(role)) return true;

  return false;
}

function isHidden($el: cheerio.Cheerio<Element>): boolean {
  const style = ($el.attr('style') ?? '').toLowerCase();
  if (style.includes('display:none') || style.includes('display: none')) return true;
  if ($el.attr('hidden') !== undefined) return true;
  if ($el.attr('aria-hidden') === 'true') return true;
  return false;
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

interface PageMeta {
  title: string;
  author: string | null;
  date: string | null;
  siteName: string | null;
  language: string | null;
}

function extractMeta($: cheerio.CheerioAPI): PageMeta {
  // Title — prefer og:title, then <title>, then h1
  let title =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').text() ||
    $('h1').first().text() ||
    '';
  title = title.trim().replace(/\s+/g, ' ');

  // Author
  let author: string | null =
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    $('[rel="author"]').first().text() ||
    $('[itemprop="author"]').first().text() ||
    null;

  // Byline patterns — look for common class names
  if (!author) {
    const bylineSelectors = [
      '.byline', '.author', '.post-author', '.article-author',
      '.entry-author', '[class*="byline"]', '[class*="author"]',
    ];
    for (const sel of bylineSelectors) {
      const text = $(sel).first().text().trim();
      if (text && text.length < 100) {
        // Strip "By " prefix common in bylines
        author = text.replace(/^by\s+/i, '').trim();
        break;
      }
    }
  }

  if (author) author = author.trim().replace(/\s+/g, ' ') || null;

  // Date
  let date: string | null =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="publishdate"]').attr('content') ||
    $('meta[name="publish_date"]').attr('content') ||
    $('meta[itemprop="datePublished"]').attr('content') ||
    null;

  if (!date) {
    // Look for <time> elements
    const timeEl = $('time[datetime]').first();
    if (timeEl.length) {
      date = timeEl.attr('datetime') || timeEl.text().trim() || null;
    }
  }

  if (!date) {
    // Look for JSON-LD datePublished
    $('script[type="application/ld+json"]').each((_, el) => {
      if (date) return;
      try {
        const parsed = JSON.parse($(el).html() ?? '{}');
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        for (const obj of candidates) {
          if (obj.datePublished) {
            date = obj.datePublished as string;
            break;
          }
        }
      } catch { /* ignore parse errors */ }
    });
  }

  if (date) date = date.trim() || null;

  // Site name
  const siteName: string | null =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    null;

  // Language
  const language: string | null =
    $('html').attr('lang')?.trim().split('-')[0] ||
    $('meta[http-equiv="Content-Language"]').attr('content')?.trim() ||
    null;

  return { title, author, date, siteName, language };
}

// ─── Noise removal ────────────────────────────────────────────────────────────

function removeNoise($: cheerio.CheerioAPI): void {
  // Remove hidden elements first
  $('[aria-hidden="true"], [hidden]').remove();
  $('[style*="display:none"], [style*="display: none"]').remove();

  // Walk and remove noise elements (top-down, don't recurse into removed nodes)
  const toRemove: Element[] = [];

  function walk(node: AnyNode): void {
    if (node.type !== 'tag') return;
    const el = node as Element;
    const tagName = (el.tagName ?? '').toLowerCase();

    // Skip script/style (already handled by htmlToMarkdown)
    if (tagName === 'script' || tagName === 'style' || tagName === 'meta' || tagName === 'link') return;

    if (isNoise(el, $) || isHidden($(el))) {
      toRemove.push(el);
      return; // Don't recurse into nodes we'll remove
    }

    for (const child of el.children ?? []) {
      walk(child);
    }
  }

  const body = $('body').get(0);
  if (body) walk(body);

  for (const el of toRemove) {
    $(el).remove();
  }
}

// ─── Candidate scoring ────────────────────────────────────────────────────────

interface Candidate {
  el: Element;
  score: number;
  textLength: number;
  paragraphCount: number;
  linkDensity: number;
}

function scoreCandidate($el: cheerio.Cheerio<Element>, $: cheerio.CheerioAPI): number {
  const html = $.html($el) ?? '';
  const htmlLength = html.length;
  if (htmlLength === 0) return 0;

  // Remove scripts/styles from clone for text measurement
  const clone = $el.clone();
  clone.find('script, style, noscript').remove();

  const visibleText = clone.text() ?? '';
  const textLength = visibleText.trim().length;
  const textDensity = textLength / Math.max(htmlLength, 1);

  // Link density
  let linkTextLength = 0;
  $el.find('a').each((_, a) => {
    linkTextLength += ($(a).text() ?? '').trim().length;
  });
  const linkDensity = textLength > 0 ? linkTextLength / textLength : 1;

  // Paragraph count
  const paragraphCount = $el.find('p').length;

  // Base score: paragraphs × 3 + text length bonus - link density penalty
  let score = paragraphCount * 3 + textLength / 100 - linkDensity * 100;

  // Boost for high text density
  score += textDensity * 20;

  // Penalize noise class/id
  const combined = getClassAndId($el, $);
  for (const p of NOISE_CLASS_PATTERNS) {
    if (p.test(combined)) {
      score -= 30;
      break;
    }
  }

  // Boost if inside <main> or <article>
  const parents = $el.parents('main, article');
  if (parents.length > 0) {
    score += 20;
  }

  return score;
}

function findBestCandidate($: cheerio.CheerioAPI): Element | null {
  // Priority 1: <article>
  const articles = $('article');
  if (articles.length > 0) {
    // If multiple articles, pick the one with most paragraph content
    let best: Element | null = null;
    let bestScore = -Infinity;
    articles.each((_, el) => {
      const $el = $(el);
      const s = scoreCandidate($el, $);
      if (s > bestScore) {
        bestScore = s;
        best = el as Element;
      }
    });
    if (best) return best;
  }

  // Priority 2: <main>
  const main = $('main').first();
  if (main.length > 0) {
    return main.get(0) as Element;
  }

  // Priority 3: [role="main"]
  const roleMain = $('[role="main"]').first();
  if (roleMain.length > 0) {
    return roleMain.get(0) as Element;
  }

  // Priority 4: Highest-scoring div/section
  const candidates: Candidate[] = [];
  $('div, section').each((_, el) => {
    const $el = $(el);
    const html = $.html($el) ?? '';
    // Only consider elements with meaningful content (skip tiny wrappers)
    if (html.length < 200) return;
    const clone = $el.clone();
    clone.find('script, style, noscript').remove();
    const textLength = clone.text().trim().length;
    if (textLength < 100) return;

    const paragraphCount = $el.find('p').length;
    if (paragraphCount < 1) return; // Require at least one <p>

    let linkTextLength = 0;
    $el.find('a').each((_, a) => {
      linkTextLength += ($(a).text() ?? '').trim().length;
    });
    const linkDensity = textLength > 0 ? linkTextLength / textLength : 1;

    const score = scoreCandidate($el, $);
    candidates.push({ el: el as Element, score, textLength, paragraphCount, linkDensity });
  });

  if (candidates.length === 0) return null;

  // Return highest score
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].el;
}

// ─── Post-selection cleaning ──────────────────────────────────────────────────

function cleanCandidate($candidate: cheerio.Cheerio<Element>, $: cheerio.CheerioAPI, options: ReadabilityOptions): void {
  // Remove remaining inline noise (share buttons, social icons)
  $candidate.find('*').each((_, el) => {
    const $el = $(el);
    const combined = getClassAndId($el, $);
    for (const p of INLINE_NOISE_PATTERNS) {
      if (p.test(combined)) {
        // Only remove if it's clearly a widget, not article text
        const text = $el.text().trim();
        const tagName = (el as Element).tagName?.toLowerCase() ?? '';
        const isInlineNoise = tagName === 'div' || tagName === 'span' || tagName === 'ul' || tagName === 'button';
        if (isInlineNoise && text.length < 200) {
          $el.remove();
          return;
        }
      }
    }
  });

  // Strip images if not wanted
  if (options.includeImages === false) {
    $candidate.find('img, picture, figure, [class*="image"]').remove();
  }

  // Strip links (keep text) if not wanted
  if (options.includeLinks === false) {
    $candidate.find('a').each((_, el) => {
      $(el).replaceWith($(el).text());
    });
  }

  // Strip code blocks if not wanted
  if (options.includeCode === false) {
    $candidate.find('pre, code').remove();
  }

  // Strip tables if not wanted
  if (options.includeTables === false) {
    $candidate.find('table').remove();
  }
}

// ─── Excerpt generation ───────────────────────────────────────────────────────

function extractExcerpt(text: string): string {
  // Split by sentence boundaries and take first 2 complete sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length === 0) {
    // Fallback: first 200 chars
    return text.slice(0, 200).trim();
  }
  return sentences.slice(0, 2).join(' ').trim();
}

// ─── Reading time ─────────────────────────────────────────────────────────────

function calcReadingTime(wordCount: number): string {
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return `${minutes} min read`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract clean, readable article content from raw HTML.
 *
 * Mimics browser Reader Mode but deterministic and purpose-built for AI agents.
 *
 * @param html  - Raw HTML of the page
 * @param url   - Source URL (used for resolving relative links in metadata)
 * @param options - Extraction options
 */
export function extractReadableContent(
  html: string,
  _url: string,
  options: ReadabilityOptions = {},
): ReadabilityResult {
  const {
    includeImages = true,
    includeLinks = true,
    includeCode = true,
    includeTables = true,
    maxLength,
  } = options;

  // Security: cap HTML size
  if (html.length > 10 * 1024 * 1024) {
    html = html.slice(0, 10 * 1024 * 1024);
  }

  // Handle empty input gracefully
  if (!html.trim()) {
    return {
      title: '',
      author: null,
      date: null,
      siteName: null,
      content: '',
      excerpt: '',
      wordCount: 0,
      readingTime: '1 min read',
      language: null,
    };
  }

  const $ = cheerio.load(html);

  // ── Step 1: Extract metadata BEFORE noise removal (meta tags in <head> must survive) ──
  const meta = extractMeta($);

  // ── Step 2: Noise removal ──────────────────────────────────────────────────
  removeNoise($);

  // ── Step 3: Find best candidate ────────────────────────────────────────────
  const bestEl = findBestCandidate($);

  let candidateHtml: string;
  if (bestEl) {
    candidateHtml = $.html($(bestEl)) ?? '';
  } else {
    // Fallback: use cleaned body content
    candidateHtml = $('body').html() ?? $.html();
  }

  // ── Step 4: Post-selection cleaning ────────────────────────────────────────
  const $candidate = cheerio.load(candidateHtml);
  const $root = $candidate('body');

  cleanCandidate($root, $candidate, { includeImages, includeLinks, includeCode, includeTables });

  const cleanedHtml = $candidate('body').html() ?? candidateHtml;

  // ── Step 5: Convert to markdown ────────────────────────────────────────────
  // We use the existing htmlToMarkdown with prune:false (already cleaned)
  let content = rawHtmlToMarkdown(cleanedHtml);

  // ── Step 6: Build metadata header ──────────────────────────────────────────
  // Use H1 from content as title if meta title is missing or just the tab title
  if (!meta.title || meta.title.length < 3) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) meta.title = h1Match[1].trim();
  }

  // Extract word count from plain content text
  const plainText = content.replace(/[#*_`\[\]\(\)>|-]/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length;
  const readingTime = calcReadingTime(wordCount);

  // Build metadata line
  const metaParts: string[] = [];
  if (meta.author) metaParts.push(`By ${meta.author}`);
  if (meta.date) {
    // Try to format the date nicely
    try {
      const d = new Date(meta.date);
      if (!isNaN(d.getTime())) {
        metaParts.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
      } else {
        metaParts.push(meta.date);
      }
    } catch {
      metaParts.push(meta.date);
    }
  }
  metaParts.push(readingTime);

  const metaLine = metaParts.length > 0 ? `*${metaParts.join(' · ')}*\n\n` : '';
  const titleLine = meta.title ? `# ${meta.title}\n${metaLine}` : metaLine;

  // Don't duplicate title if it's already the first heading in content
  const contentStartsWithTitle =
    meta.title &&
    content.trimStart().startsWith(`# ${meta.title}`);

  if (!contentStartsWithTitle && titleLine) {
    content = titleLine + content;
  } else if (contentStartsWithTitle && metaLine) {
    // Inject meta line right after the title heading
    content = content.replace(/^(#\s+.+\n)/, `$1${metaLine}`);
  }

  // ── Step 7: Clean up whitespace ─────────────────────────────────────────────
  content = content.replace(/\n{3,}/g, '\n\n').trim();

  // ── Step 8: Apply maxLength ──────────────────────────────────────────────────
  if (maxLength && maxLength > 0 && content.length > maxLength) {
    content = content.slice(0, maxLength).trim() + '\n\n[Content truncated]';
  }

  // ── Step 9: Generate excerpt ─────────────────────────────────────────────────
  // Extract from the plain article text (no markdown formatting)
  const articleTextForExcerpt = plainText;
  const excerpt = extractExcerpt(articleTextForExcerpt);

  return {
    title: meta.title,
    author: meta.author,
    date: meta.date,
    siteName: meta.siteName,
    content,
    excerpt,
    wordCount,
    readingTime,
    language: meta.language,
  };
}
