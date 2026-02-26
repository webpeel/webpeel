import { describe, it, expect } from 'vitest';
import { cleanForAI } from '../core/markdown.js';

describe('cleanForAI', () => {
  it('converts links to plain text', () => {
    expect(cleanForAI('[Google](https://google.com)')).toBe('Google');
  });

  it('converts images to descriptive text', () => {
    expect(cleanForAI('![Logo](https://example.com/logo.png)')).toBe('[Image: Logo]');
  });

  it('removes images without alt text', () => {
    expect(cleanForAI('![](https://example.com/spacer.gif)')).toBe('');
  });

  it('preserves headings', () => {
    expect(cleanForAI('## Hello World\n\nSome text')).toBe('## Hello World\n\nSome text');
  });

  it('preserves bold and italic', () => {
    expect(cleanForAI('**bold** and *italic*')).toBe('**bold** and *italic*');
  });

  it('preserves code blocks', () => {
    const input = '```javascript\nconst x = 1;\n```';
    expect(cleanForAI(input)).toBe(input);
  });

  it('preserves lists', () => {
    expect(cleanForAI('- item 1\n- item 2')).toBe('- item 1\n- item 2');
  });

  it('removes reference-style link definitions', () => {
    expect(cleanForAI('[ref]: https://example.com')).toBe('');
  });

  it('removes citation references', () => {
    expect(cleanForAI('Einstein proposed[1] this theory[2].')).toBe('Einstein proposed this theory.');
  });

  it('removes standalone bare URLs', () => {
    expect(cleanForAI('Visit:\nhttps://example.com\nfor more')).toBe('Visit:\n\nfor more');
  });

  it('removes HTML comments', () => {
    expect(cleanForAI('before <!-- comment --> after')).toBe('before  after');
  });

  it('collapses excessive newlines', () => {
    expect(cleanForAI('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('handles complex real-world content', () => {
    const input = `# Web Scraping

[Web scraping](https://en.wikipedia.org/wiki/Web_scraping) is [data extraction](https://example.com/data) used for websites.[1][2]

![diagram](https://example.com/diagram.png)

## Techniques

- [Crawl4AI](https://github.com/crawl4ai) — open source
- [Firecrawl](https://firecrawl.dev) — managed service

[1]: https://example.com/ref1
[2]: https://example.com/ref2`;

    const result = cleanForAI(input);
    expect(result).toContain('# Web Scraping');
    expect(result).toContain('Web scraping is data extraction used for websites.');
    expect(result).toContain('Crawl4AI — open source');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('](');
  });
});
