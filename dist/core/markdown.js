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
export function selectContent(html, selector, exclude) {
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
function cleanHTML(html) {
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
 * Convert HTML to clean, readable Markdown
 */
export function htmlToMarkdown(html) {
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
            const alt = node.alt;
            const src = node.src;
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
            const codeNode = node.firstChild;
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
        if (i === 0)
            return line;
        const prevEmpty = arr[i - 1].trim() === '';
        const currEmpty = line.trim() === '';
        if (prevEmpty && currEmpty)
            return acc;
        return acc + '\n' + line;
    }, '');
    // Remove leading/trailing whitespace
    markdown = markdown.trim();
    return markdown;
}
/**
 * Convert HTML to plain text (strip all formatting)
 */
export function htmlToText(html) {
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
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
//# sourceMappingURL=markdown.js.map