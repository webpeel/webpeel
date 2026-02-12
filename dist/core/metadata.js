/**
 * Extract structured metadata from HTML
 */
import * as cheerio from 'cheerio';
/**
 * Extract page title using fallback chain:
 * og:title → twitter:title → title tag → h1
 */
function extractTitle($) {
    // Try Open Graph title
    let title = $('meta[property="og:title"]').attr('content');
    if (title)
        return title.trim();
    // Try Twitter title
    title = $('meta[name="twitter:title"]').attr('content');
    if (title)
        return title.trim();
    // Try title tag
    title = $('title').text();
    if (title)
        return title.trim();
    // Fallback to first h1
    title = $('h1').first().text();
    if (title)
        return title.trim();
    return '';
}
/**
 * Extract page description using fallback chain:
 * og:description → twitter:description → meta description
 */
function extractDescription($) {
    // Try Open Graph description
    let desc = $('meta[property="og:description"]').attr('content');
    if (desc)
        return desc.trim();
    // Try Twitter description
    desc = $('meta[name="twitter:description"]').attr('content');
    if (desc)
        return desc.trim();
    // Try standard meta description
    desc = $('meta[name="description"]').attr('content');
    if (desc)
        return desc.trim();
    return undefined;
}
/**
 * Extract author from meta tags
 */
function extractAuthor($) {
    // Try article:author
    let author = $('meta[property="article:author"]').attr('content');
    if (author)
        return author.trim();
    // Try author meta tag
    author = $('meta[name="author"]').attr('content');
    if (author)
        return author.trim();
    return undefined;
}
/**
 * Extract published date from meta tags
 * Returns ISO 8601 date string if found
 */
function extractPublished($) {
    // Try article:published_time
    let published = $('meta[property="article:published_time"]').attr('content');
    if (published) {
        try {
            return new Date(published).toISOString();
        }
        catch {
            // Invalid date, continue
        }
    }
    // Try datePublished schema.org
    published = $('meta[itemprop="datePublished"]').attr('content');
    if (published) {
        try {
            return new Date(published).toISOString();
        }
        catch {
            // Invalid date, continue
        }
    }
    return undefined;
}
/**
 * Extract Open Graph image URL
 */
function extractImage($) {
    // Try og:image
    let image = $('meta[property="og:image"]').attr('content');
    if (image)
        return image.trim();
    // Try twitter:image
    image = $('meta[name="twitter:image"]').attr('content');
    if (image)
        return image.trim();
    return undefined;
}
/**
 * Extract canonical URL
 */
function extractCanonical($) {
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical)
        return canonical.trim();
    // Fallback to og:url
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl)
        return ogUrl.trim();
    return undefined;
}
/**
 * Extract all links from page
 * Returns absolute URLs, deduplicated
 */
export function extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    $('a[href]').each((_, elem) => {
        const href = $(elem).attr('href');
        if (!href)
            return;
        try {
            const absoluteUrl = new URL(href, baseUrl).href;
            // Skip non-HTTP(S) links
            if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
                return;
            }
            // Skip common junk links
            if (absoluteUrl.includes('javascript:') ||
                absoluteUrl.includes('mailto:') ||
                absoluteUrl.includes('#')) {
                return;
            }
            links.add(absoluteUrl);
        }
        catch {
            // Invalid URL, skip
        }
    });
    return Array.from(links).sort();
}
/**
 * Extract all metadata from HTML
 */
export function extractMetadata(html, _url) {
    const $ = cheerio.load(html);
    const title = extractTitle($);
    const metadata = {
        description: extractDescription($),
        author: extractAuthor($),
        published: extractPublished($),
        image: extractImage($),
        canonical: extractCanonical($),
    };
    return { title, metadata };
}
//# sourceMappingURL=metadata.js.map