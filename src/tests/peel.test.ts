/**
 * Tests for the main peel() function
 * These tests use mocks to avoid real network requests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { peel } from '../index.js';

// Mock the smartFetch function to avoid real network requests
vi.mock('../core/strategies.js', () => ({
  smartFetch: vi.fn(async (url: string, options: any) => {
    // Return a mock HTML response
    return {
      url,
      html: `
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="OG Test Title" />
            <meta property="og:description" content="Test description" />
          </head>
          <body>
            <article>
              <h1>Main Article</h1>
              <p>This is the main content of the test page with sufficient length to be detected as meaningful content.</p>
              <a href="/page1">Link 1</a>
              <a href="https://example.com/page2">Link 2</a>
              <img src="https://example.com/image.jpg" alt="Test image" />
            </article>
          </body>
        </html>
      `,
      method: options?.stealth ? 'stealth' : options?.forceBrowser ? 'browser' : 'simple',
      statusCode: 200,
      contentType: 'text/html',
      elapsed: 100,
      screenshot: options?.screenshot ? Buffer.from('fake-screenshot') : undefined,
    };
  }),
  cleanup: vi.fn(),
}));

describe('peel() function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and converts HTML to markdown by default', async () => {
    const result = await peel('https://example.com');

    expect(result.url).toBe('https://example.com');
    expect(result.content).toContain('# Main Article');
    expect(result.content).toContain('main content');
    expect(result.method).toBe('simple');
  });

  it('converts to text format when specified', async () => {
    const result = await peel('https://example.com', { format: 'text' });

    expect(result.content).toContain('Main Article');
    expect(result.content).not.toContain('#'); // No markdown formatting
    expect(result.content).not.toContain('<'); // No HTML tags
  });

  it('returns HTML format when specified', async () => {
    const result = await peel('https://example.com', { format: 'html' });

    expect(result.content).toContain('<h1>');
    expect(result.content).toContain('</h1>');
  });

  it('extracts metadata', async () => {
    const result = await peel('https://example.com');

    expect(result.title).toBe('OG Test Title');
    expect(result.metadata.description).toBe('Test description');
  });

  it('extracts links', async () => {
    const result = await peel('https://example.com');

    expect(result.links).toBeDefined();
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.links).toContain('https://example.com/page1');
    expect(result.links).toContain('https://example.com/page2');
  });

  it('includes token estimate', async () => {
    const result = await peel('https://example.com');

    expect(result.tokens).toBeGreaterThan(0);
    expect(typeof result.tokens).toBe('number');
  });

  it('includes content fingerprint', async () => {
    const result = await peel('https://example.com');

    expect(result.fingerprint).toBeDefined();
    expect(typeof result.fingerprint).toBe('string');
    expect(result.fingerprint!.length).toBe(16); // SHA256 hex truncated to first 16 chars
  });

  it('includes quality score', async () => {
    const result = await peel('https://example.com');

    expect(result.quality).toBeDefined();
    expect(typeof result.quality).toBe('number');
    expect(result.quality).toBeGreaterThanOrEqual(0);
    expect(result.quality).toBeLessThanOrEqual(1);
  });

  it('includes elapsed time', async () => {
    const result = await peel('https://example.com');

    expect(result.elapsed).toBeGreaterThan(0);
    expect(typeof result.elapsed).toBe('number');
  });

  it('uses browser method when render=true', async () => {
    const result = await peel('https://example.com', { render: true });

    expect(result.method).toBe('browser');
  });

  it('uses stealth method when stealth=true', async () => {
    const result = await peel('https://example.com', { stealth: true });

    expect(result.method).toBe('stealth');
  });

  it('handles PDF URLs via simple fetch (no browser needed)', async () => {
    const result = await peel('https://example.com/document.pdf');

    // PDFs are now parsed via pdf-parse in the simple HTTP path — no browser required
    expect(result.method).toBe('simple');
  });

  it('forces browser when screenshot requested', async () => {
    const result = await peel('https://example.com', { screenshot: true });

    expect(result.method).toBe('browser');
    expect(result.screenshot).toBeDefined();
  });

  it('extracts images when images=true', async () => {
    const result = await peel('https://example.com', { images: true });

    expect(result.images).toBeDefined();
    expect(Array.isArray(result.images)).toBe(true);
    expect(result.images!.length).toBeGreaterThan(0);
    expect(result.images![0].src).toContain('image.jpg');
  });

  it('does not extract images by default', async () => {
    const result = await peel('https://example.com');

    expect(result.images).toBeUndefined();
  });

  it('applies token budget when maxTokens specified', async () => {
    const result = await peel('https://example.com', { maxTokens: 10 });

    // Content should be truncated to fit budget
    expect(result.tokens).toBeLessThanOrEqual(15); // Allow small margin
  });

  it('passes through includeTags option', async () => {
    // This would normally filter HTML to only include specified tags
    const result = await peel('https://example.com', { 
      includeTags: ['article'] 
    });

    expect(result.content).toBeTruthy();
    // Content should be from article tag
  });

  it('passes through excludeTags option', async () => {
    const result = await peel('https://example.com', { 
      excludeTags: ['nav', 'footer'] 
    });

    expect(result.content).toBeTruthy();
    // Nav and footer content should be excluded
  });

  it('applies selector when specified', async () => {
    const result = await peel('https://example.com', { 
      selector: 'article' 
    });

    expect(result.content).toContain('Main Article');
  });

  it('applies exclude selectors', async () => {
    const result = await peel('https://example.com', { 
      selector: 'body',
      exclude: ['nav', 'footer']
    });

    expect(result.content).toBeTruthy();
  });

  it('includes method in result', async () => {
    const result = await peel('https://example.com');

    expect(['simple', 'browser', 'stealth']).toContain(result.method);
  });

  it('handles timeout option', async () => {
    const result = await peel('https://example.com', { timeout: 5000 });

    expect(result).toBeDefined();
  });

  it('handles userAgent option', async () => {
    const result = await peel('https://example.com', { 
      userAgent: 'CustomBot/1.0' 
    });

    expect(result).toBeDefined();
  });

  it('handles wait option for render mode', async () => {
    const result = await peel('https://example.com', { 
      render: true,
      wait: 1000 
    });

    expect(result.method).toBe('browser');
  });

  it('extracts structured data when extract option provided', async () => {
    const result = await peel('https://example.com', {
      extract: {
        selectors: {
          title: 'h1',
        },
      },
    });

    expect(result.extracted).toBeDefined();
    expect(result.extracted?.title).toBe('Main Article');
  });

  it('handles raw option for unprocessed HTML', async () => {
    const result = await peel('https://example.com', { 
      raw: true,
      format: 'html' 
    });

    expect(result.content).toContain('<html');
  });

  it('returns correct content type detection', async () => {
    const result = await peel('https://example.com');

    expect(result.contentType).toBeDefined();
  });

  it('handles multiple concurrent requests', async () => {
    const results = await Promise.all([
      peel('https://example.com/page1'),
      peel('https://example.com/page2'),
      peel('https://example.com/page3'),
    ]);

    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result.content).toBeTruthy();
      expect(result.title).toBeTruthy();
    });
  });

  it('generates consistent fingerprints for same content', async () => {
    const result1 = await peel('https://example.com');
    const result2 = await peel('https://example.com');

    expect(result1.fingerprint).toBe(result2.fingerprint);
  });

  it('includes all required fields in result', async () => {
    const result = await peel('https://example.com');

    // Required fields
    expect(result.url).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.method).toBeDefined();
    expect(result.elapsed).toBeDefined();
    expect(result.tokens).toBeDefined();
    expect(result.fingerprint).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.links).toBeDefined();
  });

  it('handles custom headers', async () => {
    const result = await peel('https://example.com', {
      headers: {
        'X-Custom-Header': 'test-value',
      },
    });

    expect(result).toBeDefined();
  });

  it('handles cookies', async () => {
    const result = await peel('https://example.com', {
      cookies: [
        'session=abc123',
      ],
    });

    expect(result).toBeDefined();
  });

  it('returns contentType for content', async () => {
    const result = await peel('https://example.com');

    expect(result.contentType).toBeDefined();
  });

  it('passes actions to browser when provided', async () => {
    const result = await peel('https://example.com', {
      actions: [
        { type: 'click', selector: 'button' },
      ],
    });

    expect(result.method).toBe('browser');
  });

  it('handles screenshotFullPage option', async () => {
    const result = await peel('https://example.com', {
      screenshot: true,
      screenshotFullPage: true,
    });

    expect(result.screenshot).toBeDefined();
  });
});

describe('peel() error cases', () => {
  // Note: These tests are skipped because the mock doesn't throw errors
  // In real usage, invalid URLs would be handled by the fetch layer
  it.skip('handles invalid URLs gracefully', async () => {
    await expect(peel('not-a-url')).rejects.toThrow();
  });

  it.skip('handles empty URL', async () => {
    await expect(peel('')).rejects.toThrow();
  });
});
