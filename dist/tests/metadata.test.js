/**
 * Tests for metadata extraction
 */
import { describe, it, expect } from 'vitest';
import { extractMetadata, extractLinks } from '../core/metadata.js';
describe('extractMetadata', () => {
    it('extracts title from og:title', () => {
        const html = `
      <html>
        <head>
          <meta property="og:title" content="OG Title" />
          <title>Page Title</title>
        </head>
        <body><h1>H1 Title</h1></body>
      </html>
    `;
        const { title } = extractMetadata(html, 'https://example.com');
        expect(title).toBe('OG Title');
    });
    it('falls back to title tag if og:title missing', () => {
        const html = `
      <html>
        <head><title>Page Title</title></head>
        <body><h1>H1 Title</h1></body>
      </html>
    `;
        const { title } = extractMetadata(html, 'https://example.com');
        expect(title).toBe('Page Title');
    });
    it('falls back to h1 if no title tag', () => {
        const html = `
      <html>
        <body><h1>H1 Title</h1></body>
      </html>
    `;
        const { title } = extractMetadata(html, 'https://example.com');
        expect(title).toBe('H1 Title');
    });
    it('extracts description from og:description', () => {
        const html = `
      <html>
        <head>
          <meta property="og:description" content="OG Description" />
          <meta name="description" content="Meta Description" />
        </head>
      </html>
    `;
        const { metadata } = extractMetadata(html, 'https://example.com');
        expect(metadata.description).toBe('OG Description');
    });
    it('extracts author from meta tag', () => {
        const html = `
      <html>
        <head>
          <meta name="author" content="John Doe" />
        </head>
      </html>
    `;
        const { metadata } = extractMetadata(html, 'https://example.com');
        expect(metadata.author).toBe('John Doe');
    });
    it('extracts canonical URL', () => {
        const html = `
      <html>
        <head>
          <link rel="canonical" href="https://example.com/canonical" />
        </head>
      </html>
    `;
        const { metadata } = extractMetadata(html, 'https://example.com');
        expect(metadata.canonical).toBe('https://example.com/canonical');
    });
    it('extracts image from og:image', () => {
        const html = `
      <html>
        <head>
          <meta property="og:image" content="https://example.com/image.jpg" />
        </head>
      </html>
    `;
        const { metadata } = extractMetadata(html, 'https://example.com');
        expect(metadata.image).toBe('https://example.com/image.jpg');
    });
});
describe('extractLinks', () => {
    it('extracts all links from page', () => {
        const html = `
      <html>
        <body>
          <a href="https://example.com/page1">Link 1</a>
          <a href="https://example.com/page2">Link 2</a>
          <a href="/relative">Relative Link</a>
        </body>
      </html>
    `;
        const links = extractLinks(html, 'https://example.com');
        expect(links).toContain('https://example.com/page1');
        expect(links).toContain('https://example.com/page2');
        expect(links).toContain('https://example.com/relative');
    });
    it('deduplicates links', () => {
        const html = `
      <html>
        <body>
          <a href="https://example.com/page1">Link 1</a>
          <a href="https://example.com/page1">Link 1 Again</a>
        </body>
      </html>
    `;
        const links = extractLinks(html, 'https://example.com');
        expect(links).toHaveLength(1);
        expect(links[0]).toBe('https://example.com/page1');
    });
    it('converts relative URLs to absolute', () => {
        const html = `
      <html>
        <body>
          <a href="/about">About</a>
          <a href="contact">Contact</a>
        </body>
      </html>
    `;
        const links = extractLinks(html, 'https://example.com/blog/');
        expect(links).toContain('https://example.com/about');
        expect(links).toContain('https://example.com/blog/contact');
    });
    it('skips javascript: and mailto: links', () => {
        const html = `
      <html>
        <body>
          <a href="javascript:void(0)">JS Link</a>
          <a href="mailto:test@example.com">Email</a>
          <a href="https://example.com/page1">Valid Link</a>
        </body>
      </html>
    `;
        const links = extractLinks(html, 'https://example.com');
        expect(links).toHaveLength(1);
        expect(links[0]).toBe('https://example.com/page1');
    });
    it('skips hash-only links', () => {
        const html = `
      <html>
        <body>
          <a href="#section">Section</a>
          <a href="https://example.com/page1">Valid Link</a>
        </body>
      </html>
    `;
        const links = extractLinks(html, 'https://example.com');
        expect(links).toHaveLength(1);
        expect(links[0]).toBe('https://example.com/page1');
    });
});
//# sourceMappingURL=metadata.test.js.map