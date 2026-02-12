/**
 * HTML to Markdown conversion with smart cleanup
 */

import TurndownService from 'turndown';
import * as cheerio from 'cheerio';

const JUNK_SELECTORS = [
  'script',
  'style',
  'nav',
  'footer',
  'header.site-header',
  'aside',
  '.sidebar',
  '.advertisement',
  '.ad',
  '.cookie-banner',
  '.cookie-notice',
  '.newsletter-signup',
  '.social-share',
  '.related-posts',
  '.comments',
  '#comments',
  '.cookie-consent',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="banner"]',
  '[class*="popup"]',
  '[class*="modal"]',
];

/**
 * Clean HTML before conversion
 * Remove navigation, ads, cookie banners, and other junk
 */
function cleanHTML(html: string): string {
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
 * Convert HTML to clean, readable Markdown
 */
export function htmlToMarkdown(html: string): string {
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

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

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
