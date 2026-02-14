/**
 * Tests for metadata.ts functions
 * Tests extractImages, extractLinks, and extractMetadata
 */

import { describe, it, expect } from 'vitest';
import { extractImages, extractLinks, extractMetadata } from '../core/metadata.js';

describe('extractImages', () => {
  const baseUrl = 'https://example.com/page';

  it('extracts img src attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/image.jpg');
  });

  it('extracts img alt attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" alt="Test image" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('Test image');
  });

  it('extracts img width attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" width="800" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].width).toBe(800);
  });

  it('extracts img height attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" height="600" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].height).toBe(600);
  });

  it('extracts all img attributes together', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/photo.png" alt="Photo" title="My Photo" width="1920" height="1080" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      src: 'https://example.com/photo.png',
      alt: 'Photo',
      title: 'My Photo',
      width: 1920,
      height: 1080,
    });
  });

  it('handles missing alt attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('');
  });

  it('handles missing width attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" height="100" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].width).toBeUndefined();
    expect(images[0].height).toBe(100);
  });

  it('handles missing height attribute', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" width="100" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].height).toBeUndefined();
    expect(images[0].width).toBe(100);
  });

  it('handles invalid width value', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" width="invalid" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].width).toBeUndefined();
  });

  it('handles invalid height value', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" height="auto" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].height).toBeUndefined();
  });

  it('resolves relative URLs to absolute', () => {
    const html = `
      <html>
        <body>
          <img src="/images/logo.png" />
          <img src="assets/photo.jpg" />
          <img src="../icon.svg" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(3);
    expect(images[0].src).toBe('https://example.com/images/logo.png');
    expect(images[1].src).toBe('https://example.com/assets/photo.jpg');
    expect(images[2].src).toBe('https://example.com/icon.svg');
  });

  it('deduplicates images by src', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/image.jpg" alt="First" />
          <img src="https://example.com/image.jpg" alt="Second" />
          <img src="https://example.com/image.jpg" alt="Third" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    // Should only have 1 image (deduplicated)
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/image.jpg');
  });

  it('extracts picture source srcset', () => {
    const html = `
      <html>
        <body>
          <picture>
            <source srcset="https://example.com/image-large.jpg" />
            <img src="https://example.com/image.jpg" alt="Responsive image" />
          </picture>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images.length).toBeGreaterThanOrEqual(1);
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/image-large.jpg');
  });

  it('parses srcset with multiple images', () => {
    const html = `
      <html>
        <body>
          <picture>
            <source srcset="https://example.com/small.jpg 1x, https://example.com/large.jpg 2x" />
            <img src="https://example.com/fallback.jpg" alt="Multi-res" />
          </picture>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/small.jpg');
    expect(srcs).toContain('https://example.com/large.jpg');
  });

  it('extracts alt from parent picture element', () => {
    const html = `
      <html>
        <body>
          <picture>
            <source srcset="https://example.com/responsive.jpg" />
            <img src="https://example.com/fallback.jpg" alt="Picture alt text" />
          </picture>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    const responsiveImage = images.find(img => img.src === 'https://example.com/responsive.jpg');
    expect(responsiveImage).toBeDefined();
    expect(responsiveImage?.alt).toBe('Picture alt text');
  });

  it('rejects non-HTTP URLs (SSRF protection)', () => {
    const html = `
      <html>
        <body>
          <img src="javascript:alert('xss')" />
          <img src="file:///etc/passwd" />
          <img src="data:image/png;base64,xyz" />
          <img src="ftp://example.com/image.jpg" />
          <img src="https://example.com/safe.jpg" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    // Should only extract the HTTPS image
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://example.com/safe.jpg');
  });

  it('handles malformed URLs gracefully', () => {
    const html = `
      <html>
        <body>
          <img src="ht!tp://invalid" />
          <img src="https://example.com/valid.jpg" />
          <img src="not a url at all" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    // Should include valid URL; malformed URLs may be resolved against baseUrl
    expect(images.some(img => img.src === 'https://example.com/valid.jpg')).toBe(true);
  });

  it('extracts CSS background images', () => {
    const html = `
      <html>
        <body>
          <div style="background-image: url('https://example.com/bg.jpg')">Content</div>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images.length).toBeGreaterThan(0);
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/bg.jpg');
  });

  it('handles CSS background images with double quotes', () => {
    const html = `
      <html>
        <body>
          <div style='background-image: url("https://example.com/bg.jpg")'>Content</div>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/bg.jpg');
  });

  it('handles CSS background images without quotes', () => {
    const html = `
      <html>
        <body>
          <div style="background-image: url(https://example.com/bg.jpg)">Content</div>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    const srcs = images.map(img => img.src);
    expect(srcs).toContain('https://example.com/bg.jpg');
  });

  it('extracts multiple images from same page', () => {
    const html = `
      <html>
        <body>
          <img src="https://example.com/1.jpg" alt="Image 1" />
          <img src="https://example.com/2.jpg" alt="Image 2" />
          <picture>
            <source srcset="https://example.com/3.jpg" />
            <img src="https://example.com/4.jpg" alt="Image 4" />
          </picture>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images.length).toBeGreaterThanOrEqual(4);
  });

  it('returns empty array when no images found', () => {
    const html = `
      <html>
        <body>
          <p>No images here</p>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toEqual([]);
  });

  it('skips images without src attribute', () => {
    const html = `
      <html>
        <body>
          <img alt="No source" />
          <img src="https://example.com/valid.jpg" alt="Has source" />
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe('Has source');
  });

  it('handles empty srcset gracefully', () => {
    const html = `
      <html>
        <body>
          <picture>
            <source srcset="" />
            <img src="https://example.com/fallback.jpg" />
          </picture>
        </body>
      </html>
    `;
    
    const images = extractImages(html, baseUrl);
    
    // Should at least get the fallback img
    expect(images.length).toBeGreaterThan(0);
  });
});

describe('extractLinks', () => {
  const baseUrl = 'https://example.com/page';

  it('extracts absolute URLs', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/link1">Link 1</a>
          <a href="https://other.com/link2">Link 2</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).toContain('https://example.com/link1');
    expect(links).toContain('https://other.com/link2');
  });

  it('resolves relative URLs', () => {
    const html = `
      <html>
        <body>
          <a href="/about">About</a>
          <a href="contact">Contact</a>
          <a href="../home">Home</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).toContain('https://example.com/about');
    expect(links).toContain('https://example.com/contact');
    expect(links).toContain('https://example.com/home');
  });

  it('deduplicates links', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/same">Link 1</a>
          <a href="https://example.com/same">Link 2</a>
          <a href="https://example.com/same">Link 3</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links.filter(l => l === 'https://example.com/same')).toHaveLength(1);
  });

  it('skips anchor-only links', () => {
    const html = `
      <html>
        <body>
          <a href="#section1">Section 1</a>
          <a href="#section2">Section 2</a>
          <a href="https://example.com/real-link">Real Link</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).not.toContain('#section1');
    expect(links).not.toContain('#section2');
    expect(links).toContain('https://example.com/real-link');
  });

  it('rejects non-HTTP protocols (SSRF protection)', () => {
    const html = `
      <html>
        <body>
          <a href="javascript:alert('xss')">XSS</a>
          <a href="file:///etc/passwd">File</a>
          <a href="ftp://example.com/file">FTP</a>
          <a href="https://example.com/safe">Safe</a>
          <a href="http://example.com/also-safe">Also Safe</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).toContain('https://example.com/safe');
    expect(links).toContain('http://example.com/also-safe');
    expect(links).not.toContain('javascript:alert(\'xss\')');
    expect(links).not.toContain('file:///etc/passwd');
    expect(links).not.toContain('ftp://example.com/file');
  });

  it('handles malformed URLs gracefully', () => {
    const html = `
      <html>
        <body>
          <a href="ht!tp://invalid">Invalid</a>
          <a href="https://example.com/valid">Valid</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).toContain('https://example.com/valid');
    // Malformed URLs may be resolved against base URL or kept as-is
    // The key assertion is that valid URLs are included
  });

  it('returns sorted links', () => {
    const html = `
      <html>
        <body>
          <a href="https://z.com">Z</a>
          <a href="https://a.com">A</a>
          <a href="https://m.com">M</a>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    // Check if sorted
    const sorted = [...links].sort();
    expect(links).toEqual(sorted);
  });

  it('returns empty array when no links found', () => {
    const html = `
      <html>
        <body>
          <p>No links here</p>
        </body>
      </html>
    `;
    
    const links = extractLinks(html, baseUrl);
    
    expect(links).toEqual([]);
  });
});

describe('extractMetadata', () => {
  it('extracts title from og:title', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="OG Title" />
          <title>Fallback Title</title>
        </head>
      </html>
    `;
    
    const { title } = extractMetadata(html, 'https://example.com');
    
    expect(title).toBe('OG Title');
  });

  it('falls back to twitter:title', () => {
    const html = `
      <html>
        <head>
          <meta name="twitter:title" content="Twitter Title" />
          <title>Fallback Title</title>
        </head>
      </html>
    `;
    
    const { title } = extractMetadata(html, 'https://example.com');
    
    expect(title).toBe('Twitter Title');
  });

  it('falls back to title tag', () => {
    const html = `
      <html>
        <head>
          <title>Page Title</title>
        </head>
      </html>
    `;
    
    const { title } = extractMetadata(html, 'https://example.com');
    
    expect(title).toBe('Page Title');
  });

  it('falls back to h1', () => {
    const html = `
      <html>
        <body>
          <h1>H1 Title</h1>
        </body>
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
        </head>
      </html>
    `;
    
    const { metadata } = extractMetadata(html, 'https://example.com');
    
    expect(metadata.description).toBe('OG Description');
  });

  it('extracts author', () => {
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

  it('extracts published date', () => {
    const html = `
      <html>
        <head>
          <meta property="article:published_time" content="2024-01-15T10:30:00Z" />
        </head>
      </html>
    `;
    
    const { metadata } = extractMetadata(html, 'https://example.com');
    
    expect(metadata.published).toBeDefined();
    expect(metadata.published).toContain('2024-01-15');
  });

  it('extracts og:image', () => {
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
});
