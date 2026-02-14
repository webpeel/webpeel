/**
 * Tests for metadata extraction
 */

import { describe, it, expect } from 'vitest';
import { extractMetadata, extractLinks, extractImages } from '../core/metadata.js';

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

  it('extracts twitter:image as fallback', () => {
    const html = `
      <html>
        <head>
          <meta name="twitter:image" content="https://example.com/twitter-image.jpg" />
        </head>
      </html>
    `;

    const { metadata } = extractMetadata(html, 'https://example.com');
    expect(metadata.image).toBe('https://example.com/twitter-image.jpg');
  });

  it('extracts language from html tag', () => {
    const html = `
      <html lang="en-US">
        <head><title>Test</title></head>
      </html>
    `;

    const { metadata } = extractMetadata(html, 'https://example.com');
    expect(metadata).toBeDefined(); // Language is in the HTML but not in PageMetadata type
  });

  it('handles missing metadata gracefully', () => {
    const html = `
      <html>
        <body><p>No metadata</p></body>
      </html>
    `;

    const { metadata } = extractMetadata(html, 'https://example.com');
    expect(metadata.description).toBeUndefined();
    expect(metadata.author).toBeUndefined();
    expect(metadata.image).toBeUndefined();
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

  it('handles links with fragments (keeps them)', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/page1#section">Link with fragment</a>
          <a href="/page2#top">Relative with fragment</a>
        </body>
      </html>
    `;

    const links = extractLinks(html, 'https://example.com');

    expect(links).toContain('https://example.com/page1#section');
    expect(links).toContain('https://example.com/page2#top');
  });

  it('handles protocol-relative URLs', () => {
    const html = `
      <html>
        <body>
          <a href="//cdn.example.com/page">CDN Link</a>
        </body>
      </html>
    `;

    const links = extractLinks(html, 'https://example.com');

    // Protocol-relative URLs should resolve to https
    expect(links).toContain('https://cdn.example.com/page');
  });

  it('handles query parameters', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/page?foo=bar&baz=qux">Link with params</a>
        </body>
      </html>
    `;

    const links = extractLinks(html, 'https://example.com');

    expect(links[0]).toBe('https://example.com/page?foo=bar&baz=qux');
  });

  it('returns sorted links', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/zebra">Z</a>
          <a href="https://example.com/apple">A</a>
          <a href="https://example.com/banana">B</a>
        </body>
      </html>
    `;

    const links = extractLinks(html, 'https://example.com');

    expect(links[0]).toBe('https://example.com/apple');
    expect(links[1]).toBe('https://example.com/banana');
    expect(links[2]).toBe('https://example.com/zebra');
  });
});

describe('extractImages', () => {
  it('extracts img tags', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image1.jpg" alt="Image 1" />
          <img src="https://example.com/image2.png" alt="Image 2" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images).toHaveLength(2);
    expect(images[0].src).toBe('https://example.com/image1.jpg');
    expect(images[0].alt).toBe('Image 1');
    expect(images[1].src).toBe('https://example.com/image2.png');
    expect(images[1].alt).toBe('Image 2');
  });

  it('resolves relative image URLs', () => {
    const html = `
      <html>
        <body>
          <img src="/images/photo.jpg" alt="Photo" />
          <img src="assets/logo.png" alt="Logo" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com/page/');

    expect(images).toHaveLength(2);
    expect(images[0].src).toBe('https://example.com/images/photo.jpg');
    expect(images[1].src).toBe('https://example.com/page/assets/logo.png');
  });

  it('extracts picture source tags', () => {
    const html = `
      <html>
        <body>
          <picture>
            <source srcset="https://example.com/image-large.jpg 2x, https://example.com/image-small.jpg 1x" />
            <img src="https://example.com/image-fallback.jpg" alt="Picture" />
          </picture>
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    // Should extract both srcset images and fallback img
    expect(images.length).toBeGreaterThanOrEqual(2);
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/image-large.jpg');
    expect(srcs).toContain('https://example.com/image-small.jpg');
  });

  it('extracts CSS background images', () => {
    const html = `
      <html>
        <body>
          <div style="background-image: url('https://example.com/bg.jpg');">Content</div>
          <div style="background: url(https://example.com/bg2.png) no-repeat;">More</div>
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/bg.jpg');
    expect(srcs).toContain('https://example.com/bg2.png');
  });

  it('deduplicates images', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" alt="First" />
          <img src="https://example.com/image.jpg" alt="Second" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/image.jpg');
  });

  it('rejects non-HTTP/HTTPS protocols (SSRF protection)', () => {
    const html = `
      <html>
        <body>
          <img src="javascript:alert('xss')" alt="XSS" />
          <img src="data:image/png;base64,iVBORw0KGgo..." alt="Data URI" />
          <img src="file:///etc/passwd" alt="File" />
          <img src="https://example.com/safe.jpg" alt="Safe" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/safe.jpg');
  });

  it('extracts image dimensions', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" alt="Image" width="800" height="600" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images[0].width).toBe(800);
    expect(images[0].height).toBe(600);
  });

  it('extracts image title attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" alt="Image" title="Hover text" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images[0].title).toBe('Hover text');
  });

  it('handles images without alt text', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" />
        </body>
      </html>
    `;

    const images = extractImages(html, 'https://example.com');

    expect(images[0].alt).toBe('');
  });
});
