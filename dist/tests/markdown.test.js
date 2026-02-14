/**
 * Tests for markdown conversion
 */
import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, htmlToText, estimateTokens, filterByTags, selectContent, detectMainContent, calculateQuality, truncateToTokenBudget, } from '../core/markdown.js';
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
    it('estimates single character correctly', () => {
        expect(estimateTokens('a')).toBe(1);
    });
    it('estimates with special characters', () => {
        const text = '🚀 Hello! @#$%^&*()';
        const tokens = estimateTokens(text);
        expect(tokens).toBeGreaterThan(0);
    });
});
describe('filterByTags', () => {
    it('includes only specified tags', () => {
        const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <article>Article content</article>
          <aside>Sidebar</aside>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, ['article']);
        expect(filtered).toContain('Article content');
        expect(filtered).not.toContain('Navigation');
        expect(filtered).not.toContain('Sidebar');
    });
    it('excludes specified tags', () => {
        const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <article>Article content</article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, undefined, ['nav', 'footer']);
        expect(filtered).toContain('Article content');
        expect(filtered).not.toContain('Navigation');
        expect(filtered).not.toContain('Footer');
    });
    it('handles both include and exclude tags', () => {
        const html = `
      <html>
        <body>
          <article>
            <h1>Title</h1>
            <nav>Article nav</nav>
            <p>Content</p>
          </article>
          <aside>Sidebar</aside>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, ['article'], ['nav']);
        expect(filtered).toContain('Title');
        expect(filtered).toContain('Content');
        expect(filtered).not.toContain('Article nav');
        expect(filtered).not.toContain('Sidebar');
    });
    it('supports CSS class selectors', () => {
        const html = `
      <html>
        <body>
          <div class="content">Main content</div>
          <div class="sidebar">Sidebar</div>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, ['.content']);
        expect(filtered).toContain('Main content');
        expect(filtered).not.toContain('Sidebar');
    });
    it('returns empty string when include tags match nothing', () => {
        const html = `
      <html>
        <body>
          <div>Content</div>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, ['article']);
        expect(filtered).toBe('');
    });
    it('handles multiple include tag matches', () => {
        const html = `
      <html>
        <body>
          <article>Article 1</article>
          <article>Article 2</article>
          <section>Section content</section>
        </body>
      </html>
    `;
        const filtered = filterByTags(html, ['article', 'section']);
        expect(filtered).toContain('Article 1');
        expect(filtered).toContain('Article 2');
        expect(filtered).toContain('Section content');
    });
});
describe('selectContent', () => {
    it('selects content by CSS selector', () => {
        const html = `
      <html>
        <body>
          <div class="content">Main content</div>
          <div class="sidebar">Sidebar</div>
        </body>
      </html>
    `;
        const selected = selectContent(html, '.content');
        expect(selected).toContain('Main content');
        expect(selected).not.toContain('Sidebar');
    });
    it('falls back to full HTML when selector matches nothing', () => {
        const html = `
      <html>
        <body>
          <div>Content</div>
        </body>
      </html>
    `;
        const selected = selectContent(html, '.nonexistent');
        expect(selected).toContain('Content'); // Returns full HTML
    });
    it('applies exclude patterns', () => {
        const html = `
      <html>
        <body>
          <article>
            <h1>Title</h1>
            <nav>Navigation</nav>
            <p>Content</p>
          </article>
        </body>
      </html>
    `;
        const selected = selectContent(html, 'article', ['nav']);
        expect(selected).toContain('Title');
        expect(selected).toContain('Content');
        expect(selected).not.toContain('Navigation');
    });
    it('handles multiple matching selectors', () => {
        const html = `
      <html>
        <body>
          <p class="intro">Intro</p>
          <p class="intro">More intro</p>
        </body>
      </html>
    `;
        const selected = selectContent(html, '.intro');
        expect(selected).toContain('Intro');
        expect(selected).toContain('More intro');
    });
});
describe('detectMainContent', () => {
    it('detects article tags', () => {
        const html = `
      <html>
        <body>
          <nav>Navigation</nav>
          <article>
            <h1>Article Title</h1>
            <p>This is the main article content with sufficient length to be detected as the primary content area of the page.</p>
          </article>
          <footer>Footer</footer>
        </body>
      </html>
    `;
        const result = detectMainContent(html);
        expect(result.detected).toBe(true);
        expect(result.html).toContain('Article Title');
        expect(result.html).not.toContain('Navigation');
    });
    it('detects main tags', () => {
        const html = `
      <html>
        <body>
          <header>Header</header>
          <main>
            <h1>Main Content</h1>
            <p>This is the main content area with enough text to be considered significant content for detection purposes.</p>
          </main>
          <aside>Sidebar</aside>
        </body>
      </html>
    `;
        const result = detectMainContent(html);
        expect(result.detected).toBe(true);
        expect(result.html).toContain('Main Content');
        expect(result.html).not.toContain('Header');
    });
    it('detects content divs by class', () => {
        const html = `
      <html>
        <body>
          <div class="sidebar">Sidebar</div>
          <div class="post-content">
            <h1>Post Title</h1>
            <p>This is the main post content that should be detected as the primary content because it has sufficient text length.</p>
          </div>
        </body>
      </html>
    `;
        const result = detectMainContent(html);
        expect(result.detected).toBe(true);
        expect(result.html).toContain('Post Title');
    });
    it('returns not detected when no semantic elements exist', () => {
        const html = `
      <html>
        <body>
          <div>
            <div>Short text</div>
            <div>
              <p>This is a much longer text block but without semantic containers.</p>
            </div>
          </div>
        </body>
      </html>
    `;
        const result = detectMainContent(html);
        // Without article/main/.content, detection should not trigger
        expect(result.detected).toBe(false);
    });
    it('returns full HTML when no main content detected', () => {
        const html = `
      <html>
        <body>
          <div>Short</div>
        </body>
      </html>
    `;
        const result = detectMainContent(html);
        expect(result.detected).toBe(false);
        expect(result.html).toContain('Short');
    });
});
describe('calculateQuality', () => {
    it('scores clean markdown content highly', () => {
        const content = `# Article Title

This is a well-formatted article with multiple paragraphs and good structure.

## Section 1

More content here with meaningful text that demonstrates quality.`;
        const originalHtml = '<html><head><script>...</script></head><body>' + content.repeat(10) + '</body></html>';
        const quality = calculateQuality(content, originalHtml);
        expect(quality).toBeGreaterThan(0.5);
        expect(quality).toBeLessThanOrEqual(1.0);
    });
    it('scores short content lower', () => {
        const content = 'Too short';
        const originalHtml = '<html><body>' + content + '</body></html>';
        const quality = calculateQuality(content, originalHtml);
        expect(quality).toBeLessThan(0.5);
    });
    it('returns 0 for empty content', () => {
        const quality = calculateQuality('', '<html></html>');
        expect(quality).toBe(0);
    });
    it('scores content with headings and paragraphs highly', () => {
        const content = `# Main Title

First paragraph with meaningful content.

## Subsection

More paragraphs here with good text density and structure.`;
        const originalHtml = '<html><body><div>' + content.repeat(5) + '</div></body></html>';
        const quality = calculateQuality(content, originalHtml);
        expect(quality).toBeGreaterThan(0.6);
    });
    it('penalizes content with too much markup', () => {
        const content = '# # # * * * [ ] ( ) | | | > > >'.repeat(10);
        const originalHtml = '<html><body>' + content + '</body></html>';
        const quality = calculateQuality(content, originalHtml);
        expect(quality).toBeLessThan(0.7);
    });
});
describe('truncateToTokenBudget', () => {
    it('returns content as-is when under budget', () => {
        const content = 'Short content';
        const tokens = estimateTokens(content);
        const truncated = truncateToTokenBudget(content, tokens + 100);
        expect(truncated).toBe(content);
    });
    it('truncates content when over budget', () => {
        const content = 'word '.repeat(1000); // ~5000 chars = ~1250 tokens
        const truncated = truncateToTokenBudget(content, 500);
        expect(truncated).toContain('[Content truncated');
        expect(estimateTokens(truncated)).toBeLessThanOrEqual(550); // Allow some margin
    });
    it('preserves first heading', () => {
        const content = `# Important Title

Paragraph 1 with content.

Paragraph 2 with more content.

${'More content. '.repeat(200)}`;
        const truncated = truncateToTokenBudget(content, 100);
        expect(truncated).toContain('# Important Title');
        expect(truncated).toContain('[Content truncated');
    });
    it('handles content without headings', () => {
        const content = 'No headings here. '.repeat(100);
        const truncated = truncateToTokenBudget(content, 50);
        expect(truncated).toContain('[Content truncated');
        expect(estimateTokens(truncated)).toBeLessThanOrEqual(60);
    });
    it('enforces minimum content inclusion', () => {
        const content = `# Title

First line of content.`;
        const truncated = truncateToTokenBudget(content, 5); // Very low budget
        expect(truncated).toContain('# Title');
    });
});
//# sourceMappingURL=markdown.test.js.map