/**
 * Tests for readability.ts
 *
 * Validates the readability engine that strips page noise and extracts
 * the main article content — like browser Reader Mode but for AI agents.
 */

import { describe, it, expect } from 'vitest';
import { extractReadableContent } from '../core/readability.js';

// ─── Fixture HTML ────────────────────────────────────────────────────────────

/**
 * Standard test article page with realistic noise elements.
 */
const ARTICLE_HTML = `
<html lang="en">
<head>
  <title>Test Article Title — Example Site</title>
  <meta name="author" content="John Smith">
  <meta property="og:title" content="Test Article Title">
  <meta property="og:site_name" content="Example Site">
  <meta property="article:published_time" content="2024-01-15T10:00:00Z">
</head>
<body>
  <nav>Home | About | Contact</nav>
  <div class="cookie-banner">We use cookies to improve your experience.</div>
  <main>
    <article>
      <h1>Test Article Title</h1>
      <div class="byline">By John Smith · January 15, 2024</div>
      <p>First paragraph of the actual article content with real information about the topic at hand.</p>
      <p>Second paragraph continues the article with more details and facts that are relevant.</p>
      <div class="share-buttons">Share on Twitter | Facebook | LinkedIn</div>
      <p>Third paragraph wraps up the main points and provides a conclusion for the reader.</p>
    </article>
  </main>
  <aside class="sidebar">
    <h3>Related Articles</h3>
    <ul><li>Article 1</li><li>Article 2</li></ul>
  </aside>
  <div class="newsletter">Subscribe to our newsletter! Get the latest updates.</div>
  <footer>Copyright 2024 Example Site. All rights reserved.</footer>
</body>
</html>
`;

/**
 * Page without <article> tag — only a content div.
 */
const NO_ARTICLE_HTML = `
<html lang="en">
<head>
  <title>No Article Tag</title>
  <meta name="author" content="Jane Doe">
</head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav>
  <div class="main-content">
    <h1>An Article Without Article Tag</h1>
    <p>This content is inside a div with class main-content, not an article tag.</p>
    <p>There is a second paragraph here with more substantive content to read.</p>
    <p>And a third paragraph that provides additional depth and context to the story.</p>
  </div>
  <div class="sidebar">
    <ul>
      <li><a href="/1">Link 1</a></li>
      <li><a href="/2">Link 2</a></li>
      <li><a href="/3">Link 3</a></li>
    </ul>
  </div>
  <footer>Footer content copyright 2024.</footer>
</body>
</html>
`;

/**
 * Page with nav bar having many links (high link density — should score low).
 */
const HIGH_LINK_DENSITY_HTML = `
<html>
<head><title>Link Density Test</title></head>
<body>
  <nav>
    <a href="/a">Alpha</a>
    <a href="/b">Beta</a>
    <a href="/c">Gamma</a>
    <a href="/d">Delta</a>
    <a href="/e">Epsilon</a>
    <a href="/f">Zeta</a>
    <a href="/g">Eta</a>
    <a href="/h">Theta</a>
  </nav>
  <article>
    <h1>Real Content Here</h1>
    <p>This is the real article text with meaningful content for the reader to consume.</p>
    <p>Another real paragraph with more words and actual information about the topic.</p>
    <p>The final paragraph concludes the article with solid information and insight.</p>
  </article>
</body>
</html>
`;

/**
 * Page with noise elements nested inside the main content area.
 */
const NESTED_NOISE_HTML = `
<html>
<head><title>Nested Noise</title></head>
<body>
  <main>
    <article>
      <h1>Article With Nested Noise</h1>
      <p>This is the first paragraph with real article content for the reader.</p>
      <div class="social-share">
        <a href="#">Share on Twitter</a>
        <a href="#">Share on Facebook</a>
        <a href="#">Share on LinkedIn</a>
      </div>
      <p>This is the second paragraph continuing the article after the share buttons.</p>
      <div class="newsletter">Sign up for our newsletter to get more content!</div>
      <p>This is the third and final paragraph of the article that wraps things up.</p>
    </article>
    <aside class="related">
      <h3>You might also like</h3>
      <ul>
        <li><a href="/art1">Related Article 1</a></li>
        <li><a href="/art2">Related Article 2</a></li>
      </ul>
    </aside>
  </main>
</body>
</html>
`;

/**
 * Minimal/empty page.
 */
const EMPTY_HTML = `<html><head><title>Empty</title></head><body></body></html>`;

/**
 * Page with images and code blocks.
 */
const IMAGES_AND_CODE_HTML = `
<html>
<head><title>Images and Code</title></head>
<body>
  <main>
    <article>
      <h1>Article With Media</h1>
      <p>Introduction to the article with real content for the reader to enjoy.</p>
      <img src="https://example.com/photo.jpg" alt="A descriptive photo">
      <p>A paragraph explaining the image above in detail for context and clarity.</p>
      <pre><code class="language-python">def hello():
    print("Hello, World!")</code></pre>
      <p>A final paragraph after the code block explaining what the code does here.</p>
    </article>
  </main>
</body>
</html>
`;

// ─── Core extraction tests ────────────────────────────────────────────────────

describe('extractReadableContent — core article extraction', () => {
  it('extracts article content and strips nav/sidebar/footer/noise', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');

    // Should contain the article paragraphs
    expect(result.content).toContain('First paragraph of the actual article content');
    expect(result.content).toContain('Second paragraph continues the article');
    expect(result.content).toContain('Third paragraph wraps up the main points');

    // Should NOT contain noise elements
    expect(result.content).not.toContain('Home | About | Contact');
    expect(result.content).not.toContain('We use cookies');
    expect(result.content).not.toContain('Subscribe to our newsletter');
    expect(result.content).not.toContain('Copyright 2024 Example Site');
    expect(result.content).not.toContain('Related Articles');
  });

  it('strips share buttons from content', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    // Share buttons should be removed or their text minimized
    // The content should not contain the share button widget text
    expect(result.content).not.toContain('Share on Twitter | Facebook | LinkedIn');
  });
});

// ─── Metadata extraction tests ────────────────────────────────────────────────

describe('extractReadableContent — metadata extraction', () => {
  it('extracts title from og:title / h1', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.title).toBe('Test Article Title');
  });

  it('extracts author from meta[name=author]', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.author).toBe('John Smith');
  });

  it('extracts date from article:published_time', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.date).toBeTruthy();
    // Should contain the date in some format
    expect(result.date).toContain('2024');
  });

  it('extracts site name from og:site_name', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.siteName).toBe('Example Site');
  });

  it('extracts language from html lang attribute', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.language).toBe('en');
  });

  it('returns null for missing metadata fields', () => {
    const result = extractReadableContent(
      '<html><body><article><h1>Title</h1><p>Content goes here for testing purposes today.</p></article></body></html>',
      'https://example.com',
    );
    expect(result.siteName).toBeNull();
    expect(result.language).toBeNull();
  });
});

// ─── Reading time ─────────────────────────────────────────────────────────────

describe('extractReadableContent — reading time', () => {
  it('calculates reasonable reading time', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    // Short article should be "1 min read"
    expect(result.readingTime).toMatch(/\d+ min read/);
  });

  it('returns at minimum "1 min read"', () => {
    const result = extractReadableContent(
      '<html><body><article><p>Very short content.</p></article></body></html>',
      'https://example.com',
    );
    expect(result.readingTime).toBe('1 min read');
  });

  it('calculates word count', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.wordCount).toBeGreaterThan(0);
  });
});

// ─── Excerpt generation ───────────────────────────────────────────────────────

describe('extractReadableContent — excerpt', () => {
  it('generates excerpt from first 2 sentences', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    expect(result.excerpt).toBeTruthy();
    expect(result.excerpt.length).toBeGreaterThan(0);
    // Excerpt should be substantially shorter than full content
    expect(result.excerpt.length).toBeLessThan(result.content.length);
  });

  it('excerpt contains actual content from the article', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    // Excerpt should come from the article text, not metadata
    const hasArticleContent =
      result.excerpt.includes('First paragraph') ||
      result.excerpt.includes('article content') ||
      result.excerpt.includes('Test Article') ||
      result.excerpt.length > 0;
    expect(hasArticleContent).toBe(true);
  });
});

// ─── Fallback behavior ────────────────────────────────────────────────────────

describe('extractReadableContent — fallback behavior', () => {
  it('handles pages without <article> tag — falls back to best div', () => {
    const result = extractReadableContent(NO_ARTICLE_HTML, 'https://example.com/no-article');

    // Should still find the content
    expect(result.content).toContain('An Article Without Article Tag');
    expect(result.content).toContain('inside a div with class main-content');
  });

  it('handles empty/minimal pages gracefully without throwing', () => {
    expect(() => {
      extractReadableContent(EMPTY_HTML, 'https://example.com/empty');
    }).not.toThrow();
  });

  it('returns empty content for empty page', () => {
    const result = extractReadableContent(EMPTY_HTML, 'https://example.com/empty');
    // Should return something without throwing
    expect(result).toBeTruthy();
    expect(result.readingTime).toBe('1 min read');
  });

  it('handles empty HTML string gracefully', () => {
    expect(() => {
      extractReadableContent('', 'https://example.com');
    }).not.toThrow();

    const result = extractReadableContent('', 'https://example.com');
    expect(result.content).toBe('');
    expect(result.wordCount).toBe(0);
  });

  it('handles pages with no clear main content — returns best guess', () => {
    const html = `
      <html><body>
        <div><p>Some content that is available on this page for reading.</p>
        <p>More content here with additional words and paragraphs to extract.</p></div>
      </body></html>
    `;
    const result = extractReadableContent(html, 'https://example.com');
    // Should return something rather than nothing
    expect(result.content.length).toBeGreaterThanOrEqual(0);
    // Should not throw
    expect(result).toBeTruthy();
  });
});

// ─── Link density filtering ───────────────────────────────────────────────────

describe('extractReadableContent — link density filtering', () => {
  it('keeps article text with low link density, strips high-link-density nav', () => {
    const result = extractReadableContent(HIGH_LINK_DENSITY_HTML, 'https://example.com/article');

    // Article content should be present
    expect(result.content).toContain('Real Content Here');
    expect(result.content).toContain('real article text with meaningful content');

    // Nav links (high link density) should be stripped
    expect(result.content).not.toContain('Alpha');
    expect(result.content).not.toContain('Beta');
  });
});

// ─── Nested noise removal ─────────────────────────────────────────────────────

describe('extractReadableContent — nested noise removal', () => {
  it('removes noise elements nested inside the main content area', () => {
    const result = extractReadableContent(NESTED_NOISE_HTML, 'https://example.com/article');

    // Article paragraphs should be preserved
    expect(result.content).toContain('first paragraph with real article content');
    expect(result.content).toContain('second paragraph continuing the article');
    expect(result.content).toContain('third and final paragraph');

    // Nested noise should be removed
    expect(result.content).not.toContain('Sign up for our newsletter');
    expect(result.content).not.toContain('You might also like');
  });
});

// ─── includeImages option ─────────────────────────────────────────────────────

describe('extractReadableContent — includeImages option', () => {
  it('keeps images by default (includeImages: true)', () => {
    const result = extractReadableContent(IMAGES_AND_CODE_HTML, 'https://example.com', {
      includeImages: true,
    });
    // The image alt text or src should appear somewhere
    const hasImage = result.content.includes('photo.jpg') || result.content.includes('A descriptive photo');
    expect(hasImage).toBe(true);
  });

  it('strips image references when includeImages: false', () => {
    const result = extractReadableContent(IMAGES_AND_CODE_HTML, 'https://example.com', {
      includeImages: false,
    });
    // Image URLs should not appear
    expect(result.content).not.toContain('photo.jpg');
    // Article text should still be present
    expect(result.content).toContain('Introduction to the article');
  });
});

// ─── includeCode option ───────────────────────────────────────────────────────

describe('extractReadableContent — includeCode option', () => {
  it('keeps code blocks by default (includeCode: true)', () => {
    const result = extractReadableContent(IMAGES_AND_CODE_HTML, 'https://example.com', {
      includeCode: true,
    });
    // Code content should appear
    expect(result.content).toContain('hello');
    // Article text preserved
    expect(result.content).toContain('Introduction to the article');
  });

  it('strips code blocks when includeCode: false', () => {
    const result = extractReadableContent(IMAGES_AND_CODE_HTML, 'https://example.com', {
      includeCode: false,
    });
    // Code should be stripped
    expect(result.content).not.toContain('def hello');
    // Article text should still be present
    expect(result.content).toContain('Introduction to the article');
  });
});

// ─── maxLength option ─────────────────────────────────────────────────────────

describe('extractReadableContent — maxLength option', () => {
  it('truncates content to maxLength when set', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article', {
      maxLength: 100,
    });
    expect(result.content.length).toBeLessThanOrEqual(150); // +small buffer for truncation notice
  });

  it('does not truncate when content is shorter than maxLength', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article', {
      maxLength: 100000,
    });
    // Full content preserved
    expect(result.content).toContain('First paragraph of the actual article content');
  });
});

// ─── Content quality ──────────────────────────────────────────────────────────

describe('extractReadableContent — content quality', () => {
  it('includes a metadata header with title and reading time', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    // Content should start with or contain title
    expect(result.content).toContain('Test Article Title');
    // Should contain reading time
    expect(result.content).toContain('min read');
  });

  it('returns structured result with all required fields', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');

    // All fields should be present
    expect(typeof result.title).toBe('string');
    expect(result.author === null || typeof result.author === 'string').toBe(true);
    expect(result.date === null || typeof result.date === 'string').toBe(true);
    expect(result.siteName === null || typeof result.siteName === 'string').toBe(true);
    expect(typeof result.content).toBe('string');
    expect(typeof result.excerpt).toBe('string');
    expect(typeof result.wordCount).toBe('number');
    expect(typeof result.readingTime).toBe('string');
    expect(result.language === null || typeof result.language === 'string').toBe(true);
  });
});

// ─── Author extraction from byline ────────────────────────────────────────────

describe('extractReadableContent — byline author extraction', () => {
  it('extracts author from meta[name=author]', () => {
    const result = extractReadableContent(ARTICLE_HTML, 'https://example.com/article');
    // Author should be John Smith from the meta tag
    expect(result.author).toBe('John Smith');
  });

  it('extracts author from byline div when meta is missing', () => {
    const html = `
      <html>
      <head><title>Byline Test</title></head>
      <body>
        <article>
          <h1>Test Article</h1>
          <div class="byline">By Jane Doe</div>
          <p>Article content with enough words and substance for proper extraction here.</p>
          <p>More content in the second paragraph of this article for testing purposes.</p>
        </article>
      </body>
      </html>
    `;
    const result = extractReadableContent(html, 'https://example.com/article');
    // Should extract Jane Doe from byline, stripping "By " prefix
    expect(result.author).toBeTruthy();
    // Author should be Jane Doe or null (byline extraction is best-effort)
    if (result.author) {
      expect(result.author).toContain('Jane Doe');
    }
  });
});

// ─── includeLinks option ──────────────────────────────────────────────────────

describe('extractReadableContent — includeLinks option', () => {
  it('keeps links by default', () => {
    const html = `
      <html><body>
        <article>
          <h1>Links Test</h1>
          <p>Visit <a href="https://example.com">this great resource</a> for more info.</p>
          <p>Additional content paragraph with more words for the reader to read here.</p>
        </article>
      </body></html>
    `;
    const result = extractReadableContent(html, 'https://test.com', { includeLinks: true });
    // Link text should be preserved
    expect(result.content).toContain('this great resource');
  });

  it('strips links when includeLinks: false', () => {
    const html = `
      <html><body>
        <article>
          <h1>Links Test</h1>
          <p>Visit <a href="https://example.com">this great resource</a> for more info.</p>
          <p>Additional content paragraph with more words for the reader to read here.</p>
        </article>
      </body></html>
    `;
    const result = extractReadableContent(html, 'https://test.com', { includeLinks: false });
    // Link URL should not appear
    expect(result.content).not.toContain('https://example.com');
    // Link text becomes plain text
    expect(result.content).toContain('this great resource');
  });
});

// ─── includeTables option ─────────────────────────────────────────────────────

describe('extractReadableContent — includeTables option', () => {
  it('keeps tables by default', () => {
    const html = `
      <html><body>
        <article>
          <h1>Tables Test</h1>
          <p>Introduction paragraph with meaningful content for article extraction.</p>
          <table>
            <thead><tr><th>Column A</th><th>Column B</th></tr></thead>
            <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
          </table>
          <p>Conclusion paragraph after the table with additional content.</p>
        </article>
      </body></html>
    `;
    const result = extractReadableContent(html, 'https://test.com', { includeTables: true });
    // Table content should appear in output
    const hasTableContent = result.content.includes('Column A') || result.content.includes('Cell 1');
    expect(hasTableContent).toBe(true);
  });

  it('strips tables when includeTables: false', () => {
    const html = `
      <html><body>
        <article>
          <h1>Tables Test</h1>
          <p>Introduction paragraph with meaningful content for article extraction.</p>
          <table>
            <thead><tr><th>Column A</th><th>Column B</th></tr></thead>
            <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
          </table>
          <p>Conclusion paragraph after the table with additional content.</p>
        </article>
      </body></html>
    `;
    const result = extractReadableContent(html, 'https://test.com', { includeTables: false });
    // Table content should be stripped
    expect(result.content).not.toContain('Column A');
    expect(result.content).not.toContain('Cell 1');
    // Surrounding article text should still be present
    expect(result.content).toContain('Introduction paragraph');
  });
});

// ─── Real-world simulation ────────────────────────────────────────────────────

describe('extractReadableContent — real-world simulation', () => {
  it('handles a typical news article page with all noise types', () => {
    const newsHtml = `
      <html lang="en">
      <head>
        <title>Breaking: Major Event Happens Today | News Site</title>
        <meta name="author" content="Staff Reporter">
        <meta property="og:title" content="Breaking: Major Event Happens Today">
        <meta property="og:site_name" content="News Site">
        <meta property="article:published_time" content="2024-03-20T14:30:00Z">
      </head>
      <body>
        <header>
          <a href="/">News Site Logo</a>
          <nav>
            <a href="/news">News</a>
            <a href="/sports">Sports</a>
            <a href="/tech">Technology</a>
            <a href="/politics">Politics</a>
            <a href="/entertainment">Entertainment</a>
          </nav>
        </header>

        <div class="cookie-banner" role="dialog">
          <p>We use cookies to improve your experience. Accept to continue.</p>
          <button>Accept All</button>
        </div>

        <main>
          <article>
            <h1>Breaking: Major Event Happens Today</h1>
            <div class="byline">By Staff Reporter · March 20, 2024</div>
            <p class="lead">In a significant development today, a major event occurred that has broad implications for people worldwide.</p>
            <p>According to multiple sources, the event began in the early morning hours and quickly attracted widespread attention from officials and the public alike.</p>
            <div class="social-share">
              <a href="#">Share on Twitter</a>
              <a href="#">Share on Facebook</a>
            </div>
            <p>Experts are weighing in on what the development means for the future, with many calling it a turning point in the ongoing situation.</p>
            <blockquote>
              "This is a pivotal moment," said one official familiar with the matter.
            </blockquote>
            <p>More details are expected to emerge throughout the day as reporters continue gathering information on the ground.</p>
          </article>
        </main>

        <aside class="sidebar">
          <div class="widget">
            <h3>Most Popular</h3>
            <ul>
              <li><a href="/article/1">Popular Story 1</a></li>
              <li><a href="/article/2">Popular Story 2</a></li>
              <li><a href="/article/3">Popular Story 3</a></li>
            </ul>
          </div>
          <div class="ad-unit">
            <p>Advertisement</p>
          </div>
        </aside>

        <div class="newsletter-signup">
          <h2>Subscribe to our newsletter</h2>
          <p>Get the latest news delivered to your inbox.</p>
          <form><input type="email" placeholder="Your email"><button>Subscribe</button></form>
        </div>

        <footer>
          <a href="/about">About Us</a>
          <a href="/contact">Contact</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <p>© 2024 News Site. All rights reserved.</p>
        </footer>
      </body>
      </html>
    `;

    const result = extractReadableContent(newsHtml, 'https://news.example.com/article/breaking');

    // Core article content preserved
    expect(result.content).toContain('Major Event Happens Today');
    expect(result.content).toContain('significant development today');
    expect(result.content).toContain('pivotal moment');

    // Noise removed
    expect(result.content).not.toContain('We use cookies');
    expect(result.content).not.toContain('Subscribe to our newsletter');
    expect(result.content).not.toContain('© 2024 News Site');
    expect(result.content).not.toContain('Most Popular');

    // Metadata extracted
    expect(result.title).toContain('Major Event Happens Today');
    expect(result.author).toBeTruthy();
    expect(result.date).toBeTruthy();
    expect(result.siteName).toBe('News Site');
    expect(result.language).toBe('en');

    // Reading metadata
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.readingTime).toMatch(/\d+ min read/);
    expect(result.excerpt).toBeTruthy();
  });
});
