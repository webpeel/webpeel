/**
 * Tests for structured data extraction
 */
import { describe, it, expect } from 'vitest';
import { extractStructured } from '../core/extract.js';
describe('extractStructured', () => {
    it('extracts data using CSS selectors', () => {
        const html = `
      <html>
        <body>
          <h1 class="title">Page Title</h1>
          <p class="author">John Doe</p>
          <div class="content">Main content here</div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                title: '.title',
                author: '.author',
                content: '.content',
            },
        });
        expect(result.title).toBe('Page Title');
        expect(result.author).toBe('John Doe');
        expect(result.content).toBe('Main content here');
    });
    it('returns null for missing elements', () => {
        const html = `
      <html>
        <body>
          <h1>Title</h1>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                title: 'h1',
                author: '.author', // Doesn't exist
            },
        });
        expect(result.title).toBe('Title');
        expect(result.author).toBeNull();
    });
    it('extracts multiple elements as array', () => {
        const html = `
      <html>
        <body>
          <li class="item">Item 1</li>
          <li class="item">Item 2</li>
          <li class="item">Item 3</li>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                items: '.item',
            },
        });
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items).toHaveLength(3);
        expect(result.items[0]).toBe('Item 1');
        expect(result.items[2]).toBe('Item 3');
    });
    it('uses schema for heuristic extraction', () => {
        const html = `
      <html>
        <body>
          <div class="title">Schema Title</div>
          <div class="price">$19.99</div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            schema: {
                properties: {
                    title: { type: 'string' },
                    price: { type: 'string' },
                },
            },
        });
        expect(result.title).toBe('Schema Title');
        expect(result.price).toBe('$19.99');
    });
    it('extracts nested selectors', () => {
        const html = `
      <html>
        <body>
          <article>
            <header>
              <h1>Article Title</h1>
              <span class="date">2024-01-01</span>
            </header>
            <div class="body">Article content</div>
          </article>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                title: 'article header h1',
                date: 'article .date',
                content: 'article .body',
            },
        });
        expect(result.title).toBe('Article Title');
        expect(result.date).toBe('2024-01-01');
        expect(result.content).toBe('Article content');
    });
    it('handles ID selectors', () => {
        const html = `
      <html>
        <body>
          <div id="main-title">Main Title</div>
          <div id="subtitle">Subtitle Text</div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                title: '#main-title',
                subtitle: '#subtitle',
            },
        });
        expect(result.title).toBe('Main Title');
        expect(result.subtitle).toBe('Subtitle Text');
    });
    it('extracts from meta tags using schema', () => {
        const html = `
      <html>
        <head>
          <meta name="description" content="Page description" />
          <meta property="og:title" content="OG Title" />
        </head>
        <body></body>
      </html>
    `;
        const result = extractStructured(html, {
            schema: {
                properties: {
                    description: { type: 'string' },
                    title: { type: 'string' },
                },
            },
        });
        expect(result.description).toBe('Page description');
        expect(result.title).toBe('OG Title');
    });
    it('coerces types based on schema', () => {
        const html = `
      <html>
        <body>
          <div class="price">29.99</div>
          <div class="available">true</div>
          <div class="quantity">5 units</div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            schema: {
                properties: {
                    price: { type: 'number' },
                    available: { type: 'boolean' },
                    quantity: { type: 'number' },
                },
            },
        });
        expect(result.price).toBe(29.99);
        expect(typeof result.price).toBe('number');
        expect(result.available).toBe(true);
        expect(typeof result.available).toBe('boolean');
        expect(result.quantity).toBe(5);
    });
    it('handles array type in schema', () => {
        const html = `
      <html>
        <body>
          <span class="tags">Tag 1</span>
          <span class="tags">Tag 2</span>
          <span class="tags">Tag 3</span>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            schema: {
                properties: {
                    tags: { type: 'array' },
                },
            },
        });
        expect(Array.isArray(result.tags)).toBe(true);
        expect(result.tags).toHaveLength(3);
    });
    it('gracefully handles malformed HTML', () => {
        const html = `
      <html>
        <body>
          <div class="content">Valid content
          <p>Unclosed paragraph
        </body>
    `;
        const result = extractStructured(html, {
            selectors: {
                content: '.content',
            },
        });
        expect(result.content).toContain('Valid content');
    });
    it('extracts from itemprop attributes', () => {
        const html = `
      <html>
        <body>
          <div itemscope>
            <span itemprop="name">Product Name</span>
            <span itemprop="price">$99</span>
          </div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            schema: {
                properties: {
                    name: { type: 'string' },
                    price: { type: 'string' },
                },
            },
        });
        expect(result.name).toBe('Product Name');
        expect(result.price).toBe('$99');
    });
    it('extracts from data attributes', () => {
        const html = `
      <html>
        <body>
          <div data-product-id="12345">Product</div>
          <div data-category="electronics">Category</div>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                productId: '[data-product-id]',
                category: '[data-category]',
            },
        });
        expect(result.productId).toBe('Product');
        expect(result.category).toBe('Category');
    });
    it('combines selectors and schema', () => {
        const html = `
      <html>
        <body>
          <h1 class="title">Explicit Title</h1>
          <div class="author">Author Name</div>
          <meta name="date" content="2024-01-01" />
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                title: '.title',
            },
            schema: {
                properties: {
                    author: { type: 'string' },
                    date: { type: 'string' },
                },
            },
        });
        expect(result.title).toBe('Explicit Title'); // From selector
        expect(result.author).toBe('Author Name'); // From schema
        expect(result.date).toBe('2024-01-01'); // From schema
    });
    it('handles empty schema gracefully', () => {
        const html = `<html><body><div>Content</div></body></html>`;
        const result = extractStructured(html, {
            schema: {},
        });
        expect(result).toEqual({});
    });
    it('extracts single element when multiple matches for single selector', () => {
        const html = `
      <html>
        <body>
          <p>First paragraph</p>
          <p>Second paragraph</p>
        </body>
      </html>
    `;
        const result = extractStructured(html, {
            selectors: {
                paragraph: 'p',
            },
        });
        // When multiple elements match, returns array
        expect(Array.isArray(result.paragraph)).toBe(true);
        expect(result.paragraph[0]).toBe('First paragraph');
    });
});
//# sourceMappingURL=extract.test.js.map