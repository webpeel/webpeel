/**
 * JSON-LD Structured Data Extractor
 *
 * Extracts and converts JSON-LD (schema.org) data to clean markdown.
 * Handles Recipe, Product, Article, FAQPage, HowTo, Event, LocalBusiness, Review.
 * This is a FIRST-CLASS content source — tried before HTML DOM parsing.
 */

import * as cheerio from 'cheerio';

export interface JsonLdResult {
  found: boolean;
  type: string;     // e.g., "Recipe", "Product", "Article"
  content: string;  // Clean markdown
  title: string;
  data: any;        // Raw parsed JSON-LD
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags from text fields (some sites put HTML in JSON-LD text) */
function stripHtml(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

/** Extract a string value from an object that may be a string or { name, '@value' } */
function str(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return stripHtml(val);
  if (typeof val === 'object') {
    if (val['@value']) return stripHtml(String(val['@value']));
    if (val.name) return stripHtml(val.name);
    if (val.text) return stripHtml(val.text);
  }
  return stripHtml(String(val));
}

/** Extract author name from author field (may be string, object, or array) */
function authorName(author: any): string {
  if (!author) return '';
  if (typeof author === 'string') return stripHtml(author);
  if (Array.isArray(author)) return author.map(a => str(a.name || a)).filter(Boolean).join(', ');
  return str(author.name || author);
}

/**
 * Parse ISO 8601 duration to human-readable string.
 * PT20M → "20 min", PT1H30M → "1 hr 30 min", P2DT3H → "2 days 3 hr"
 */
function parseIso8601Duration(duration: string): string {
  if (!duration || typeof duration !== 'string') return '';
  // Remove the leading P
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return duration;
  const days = parseInt(match[1] || '0', 10);
  const hours = parseInt(match[2] || '0', 10);
  const minutes = parseInt(match[3] || '0', 10);
  const seconds = parseInt(match[4] || '0', 10);

  const parts: string[] = [];
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds && !days && !hours && !minutes) parts.push(`${seconds} sec`);
  return parts.join(' ') || duration;
}

/** Extract availability from schema.org URL like "https://schema.org/InStock" */
function parseAvailability(availability: string): string {
  if (!availability) return '';
  // Extract just the last part after last / or #
  const last = availability.split(/[/#]/).pop() || availability;
  // Convert CamelCase to space-separated: InStock → In Stock
  return last.replace(/([A-Z])/g, ' $1').trim();
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractJsonLd(html: string): JsonLdResult | null {
  const $ = cheerio.load(html);
  const scripts: any[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Handle @graph arrays
      if (parsed['@graph']) {
        scripts.push(...parsed['@graph']);
      } else if (Array.isArray(parsed)) {
        scripts.push(...parsed);
      } else {
        scripts.push(parsed);
      }
    } catch { /* skip malformed JSON-LD */ }
  });

  if (scripts.length === 0) return null;

  // Try each converter in priority order
  for (const item of scripts) {
    const type = item['@type'];
    if (!type) continue;

    const typeStr = Array.isArray(type) ? type[0] : type;

    switch (typeStr) {
      case 'Recipe': {
        const r = convertRecipe(item);
        if (r) return r;
        break;
      }
      case 'Product': {
        const r = convertProduct(item);
        if (r) return r;
        break;
      }
      case 'Article':
      case 'NewsArticle':
      case 'BlogPosting':
      case 'TechArticle': {
        const r = convertArticle(item);
        if (r) return r;
        break;
      }
      case 'FAQPage': {
        const r = convertFAQ(item);
        if (r) return r;
        break;
      }
      case 'HowTo': {
        const r = convertHowTo(item);
        if (r) return r;
        break;
      }
      case 'Event': {
        const r = convertEvent(item);
        if (r) return r;
        break;
      }
      case 'LocalBusiness':
      case 'Restaurant':
      case 'Store': {
        const r = convertLocalBusiness(item);
        if (r) return r;
        break;
      }
      case 'Review': {
        const r = convertReview(item);
        if (r) return r;
        break;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function convertRecipe(item: any): JsonLdResult | null {
  const name = str(item.name);
  const ingredients: string[] = Array.isArray(item.recipeIngredient)
    ? item.recipeIngredient.map((i: any) => str(i)).filter(Boolean)
    : [];

  // Require at minimum a name and at least one ingredient
  if (!name || ingredients.length === 0) return null;

  // Parse instructions — can be string[], HowToStep[], or HowToSection[]
  const rawInstructions = item.recipeInstructions;
  const instructions: string[] = [];
  if (rawInstructions) {
    const list = Array.isArray(rawInstructions) ? rawInstructions : [rawInstructions];
    for (const inst of list) {
      if (typeof inst === 'string') {
        const t = stripHtml(inst);
        if (t) instructions.push(t);
      } else if (inst['@type'] === 'HowToStep') {
        const t = str(inst.text || inst.name);
        if (t) instructions.push(t);
      } else if (inst['@type'] === 'HowToSection') {
        // Section with nested steps
        const steps = Array.isArray(inst.itemListElement) ? inst.itemListElement : [];
        for (const step of steps) {
          const t = str(step.text || step.name);
          if (t) instructions.push(t);
        }
      }
    }
  }

  const description = str(item.description);
  const prepTime = item.prepTime ? parseIso8601Duration(item.prepTime) : '';
  const cookTime = item.cookTime ? parseIso8601Duration(item.cookTime) : '';
  const totalTime = item.totalTime ? parseIso8601Duration(item.totalTime) : '';
  const recipeYield = str(item.recipeYield);

  // Nutrition
  const nutrition = item.nutrition || {};
  const calories = str(nutrition.calories);
  const fat = str(nutrition.fatContent);
  const protein = str(nutrition.proteinContent);
  const carbs = str(nutrition.carbohydrateContent);

  // Rating
  const rating = item.aggregateRating;
  const ratingValue = rating ? str(rating.ratingValue) : '';
  const ratingCount = rating ? str(rating.ratingCount || rating.reviewCount) : '';

  // Author
  const author = authorName(item.author);

  const lines: string[] = [];

  lines.push(`# ${name}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  // Times row
  const timeParts: string[] = [];
  if (prepTime) timeParts.push(`**Prep Time:** ${prepTime}`);
  if (cookTime) timeParts.push(`**Cook Time:** ${cookTime}`);
  if (totalTime) timeParts.push(`**Total:** ${totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(' | '));
  }

  const yieldParts: string[] = [];
  if (recipeYield) yieldParts.push(`**Servings:** ${recipeYield}`);
  if (calories) yieldParts.push(`**Calories:** ${calories}`);
  if (yieldParts.length > 0) {
    lines.push(yieldParts.join(' | '));
  }

  if (timeParts.length > 0 || yieldParts.length > 0) lines.push('');

  // Ingredients
  lines.push('## Ingredients');
  for (const ing of ingredients) {
    lines.push(`- ${ing}`);
  }
  lines.push('');

  // Instructions
  if (instructions.length > 0) {
    lines.push('## Instructions');
    instructions.forEach((inst, i) => {
      lines.push(`${i + 1}. ${inst}`);
    });
    lines.push('');
  }

  // Nutrition section
  const nutritionParts: string[] = [];
  if (calories) nutritionParts.push(`Calories: ${calories}`);
  if (fat) nutritionParts.push(`Fat: ${fat}`);
  if (protein) nutritionParts.push(`Protein: ${protein}`);
  if (carbs) nutritionParts.push(`Carbs: ${carbs}`);
  if (nutritionParts.length > 0) {
    lines.push('## Nutrition');
    lines.push(nutritionParts.join(' | '));
    lines.push('');
  }

  // Footer
  const footerParts: string[] = [];
  if (author) footerParts.push(`Source: ${author}`);
  if (ratingValue) {
    const ratingStr = ratingCount ? `Rating: ${ratingValue}/5 (${ratingCount} reviews)` : `Rating: ${ratingValue}/5`;
    footerParts.push(ratingStr);
  }
  if (footerParts.length > 0) {
    lines.push(`*${footerParts.join(' | ')}*`);
  }

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: 'Recipe',
    content,
    title: name,
    data: item,
  };
}

function convertProduct(item: any): JsonLdResult | null {
  const name = str(item.name);
  if (!name) return null;

  const description = str(item.description);
  const brand = item.brand ? str(item.brand.name || item.brand) : '';
  const sku = str(item.sku || item.mpn);

  // Handle offers as single object or array (take lowest price)
  let price = '';
  let currency = '';
  let availability = '';
  if (item.offers) {
    const offersArr = Array.isArray(item.offers) ? item.offers : [item.offers];
    let lowestPrice = Infinity;
    let lowestOffer: any = offersArr[0];
    for (const offer of offersArr) {
      const p = parseFloat(str(offer.price));
      if (!isNaN(p) && p < lowestPrice) {
        lowestPrice = p;
        lowestOffer = offer;
      }
    }
    price = str(lowestOffer.price);
    currency = str(lowestOffer.priceCurrency);
    availability = lowestOffer.availability ? parseAvailability(str(lowestOffer.availability)) : '';
  }

  const rating = item.aggregateRating;
  const ratingValue = rating ? str(rating.ratingValue) : '';
  const ratingCount = rating ? str(rating.reviewCount || rating.ratingCount) : '';

  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  if (price) {
    lines.push(`**Price:** ${price}${currency ? ' ' + currency : ''}`);
  }
  if (availability) {
    lines.push(`**Availability:** ${availability}`);
  }
  if (brand) {
    lines.push(`**Brand:** ${brand}`);
  }
  if (ratingValue) {
    const ratingStr = ratingCount ? `${ratingValue}/5 (${ratingCount} reviews)` : `${ratingValue}/5`;
    lines.push(`**Rating:** ${ratingStr}`);
  }
  if (sku) {
    lines.push(`**SKU:** ${sku}`);
  }

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: 'Product',
    content,
    title: name,
    data: item,
  };
}

function convertArticle(item: any): JsonLdResult | null {
  const headline = str(item.headline || item.name);
  if (!headline) return null;

  const articleBody = str(item.articleBody);
  // If articleBody is missing, return null (let HTML pipeline handle it)
  if (!articleBody) return null;

  const author = authorName(item.author);
  const datePublished = str(item.datePublished);
  const dateModified = str(item.dateModified);
  const typeStr = Array.isArray(item['@type']) ? item['@type'][0] : (item['@type'] || 'Article');

  const lines: string[] = [];
  lines.push(`# ${headline}`);
  lines.push('');

  const metaParts: string[] = [];
  if (author) metaParts.push(`By ${author}`);
  if (datePublished) metaParts.push(`Published: ${datePublished}`);
  if (dateModified) metaParts.push(`Modified: ${dateModified}`);
  if (metaParts.length > 0) {
    lines.push(`*${metaParts.join(' | ')}*`);
    lines.push('');
  }

  lines.push(articleBody);

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: typeStr,
    content,
    title: headline,
    data: item,
  };
}

function convertFAQ(item: any): JsonLdResult | null {
  const mainEntity = Array.isArray(item.mainEntity) ? item.mainEntity : [];
  if (mainEntity.length === 0) return null;

  const lines: string[] = [];
  lines.push('# Frequently Asked Questions');
  lines.push('');

  for (const q of mainEntity) {
    const question = str(q.name);
    const answer = q.acceptedAnswer ? str(q.acceptedAnswer.text) : '';
    if (!question) continue;
    lines.push(`## ${question}`);
    if (answer) {
      lines.push(answer);
    }
    lines.push('');
  }

  const content = lines.join('\n').trim();
  if (content.length < 50) return null;

  return {
    found: true,
    type: 'FAQPage',
    content,
    title: 'Frequently Asked Questions',
    data: item,
  };
}

function convertHowTo(item: any): JsonLdResult | null {
  const name = str(item.name);
  if (!name) return null;

  const description = str(item.description);

  // Collect steps from step or itemListElement
  const stepsRaw = item.step || item.itemListElement || [];
  const steps: string[] = [];
  const stepsList = Array.isArray(stepsRaw) ? stepsRaw : [stepsRaw];
  for (const step of stepsList) {
    if (typeof step === 'string') {
      const t = stripHtml(step);
      if (t) steps.push(t);
    } else if (step['@type'] === 'HowToStep') {
      const t = str(step.text || step.name);
      if (t) steps.push(t);
    } else if (step['@type'] === 'HowToSection') {
      const nested = Array.isArray(step.itemListElement) ? step.itemListElement : [];
      for (const s of nested) {
        const t = str(s.text || s.name);
        if (t) steps.push(t);
      }
    }
  }

  if (steps.length === 0) return null;

  const totalTime = item.totalTime ? parseIso8601Duration(item.totalTime) : '';
  const estimatedCost = item.estimatedCost ? str(item.estimatedCost.value || item.estimatedCost) : '';

  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  if (totalTime) lines.push(`**Total Time:** ${totalTime}`);
  if (estimatedCost) lines.push(`**Estimated Cost:** ${estimatedCost}`);
  if (totalTime || estimatedCost) lines.push('');

  lines.push('## Steps');
  steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: 'HowTo',
    content,
    title: name,
    data: item,
  };
}

function convertEvent(item: any): JsonLdResult | null {
  const name = str(item.name);
  if (!name) return null;

  const description = str(item.description);
  const startDate = str(item.startDate);
  const endDate = str(item.endDate);
  const location = item.location ? str(item.location.name || item.location.address || item.location) : '';
  const organizer = item.organizer ? str(item.organizer.name || item.organizer) : '';
  const url = str(item.url);

  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  if (startDate) lines.push(`**Date:** ${startDate}${endDate ? ' – ' + endDate : ''}`);
  if (location) lines.push(`**Location:** ${location}`);
  if (organizer) lines.push(`**Organizer:** ${organizer}`);
  if (url) lines.push(`**URL:** ${url}`);

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: 'Event',
    content,
    title: name,
    data: item,
  };
}

function convertLocalBusiness(item: any): JsonLdResult | null {
  const name = str(item.name);
  if (!name) return null;

  const description = str(item.description);
  const typeStr = Array.isArray(item['@type']) ? item['@type'][0] : (item['@type'] || 'LocalBusiness');

  // Address
  const addr = item.address;
  let address = '';
  if (addr) {
    if (typeof addr === 'string') {
      address = addr;
    } else {
      const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].filter(Boolean);
      address = parts.join(', ');
    }
  }

  const phone = str(item.telephone);
  const url = str(item.url);
  const priceRange = str(item.priceRange);
  const servesCuisine = item.servesCuisine ? (Array.isArray(item.servesCuisine) ? item.servesCuisine.join(', ') : str(item.servesCuisine)) : '';

  const rating = item.aggregateRating;
  const ratingValue = rating ? str(rating.ratingValue) : '';
  const ratingCount = rating ? str(rating.reviewCount || rating.ratingCount) : '';

  // Hours
  const hours = item.openingHours;
  let hoursStr = '';
  if (hours) {
    hoursStr = Array.isArray(hours) ? hours.join(', ') : str(hours);
  }

  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  if (address) lines.push(`**Address:** ${address}`);
  if (phone) lines.push(`**Phone:** ${phone}`);
  if (url) lines.push(`**Website:** ${url}`);
  if (priceRange) lines.push(`**Price Range:** ${priceRange}`);
  if (servesCuisine) lines.push(`**Cuisine:** ${servesCuisine}`);
  if (hoursStr) lines.push(`**Hours:** ${hoursStr}`);
  if (ratingValue) {
    const ratingStr = ratingCount ? `${ratingValue}/5 (${ratingCount} reviews)` : `${ratingValue}/5`;
    lines.push(`**Rating:** ${ratingStr}`);
  }

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: typeStr,
    content,
    title: name,
    data: item,
  };
}

function convertReview(item: any): JsonLdResult | null {
  const itemReviewed = item.itemReviewed ? str(item.itemReviewed.name || item.itemReviewed) : '';
  const author = authorName(item.author);
  const reviewBody = str(item.reviewBody);
  if (!reviewBody) return null;

  const ratingValue = item.reviewRating ? str(item.reviewRating.ratingValue) : '';
  const bestRating = item.reviewRating ? str(item.reviewRating.bestRating || '5') : '5';
  const datePublished = str(item.datePublished);

  const title = itemReviewed ? `Review: ${itemReviewed}` : (author ? `Review by ${author}` : 'Review');

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');

  const metaParts: string[] = [];
  if (author) metaParts.push(`By ${author}`);
  if (ratingValue) metaParts.push(`Rating: ${ratingValue}/${bestRating}`);
  if (datePublished) metaParts.push(datePublished);
  if (metaParts.length > 0) {
    lines.push(`*${metaParts.join(' | ')}*`);
    lines.push('');
  }

  lines.push(reviewBody);

  const content = lines.join('\n').trim();
  return {
    found: true,
    type: 'Review',
    content,
    title,
    data: item,
  };
}
