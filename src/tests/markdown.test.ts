/**
 * Tests for markdown.ts functions
 * Tests filterByTags, detectMainContent, and other markdown utilities
 */

import { describe, it, expect } from 'vitest';
import { filterByTags, detectMainContent, calculateQuality, truncateToTokenBudget, estimateTokens, cleanMarkdownNoise } from '../core/markdown.js';

describe('filterByTags', () => {
  it('filters by tag name (article)', () => {
    const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <article>Main article content</article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['article']);
    
    expect(result).toContain('Main article content');
    expect(result).not.toContain('Navigation');
    expect(result).not.toContain('Footer');
  });

  it('filters by tag name (main)', () => {
    const html = `
      <html>
        <body>
          <header>Header</header>
          <main>Main content here</main>
          <aside>Sidebar</aside>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['main']);
    
    expect(result).toContain('Main content here');
    expect(result).not.toContain('Header');
    expect(result).not.toContain('Sidebar');
  });

  it('filters by CSS class selector (.content)', () => {
    const html = `
      <html>
        <body>
          <div class="sidebar">Sidebar content</div>
          <div class="content">Main content</div>
          <div class="ads">Advertisements</div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['.content']);
    
    expect(result).toContain('Main content');
    expect(result).not.toContain('Sidebar content');
    expect(result).not.toContain('Advertisements');
  });

  it('filters by CSS id selector (#main)', () => {
    const html = `
      <html>
        <body>
          <div id="header">Header</div>
          <div id="main">Main content area</div>
          <div id="footer">Footer</div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['#main']);
    
    expect(result).toContain('Main content area');
    expect(result).not.toContain('Header');
    expect(result).not.toContain('Footer');
  });

  it('handles multiple includeTags', () => {
    const html = `
      <html>
        <body>
          <nav>Nav</nav>
          <article>Article 1</article>
          <main>Main content</main>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['article', 'main']);
    
    expect(result).toContain('Article 1');
    expect(result).toContain('Main content');
    expect(result).not.toContain('Nav');
    expect(result).not.toContain('Footer');
  });

  it('handles empty includeTags array', () => {
    const html = `
      <html>
        <body>
          <article>Content</article>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, []);
    
    // Empty array should return full HTML
    expect(result).toContain('Content');
  });

  it('handles null includeTags', () => {
    const html = `
      <html>
        <body>
          <article>Content</article>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined);
    
    // Undefined should return full HTML
    expect(result).toContain('Content');
  });

  it('removes content from excluded tags', () => {
    const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <article>Main content</article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined, ['nav', 'footer']);
    
    expect(result).toContain('Main content');
    expect(result).not.toContain('Navigation');
    expect(result).not.toContain('Footer');
  });

  it('removes multiple excluded tags', () => {
    const html = `
      <html>
        <head><script>alert('hi')</script></head>
        <body>
          <nav>Nav</nav>
          <aside>Sidebar</aside>
          <article>Content</article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined, ['nav', 'aside', 'footer', 'script']);
    
    expect(result).toContain('Content');
    expect(result).not.toContain('Nav');
    expect(result).not.toContain('Sidebar');
    expect(result).not.toContain('Footer');
    expect(result).not.toContain('alert');
  });

  it('excludes tags by CSS selectors', () => {
    const html = `
      <html>
        <body>
          <div class="ad">Advertisement</div>
          <div class="content">Main content</div>
          <div class="banner">Banner</div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined, ['.ad', '.banner']);
    
    expect(result).toContain('Main content');
    expect(result).not.toContain('Advertisement');
    expect(result).not.toContain('Banner');
  });

  it('handles empty excludeTags array', () => {
    const html = `
      <html>
        <body>
          <article>Content</article>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined, []);
    
    expect(result).toContain('Content');
  });

  it('handles null excludeTags', () => {
    const html = `
      <html>
        <body>
          <article>Content</article>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, undefined, undefined);
    
    expect(result).toContain('Content');
  });

  it('applies excludeTags before includeTags', () => {
    const html = `
      <html>
        <body>
          <article>
            <nav>Article nav</nav>
            <p>Article content</p>
          </article>
        </body>
      </html>
    `;
    
    // First excludes nav, then includes article
    const result = filterByTags(html, ['article'], ['nav']);
    
    expect(result).toContain('Article content');
    expect(result).not.toContain('Article nav');
  });

  it('preserves content within matched tags', () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>Title</h1>
            <p>Paragraph 1</p>
            <p>Paragraph 2</p>
            <img src="test.jpg" alt="Test" />
            <a href="/link">Link</a>
          </article>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['article']);
    
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph 1');
    expect(result).toContain('Paragraph 2');
    expect(result).toContain('test.jpg');
    expect(result).toContain('Link');
  });

  it('returns empty string when includeTags match nothing', () => {
    const html = `
      <html>
        <body>
          <div>Content</div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['article']);
    
    expect(result).toBe('');
  });

  it('handles complex nested structures', () => {
    const html = `
      <html>
        <body>
          <div class="container">
            <nav>Nav</nav>
            <main>
              <article>
                <header>Article header</header>
                <section>Article content</section>
              </article>
            </main>
            <aside>Sidebar</aside>
          </div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['article'], ['nav', 'aside', 'header']);
    
    expect(result).toContain('Article content');
    expect(result).not.toContain('Nav');
    expect(result).not.toContain('Sidebar');
    expect(result).not.toContain('Article header');
  });

  it('handles attribute selectors', () => {
    const html = `
      <html>
        <body>
          <div role="main">Main content</div>
          <div role="navigation">Nav</div>
        </body>
      </html>
    `;
    
    const result = filterByTags(html, ['[role="main"]']);
    
    expect(result).toContain('Main content');
    expect(result).not.toContain('Nav');
  });
});

describe('detectMainContent', () => {
  it('detects article[role="main"]', () => {
    const html = `
      <html>
        <body>
          <nav>Nav content</nav>
          <article role="main">This is the main article content with sufficient length to be detected as meaningful content area. Adding more text to exceed the minimum character requirement of one hundred characters for proper detection by the algorithm.</article>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.detected).toBe(true);
    expect(result.html).toContain('main article content');
    expect(result.html).not.toContain('Nav content');
  });

  it('detects main article', () => {
    const html = `
      <html>
        <body>
          <main>
            <article>Article inside main with plenty of text to make it meaningful and worth extracting. Here is more content padding to ensure we cross the minimum threshold for detection.</article>
          </main>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.detected).toBe(true);
    expect(result.html).toContain('Article inside main');
  });

  it('detects standalone article', () => {
    const html = `
      <html>
        <body>
          <header>Header</header>
          <article>Standalone article with enough content to be detected as the main content area of the page. Here is more content padding to ensure we cross the minimum threshold.</article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.detected).toBe(true);
    expect(result.html).toContain('Standalone article');
  });

  it('detects main tag', () => {
    const html = `
      <html>
        <body>
          <header>Header</header>
          <main>Main content area with substantial text that makes it the primary content of this webpage. Here is more content padding to ensure we cross the minimum threshold.</main>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.detected).toBe(true);
    expect(result.html).toContain('Main content area');
  });

  it('skips main content with insufficient text', () => {
    const html = `
      <html>
        <body>
          <article>Short</article>
          <div>This is a much longer content block that contains substantial text and should be detected as the main content area.</div>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    // Should fallback to finding largest text block
    expect(result.html).toContain('much longer content block');
  });

  it('falls back to largest text block', () => {
    const html = `
      <html>
        <body>
          <div>Short div</div>
          <section>This section contains a lot of text that makes it the primary content. It has many words and sentences that provide value to readers. This is definitely the main content area that should be extracted.</section>
          <div>Another short div</div>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.html).toContain('section contains a lot of text');
  });

  it('returns full HTML when no main content detected', () => {
    const html = `
      <html>
        <body>
          <div>Short 1</div>
          <div>Short 2</div>
        </body>
      </html>
    `;
    
    const result = detectMainContent(html);
    
    expect(result.detected).toBe(false);
    expect(result.html).toContain('Short 1');
    expect(result.html).toContain('Short 2');
  });
});

describe('calculateQuality', () => {
  it('returns quality score between 0 and 1', () => {
    const content = 'Some markdown content';
    const html = '<html><body><p>Some markdown content</p></body></html>';
    
    const quality = calculateQuality(content, html);
    
    expect(quality).toBeGreaterThanOrEqual(0);
    expect(quality).toBeLessThanOrEqual(1);
  });

  it('returns 0 for empty content', () => {
    const quality = calculateQuality('', '<html></html>');
    expect(quality).toBe(0);
  });

  it('returns 0 for very short content', () => {
    const quality = calculateQuality('abc', '<html><body><p>abc</p></body></html>');
    expect(quality).toBeLessThan(0.5);
  });

  it('gives higher scores to well-extracted content', () => {
    // Clean markdown extracted from larger HTML
    const goodContent = `# Main Article\n\nThis is a good article with meaningful content. It has paragraphs and structure.`;
    const html = '<html><head><script>lots of js</script></head><body><nav>nav</nav><article><h1>Main Article</h1><p>This is a good article with meaningful content. It has paragraphs and structure.</p></article><footer>footer</footer></body></html>';
    
    const quality = calculateQuality(goodContent, html);
    
    expect(quality).toBeGreaterThan(0.5);
  });

  it('penalizes content that is too similar to HTML (poor extraction)', () => {
    const poorContent = '<html><head><script>code</script></head><body><nav>nav</nav><p>Content</p></body></html>';
    const html = '<html><head><script>code</script></head><body><nav>nav</nav><p>Content</p></body></html>';
    
    const quality = calculateQuality(poorContent, html);
    
    expect(quality).toBeLessThan(0.8);
  });
});

describe('estimateTokens', () => {
  it('estimates tokens for short text', () => {
    const text = 'Hello world';
    const tokens = estimateTokens(text);
    
    // "Hello world" = 11 chars / 4 = ~3 tokens
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('estimates tokens for longer text', () => {
    const text = 'This is a much longer piece of text that contains multiple sentences and should result in more tokens being estimated.';
    const tokens = estimateTokens(text);
    
    expect(tokens).toBeGreaterThan(20);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('truncateToTokenBudget', () => {
  it('returns content as-is when under budget', () => {
    const content = 'Short content';
    const result = truncateToTokenBudget(content, 100);
    
    expect(result).toBe(content);
  });

  it('truncates content when over budget', () => {
    const content = 'A'.repeat(1000); // 1000 chars = ~250 tokens
    const result = truncateToTokenBudget(content, 50);
    
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain('truncated');
  });

  it('preserves first heading when truncating', () => {
    const content = `# Main Title\n\nParagraph 1\n\n## Section 2\n\nParagraph 2\n\n${'A'.repeat(1000)}`;
    const result = truncateToTokenBudget(content, 50);
    
    expect(result).toContain('# Main Title');
    expect(result).toContain('truncated');
  });

  it('adds truncation notice', () => {
    const content = 'A'.repeat(1000);
    const result = truncateToTokenBudget(content, 50);
    
    expect(result).toContain('[Content truncated to ~50 tokens]');
  });
});

describe('cleanMarkdownNoise', () => {
  it('removes empty links [](url)', () => {
    const input = 'Some text [](https://example.com) more text';
    const result = cleanMarkdownNoise(input);
    expect(result).not.toContain('[](');
    expect(result).toContain('Some text');
    expect(result).toContain('more text');
  });

  it('removes empty links with spaces [ ](url)', () => {
    const input = 'Text [  ](https://example.com) end';
    const result = cleanMarkdownNoise(input);
    expect(result).not.toContain('[  ](');
    expect(result).toContain('Text');
    expect(result).toContain('end');
  });

  it('removes image-only links [![](img)](link)', () => {
    const input = 'Content [![](https://img.example.com/icon.png)](https://example.com) more';
    const result = cleanMarkdownNoise(input);
    expect(result).not.toContain('[![](');
    expect(result).toContain('Content');
    expect(result).toContain('more');
  });

  it('collapses 3+ newlines to 2', () => {
    const input = 'Paragraph one\n\n\n\nParagraph two\n\n\n\n\nParagraph three';
    const result = cleanMarkdownNoise(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('Paragraph one');
    expect(result).toContain('Paragraph two');
    expect(result).toContain('Paragraph three');
  });

  it('removes trailing whitespace on lines', () => {
    const input = 'Line with spaces   \nAnother line\t  \nClean line';
    const result = cleanMarkdownNoise(input);
    const lines = result.split('\n');
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('trims leading and trailing whitespace from the whole string', () => {
    const input = '\n\nSome content\n\n';
    const result = cleanMarkdownNoise(input);
    expect(result).toBe('Some content');
  });

  it('preserves normal links [text](url)', () => {
    const input = 'Click [here](https://example.com) to continue';
    const result = cleanMarkdownNoise(input);
    expect(result).toContain('[here](https://example.com)');
  });

  it('preserves normal inline images ![alt](img)', () => {
    const input = 'An image: ![logo](https://example.com/logo.png) done';
    const result = cleanMarkdownNoise(input);
    expect(result).toContain('![logo](https://example.com/logo.png)');
  });
});
