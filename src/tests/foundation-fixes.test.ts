import { describe, it, expect } from 'vitest';
import { extractJsonLd } from '../core/json-ld.js';
import { peel } from '../index.js';

describe('JSON-LD extraction', () => {
  it('should extract Recipe from JSON-LD', () => {
    const html = `<html><head>
    <script type="application/ld+json">{
      "@type": "Recipe",
      "name": "Chocolate Chip Cookies",
      "description": "Classic cookies everyone loves",
      "prepTime": "PT20M",
      "cookTime": "PT12M",
      "recipeYield": "24 cookies",
      "recipeIngredient": ["2 cups flour", "1 cup butter", "1 cup sugar", "2 eggs", "1 cup chocolate chips"],
      "recipeInstructions": [
        {"@type": "HowToStep", "text": "Preheat oven to 375°F."},
        {"@type": "HowToStep", "text": "Mix flour and butter."},
        {"@type": "HowToStep", "text": "Add chocolate chips and bake for 12 minutes."}
      ],
      "nutrition": {"calories": "200 calories"},
      "author": {"@type": "Person", "name": "Jane Baker"},
      "aggregateRating": {"ratingValue": "4.8", "ratingCount": "1234"}
    }</script>
    </head><body><p>Some page content</p></body></html>`;

    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Recipe');
    expect(result!.content).toContain('Chocolate Chip Cookies');
    expect(result!.content).toContain('2 cups flour');
    expect(result!.content).toContain('Preheat oven');
    expect(result!.content).toContain('20 min');
    expect(result!.content).toContain('4.8');
  });

  it('should extract Product from JSON-LD', () => {
    const html = `<html><head>
    <script type="application/ld+json">{
      "@type": "Product",
      "name": "AirPods Pro",
      "description": "Active noise cancellation headphones",
      "brand": {"@type": "Brand", "name": "Apple"},
      "offers": {"@type": "Offer", "price": "249.99", "priceCurrency": "USD", "availability": "https://schema.org/InStock"},
      "aggregateRating": {"ratingValue": "4.7", "reviewCount": "5678"},
      "sku": "MTJV3AM/A"
    }</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Product');
    expect(result!.content).toContain('AirPods Pro');
    expect(result!.content).toContain('249.99');
    expect(result!.content).toContain('Apple');
    expect(result!.content).toContain('In Stock');
  });

  it('should extract Article from JSON-LD', () => {
    const html = `<html><head>
    <script type="application/ld+json">{
      "@type": "NewsArticle",
      "headline": "Breaking: AI Advances",
      "author": {"@type": "Person", "name": "John Smith"},
      "datePublished": "2026-02-24",
      "articleBody": "Artificial intelligence continues to advance rapidly. Researchers announced new breakthroughs today."
    }</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('NewsArticle');
    expect(result!.content).toContain('Breaking: AI Advances');
    expect(result!.content).toContain('John Smith');
    expect(result!.content).toContain('advance rapidly');
  });

  it('should extract FAQPage from JSON-LD', () => {
    const html = `<html><head>
    <script type="application/ld+json">{
      "@type": "FAQPage",
      "mainEntity": [
        {"@type": "Question", "name": "What is WebPeel?", "acceptedAnswer": {"@type": "Answer", "text": "A web fetcher for AI agents."}},
        {"@type": "Question", "name": "Is it free?", "acceptedAnswer": {"@type": "Answer", "text": "Yes, 500 requests per week."}}
      ]
    }</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('FAQPage');
    expect(result!.content).toContain('What is WebPeel');
    expect(result!.content).toContain('web fetcher');
    expect(result!.content).toContain('500 requests');
  });

  it('should handle @graph arrays', () => {
    const html = `<html><head>
    <script type="application/ld+json">{
      "@graph": [
        {"@type": "WebSite", "name": "Example"},
        {"@type": "Recipe", "name": "Test Recipe", "recipeIngredient": ["flour", "sugar"], "recipeInstructions": ["Mix all"]}
      ]
    }</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Recipe');
  });

  it('should return null when no supported JSON-LD found', () => {
    const html = `<html><head>
    <script type="application/ld+json">{"@type": "WebSite", "name": "Example"}</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).toBeNull();
  });

  it('should handle malformed JSON-LD gracefully', () => {
    const html = `<html><head>
    <script type="application/ld+json">{broken json here</script>
    </head><body></body></html>`;

    const result = extractJsonLd(html);
    expect(result).toBeNull();
  });
});

describe('Zero-token safety net', () => {
  it('should never return 0 tokens for a real URL', async () => {
    // Use a URL that previously returned 0 tokens without JSON-LD
    const result = await peel('https://httpbin.org/html');
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.content.length).toBeGreaterThan(0);
  }, 15000);

  it('should fall back to meta description when content is empty', async () => {
    // peel a page that has meta tags but might have empty body
    const result = await peel('https://httpbin.org/html');
    expect(result.content).toBeTruthy();
  }, 15000);
});
