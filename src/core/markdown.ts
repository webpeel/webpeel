/**
 * HTML to Markdown conversion with smart cleanup
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { pruneContent } from './content-pruner.js';

const JUNK_SELECTORS = [
  // Scripts, styles, metadata
  'script', 'style', 'noscript', 'iframe', 'link[rel="stylesheet"]',
  // Navigation
  'nav', '[role="navigation"]', '[role="search"]',
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
  // Popups, modals (precise selectors — no broad banner/overlay)
  '[class*="popup"]', '[class*="modal"]',
  '[class*="notification-bar"]',
  // Banners — only known ad/promo banners
  '.ad-banner', '.promo-banner',
  // Social & sharing — only sharing widgets
  '.social-share', '.share-buttons', '.share-widget',
  // Newsletter & CTA — only forms/widgets
  '.newsletter-signup', '[class*="newsletter"]',
  '.subscribe-form', '.subscribe-widget',
  '.signup-form', '.signup-widget', '.signup-cta',
  '[class*="call-to-action"]',
  // Related content — only explicit widgets
  '.related-posts', '[class*="you-may-also"]', '[class*="more-stories"]',
  // Comments — only sections/forms, not comment text
  '.comments-section', '.comment-form', '#comments',
  // Job site CTAs — resume upload prompts, apply nudges, sign-in gates
  '[class*="resume-upload"]', '[class*="resumeUpload"]',
  '[class*="job-alert"]', '[class*="jobAlert"]',
  '[class*="sign-in-gate"]', '[class*="signin-prompt"]',
  // Login/auth gates (specific patterns to avoid matching "navigate", "aggregate", etc.)
  '[class*="login-wall"]', '[class*="paywall"]', '[class*="signin-gate"]',
  '[class*="login-gate"]', '[class*="access-gate"]', '[class*="content-gate"]',
  '[class*="registration-wall"]', '.login-prompt', '.auth-wall',
  // Chat widgets
  '[class*="chat-widget"]', '[class*="chatbot"]', '[class*="intercom"]',
  '[class*="drift-"]', '[class*="zendesk"]', '[class*="crisp"]',
  '[class*="hubspot"]', '#hubspot-messages-iframe-container',
  // Skip links
  '.skip-to-content', '.skip-link', '.skip-nav',
];

/**
 * Filter HTML by including or excluding specific tags/selectors
 * Applied BEFORE markdown conversion for precise content control
 * 
 * @param html - HTML to filter
 * @param includeTags - Only keep content from these elements (e.g., ['article', 'main', '.content'])
 * @param excludeTags - Remove these elements (e.g., ['nav', 'footer', 'header', '.sidebar'])
 * @returns Filtered HTML
 */
export function filterByTags(html: string, includeTags?: string[], excludeTags?: string[]): string {
  const $ = cheerio.load(html);
  
  // Apply exclude tags first (remove unwanted elements)
  if (excludeTags?.length) {
    excludeTags.forEach(selector => {
      $(selector).remove();
    });
  }
  
  // Apply include tags (only keep specified elements)
  if (includeTags?.length) {
    // Collect all matching elements
    const included: cheerio.Cheerio<any>[] = [];
    includeTags.forEach(selector => {
      const matches = $(selector);
      if (matches.length > 0) {
        matches.each((_, el) => {
          included.push($(el));
        });
      }
    });
    
    // If we found matching elements, return only those
    if (included.length > 0) {
      return included.map(el => $.html(el)).join('\n');
    }
    
    // If includeTags specified but nothing matched, return empty
    return '';
  }
  
  // Return filtered HTML
  return $.html();
}

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

  // Conditionally remove header/footer — keep if they have substantial content (>200 chars)
  $('header, [role="banner"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length < 200) $(el).remove();
  });
  $('footer, [role="contentinfo"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length < 200) $(el).remove();
  });

  // Only remove sidebar-like asides, not all aside elements
  $('aside.sidebar, aside[role="complementary"], aside[class*="sidebar"]').remove();

  // Convert layout tables to clean divs before Turndown runs.
  // Layout tables (HN, old Reddit, email HTML etc.) use <table> for positioning,
  // not data — GFM's table plugin fails on them and emits raw HTML.
  // Detection: has presentation attributes OR contains nested <table> OR no <th>.
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);
    const hasBorder = $table.attr('border') !== undefined;
    const hasCellpadding = $table.attr('cellpadding') !== undefined;
    const hasBgcolor = $table.attr('bgcolor') !== undefined;
    const hasRolePresentation = $table.attr('role') === 'presentation';
    const hasNestedTable = $table.find('table').length > 0;
    const hasTh = $table.find('th').length > 0;
    const isLayoutTable = hasBorder || hasCellpadding || hasBgcolor || hasRolePresentation || hasNestedTable || !hasTh;
    if (!isLayoutTable) return;
    // Extract: links (as list items) + non-empty text from each <td>
    const lines: string[] = [];
    $table.find('td').each((_, td) => {
      const $td = $(td);
      // Preserve links found in this cell
      $td.find('a').each((_, a) => {
        const $a = $(a);
        const href = $a.attr('href');
        const label = $a.text().trim();
        if (label && href) lines.push(`<a href="${href}">${label}</a>`);
      });
      // Add non-link text if substantial
      const nonLinkText = $td.clone().find('a').remove().end().text().trim();
      if (nonLinkText.length > 10 && !$td.find('a').length) {
        lines.push(`<p>${nonLinkText}</p>`);
      }
    });
    const replacement = `<div>${lines.join('\n')}</div>`;
    $table.replaceWith(replacement);
  });

  // Convert complex data tables to clean markdown-ready format.
  // Turndown's GFM plugin fails on tables with colspan/rowspan, missing <thead>,
  // or too many columns. Detect these and convert to readable text pre-Turndown.
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);

    // Detect complexity: colspan, rowspan, no <thead>, or >8 columns
    const hasColspan = $table.find('[colspan]').length > 0;
    const hasRowspan = $table.find('[rowspan]').length > 0;
    const hasThead = $table.find('thead').length > 0;
    const firstRow = $table.find('tr').first();
    const colCount = firstRow.children('th, td').length;
    const isComplex = hasColspan || hasRowspan || !hasThead || colCount > 8;

    if (!isComplex) {
      // Simple table: just strip attributes so GFM plugin handles it
      const tableTags = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'];
      tableTags.forEach(tag => {
        $table.find(tag).addBack(tag).each((_i, el) => {
          const attrs = (el as any).attribs || {};
          for (const attr of Object.keys(attrs)) {
            $(el).removeAttr(attr);
          }
        });
      });
      return;
    }

    // Complex table: convert to structured text that reads well in markdown/chat
    // Extract headers from first row of <th> elements
    const headers: string[] = [];
    $table.find('tr').first().children('th').each((_i, th) => {
      headers.push($(th).text().trim());
    });

    // If first row had <th>, treat it as header row; otherwise no headers
    const dataRows = $table.find('tr').toArray();
    const startIdx = headers.length > 0 ? 1 : 0;

    // For tables with ≤6 useful columns and headers, rebuild as a clean bare HTML table
    // so Turndown's GFM plugin can convert it to a proper pipe table
    if (headers.length >= 2 && headers.length <= 6) {
      const theadRow = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
      const tbodyRows: string[] = [];

      for (let r = startIdx; r < dataRows.length; r++) {
        const cells: string[] = [];
        $(dataRows[r]).children('td, th').each((_j, td) => {
          const span = parseInt($(td).attr('colspan') || '1', 10);
          const text = $(td).text().trim();
          for (let s = 0; s < Math.min(span, 6); s++) cells.push(text);
        });
        // Pad or trim to match header count
        while (cells.length < headers.length) cells.push('');
        tbodyRows.push(`<tr>${cells.slice(0, headers.length).map(c => `<td>${c}</td>`).join('')}</tr>`);
      }

      $table.replaceWith(`<table><thead>${theadRow}</thead><tbody>${tbodyRows.join('')}</tbody></table>`);
      return;
    }

    // Wide tables or no headers: convert to HTML list so Turndown handles it properly
    // (never put pre-formatted markdown inside a div — Turndown will escape it)
    const liItems: string[] = [];
    for (let r = startIdx; r < dataRows.length; r++) {
      const cells: string[] = [];
      $(dataRows[r]).children('td, th').each((_j, td) => {
        const span = parseInt($(td).attr('colspan') || '1', 10);
        const text = $(td).text().trim();
        for (let s = 0; s < Math.min(span, 3); s++) cells.push(text);
      });
      if (cells.some(c => c)) {
        if (headers.length > 0) {
          const parts = cells
            .map((c, j) => (headers[j] && c) ? `<strong>${headers[j]}:</strong> ${c}` : c)
            .filter(Boolean)
            .join(' &middot; ');
          liItems.push(`<li>${parts}</li>`);
        } else {
          liItems.push(`<li>${cells.filter(Boolean).join(' &middot; ')}</li>`);
        }
      }
    }

    if (liItems.length > 0) {
      $table.replaceWith(`<ul>${liItems.join('')}</ul>`);
    }
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
  '.prose', '.markdown-body', '.post-text', '.article__body',
  '.story-content', '.entry-text', '.post-entry',
  '[itemprop="articleBody"]', '[data-article-body]',
  '.blog-post-content', '.blog-content',
];

/**
 * Try to detect the main content area of a page.
 * Returns the main content HTML, or the full cleaned HTML if no main content detected.
 */
export function detectMainContent(html: string): { html: string; detected: boolean } {
  const $ = cheerio.load(html);

  // Helper: get visible text length (ignoring script/style/noscript)
  function visibleTextLength(root: cheerio.Cheerio<any>): number {
    const clone = root.clone();
    clone.find('script, style, noscript').remove();
    return clone.text().trim().length;
  }

  const totalTextLen = visibleTextLength($.root());

  for (const selector of MAIN_CONTENT_SELECTORS) {
    const el = $(selector);
    if (el.length > 0) {
      // Check if it has meaningful content (at least 100 chars of text)
      const text = el.first().text().trim();
      if (text.length >= 100) {
        // Text-coverage heuristic: if detected element has <50% of page text,
        // the detection was too narrow — return full page instead
        const candidateLen = visibleTextLength(el.first());
        if (totalTextLen > 0 && candidateLen / totalTextLen < 0.5) {
          return { html, detected: false };
        }
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
    // Same coverage check for fallback
    if (totalTextLen > 0 && bestLen / totalTextLen < 0.5) {
      return { html, detected: false };
    }
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

// Module-level singleton TurndownService — stateless per-call, safe to reuse.
const turndownSingleton = (() => {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
  });

  // Enable GFM support (tables, strikethrough, task lists)
  td.use(gfm);

  // Custom rule: convert images to alt text or skip
  td.addRule('images', {
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
  td.addRule('codeBlocks', {
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

  return td;
})();

/**
 * Convert HTML to clean, readable Markdown
 * @param html - HTML to convert
 * @param options.raw - Skip main-content heuristics (return full page)
 * @param options.prune - Apply content density pruning (default: true)
 */
export function htmlToMarkdown(html: string, options?: { raw?: boolean; prune?: boolean }): string {
  let cleanedHTML = cleanHTML(html);

  // Content density pruning — runs AFTER junk selector removal, BEFORE Turndown conversion
  // Default ON; callers pass prune:false to skip (e.g. --full-content flag)
  if (options?.prune !== false) {
    const pruned = pruneContent(cleanedHTML, { dynamic: true });
    cleanedHTML = pruned.html;
  }

  let markdown = turndownSingleton.turndown(cleanedHTML);

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

  // Remove common CTA / noise lines (job sites, sign-up prompts, etc.)
  // Strip markdown heading prefix before matching (e.g., "## Are you open...")
  markdown = markdown.split('\n').filter(line => {
    const trimmed = line.trim().toLowerCase().replace(/^#{1,6}\s*/, '');
    // Job site CTA noise
    if (trimmed === 'upload resume' || trimmed === 'upload your resume') return false;
    if (trimmed === 'apply now' || trimmed === 'apply on employer site' || trimmed === 'apply on employer siteapply now') return false;
    if (trimmed === 'easy apply' || trimmed === 'save job' || trimmed === 'easy apply onlyremote only') return false;
    if (/^(is your resume a good match|are you open to new opportunities)\??$/.test(trimmed)) return false;
    if (/^upload your resume to increase your chances/i.test(trimmed)) return false;
    if (/^use ai to find out how well/i.test(trimmed)) return false;
    // Job site filter sidebar labels (standalone)
    if (trimmed === 'company rating' || trimmed === 'date posted' || trimmed === 'salary range') return false;
    // Indeed profile insights noise
    if (/^do you have (experience in|a )/i.test(trimmed)) return false;
    if (trimmed === 'yesno' || trimmed === 'yes no') return false;
    if (trimmed === 'profile insights' || trimmed === 'find out how your skills align') return false;
    if (/^find out how your skills align/i.test(trimmed)) return false;
    // Common UI artifacts (icons, loading, inline labels)
    if (trimmed === 'save-icon' || trimmed === 'loading' || trimmed === 'report job') return false;
    if (/^show more(chevron down)?$/i.test(trimmed)) return false;
    if (trimmed === 'whatwherefind jobs') return false;
    // Q&A site chrome (Stack Overflow, StackExchange, forums)
    if (/^\[?(share|follow|flag|report)\]?(\(.*\))?$/i.test(trimmed)) return false;
    if (/^\[?improve this (question|answer)\]?/i.test(trimmed)) return false;
    if (/^(sorted by|highest score|trending|date modified|date created)/i.test(trimmed)) return false;
    if (/^\[?(edited|answered|asked)\s+\w+\s+\d/i.test(trimmed)) return false;
    if (/^community wiki$/i.test(trimmed)) return false;
    if (/^\d+\s*(answers?|votes?|views?)\s*\d*$/i.test(trimmed)) return false;
    if (/^\[?reset to default\]?/i.test(trimmed)) return false;
    // Generic interactive chrome
    if (/^\[?(bookmark|save|pin|mute|hide|block)\]?(\(.*\))?$/i.test(trimmed)) return false;
    if (/^\[?(reply|retweet|repost|quote)\]?(\(.*\))?$/i.test(trimmed)) return false;
    if (/^\[?copy\s*(link|url)?\]?(\(.*\))?$/i.test(trimmed)) return false;
    if (/^(sign up|log in|create account|join now)\s*(to|for)?/i.test(trimmed)) return false;
    return true;
  }).join('\n');

  // Truncate trailing recommendation/related-jobs sections (common on job sites like Indeed)
  // These appear after the main content and add 1000+ tokens of noise
  const trailCutPatterns = [
    /^#{1,3}\s*(explore other jobs|discover opportunities beyond)/im,
    /^#{1,3}\s*(jobs with similar titles)/im,
    /^#{1,3}\s*(similar job categories)/im,
    /^#{1,3}\s*(career guide articles)/im,
    /^#{1,3}\s*(similar jobs nearby)/im,
    /^#{1,3}\s*(company and salary information)/im,
  ];
  for (const pattern of trailCutPatterns) {
    const match = pattern.exec(markdown);
    if (match && match.index !== undefined) {
      // Only truncate if the noise section is in the bottom 40% of the content
      if (match.index > markdown.length * 0.6) {
        markdown = markdown.slice(0, match.index).trim();
        break;
      }
    }
  }

  // Remove leading/trailing whitespace
  markdown = markdown.trim();

  return markdown;
}

/**
 * Convert HTML to markdown using Turndown directly, without the full cleanHTML pipeline.
 * Useful when the caller has already cleaned the HTML and wants to preserve elements
 * (like images) that cleanHTML would strip due to empty-element detection.
 *
 * The only pre-processing done: remove script/style tags for safety.
 */
export function rawHtmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts and styles (always)
  $('script, style, noscript').remove();

  // Run Turndown on the cleaned HTML
  let markdown = turndownSingleton.turndown($.html());

  // Clean up excessive newlines
  markdown = markdown.split('\n').reduce((acc, line, i, arr) => {
    if (i === 0) return line;
    const prevEmpty = arr[i - 1].trim() === '';
    const currEmpty = line.trim() === '';
    if (prevEmpty && currEmpty) return acc;
    return acc + '\n' + line;
  }, '');

  return markdown.trim();
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

/**
 * Strip markdown link/image syntax for clean AI-readable text.
 * Preserves headings, lists, bold, italic, code blocks.
 * Removes: [text](url) → text, ![alt](src) → [Image: alt], reference links.
 */
export function cleanForAI(markdown: string): string {
  return markdown
    // Convert images to descriptive text: ![alt](url) → [Image: alt]
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => alt ? `[Image: ${alt}]` : '')
    // Convert links to just text: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove reference-style link definitions: [id]: url
    .replace(/^\[[\w-]+\]:\s+\S+.*$/gm, '')
    // Remove bare URLs that aren't in code blocks (heuristic: standalone URLs on a line)
    .replace(/^https?:\/\/\S+$/gm, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove empty link fragments like []
    .replace(/\[\s*\]/g, '')
    // Clean up citation references like [1], [2] etc (common in scraped content)
    .replace(/\[(\d+)\]/g, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Trim trailing whitespace on each line
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * Clean up common markdown noise patterns produced during HTML-to-markdown conversion.
 * Removes empty links, orphaned image links, collapses excess newlines, strips trailing whitespace.
 */
export function cleanMarkdownNoise(content: string): string {
  return content
    // Remove empty links: [](url) or [ ](url)
    .replace(/\[\s*\]\([^)]+\)/g, '')
    // Remove image-only links that are just UI elements: [![](img)](link)
    .replace(/\[\!\[\]\([^)]+\)\]\([^)]+\)/g, '')
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove trailing whitespace on lines
    .replace(/[ \t]+$/gm, '')
    .trim();
}
