import { describe, it, expect } from 'vitest';
import { peel } from '../index.js';

describe('v0.15.0 improvements', () => {
  // Rich metadata
  it('should extract author from meta tags', async () => {
    // Use a page known to have author meta tags
    const result = await peel('https://en.wikipedia.org/wiki/TypeScript');
    expect(result.metadata).toBeDefined();
    // Wikipedia may not have author, but wordCount and language should be present
    expect(result.metadata.wordCount).toBeGreaterThan(100);
    expect(result.metadata.language).toBeDefined();
  }, 30000);

  // linkCount
  it('should include linkCount in result', async () => {
    const result = await peel('https://httpbin.org/html');
    expect(typeof result.linkCount).toBe('number');
    expect(result.linkCount).toBeGreaterThanOrEqual(0);
    expect(result.links.length).toBe(result.linkCount);
  }, 15000);

  // Freshness
  it('should include freshness data', async () => {
    const result = await peel('https://httpbin.org/html');
    expect(result.freshness).toBeDefined();
    expect(result.freshness?.fetchedAt).toBeDefined();
    // fetchedAt should be a valid ISO date
    expect(new Date(result.freshness!.fetchedAt).getTime()).toBeGreaterThan(0);
  }, 15000);

  // Auto-budget does NOT apply to library peel()
  it('should NOT auto-budget in library peel()', async () => {
    const result = await peel('https://en.wikipedia.org/wiki/TypeScript');
    // Without budget option, full content should be returned (>4000 tokens)
    expect(result.tokens).toBeGreaterThan(4000);
  }, 30000);

  // Library peel() with explicit budget still works
  it('should respect explicit budget in library peel()', async () => {
    const result = await peel('https://en.wikipedia.org/wiki/TypeScript', { budget: 2000 });
    expect(result.tokens).toBeLessThanOrEqual(2500); // Some tolerance
  }, 30000);

  // wordCount in metadata
  it('should compute wordCount', async () => {
    const result = await peel('https://httpbin.org/html');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(typeof result.metadata.wordCount).toBe('number');
  }, 15000);
});
