/**
 * HTML to Markdown conversion with smart cleanup
 */

import TurndownService from 'turndown';
import * as cheerio from 'cheerio';

const JUNK_SELECTORS = [
  // Scripts, styles, metadata
  'script', 'style', 'noscript', 'iframe', 'link[rel="stylesheet"]',
  // Navigation & structure
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[role="search"]',
  '.sidebar', '.topbar', '.top-bar', '.site-nav', '.main-nav',
  '.breadcrumb', '.breadcrumbs', '[class*="breadcrumb"]',
  '.pagination', '[class*="pagination"]',
  // Ads & tracking
  '.advertisement', '.ad', '[class*="ad-"]', '[id*="ad-"]',
  '[class*="advert"]', '[class*="sponsor"]', '[class*="promo"]',
  // Cookie & consent
  '.cookie-banner', '.cookie-notice', '.cookie-consent',
  '[class*="cookie"]', '[id*="cookie"]',
  '[class*="consent"]', '[class*="gdpr"]',
  // Popups, modals, banners
  '[class*="banner"]', '[class*="popup"]', '[class*="modal"]',
  '[class*="overlay"]', '[class*="notification-bar"]',
  // Social & sharing
  '.social-share', '[class*="share"]', '[class*="social"]',
  // Newsletter & CTA
  '.newsletter-signup', '[class*="newsletter"]', '[class*="subscribe"]',
  '[class*="cta"]', '[class*="call-to-action"]', '[class*="signup"]',
  // Related content
  '.related-posts', '[class*="related"]', '[class*="recommended"]',
  '[class*="you-may-also"]', '[class*="more-stories"]',
  // Comments
  '.comments', '#comments', '[class*="comment"]',
  // SVG decorations (icons, decorative elements)
  'svg:not(img svg)',
];

/**
 * Extract content matching a CSS selector
 * Returns filtered HTML or full HTML if selector matches nothing
 */
export function selectContent(html: string, selector: string, exclude?: string[]): string {
  const $ = cheerio.load(html);
  
  // Apply excludes first
  if (exclude?.length) {
    exclude.forEach(sel => $(sel).remove());
  }
  
  // Select matching elements
  const selected = $(selector);
  if (selected.length === 0) {
    // Fallback to full page if selector matches nothing
    return html;
  }
  
  // Return the HTML of all matched elements
  return selected.map((_, el) => $.html(el)).get().join('\n');
}

/**
 * Clean HTML before conversion
 * Remove navigation, ads, cookie banners, and other junk
 */
function cleanHTML(html: string): string {
  // SECURITY: Limit HTML size to prevent DoS
  if (html.length > 10 * 1024 * 1024) { // 10MB
    throw new Error('HTML too large to process (max 10MB)');
  }
  
  const $ = cheerio.load(html);

  // Remove junk elements
  JUNK_SELECTORS.forEach((selector) => {
    $(selector).remove();
  });

  // Remove empty paragraphs and divs
  $('p:empty, div:empty').remove();

  // Remove elements with only whitespace
  $('*').each((_, elem) => {
    const $elem = $(elem);
    const text = $elem.text().trim();
    if (!text && $elem.children().length === 0) {
      $elem.remove();
    }
  });

  return $.html();
}

/**
 * MAIN CONTENT SELECTORS — prioritized list of selectors to find the article body
 * Checked in order: first match wins
 */
const MAIN_CONTENT_SELECTORS = [
  'article[role="main"]',
  'main article',
  '[role="main"] article',
  'article',
  '[role="main"]',
  'main',
  '.post-content', '.article-content', '.article-body', '.entry-content',
  '.post-body', '.story-body', '.page-content',
  '#content', '#main-content', '#article', '#post',
  '.content', '.main-content',
];

/**
 * Try to detect the main content area of a page.
 * Returns the main content HTML, or the full cleaned HTML if no main content detected.
 */
export function detectMainContent(html: string): { html: string; detected: boolean } {
  const $ = cheerio.load(html);
  
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const el = $(selector);
    if (el.length > 0) {
      // Check if it has meaningful content (at least 100 chars of text)
      const text = el.first().text().trim();
      if (text.length >= 100) {
        return { html: $.html(el.first()), detected: true };
      }
    }
  }
  
  // Fallback: find the largest text block (div or section with most text)
  let bestEl: cheerio.Cheerio<any> | null = null;
  let bestLen = 0;
  
  $('div, section').each((_, elem) => {
    const $elem = $(elem);
    const text = $elem.text().trim();
    // Prefer elements with significant text that aren't too deeply nested
    if (text.length > bestLen && text.length >= 200) {
      // Check it's not a wrapper of the whole page
      const parent = $elem.parent();
      if (parent.length && parent[0] !== $('body')[0] && parent[0] !== $('html')[0]) {
        bestEl = $elem;
        bestLen = text.length;
      }
    }
  });
  
  if (bestEl && bestLen > 300) {
    return { html: $.html(bestEl), detected: true };
  }
  
  return { html, detected: false };
}

/**
 * Calculate content quality score (0-1)
 * Measures how clean and useful the extracted content is
 */
export function calculateQuality(content: string, originalHtml: string): number {
  if (!content || content.length < 10) return 0;
  
  const contentLen = content.length;
  const htmlLen = originalHtml.length;
  
  // Factor 1: Compression ratio (how much we stripped) — higher is better, up to a point
  const compressionRatio = Math.min(contentLen / Math.max(htmlLen, 1), 1);
  // Sweet spot: 5-30% of original HTML is usually the real content
  const compressionScore = compressionRatio < 0.01 ? 0.3 :
    compressionRatio < 0.05 ? 0.7 :
    compressionRatio < 0.40 ? 1.0 :
    compressionRatio < 0.60 ? 0.8 : 0.5;
  
  // Factor 2: Text density (ratio of visible text to markdown formatting)
  const textOnly = content.replace(/[#*_\[\]\(\)\-`|>]/g, '');
  const textDensity = textOnly.trim().length / Math.max(contentLen, 1);
  const densityScore = Math.min(textDensity / 0.7, 1);
  
  // Factor 3: Has meaningful structure (headings, paragraphs)
  const hasHeadings = /^#{1,6}\s/m.test(content) ? 1 : 0.7;
  const hasParagraphs = content.split('\n\n').length > 2 ? 1 : 0.8;
  
  // Factor 4: Not too short, not too long
  const lengthScore = contentLen < 50 ? 0.3 :
    contentLen < 200 ? 0.6 :
    contentLen < 50000 ? 1.0 : 0.8;
  
  // Weighted average
  const quality = (
    compressionScore * 0.3 +
    densityScore * 0.3 +
    (hasHeadings * hasParagraphs) * 0.2 +
    lengthScore * 0.2
  );
  
  return Math.round(quality * 100) / 100;
}

/**
 * Convert HTML to clean, readable Markdown
 * @param html - HTML to convert
 */
export function htmlToMarkdown(html: string, _options?: { raw?: boolean }): string {
  const cleanedHTML = cleanHTML(html);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
  });

  // Preserve tables
  turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);

  // Custom rule: convert images to alt text or skip
  turndown.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node as any).alt;
      const src = (node as any).src;
      if (alt) {
        return `![${alt}](${src})`;
      }
      return '';
    },
  });

  // Custom rule: preserve code blocks
  turndown.addRule('codeBlocks', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE';
    },
    replacement: (_content, node) => {
      const codeNode = node.firstChild as any;
      const className = codeNode.getAttribute('class') || '';
      const language = className.match(/language-(\w+)/)?.[1] || '';
      return '\n\n```' + language + '\n' + codeNode.textContent + '\n```\n\n';
    },
  });

  let markdown = turndown.turndown(cleanedHTML);

  // SECURITY: Protect against ReDoS - limit input size before regex
  if (markdown.length > 1024 * 1024) { // 1MB limit for markdown
    markdown = markdown.slice(0, 1024 * 1024);
  }

  // Clean up excessive newlines (use non-backtracking approach)
  markdown = markdown.split('\n').reduce((acc, line, i, arr) => {
    if (i === 0) return line;
    const prevEmpty = arr[i - 1].trim() === '';
    const currEmpty = line.trim() === '';
    if (prevEmpty && currEmpty) return acc;
    return acc + '\n' + line;
  }, '');

  // Remove leading/trailing whitespace
  markdown = markdown.trim();

  return markdown;
}

/**
 * Convert HTML to plain text (strip all formatting)
 */
export function htmlToText(html: string): string {
  const cleanedHTML = cleanHTML(html);
  const $ = cheerio.load(cleanedHTML);

  // Get text content, preserving some structure
  let text = '';
  $('h1, h2, h3, h4, h5, h6, p, li').each((_, elem) => {
    const content = $(elem).text().trim();
    if (content) {
      text += content + '\n\n';
    }
  });

  // Fallback: if no structured content found, get all text
  if (!text.trim()) {
    text = $('body').text();
  }

  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');

  return text.trim();
}

/**
 * Estimate token count (very rough approximation)
 * Rule of thumb: 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate content to fit within a token budget
 * Intelligently preserves structure (headings, first paragraph)
 */
export function truncateToTokenBudget(content: string, maxTokens: number): string {
  const currentTokens = estimateTokens(content);
  
  // If under budget, return as-is
  if (currentTokens <= maxTokens) {
    return content;
  }
  
  // Split into lines
  const lines = content.split('\n');
  
  // Build truncated content
  const result: string[] = [];
  let currentTokenCount = 0;
  let foundFirstHeading = false;
  
  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    const isHeading = /^#{1,6}\s/.test(line);
    
    // Always include the first heading
    if (!foundFirstHeading && isHeading) {
      result.push(line);
      currentTokenCount += lineTokens;
      foundFirstHeading = true;
      continue;
    }
    
    // Check if adding this line would exceed budget
    if (currentTokenCount + lineTokens > maxTokens) {
      // Stop here
      break;
    }
    
    // Add the line
    result.push(line);
    currentTokenCount += lineTokens;
  }
  
  // Add truncation notice
  result.push('');
  result.push(`[Content truncated to ~${maxTokens} tokens]`);
  
  return result.join('\n');
}
