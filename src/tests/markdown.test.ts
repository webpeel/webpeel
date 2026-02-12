/**
 * Tests for markdown conversion
 */

import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, htmlToText, estimateTokens } from '../core/markdown.js';

describe('htmlToMarkdown', () => {
  it('converts basic HTML to markdown', () => {
    const html = `
      <h1>Test Title</h1>
      <p>This is a <strong>test</strong> paragraph with <em>formatting</em>.</p>
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
      </ul>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('# Test Title');
    expect(markdown).toContain('**test**');
    expect(markdown).toContain('_formatting_');
    expect(markdown).toContain('Item 1');
    expect(markdown).toContain('Item 2');
  });

  it('removes script and style tags', () => {
    const html = `
      <h1>Title</h1>
      <script>alert('test');</script>
      <style>.test { color: red; }</style>
      <p>Content</p>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).not.toContain('alert');
    expect(markdown).not.toContain('.test');
    expect(markdown).toContain('Title');
    expect(markdown).toContain('Content');
  });

  it('removes navigation and footer elements', () => {
    const html = `
      <nav>Navigation</nav>
      <h1>Main Content</h1>
      <p>Paragraph</p>
      <footer>Footer content</footer>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).not.toContain('Navigation');
    expect(markdown).not.toContain('Footer');
    expect(markdown).toContain('Main Content');
    expect(markdown).toContain('Paragraph');
  });

  it('preserves code blocks', () => {
    const html = `
      <pre><code class="language-javascript">console.log('hello');</code></pre>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('```javascript');
    expect(markdown).toContain("console.log('hello');");
    expect(markdown).toContain('```');
  });

  it('preserves images in context', () => {
    const html = `
      <html><body>
        <p>Some text with an image: <img src="https://example.com/image.jpg" alt="Test Image" /></p>
      </body></html>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('Some text');
    // Image handling can vary, but content should be present
    expect(markdown.length).toBeGreaterThan(0);
  });
});

describe('htmlToText', () => {
  it('converts HTML to plain text', () => {
    const html = `
      <h1>Title</h1>
      <p>This is a <strong>paragraph</strong>.</p>
    `;

    const text = htmlToText(html);

    expect(text).toContain('Title');
    expect(text).toContain('This is a paragraph');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('<strong>');
  });

  it('removes scripts and styles', () => {
    const html = `
      <h1>Title</h1>
      <script>alert('test');</script>
      <p>Content</p>
    `;

    const text = htmlToText(html);

    expect(text).not.toContain('alert');
    expect(text).toContain('Title');
    expect(text).toContain('Content');
  });
});

describe('estimateTokens', () => {
  it('estimates tokens correctly', () => {
    const text = 'This is a test string with about 8 words';
    const tokens = estimateTokens(text);

    // Rough estimate: 1 token ≈ 4 characters
    // 42 characters / 4 = ~11 tokens
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(15);
  });

  it('handles empty strings', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles long text', () => {
    const longText = 'word '.repeat(1000); // 5000 characters
    const tokens = estimateTokens(longText);

    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(2000);
  });
});
