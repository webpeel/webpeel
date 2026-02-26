import { describe, it, expect } from 'vitest';
import { extractValueFromPassage, smartExtractSchemaFields } from '../core/schema-postprocess.js';

describe('extractValueFromPassage', () => {
  describe('price extraction', () => {
    it('extracts dollar amount', () => {
      expect(extractValueFromPassage('The iPhone 16 costs $799 and is available now', 'price')).toBe('$799');
    });
    it('extracts dollar amount with cents', () => {
      expect(extractValueFromPassage('Price: $1,299.99 for the Pro model', 'price')).toBe('$1,299.99');
    });
    it('extracts euro amount', () => {
      expect(extractValueFromPassage('The price is €599 in Europe', 'price')).toBe('€599');
    });
    it('extracts "starting at" price', () => {
      expect(extractValueFromPassage('Starting at $9.99 per month', 'price')).toContain('$9.99');
    });
  });

  describe('date extraction', () => {
    it('extracts ISO date', () => {
      expect(extractValueFromPassage('Published 2023-11-21\n\n5 min read', 'date')).toBe('2023-11-21');
    });
    it('extracts written date', () => {
      expect(extractValueFromPassage('Published on November 21, 2023 by the team', 'date')).toBe('November 21, 2023');
    });
    it('extracts short month date', () => {
      expect(extractValueFromPassage('Last updated Jan 5, 2024', 'date')).toBe('Jan 5, 2024');
    });
  });

  describe('author extraction', () => {
    it('extracts "by Author" pattern', () => {
      expect(extractValueFromPassage('Written by John Smith on the Cloudflare blog', 'author')).toBe('John Smith');
    });
    it('extracts "author: Name" pattern', () => {
      expect(extractValueFromPassage('Author: Jane Doe | Published: 2023', 'author')).toBe('Jane Doe');
    });
  });

  describe('title extraction', () => {
    it('extracts from heading', () => {
      expect(extractValueFromPassage('# Workers AI Update: Hello, Mistral 7B!\n\n2023-11-21', 'title')).toBe('Workers AI Update: Hello, Mistral 7B!');
    });
    it('skips dates and metadata', () => {
      const passage = '2023-11-21\n\n5 min read\n\nToday we are excited to announce our new feature';
      const result = extractValueFromPassage(passage, 'title');
      expect(result).not.toContain('2023-11-21');
      expect(result).not.toContain('min read');
      expect(result.length).toBeGreaterThan(10);
    });
  });

  describe('rating extraction', () => {
    it('extracts star rating', () => {
      expect(extractValueFromPassage('Rated 4.5 out of 5 stars by users', 'rating')).toBe('4.5');
    });
    it('extracts slash rating', () => {
      expect(extractValueFromPassage('Rating: 8.5/10 based on reviews', 'rating')).toBe('8.5');
    });
  });

  describe('email extraction', () => {
    it('extracts email address', () => {
      expect(extractValueFromPassage('Contact us at hello@example.com for support', 'email')).toBe('hello@example.com');
    });
  });

  describe('URL extraction', () => {
    it('extracts URL', () => {
      expect(extractValueFromPassage('Visit our site at https://example.com/page for details', 'url')).toBe('https://example.com/page');
    });
    it('extracts image URL', () => {
      expect(extractValueFromPassage('Main image: https://cdn.example.com/photo.jpg available', 'image')).toBe('https://cdn.example.com/photo.jpg');
    });
  });

  describe('brand extraction', () => {
    it('extracts brand from "by Brand" pattern', () => {
      expect(extractValueFromPassage('Made by Apple for the modern user', 'brand')).toBe('Apple');
    });
    it('extracts capitalized brand name', () => {
      const result = extractValueFromPassage('Samsung announced their new Galaxy lineup', 'brand');
      expect(result).toBe('Samsung');
    });
  });

  describe('default extraction', () => {
    it('returns first sentence for unknown fields', () => {
      const result = extractValueFromPassage('First sentence here. Second sentence is longer and less relevant.', 'customField');
      expect(result).toBe('First sentence here.');
    });
  });
});

describe('smartExtractSchemaFields', () => {
  // Mock quickAnswer for testing
  const mockQA = (opts: { content: string; question: string }) => ({
    answer: opts.content.slice(0, 100),
    confidence: 0.5,
  });

  it('uses page title for title field', () => {
    const result = smartExtractSchemaFields(
      'Some content here about stuff',
      { title: 'article title or headline' },
      mockQA,
      { pageTitle: 'Workers AI Update: Hello, Mistral 7B! - Cloudflare Blog' },
    );
    expect(result.title).toBe('Workers AI Update: Hello, Mistral 7B!');
  });

  it('strips site name suffix from title', () => {
    const result = smartExtractSchemaFields(
      'content',
      { title: 'title' },
      mockQA,
      { pageTitle: 'iPhone 16 - Wikipedia' },
    );
    expect(result.title).toBe('iPhone 16');
  });

  it('extracts author from "by Name" pattern', () => {
    const result = smartExtractSchemaFields(
      '# My Article\n\nby John Smith | November 2023\n\nArticle content here...',
      { author: 'author name' },
      mockQA,
    );
    expect(result.author).toBe('John Smith');
  });

  it('extracts date from top of content', () => {
    const result = smartExtractSchemaFields(
      '# Workers AI Update\n\n2023-11-21\n\n5 min read\n\nContent here...',
      { date: 'publication date' },
      mockQA,
    );
    expect(result.date).toBe('2023-11-21');
  });

  it('extracts price with regex', () => {
    const result = smartExtractSchemaFields(
      'The iPhone 16 starts at $799 for the base model. The Pro version costs $999.',
      { price: 'current price' },
      mockQA,
    );
    expect(result.price).toBe('$799');
  });

  it('extracts email', () => {
    const result = smartExtractSchemaFields(
      'Contact us at hello@example.com for more info',
      { email: 'email address' },
      mockQA,
    );
    expect(result.email).toBe('hello@example.com');
  });

  it('falls back to BM25 for description', () => {
    const result = smartExtractSchemaFields(
      'A long article about various topics in technology and science...',
      { summary: 'article summary' },
      mockQA,
    );
    // Should have used BM25 fallback (mockQA returns first 100 chars)
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('extracts brand from page title', () => {
    const result = smartExtractSchemaFields(
      'Content about the device...',
      { brand: 'brand name' },
      mockQA,
      { pageTitle: 'Apple iPhone 16 - Specifications' },
    );
    expect(result.brand).toBe('Apple');
  });
});

describe('smartExtractSchemaFields — precision fixes', () => {
  const mockQA = (opts: { content: string; question: string }) => ({
    answer: opts.content.slice(0, 100),
    confidence: 0.5,
  });

  it('extracts brand from "by Brand" pattern, not first word of title', () => {
    const result = smartExtractSchemaFields(
      '# IPhone 16\n\n*2024 smartphone by Apple*\n\nThe iPhone 16 is developed by Apple Inc.',
      { brand: 'brand name' },
      mockQA,
      { pageTitle: 'IPhone 16' },
    );
    expect(result.brand).toBe('Apple');
  });

  it('extracts source from URL domain', () => {
    const result = smartExtractSchemaFields(
      'Some content',
      { source: 'publication name' },
      mockQA,
      { pageUrl: 'https://blog.cloudflare.com/some-post' },
    );
    expect(result.source).toBe('Blog Cloudflare');
  });

  it('extracts source from page title suffix', () => {
    const result = smartExtractSchemaFields(
      'Some content',
      { source: 'publication name' },
      mockQA,
      { pageTitle: 'Some Article - The New York Times', pageUrl: 'https://example.com' },
    );
    expect(result.source).toBe('The New York Times');
  });

  it('extracts summary as first substantive paragraph', () => {
    const result = smartExtractSchemaFields(
      '# My Title\n\n2023-11-21\n\n5 min read\n\nThis is the actual first paragraph about something interesting and important.',
      { summary: 'article summary' },
      mockQA,
    );
    expect(result.summary).toContain('This is the actual first paragraph');
    expect(result.summary).not.toContain('2023-11-21');
    expect(result.summary).not.toContain('min read');
  });

  it('returns content directly for body field', () => {
    const content = '# Title\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.';
    const result = smartExtractSchemaFields(
      content,
      { body: 'article body' },
      mockQA,
    );
    expect(result.body).toBe(content.slice(0, 2000));
  });

  it('extracts tags from headings', () => {
    const result = smartExtractSchemaFields(
      '# Main Title\n\nIntro.\n\n## History\n\nText.\n\n## Features\n\nText.\n\n## Pricing\n\nText.',
      { tags: 'article tags' },
      mockQA,
    );
    expect(result.tags).toContain('History');
    expect(result.tags).toContain('Features');
    expect(result.tags).toContain('Pricing');
  });
});
