/**
 * Schema-based extraction using CSS selectors.
 *
 * Each schema defines how to extract listings from a specific domain,
 * inspired by Crawl4AI's JsonCssExtractionStrategy. Unlike generic
 * auto-detection, schemas provide exact selectors for each site's DOM.
 *
 * @module schema-extraction
 */

import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

/* ------------------------------------------------------------------ */
/*  Public types                                                        */
/* ------------------------------------------------------------------ */

export interface SchemaField {
  /** Field name in output (e.g., "title", "price", "rating") */
  name: string;
  /** CSS selector relative to baseSelector. Empty string selects the base element itself. */
  selector: string;
  /** What to extract */
  type: 'text' | 'attribute' | 'html' | 'exists';
  /** For type='attribute', which attribute to read */
  attribute?: string;
  /** Extract all matches (returns array instead of first match) */
  multiple?: boolean;
  /** Optional transform to apply after extraction */
  transform?: 'trim' | 'number' | 'stripCurrency';
}

export interface ExtractionSchema {
  /** Human-readable schema name (e.g., "Booking.com Hotel Search") */
  name: string;
  /** Schema version string */
  version: string;
  /** Matching domains (e.g., ["booking.com", "www.booking.com"]) */
  domains: string[];
  /** Optional URL path patterns (regex strings) for more specific matching */
  urlPatterns?: string[];
  /** CSS selector for each listing item */
  baseSelector: string;
  /** Fields to extract from each item */
  fields: SchemaField[];
  /** Optional pagination config */
  pagination?: {
    nextSelector?: string;
    pageParam?: string;
  };
}

/** A single extracted item — field names map to extracted values */
export interface ExtractedItem {
  [key: string]: string | string[] | boolean | number | undefined;
}

/* ------------------------------------------------------------------ */
/*  Bundled schemas (hardcoded to avoid JSON import complications)     */
/* ------------------------------------------------------------------ */

const BOOKING_COM_SCHEMA: ExtractionSchema = {
  name: 'Booking.com Hotel Search',
  version: '1.0',
  domains: ['booking.com', 'www.booking.com'],
  urlPatterns: ['searchresults'],
  baseSelector: "[data-testid='property-card']",
  fields: [
    { name: 'title', selector: "[data-testid='title'], .sr-hotel__name, h3 a", type: 'text' },
    { name: 'price', selector: "[data-testid='price-and-discounted-price'], .bui-price-display__value, [data-testid='price-for-x-nights']", type: 'text', transform: 'trim' },
    { name: 'rating', selector: "[data-testid='review-score'] div:first-child, .bui-review-score__badge", type: 'text' },
    { name: 'reviewCount', selector: "[data-testid='review-score'] div:nth-child(2) div:nth-child(2), .bui-review-score__text", type: 'text' },
    { name: 'location', selector: "[data-testid='address'], .sr_card_address_line", type: 'text' },
    { name: 'link', selector: "a[data-testid='title-link'], h3 a, a.hotel_name_link", type: 'attribute', attribute: 'href' },
    { name: 'image', selector: "img[data-testid='image'], img.hotel_image", type: 'attribute', attribute: 'src' },
    { name: 'stars', selector: "[data-testid='rating-stars'] span, .bui-star-rating .bui-star-rating__star", type: 'text' },
  ],
};

const AMAZON_COM_SCHEMA: ExtractionSchema = {
  name: 'Amazon Product Search',
  version: '1.0',
  domains: ['amazon.com', 'www.amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca'],
  urlPatterns: ['/s\\?', '/s/'],
  baseSelector: "[data-component-type='s-search-result']",
  fields: [
    { name: 'title', selector: 'h2 a span, h2 span a span', type: 'text' },
    { name: 'price', selector: '.a-price .a-offscreen', type: 'text' },
    { name: 'originalPrice', selector: '.a-price.a-text-price .a-offscreen', type: 'text' },
    { name: 'rating', selector: '.a-icon-star-small .a-icon-alt, .a-icon-star-mini .a-icon-alt', type: 'text' },
    { name: 'reviewCount', selector: "[data-csa-c-func-deps='aui-da-a-popover'] ~ span span, .a-size-base.s-underline-text", type: 'text' },
    { name: 'link', selector: 'h2 a', type: 'attribute', attribute: 'href' },
    { name: 'image', selector: '.s-image', type: 'attribute', attribute: 'src' },
    { name: 'sponsored', selector: '.puis-sponsored-label-text', type: 'exists' },
    { name: 'asin', selector: '', type: 'attribute', attribute: 'data-asin' },
  ],
};

const EBAY_COM_SCHEMA: ExtractionSchema = {
  name: 'eBay Search Results',
  version: '1.0',
  domains: ['ebay.com', 'www.ebay.com'],
  urlPatterns: ['/sch/'],
  baseSelector: '.s-item, [data-viewport]',
  fields: [
    { name: 'title', selector: '.s-item__title span, .s-item__title', type: 'text' },
    { name: 'price', selector: '.s-item__price', type: 'text' },
    { name: 'link', selector: '.s-item__link, a.s-item__link', type: 'attribute', attribute: 'href' },
    { name: 'image', selector: '.s-item__image-wrapper img, .s-item__image img', type: 'attribute', attribute: 'src' },
    { name: 'condition', selector: '.SECONDARY_INFO', type: 'text' },
    { name: 'shipping', selector: '.s-item__shipping, .s-item__freeXDays', type: 'text' },
    { name: 'seller', selector: '.s-item__seller-info-text', type: 'text' },
  ],
};

const YELP_COM_SCHEMA: ExtractionSchema = {
  name: 'Yelp Business Search',
  version: '1.0',
  domains: ['yelp.com', 'www.yelp.com'],
  urlPatterns: ['/search'],
  baseSelector: "[data-testid='serp-ia-card'], li.border-color--default",
  fields: [
    { name: 'title', selector: "a[href*='/biz/'] span, h3 a span", type: 'text' },
    { name: 'rating', selector: "[aria-label*='star rating'], .i-stars", type: 'attribute', attribute: 'aria-label' },
    { name: 'reviewCount', selector: ".reviewCount, span[class*='css-']", type: 'text' },
    { name: 'price', selector: '.priceRange, span.priceRange', type: 'text' },
    { name: 'category', selector: ".priceCategory span, p[class*='css-'] a", type: 'text' },
    { name: 'link', selector: "a[href*='/biz/']", type: 'attribute', attribute: 'href' },
    { name: 'address', selector: "address, span[class*='css-']", type: 'text' },
  ],
};

const WALMART_COM_SCHEMA: ExtractionSchema = {
  name: 'Walmart Product Search',
  version: '1.0',
  domains: ['walmart.com', 'www.walmart.com'],
  urlPatterns: ['/search'],
  baseSelector: "[data-testid='list-view'] > div, [data-item-id]",
  fields: [
    { name: 'title', selector: "a[link-identifier] span, [data-automation-id='product-title']", type: 'text' },
    { name: 'price', selector: "[data-automation-id='product-price'] .f2, [itemprop='price']", type: 'text' },
    { name: 'rating', selector: "[data-testid='product-ratings'] .w_iUH7, .stars-reviews-count", type: 'text' },
    { name: 'link', selector: "a[link-identifier], a[href*='/ip/']", type: 'attribute', attribute: 'href' },
    { name: 'image', selector: "img[data-testid='productTileImage'], img[loading]", type: 'attribute', attribute: 'src' },
    { name: 'seller', selector: "[data-automation-id='fulfillment-badge']", type: 'text' },
  ],
};

const HACKERNEWS_SCHEMA: ExtractionSchema = {
  name: 'Hacker News',
  version: '1.0',
  domains: ['news.ycombinator.com'],
  baseSelector: 'tr.athing',
  fields: [
    { name: 'title', selector: '.titleline a', type: 'text' },
    { name: 'link', selector: '.titleline a', type: 'attribute', attribute: 'href' },
    { name: 'rank', selector: '.rank', type: 'text' },
    { name: 'site', selector: '.sitestr', type: 'text' },
  ],
};

const EXPEDIA_COM_SCHEMA: ExtractionSchema = {
  name: 'Expedia Hotel Search',
  version: '1.0',
  domains: ['expedia.com', 'www.expedia.com'],
  urlPatterns: ['Hotel-Search', 'hotel-search'],
  baseSelector: "[data-stid='property-listing'], li.uitk-spacing[class*='uitk-spacing'], [data-stid='lodging-card-responsive']",
  fields: [
    { name: 'title', selector: "[data-stid='content-hotel-title'], .uitk-heading-5, .uitk-heading-6, h3[class*='uitk-heading']", type: 'text' },
    { name: 'price', selector: "[data-stid='price-summary'] .uitk-type-500, [data-stid='price-summary-message-total'], .uitk-type-500", type: 'text', transform: 'trim' },
    { name: 'rating', selector: "[data-stid='star-rating-msg'], .uitk-badge-base, [aria-label*='out of']", type: 'text' },
    { name: 'reviewCount', selector: "[data-stid='review-info-text'], .uitk-type-200", type: 'text' },
    { name: 'location', selector: "[data-stid='location-info'], [data-stid='neighborhood-name']", type: 'text' },
    { name: 'link', selector: "a[data-stid='open-hotel-information'], a[href*='/h/'], a.uitk-card-link", type: 'attribute', attribute: 'href' },
    { name: 'image', selector: "img[data-stid='image'], .uitk-image-media img", type: 'attribute', attribute: 'src' },
  ],
};

/** All bundled schemas in priority order */
const BUNDLED_SCHEMAS: ExtractionSchema[] = [
  BOOKING_COM_SCHEMA,
  AMAZON_COM_SCHEMA,
  EBAY_COM_SCHEMA,
  YELP_COM_SCHEMA,
  WALMART_COM_SCHEMA,
  HACKERNEWS_SCHEMA,
  EXPEDIA_COM_SCHEMA,
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Apply a transform to an extracted string value.
 */
function applyTransform(value: string, transform: SchemaField['transform']): string | number {
  if (!transform) return value;
  switch (transform) {
    case 'trim':
      return value.trim();
    case 'number': {
      const num = parseFloat(value.replace(/[^\d.]/g, ''));
      return isNaN(num) ? value : num;
    }
    case 'stripCurrency':
      return value.replace(/[^\d.,]/g, '').trim();
    default:
      return value;
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(href: string | undefined, baseUrl?: string): string | undefined {
  if (!href) return undefined;
  if (href.startsWith('data:') || href.startsWith('javascript:')) return undefined;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * Extract a single field value from a cheerio element.
 */
function extractFieldValue(
  $: CheerioAPI,
  $el: Cheerio<AnyNode>,
  field: SchemaField,
  baseUrl?: string,
): string | string[] | boolean | number | undefined {
  // For empty selector on attribute type, read from the base element itself
  const useBaseEl = field.selector === '' || field.selector.trim() === '';

  if (field.multiple && !useBaseEl) {
    // Collect all matches
    const results: string[] = [];
    $el.find(field.selector).each((_, el) => {
      const $match = $(el);
      let val: string | undefined;
      switch (field.type) {
        case 'text':
          val = $match.text().trim();
          break;
        case 'attribute':
          val = field.attribute ? ($match.attr(field.attribute) ?? undefined) : undefined;
          if (field.attribute === 'href' || field.attribute === 'src') {
            val = resolveUrl(val, baseUrl);
          }
          break;
        case 'html':
          val = $match.html() ?? undefined;
          break;
        case 'exists':
          // not meaningful for multiple
          break;
      }
      if (val !== undefined && val !== '') results.push(val);
    });
    return results.length > 0 ? results : undefined;
  }

  // Single match mode
  const $target = useBaseEl ? $el : $el.find(field.selector).first();

  switch (field.type) {
    case 'exists':
      return useBaseEl ? true : $el.find(field.selector).length > 0;

    case 'text': {
      if (!useBaseEl && $target.length === 0) return undefined;
      const text = $target.text().trim();
      if (text === '') return undefined;
      const transformed = applyTransform(text, field.transform);
      return transformed;
    }

    case 'attribute': {
      if (!field.attribute) return undefined;
      const attrVal = $target.attr(field.attribute) ?? undefined;
      if (attrVal === undefined) return undefined;
      if (field.attribute === 'href' || field.attribute === 'src') {
        const resolved = resolveUrl(attrVal, baseUrl);
        if (!resolved) return undefined;
        return applyTransform(resolved, field.transform) as string;
      }
      return applyTransform(attrVal, field.transform) as string;
    }

    case 'html': {
      if (!useBaseEl && $target.length === 0) return undefined;
      return $target.html() ?? undefined;
    }

    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Load all bundled schemas.
 */
export function loadBundledSchemas(): ExtractionSchema[] {
  return [...BUNDLED_SCHEMAS];
}

/**
 * Find a matching schema for a given URL.
 *
 * Matches by domain first, then optionally by URL patterns (regex).
 * Returns the first matching schema or null.
 */
export function findSchemaForUrl(url: string): ExtractionSchema | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const fullUrl = url;

  for (const schema of BUNDLED_SCHEMAS) {
    // Check domain match
    const domainMatch = schema.domains.some(domain => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith('.' + d) || d.endsWith('.' + hostname);
    });

    if (!domainMatch) continue;

    // If no urlPatterns, domain match is enough
    if (!schema.urlPatterns || schema.urlPatterns.length === 0) {
      return schema;
    }

    // Check URL patterns against the full URL
    const patternMatch = schema.urlPatterns.some(pattern => {
      try {
        return new RegExp(pattern).test(fullUrl);
      } catch {
        return false;
      }
    });

    if (patternMatch) return schema;
  }

  return null;
}

/**
 * Extract listings from HTML using a schema's CSS selectors.
 *
 * @param html    - Raw HTML string to parse
 * @param schema  - Extraction schema to use
 * @param baseUrl - Optional base URL for resolving relative links
 * @returns Array of extracted items (may be empty)
 */
export function extractWithSchema(
  html: string,
  schema: ExtractionSchema,
  baseUrl?: string,
): ExtractedItem[] {
  if (!html || html.trim().length === 0) return [];

  const $ = load(html);
  const items: ExtractedItem[] = [];

  // Find the title/name field to use for filtering empty items
  const titleFieldName = schema.fields.find(
    f => f.name === 'title' || f.name === 'name',
  )?.name;

  $(schema.baseSelector).each((_, el) => {
    const $el = $(el);
    const item: ExtractedItem = {};

    for (const field of schema.fields) {
      const value = extractFieldValue($, $el, field, baseUrl);
      if (value !== undefined) {
        item[field.name] = value;
      }
    }

    // Clean title/name field: strip common junk suffixes (e.g., "Opens in new window")
    if (titleFieldName !== undefined && typeof item[titleFieldName] === 'string') {
      let title = item[titleFieldName] as string;
      // Strip "Opens in (a) new window/tab" variants
      title = title.replace(/\s*Opens?\s+in\s+(?:a\s+)?new\s+(?:window|tab)(?:\s+or\s+(?:window|tab))?/gi, '');
      // Strip "New Listing", "Sponsored", "Ad" prefixes
      title = title.replace(/^(?:New\s+Listing|Sponsored|Ad)\s*[-–—:·]?\s*/i, '');
      item[titleFieldName] = title.trim();
    }

    // Skip items with no title/name (likely empty/phantom elements)
    if (titleFieldName !== undefined) {
      const titleVal = item[titleFieldName];
      if (!titleVal || (typeof titleVal === 'string' && titleVal.trim() === '')) {
        return; // skip
      }
    }

    // Skip completely empty items
    if (Object.keys(item).length === 0) return;

    items.push(item);
  });

  // Deduplicate: remove items with identical title + price (common with nested selectors)
  if (titleFieldName) {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = `${String(item[titleFieldName] ?? '')}|${String(item.price ?? '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return items;
}
