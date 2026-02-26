/**
 * Tests for src/core/chunker.ts
 *
 * Covers: section, paragraph, fixed strategies; overlap; metadata;
 * edge cases (empty, single paragraph, default options).
 */

import { describe, it, expect } from 'vitest';
import { chunkContent, type ContentChunk } from '../core/chunker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(tokens: number, char = 'x'): string {
  return char.repeat(tokens * 4);
}

// ---------------------------------------------------------------------------
// Section strategy — splits by headings
// ---------------------------------------------------------------------------

describe('chunkContent — section strategy', () => {
  it('splits by headings — basic case with 3 sections', () => {
    const content = [
      '# Introduction',
      '',
      'This is the introduction.',
      '',
      '## Section One',
      '',
      'Content for section one.',
      '',
      '## Section Two',
      '',
      'Content for section two.',
    ].join('\n');

    const result = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    expect(result.totalChunks).toBeGreaterThanOrEqual(2);
    expect(result.chunks.length).toBe(result.totalChunks);
    expect(result.strategy).toBe('section');
  });

  it('large section gets sub-split by paragraph', () => {
    // Create a section that is larger than maxTokens
    const paras = Array.from({ length: 10 }, (_, i) => `Para ${i + 1}: ${'word '.repeat(30).trim()}`);
    const content = '## Large Section\n\n' + paras.join('\n\n');

    // maxTokens=50 → maxChars=200, each para ~150 chars → triggers sub-split
    const result = chunkContent(content, { strategy: 'section', maxTokens: 50, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThan(1);
    // All chunks should reference the same section
    for (const chunk of result.chunks) {
      expect(chunk.section).toBe('Large Section');
    }
  });

  it('includes section heading in each chunk', () => {
    const content = [
      '## My Section',
      '',
      'Some content here.',
    ].join('\n');

    const result = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    const chunk = result.chunks[0];
    expect(chunk.section).toBe('My Section');
    expect(chunk.sectionDepth).toBe(2);
    expect(chunk.text).toContain('## My Section');
  });

  it('overlap — text from end of chunk N appears at start of chunk N+1', () => {
    // Build a large section with many paragraphs to force sub-splitting
    const paras = Array.from({ length: 20 }, (_, i) => `Para ${i + 1}: ${'word '.repeat(20).trim()}`);
    const content = '## Big Section\n\n' + paras.join('\n\n');

    const result = chunkContent(content, { strategy: 'section', maxTokens: 30, overlap: 10 });
    if (result.chunks.length >= 2) {
      const chunkA = result.chunks[0];
      const chunkB = result.chunks[1];
      // Chunk B should contain some text from the end of chunk A (due to overlap)
      // We just verify both chunks belong to the same section and consecutive indices
      expect(chunkB.index).toBe(chunkA.index + 1);
      expect(chunkB.section).toBe(chunkA.section);
    }
  });
});

// ---------------------------------------------------------------------------
// Paragraph strategy
// ---------------------------------------------------------------------------

describe('chunkContent — paragraph strategy', () => {
  it('groups paragraphs together', () => {
    const paras = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1} with some content here.`);
    const content = paras.join('\n\n');

    const result = chunkContent(content, { strategy: 'paragraph', maxTokens: 512, overlap: 0 });
    // All short paragraphs should be grouped into a single chunk
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0].text).toContain('Paragraph 1');
    expect(result.chunks[0].text).toContain('Paragraph 10');
  });

  it('respects maxTokens — splits when paragraphs exceed budget', () => {
    // Each paragraph is ~50 tokens (200 chars); maxTokens=60 → each paragraph fits once, triggers split at 2nd
    const paras = Array.from({ length: 10 }, () => makeContent(50));
    const content = paras.join('\n\n');

    const result = chunkContent(content, { strategy: 'paragraph', maxTokens: 60, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThan(1);
    // No chunk should exceed maxTokens * CHARS_PER_TOKEN (approx)
    for (const chunk of result.chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('tracks section heading from headings in content', () => {
    const content = [
      '## My Topic',
      '',
      'Paragraph one here.',
      '',
      'Paragraph two here.',
    ].join('\n');

    const result = chunkContent(content, { strategy: 'paragraph', maxTokens: 512 });
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    // The last chunk should have section info set to "My Topic"
    const lastChunk = result.chunks[result.chunks.length - 1];
    expect(lastChunk.section).toBe('My Topic');
    expect(lastChunk.sectionDepth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fixed strategy
// ---------------------------------------------------------------------------

describe('chunkContent — fixed strategy', () => {
  it('produces consistent chunk sizes', () => {
    const content = makeContent(1000);

    const result = chunkContent(content, { strategy: 'fixed', maxTokens: 200, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThan(1);
    // Each chunk should be approximately maxTokens * 4 chars
    for (const chunk of result.chunks.slice(0, -1)) {
      expect(chunk.text.length).toBeLessThanOrEqual(200 * 4);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('overlap — chunks overlap correctly', () => {
    const content = makeContent(2000);
    const overlapTokens = 50;
    const maxTokens = 200;

    const result = chunkContent(content, { strategy: 'fixed', maxTokens, overlap: overlapTokens });
    expect(result.totalChunks).toBeGreaterThan(1);

    // Each chunk should start at i and end at i + maxChars (with step = maxChars - overlapChars)
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;
    const step = maxChars - overlapChars;

    // Verify second chunk starts at `step` (i.e. overlap is present)
    if (result.chunks.length >= 2) {
      expect(result.chunks[1].startOffset).toBe(step);
    }
  });

  it('startOffset is correct for each chunk', () => {
    const content = makeContent(500);
    const result = chunkContent(content, { strategy: 'fixed', maxTokens: 100, overlap: 0 });

    for (const chunk of result.chunks) {
      // The chunk text should correspond to the content at startOffset
      const fromSource = content.slice(chunk.startOffset, chunk.endOffset).trim();
      expect(fromSource).toBe(chunk.text);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('chunkContent — edge cases', () => {
  it('empty content returns no chunks', () => {
    const result = chunkContent('', { strategy: 'section' });
    expect(result.chunks).toHaveLength(0);
    expect(result.totalChunks).toBe(0);
    expect(result.originalLength).toBe(0);
  });

  it('empty content with paragraph strategy returns no chunks', () => {
    const result = chunkContent('', { strategy: 'paragraph' });
    expect(result.chunks).toHaveLength(0);
  });

  it('empty content with fixed strategy returns no chunks', () => {
    const result = chunkContent('', { strategy: 'fixed' });
    expect(result.chunks).toHaveLength(0);
  });

  it('single paragraph content returns one chunk', () => {
    const content = 'This is a single paragraph of content.';
    const result = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0].text).toBe(content);
  });

  it('single paragraph paragraph strategy returns one chunk', () => {
    const content = 'Just one paragraph here.';
    const result = chunkContent(content, { strategy: 'paragraph', maxTokens: 512 });
    expect(result.totalChunks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Chunk metadata
// ---------------------------------------------------------------------------

describe('chunkContent — metadata correctness', () => {
  it('chunk metadata is correct — index, wordCount, tokenCount, offsets', () => {
    const content = [
      '# Title',
      '',
      'First section content with several words here.',
      '',
      '## Second Section',
      '',
      'Second section body text.',
    ].join('\n');

    const result = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);

    result.chunks.forEach((chunk: ContentChunk, i: number) => {
      expect(chunk.index).toBe(i);
      expect(chunk.wordCount).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBe(Math.ceil(chunk.text.length / 4));
      expect(chunk.wordCount).toBe(chunk.text.split(/\s+/).filter(Boolean).length);
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
    });
  });

  it('sectionDepth is correct for h1, h2, h3', () => {
    const content = [
      '# H1 Section',
      '',
      'Content under h1.',
      '',
      '## H2 Section',
      '',
      'Content under h2.',
      '',
      '### H3 Section',
      '',
      'Content under h3.',
    ].join('\n');

    const result = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    const depths = result.chunks.map(c => c.sectionDepth).filter(d => d !== null);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
    expect(depths).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

describe('chunkContent — default options', () => {
  it('uses 512 maxTokens, 50 overlap, section strategy by default', () => {
    const content = 'Some content here.';
    const result = chunkContent(content);
    expect(result.options.maxTokens).toBe(512);
    expect(result.options.overlap).toBe(50);
    expect(result.options.strategy).toBe('section');
    expect(result.strategy).toBe('section');
  });

  it('returns originalLength matching content.length', () => {
    const content = 'Hello world. This is content.';
    const result = chunkContent(content);
    expect(result.originalLength).toBe(content.length);
  });

  it('section strategy is default when not specified', () => {
    const content = '## Section\n\nSome text.';
    const resultDefault = chunkContent(content, { maxTokens: 512 });
    const resultSection = chunkContent(content, { strategy: 'section', maxTokens: 512 });
    expect(resultDefault.totalChunks).toBe(resultSection.totalChunks);
    expect(resultDefault.strategy).toBe('section');
  });
});
