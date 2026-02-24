/**
 * Content Density Pruner
 *
 * Two-pass pruning to reduce HTML before markdown conversion:
 *
 *   Pass 1 — Semantic removal: strip elements whose tag or class/id clearly
 *            mark them as page chrome (nav, footer, sidebar, cookie banners, ads).
 *
 *   Pass 2 — Density scoring: score remaining block elements by text density,
 *            link density, tag importance, and word count. Remove low-scorers.
 *
 * Inspired by Crawl4AI's PruningContentFilter — targets 40-60% token savings.
 */

import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export interface PruneOptions {
  /** Score threshold (0-1). Blocks below this are removed. Default: 0.3 */
  threshold?: number;
  /** Minimum word count for a block to be considered. Default: 3 */
  minWords?: number;
  /** Whether threshold adapts to content distribution. Default: true */
  dynamic?: boolean;
}

export interface PruneResult {
  /** Pruned HTML */
  html: string;
  /** Number of nodes removed */
  nodesRemoved: number;
  /** Percentage of content removed (by character count) */
  reductionPercent: number;
}

// -----------------------------------------------------------------------
// Pass 1 — Semantic removal: tags and class/id patterns
// -----------------------------------------------------------------------

/** Tags that are almost always page chrome, not article content. */
const CHROME_TAGS = new Set([
  'nav', 'footer', 'aside', 'noscript',
]);

/**
 * Class/id patterns that indicate page chrome.
 * Tested against lowercased class/id strings.
 */
const CHROME_PATTERNS = [
  /\bsidebar\b/,
  /\bcookie/,
  /\bbanner\b/,
  /\b(ad|ads|advert)\b/,
  /\bpopup\b/,
  /\bmodal\b/,
  /\boverlay\b/,
  /\bsocial/,
  /\bshare\b/,
  /\bbreadcrumb/,
  /\bskip-?link/,
  /\bfootnote/,
  /\brelated-?(post|article)/,
  /\bnewsletter/,
  /\bsubscri/,
  /\bcomment/,
  /\b(sign-?up|sign-?in|log-?in)\b/,
  /\btoc\b/,
  /\btable-?of-?contents\b/,
  /\bgdpr\b/,
  /\bconsent\b/,
  // Q&A sites (Stack Overflow, StackExchange)
  /\bvote\b/,
  /\bpost-?menu/,
  /\bjs-vote/,
  /\buser-?card/,
  /\buser-?info/,
  /\bpost-?tag/,
  /\bquestion-?stats/,
  // Social/sharing UI
  /\bshare-?(button|link|panel|menu|bar)/,
  /\bfollow-?button/,
  /\breaction/,
  /\blike-?button/,
  /\bupvote/,
  /\bdownvote/,
  // Edit/action UI
  /\bedit-?(link|button|post)/,
  /\breport-?(link|button)/,
  /\bflag-?(link|button)/,
  // Generic site chrome
  /\btop-?bar/,
  /\bsite-?header/,
  /\bpage-?header/,
  /\bsticky-?header/,
  /\bnotice\b/,
  /\balert\b/,
  /\btoast\b/,
  /\bsnackbar/,
  /\bbottom-?bar/,
  /\bfloating/,
  /\bfixed-?bottom/,
  /\bback-?to-?top/,
];

/**
 * Tags we never remove (they likely wrap main content).
 * We recurse into them but never strip the element itself.
 */
const PROTECTED_TAGS = new Set(['main', 'article', 'body']);

/**
 * Tags we never remove during density scoring (Pass 2).
 * Headings, paragraphs, and semantic content elements should survive
 * even if they're small — they carry essential meaning.
 */
const DENSITY_SAFE_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'pre', 'code', 'blockquote', 'figcaption',
  'main', 'article', 'body',
  // Table structural elements — pruner must not remove these or Turndown GFM
  // can't convert tables and falls back to raw HTML output.
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

/**
 * Class/id patterns that protect an element from removal.
 */
const CONTENT_PATTERNS = [
  /\barticle/,
  /\bpost-?content/,
  /\bentry-?content/,
  /\bmain-?content/,
  /\bstory/,
  /\bblog/,
  /\bpage-?content/,
  /\bcontent-?area/,
];

function isChromeBySemantic(el: Element, $: cheerio.CheerioAPI): boolean {
  const tagName = el.tagName?.toLowerCase() ?? '';
  if (CHROME_TAGS.has(tagName)) return true;

  const cls = ($(el).attr('class') ?? '').toLowerCase();
  const id = ($(el).attr('id') ?? '').toLowerCase();
  const combined = cls + ' ' + id;

  // Don't remove if it matches a content pattern
  for (const p of CONTENT_PATTERNS) {
    if (p.test(combined)) return false;
  }

  for (const p of CHROME_PATTERNS) {
    if (p.test(combined)) return true;
  }

  // Role attribute
  const role = ($(el).attr('role') ?? '').toLowerCase();
  if (['navigation', 'banner', 'complementary', 'contentinfo', 'search'].includes(role)) {
    return true;
  }

  return false;
}

// -----------------------------------------------------------------------
// Pass 2 — Density scoring
// -----------------------------------------------------------------------

/** Tag importance scores for density scoring (-2 to +3) */
const TAG_IMPORTANCE: Record<string, number> = {
  article: 3, main: 3,
  p: 2, h1: 2, h2: 2, h3: 2, h4: 2, h5: 2, h6: 2,
  blockquote: 2, pre: 2, code: 2, figure: 2, figcaption: 2,
  section: 1, td: 1, th: 1, li: 1, dd: 1, dt: 1,
  div: 0, span: 0, table: 0, ul: 0, ol: 0, dl: 0,
  aside: -1, header: -1, form: -1,
  nav: -2, footer: -2,
};

function normalizeTagScore(rawScore: number): number {
  return (rawScore + 2) / 5; // -2..+3 → 0..1
}

interface ScoredBlock {
  element: Element;
  tagName: string;
  htmlLength: number;
  visibleText: string;
  score: number;
}

/**
 * Collect scoreable blocks from a DOM tree.
 *
 * Strategy: walk the tree top-down. For each element:
 *   - If it's a "leaf-ish" block (< threshold size), score it as one unit.
 *   - If it's large and a wrapper (div/section/table), recurse into children.
 *   - Protected elements are always recursed.
 *
 * This finds the right granularity: not scoring a 200KB wrapper div,
 * but scoring the divs/sections/p's nested 3-4 levels deep that carry
 * actual content or chrome.
 */
function collectBlocks(
  $: cheerio.CheerioAPI,
  parent: AnyNode,
  blocks: ScoredBlock[],
  maxLeafSize: number,
): void {
  const children = 'children' in parent ? (parent.children as AnyNode[]) : [];

  for (const child of children) {
    if (child.type !== 'tag') continue;
    const el = child as Element;
    const tagName = el.tagName?.toLowerCase() ?? '';

    // Skip script/style
    if (tagName === 'script' || tagName === 'style' || tagName === 'link' || tagName === 'meta') continue;

    const $el = $(el);
    const outerHtml = $.html($el) ?? '';
    const htmlLen = outerHtml.length;

    // Skip extremely tiny elements (bare tags like <br>)
    if (htmlLen < 10) continue;

    const isProtected = PROTECTED_TAGS.has(tagName);
    const isWrapper = ['div', 'section', 'table', 'tbody', 'thead', 'tr',
                       'center', 'details', 'summary'].includes(tagName);

    if (isProtected || (isWrapper && htmlLen > maxLeafSize)) {
      // Too large or protected — recurse deeper
      collectBlocks($, el, blocks, maxLeafSize);
    } else if (htmlLen > 0) {
      // Score this element
      const clone = $el.clone();
      clone.find('script, style, noscript, svg, path').remove();
      const visibleText = clone.text() ?? '';
      const visibleTextLen = visibleText.trim().length;

      const textDensity = Math.min(visibleTextLen / Math.max(htmlLen, 1), 1.0);

      let linkTextLen = 0;
      $el.find('a').each((_i, a) => {
        linkTextLen += ($(a).text() ?? '').trim().length;
      });
      const linkDensity = visibleTextLen > 0
        ? Math.min(linkTextLen / visibleTextLen, 1.0)
        : 0;

      const rawTagScore = TAG_IMPORTANCE[tagName] ?? 0;
      const normalizedTag = normalizeTagScore(rawTagScore);

      const words = visibleText.trim().split(/\s+/).filter(w => w.length > 0);
      const wordBonus = words.length > 0
        ? Math.min(Math.log(words.length + 1) / Math.log(1000), 1.0)
        : 0;

      const score = (
        textDensity * 0.35 +
        (1 - linkDensity) * 0.25 +
        normalizedTag * 0.2 +
        wordBonus * 0.1 +
        0.1 // baseline position score (removed position bias — not useful for deep nesting)
      );

      blocks.push({
        element: el,
        tagName,
        htmlLength: htmlLen,
        visibleText,
        score,
      });
    }
  }
}

// -----------------------------------------------------------------------
// Main export
// -----------------------------------------------------------------------

/**
 * Prune low-value HTML blocks using two-pass approach:
 *   1. Semantic tag/class removal
 *   2. Density scoring of remaining blocks
 *
 * @param html - Raw HTML to prune
 * @param options - Pruning configuration
 * @returns Pruned HTML with stats
 */
export function pruneContent(html: string, options: PruneOptions = {}): PruneResult {
  const {
    threshold = 0.3,
    minWords = 3,
    dynamic = true,
  } = options;

  const originalLength = html.length;
  if (!html.trim()) {
    return { html, nodesRemoved: 0, reductionPercent: 0 };
  }

  const $ = cheerio.load(html);
  let nodesRemoved = 0;

  // =====================================================================
  // Pass 1: Semantic removal
  // =====================================================================
  // Walk top-down; remove entire subtrees that are clearly chrome.
  // We look at direct children of body, and one level deeper, to catch
  // both <body> <nav> and <body> <div> <nav> patterns.
  const toRemoveSemantic: Element[] = [];

  function walkForChrome(parent: AnyNode, depth: number): void {
    const children = 'children' in parent ? (parent.children as AnyNode[]) : [];
    for (const child of children) {
      if (child.type !== 'tag') continue;
      const el = child as Element;
      const tagName = el.tagName?.toLowerCase() ?? '';
      if (tagName === 'script' || tagName === 'style') continue;

      if (PROTECTED_TAGS.has(tagName)) {
        // Recurse into protected — there might be chrome inside <article>
        walkForChrome(el, depth + 1);
        continue;
      }

      if (isChromeBySemantic(el, $)) {
        toRemoveSemantic.push(el);
        continue; // don't recurse into something we'll remove
      }

      // Recurse up to a reasonable depth
      if (depth < 6) {
        walkForChrome(el, depth + 1);
      }
    }
  }

  const body = $('body').get(0);
  if (body) {
    walkForChrome(body, 0);
  }

  for (const el of toRemoveSemantic) {
    $(el).remove();
    nodesRemoved++;
  }

  // =====================================================================
  // Pass 2: Density scoring (on the remaining HTML)
  // =====================================================================
  const postPass1Html = $.html();
  const postPass1Length = postPass1Html.length;

  // Run density scoring on remaining content
  if (postPass1Length > 100 && body) {
    const blocks: ScoredBlock[] = [];
    // Max leaf size: ~5KB or 30% of remaining content (whichever is smaller)
    // This ensures we find leaf blocks even in small documents.
    const maxLeafSize = Math.min(5000, Math.ceil(postPass1Length * 0.3));
    collectBlocks($, body, blocks, maxLeafSize);

    if (blocks.length >= 2) {
      const scores = blocks.map(b => b.score);
      const bestScore = Math.max(...scores);

      let effectiveThreshold = threshold;
      if (dynamic) {
        // Blocks scoring below 50% of the best block are candidates for removal
        effectiveThreshold = bestScore * 0.5;
      }

      // Safety: retain at least 40% of post-pass1 content
      const minRetainLength = Math.ceil(postPass1Length * 0.4);

      // Sort ascending by score — remove worst first
      const sorted = blocks
        .map((b, i) => ({ b, i, score: b.score }))
        .sort((a, b) => a.score - b.score);

      const toRemoveDensity = new Set<Element>();
      let removedLength = 0;

      for (const { b } of sorted) {
        if (PROTECTED_TAGS.has(b.tagName) || DENSITY_SAFE_TAGS.has(b.tagName)) continue;

        const words = b.visibleText.trim().split(/\s+/).filter(w => w.length > 0);
        const isTiny = words.length < minWords;
        const isLow = b.score < effectiveThreshold;

        if (!isTiny && !isLow) continue;

        // Check safety floor
        const remaining = postPass1Length - (removedLength + b.htmlLength);
        if (remaining < minRetainLength) continue;

        toRemoveDensity.add(b.element);
        removedLength += b.htmlLength;
      }

      for (const el of toRemoveDensity) {
        $(el).remove();
        nodesRemoved++;
      }
    }
  }

  const resultHtml = $.html() ?? html;
  const resultLength = resultHtml.length;
  const reductionPercent = originalLength > 0
    ? Math.max(0, Math.round(((originalLength - resultLength) / originalLength) * 100))
    : 0;

  return {
    html: resultHtml,
    nodesRemoved,
    reductionPercent,
  };
}
