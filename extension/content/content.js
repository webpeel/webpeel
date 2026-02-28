/**
 * WebPeel Extension — content.js
 * Injected into every page at document_idle.
 * Handles client-side "free mode" extraction when no API key is set.
 */

'use strict';

/* ── Selectors to REMOVE from the cloned DOM ──────── */
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'iframe',
  'canvas',
  'video',
  'audio',
  'object',
  'embed',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="search"]',
  '.sidebar',
  '.side-bar',
  '.widget',
  '.widgets',
  '.advertisement',
  '.ad',
  '.ads',
  '.ad-container',
  '#comments',
  '#sidebar',
  '.comments',
  '.comment-section',
  '.social-share',
  '.share-buttons',
  '.newsletter-signup',
  '.cookie-banner',
  '.popup',
  '.modal',
  '[aria-hidden="true"]',
];

/* ── Candidate selectors for main content (priority order) ── */
const CONTENT_CANDIDATES = [
  'article',
  '[role="main"]',
  'main',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.content-body',
  '.page-content',
  '.post-body',
  '#content',
  '#main-content',
  '.main-content',
];

/**
 * Find the best content container on the page.
 * @returns {Element}
 */
function findContentElement() {
  for (const sel of CONTENT_CANDIDATES) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) {
      return el;
    }
  }
  return document.body;
}

/**
 * Extract clean text from the page.
 * Returns { title, content, url, wordCount, extractedAt }
 */
function extractContent() {
  // 1. Title
  const title = document.title || '';

  // 2. Find main content element
  const source = findContentElement();

  // 3. Deep clone so we don't mutate the live page
  const clone = source.cloneNode(true);

  // 4. Remove noisy elements from the clone
  for (const sel of NOISE_SELECTORS) {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  }

  // 5. Get clean text
  //    innerText respects CSS display and visibility better than textContent
  const rawText = clone.innerText || clone.textContent || '';

  // 6. Clean up excessive whitespace / blank lines
  const content = rawText
    .split('\n')
    .map(line => line.trimEnd())
    .reduce((acc, line) => {
      // Collapse 3+ consecutive blank lines to 2
      const lastIsBlank = acc.length > 0 && acc[acc.length - 1] === '';
      const thisIsBlank = line.trim() === '';
      if (thisIsBlank && lastIsBlank) return acc;
      acc.push(line);
      return acc;
    }, [])
    .join('\n')
    .trim();

  // 7. Word count
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return {
    title,
    content,
    url: window.location.href,
    wordCount,
    extractedAt: new Date().toISOString(),
  };
}

/* ── Message listener ─────────────────────────────── */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'extractContent') {
    try {
      const result = extractContent();
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: err.message || 'Extraction failed in content script.' });
    }
    // Return true to keep the message channel open for async if ever needed
    return true;
  }
});
