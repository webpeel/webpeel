/**
 * Auto-extraction module — heuristic + CSS selector based structured data extraction.
 * No LLM API key required.
 *
 * Supports:
 *  - pricing   : pricing tables / plan cards
 *  - products  : product grids / listings
 *  - contact   : emails, phones, addresses, social links
 *  - article   : blog posts / news articles
 *  - api_docs  : REST API endpoint documentation
 *  - unknown   : fallback when no type is detected
 */

import { load, type CheerioAPI } from 'cheerio';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PricingPlan {
  name: string;
  price: string;
  period?: string;
  features: string[];
  cta?: string;
}

export interface PricingResult {
  type: 'pricing';
  plans: PricingPlan[];
}

export interface ProductItem {
  name: string;
  price?: string;
  image?: string;
  url?: string;
  rating?: string;
}

export interface ProductsResult {
  type: 'products';
  items: ProductItem[];
}

export interface ContactResult {
  type: 'contact';
  emails: string[];
  phones: string[];
  addresses: string[];
  social: Record<string, string>;
}

export interface ArticleSection {
  heading: string;
  content: string;
}

export interface ArticleResult {
  type: 'article';
  title?: string;
  author?: string;
  date?: string;
  readingTime?: string;
  summary?: string;
  sections: ArticleSection[];
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description?: string;
  params?: string[];
}

export interface ApiDocsResult {
  type: 'api_docs';
  baseUrl?: string;
  endpoints: ApiEndpoint[];
}

export interface UnknownResult {
  type: 'unknown';
}

export type AutoExtractResult =
  | PricingResult
  | ProductsResult
  | ContactResult
  | ArticleResult
  | ApiDocsResult
  | UnknownResult;

// ---------------------------------------------------------------------------
// Page type detection
// ---------------------------------------------------------------------------

const PRICE_INLINE = /(\$|€|£)\s*\d+/;
const FREE_PLAN = /\bfree\b/i;
const HTTP_METHOD_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const URL_PATH_PATTERN = /\/(v\d+\/)?[a-z_-]+(\/{[^}]+}|\/?[a-z_-]*)*\b/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN =
  /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{4,}/g;

/** Extract body text with spaces between elements (prevents regex over-matching adjacent tokens). */
function getBodyText($: CheerioAPI): string {
  const html = $('body').html() || '';
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function urlHas(url: string, ...keywords: string[]): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return keywords.some((kw) => path.includes(kw));
  } catch {
    const lower = url.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }
}

/**
 * Detect the page type from HTML + URL.
 * Returns one of: 'pricing' | 'products' | 'contact' | 'article' | 'api_docs' | 'unknown'
 */
export function detectPageType(html: string, url: string): string {
  const $ = load(html);

  // --- Pricing ---
  if (urlHas(url, '/pricing', '/plans', '/packages', '/tiers', '/billing')) {
    return 'pricing';
  }
  const bodyText = getBodyText($);
  const priceMatches = bodyText.match(/(\$|€|£)\s*\d+/g) || [];
  const perPeriodMatches = bodyText.match(/\/(mo|month|year|yr|annual|week)/gi) || [];
  if (priceMatches.length >= 2 && perPeriodMatches.length >= 1) {
    return 'pricing';
  }

  // --- Contact ---
  if (urlHas(url, '/contact', '/about', '/reach', '/connect', '/support')) {
    const emails = bodyText.match(EMAIL_PATTERN) || [];
    if (emails.length > 0) return 'contact';
  }
  const emails = bodyText.match(EMAIL_PATTERN) || [];
  const phones = bodyText.match(PHONE_PATTERN) || [];
  const socialLinks = $('a[href*="twitter.com"], a[href*="linkedin.com"], a[href*="github.com"]').length;
  if (emails.length > 0 && (phones.length > 0 || socialLinks > 0)) {
    return 'contact';
  }

  // --- Article ---
  const hasArticleTag = $('article').length > 0;
  const hasTimeTag = $('time[datetime], time[pubdate]').length > 0;
  const hasAuthorMeta =
    $('meta[name="author"]').length > 0 ||
    $('[class*="author"], [itemprop="author"]').length > 0;
  if (hasArticleTag || (hasTimeTag && hasAuthorMeta)) {
    return 'article';
  }
  // Single <h1> + multiple paragraphs and a date-ish element
  const h1Count = $('h1').length;
  const paraCount = $('p').length;
  if (h1Count === 1 && paraCount >= 3 && hasTimeTag) {
    return 'article';
  }

  // --- API docs ---
  const codeText = $('code, pre').text();
  const httpMethodHits = (codeText.match(HTTP_METHOD_PATTERN) || []).length;
  const urlPathHits = (codeText.match(URL_PATH_PATTERN) || []).length;
  if (httpMethodHits >= 2 && urlPathHits >= 2) {
    return 'api_docs';
  }
  // Also check for common API doc patterns in normal text
  const headingText = $('h1, h2, h3').text();
  if (
    headingText.match(/endpoint|api reference|rest api|http method/i) &&
    httpMethodHits >= 1
  ) {
    return 'api_docs';
  }

  // --- Products ---
  // Look for repeating card-like structures with prices + images
  const potentialProductContainers = [
    '.product', '.item', '.card', '[class*="product"]', '[class*="item"]', '[class*="card"]',
  ];
  for (const sel of potentialProductContainers) {
    const cards = $(sel);
    if (cards.length >= 3) {
      let withPrice = 0;
      cards.each((_, el) => {
        const text = $(el).text();
        if (PRICE_INLINE.test(text) || FREE_PLAN.test(text)) withPrice++;
      });
      if (withPrice >= 2) return 'products';
    }
  }
  // Fallback: many <img> elements with adjacent prices
  const imgs = $('img').length;
  if (imgs >= 4 && priceMatches.length >= 3) {
    return 'products';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Pricing extractor
// ---------------------------------------------------------------------------

function extractPricingPlans($: CheerioAPI): PricingPlan[] {
  const plans: PricingPlan[] = [];

  // Common pricing card selectors (ordered from specific to broad)
  const containerSelectors = [
    '[class*="pricing-card"]',
    '[class*="price-card"]',
    '[class*="plan-card"]',
    '[class*="tier-card"]',
    '[class*="pricing__plan"]',
    '[class*="plan"]',
    '[class*="pricing-tier"]',
    '[class*="pricing-table"] td',
    '[class*="pricing-table"] th',
    '.card',
    '[class*="col-"]',
  ];

  let containers: ReturnType<CheerioAPI> | null = null;
  for (const sel of containerSelectors) {
    const found = $(sel).filter((_, el) => {
      const text = $(el).text();
      return PRICE_INLINE.test(text) || FREE_PLAN.test(text);
    });
    if (found.length >= 2) {
      containers = found;
      break;
    }
  }

  if (!containers || containers.length === 0) {
    // Last resort: parse entire page for price-like text blocks
    return parsePricingFromText($);
  }

  containers.each((_, el) => {
    try {
      const $el = $(el);
      const text = $el.text().trim();

      // Extract plan name — first heading in the container
      const nameEl = $el.find('h1, h2, h3, h4, h5, h6, [class*="name"], [class*="title"]').first();
      const name = nameEl.text().trim() || 'Plan';

      // Extract price
      const priceMatch = text.match(/(\$|€|£|free)\s*[\d,]+(\.\d+)?/i);
      if (!priceMatch && !FREE_PLAN.test(text)) return; // Skip non-price containers
      const price = FREE_PLAN.test(text) && !priceMatch ? 'Free' : (priceMatch?.[0] ?? '');

      // Extract period
      const periodMatch = text.match(/\/(mo(nth)?|yr|year|week|day|annual)/i);
      const period = periodMatch ? periodMatch[0] : undefined;

      // Extract features from lists
      const features: string[] = [];
      $el.find('li').each((_, li) => {
        const featureText = $(li).text().trim();
        if (featureText && featureText.length < 200) {
          features.push(featureText);
        }
      });

      // Extract CTA button
      const ctaEl = $el
        .find('a, button')
        .filter((_, btn) =>
          /get started|sign up|buy|subscribe|choose|select|try|start|upgrade/i.test($(btn).text()),
        )
        .first();
      const cta = ctaEl.text().trim() || undefined;

      if (name || price) {
        plans.push({ name, price, period, features, cta });
      }
    } catch {
      // Silently skip malformed containers
    }
  });

  return deduplicatePlans(plans);
}

function parsePricingFromText($: CheerioAPI): PricingPlan[] {
  // Fallback: find all price-like elements and group them
  const plans: PricingPlan[] = [];
  const bodyText = getBodyText($);

  const priceRegex = /(\$|€|£)\s*(\d+(?:\.\d+)?)\s*(?:\/(mo(?:nth)?|yr|year|week|annual))?/gi;
  let match;
  const foundPrices: string[] = [];
  while ((match = priceRegex.exec(bodyText)) !== null) {
    foundPrices.push(match[0]);
  }

  // Simple heuristic: each unique price = 1 plan
  const uniquePrices = [...new Set(foundPrices)];
  for (const p of uniquePrices) {
    plans.push({ name: 'Plan', price: p, features: [] });
  }

  return plans;
}

function deduplicatePlans(plans: PricingPlan[]): PricingPlan[] {
  const seen = new Set<string>();
  return plans.filter((p) => {
    const key = `${p.name}|${p.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Products extractor
// ---------------------------------------------------------------------------

function extractProducts($: CheerioAPI, baseUrl: string): ProductItem[] {
  const items: ProductItem[] = [];
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return '';
    }
  })();

  const containerSelectors = [
    '[class*="product"]',
    '[class*="item"]',
    '[class*="card"]',
    'li',
    'article',
  ];

  let containers: ReturnType<CheerioAPI> | null = null;
  for (const sel of containerSelectors) {
    const found = $(sel).filter((_, el) => {
      const text = $(el).text();
      return (PRICE_INLINE.test(text) || FREE_PLAN.test(text)) && $(el).find('img').length > 0;
    });
    if (found.length >= 2) {
      containers = found;
      break;
    }
  }

  if (!containers || containers.length === 0) return items;

  containers.each((_, el) => {
    try {
      const $el = $(el);

      // Name
      const nameEl = $el.find('h1,h2,h3,h4,h5,h6,[class*="name"],[class*="title"]').first();
      const name = nameEl.text().trim();
      if (!name) return;

      // Price
      const priceMatch = $el.text().match(/(\$|€|£)\s*[\d,]+(\.\d+)?/);
      const price = priceMatch ? priceMatch[0].trim() : undefined;

      // Image
      const imgEl = $el.find('img').first();
      const imgSrc = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy');
      const image = imgSrc
        ? imgSrc.startsWith('http')
          ? imgSrc
          : `${origin}${imgSrc.startsWith('/') ? '' : '/'}${imgSrc}`
        : undefined;

      // URL
      const linkEl = $el.find('a').first();
      const href = linkEl.attr('href');
      const url = href
        ? href.startsWith('http')
          ? href
          : `${origin}${href.startsWith('/') ? '' : '/'}${href}`
        : undefined;

      // Rating
      const ratingMatch = $el.text().match(/(\d(\.\d)?)\s*(\/\s*5|stars?|★)/i);
      const rating = ratingMatch ? `${ratingMatch[1]}/5` : undefined;

      items.push({ name, price, image, url, rating });
    } catch {
      // Skip malformed
    }
  });

  return items.slice(0, 100); // cap at 100
}

// ---------------------------------------------------------------------------
// Contact extractor
// ---------------------------------------------------------------------------

const SOCIAL_DOMAINS: Record<string, string> = {
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'linkedin.com': 'linkedin',
  'github.com': 'github',
  'facebook.com': 'facebook',
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
  'discord.gg': 'discord',
  'discord.com': 'discord',
};

const ADDRESS_PATTERN =
  /\d{1,5}\s+[A-Za-z0-9\s,\.]+(?:street|st|avenue|ave|road|rd|blvd|boulevard|lane|ln|drive|dr|court|ct|way|wy|place|pl)\b[^<\n]{0,80}/i;

function extractContact($: CheerioAPI): ContactResult {
  const bodyText = getBodyText($);

  // Emails
  const emailMatches = bodyText.match(EMAIL_PATTERN) || [];
  const emails = [
    ...new Set(emailMatches.map((e) => e.toLowerCase())),
  ];

  // Phones
  const phoneMatches = bodyText.match(PHONE_PATTERN) || [];
  const phones = [...new Set(phoneMatches.map((p) => p.trim()))];

  // Addresses
  const addresses: string[] = [];
  $('[class*="address"], [itemprop="address"], address').each((_, el) => {
    const addr = $( el).text().replace(/\s+/g, ' ').trim();
    if (addr.length > 10) addresses.push(addr);
  });
  // Also regex-based
  const addrMatch = bodyText.match(ADDRESS_PATTERN);
  if (addrMatch) {
    const addr = addrMatch[0].trim();
    if (!addresses.some((a) => a.includes(addr.substring(0, 10)))) {
      addresses.push(addr);
    }
  }

  // Social links
  const social: Record<string, string> = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    for (const [domain, key] of Object.entries(SOCIAL_DOMAINS)) {
      if (href.includes(domain) && !social[key]) {
        social[key] = href;
      }
    }
  });

  return { type: 'contact', emails, phones, addresses, social };
}

// ---------------------------------------------------------------------------
// Article extractor
// ---------------------------------------------------------------------------

function extractArticle($: CheerioAPI): ArticleResult {
  // Title
  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    undefined;

  // Author
  const author =
    $('meta[name="author"]').attr('content') ||
    $('[itemprop="author"]').first().text().trim() ||
    $('[class*="author"]').first().text().trim() ||
    $('[rel="author"]').first().text().trim() ||
    undefined;

  // Date
  const date =
    $('time[datetime]').first().attr('datetime') ||
    $('time[pubdate]').first().attr('datetime') ||
    $('meta[name="date"]').attr('content') ||
    $('meta[property="article:published_time"]').attr('content') ||
    $('time').first().text().trim() ||
    undefined;

  // Reading time
  const readingTimeEl = $('[class*="reading-time"], [class*="read-time"], [class*="readtime"]').first();
  const readingTime = readingTimeEl.length ? readingTimeEl.text().trim() : estimateReadingTime($);

  // Summary (first 2 sentences of article content)
  const articleEl = $('article').first();
  const contentEl = articleEl.length ? articleEl : $('main').first();
  const firstPara =
    contentEl.find('p').first().text().trim() ||
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const summary = firstPara ? extractFirstSentences(firstPara, 2) : undefined;

  // Sections: h2/h3 + following content
  const sections: ArticleSection[] = [];
  const headings = contentEl.find('h2, h3');
  headings.each((_, el) => {
    const heading = $(el).text().trim();
    if (!heading) return;
    // Gather text of next sibling elements until next heading
    const contentParts: string[] = [];
    let sibling = $(el).next();
    while (sibling.length && !sibling.is('h2, h3')) {
      const text = sibling.text().trim();
      if (text) contentParts.push(text);
      sibling = sibling.next();
    }
    if (contentParts.length > 0) {
      sections.push({ heading, content: contentParts.join(' ') });
    }
  });

  return { type: 'article', title, author, date, readingTime, summary, sections };
}

function extractFirstSentences(text: string, count: number): string {
  const sentenceEnd = /[.!?]+\s+/g;
  let match;
  let lastIndex = 0;
  let sentenceCount = 0;
  while ((match = sentenceEnd.exec(text)) !== null) {
    lastIndex = match.index + match[0].length;
    sentenceCount++;
    if (sentenceCount >= count) break;
  }
  return sentenceCount > 0 ? text.slice(0, lastIndex).trim() : text.slice(0, 300).trim();
}

function estimateReadingTime($: CheerioAPI): string {
  const wordsPerMinute = 200;
  const text = $('article, main, [class*="content"], body').first().text();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
  return `${minutes} min`;
}

// ---------------------------------------------------------------------------
// API docs extractor
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function extractApiDocs($: CheerioAPI, url: string): ApiDocsResult {
  const endpoints: ApiEndpoint[] = [];

  // Try to detect base URL from page or URL
  let baseUrl: string | undefined;
  const pageText = getBodyText($);
  const baseUrlMatch = pageText.match(/https?:\/\/api\.[a-zA-Z0-9.-]+/);
  if (baseUrlMatch) {
    baseUrl = baseUrlMatch[0];
  } else {
    try {
      const parsed = new URL(url);
      baseUrl = `${parsed.protocol}//api.${parsed.hostname}`;
    } catch {
      baseUrl = undefined;
    }
  }

  // Strategy 1: Parse code blocks for HTTP method + path patterns
  $('code, pre').each((_, el) => {
    const text = $(el).text().trim();
    const lines = text.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      for (const method of HTTP_METHODS) {
        if (trimmed.startsWith(method + ' ') || trimmed.startsWith(method + '\t')) {
          const rest = trimmed.slice(method.length).trim();
          // Extract path (first URL-like token)
          const pathMatch = rest.match(/^(https?:\/\/[^\s]+|\/[^\s]*)/);
          if (pathMatch) {
            let path = pathMatch[0];
            // Normalize: strip base URL prefix if present
            if (baseUrl && path.startsWith(baseUrl)) {
              path = path.slice(baseUrl.length);
            }
            // Strip query string
            path = path.split('?')[0];

            // Try to find a description — look at nearest heading above this code block
            const description = findNearestHeading($(el)) || undefined;

            endpoints.push({ method, path, description });
          }
        }
      }
    }
  });

  // Strategy 2: Scan for method badges + inline paths in regular text
  $('[class*="method"], [class*="http-method"], .badge, .label').each((_, el) => {
    const methodText = $(el).text().trim().toUpperCase();
    if (!HTTP_METHODS.includes(methodText)) return;

    // Look for adjacent path element
    const siblings = [
      $(el).next('[class*="path"], [class*="endpoint"], [class*="route"], code'),
      $(el).parent().find('code').first(),
    ];
    for (const sibling of siblings) {
      if (sibling.length) {
        const path = sibling.text().trim();
        if (URL_PATH_PATTERN.test(path)) {
          endpoints.push({ method: methodText, path });
          break;
        }
      }
    }
  });

  // Deduplicate by method+path
  const seen = new Set<string>();
  const unique = endpoints.filter((ep) => {
    const key = `${ep.method}:${ep.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { type: 'api_docs', baseUrl, endpoints: unique };
}

function findNearestHeading($el: ReturnType<CheerioAPI>): string | null {
  // Walk backwards through siblings/parents to find closest heading
  let current = $el.prev();
  let depth = 0;
  while (depth < 5) {
    if (current.length === 0) {
      const parent = $el.parent();
      if (!parent.length) break;
      current = parent.prev();
    } else if (current.is('h1,h2,h3,h4,h5,h6')) {
      return current.text().trim();
    } else {
      current = current.prev();
    }
    depth++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * Detect the type of a web page based on HTML content and URL.
 */
export { detectPageType as default };

/**
 * Auto-extract structured data from a web page without an LLM API key.
 */
export function autoExtract(html: string, url: string): AutoExtractResult {
  const type = detectPageType(html, url);
  const $ = load(html);

  try {
    switch (type) {
      case 'pricing':
        return { type: 'pricing', plans: extractPricingPlans($) };

      case 'products':
        return { type: 'products', items: extractProducts($, url) };

      case 'contact':
        return extractContact($);

      case 'article':
        return extractArticle($);

      case 'api_docs':
        return extractApiDocs($, url);

      default:
        return { type: 'unknown' };
    }
  } catch {
    // Return partial/empty result rather than crashing
    switch (type) {
      case 'pricing':
        return { type: 'pricing', plans: [] };
      case 'products':
        return { type: 'products', items: [] };
      case 'contact':
        return { type: 'contact', emails: [], phones: [], addresses: [], social: {} };
      case 'article':
        return { type: 'article', sections: [] };
      case 'api_docs':
        return { type: 'api_docs', endpoints: [] };
      default:
        return { type: 'unknown' };
    }
  }
}
