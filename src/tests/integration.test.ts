/**
 * Integration tests
 * These tests make real HTTP requests and are marked as slow
 */

import { describe, it, expect } from 'vitest';
import { peel } from '../index.js';

// Skip integration tests in CI — they require network access to real sites
const describeIntegration = process.env.CI ? describe.skip : describe;

describeIntegration('integration tests', () => {
  it('fetches a real webpage', async () => {
    const result = await peel('https://example.com', {
      timeout: 10000,
    });

    // URL may or may not have trailing slash depending on server response
    expect(result.url).toMatch(/^https:\/\/example\.com\/?$/);
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.method).toBe('simple');
    expect(result.elapsed).toBeGreaterThan(0);
    expect(result.tokens).toBeGreaterThan(0);
  }, 15000); // 15s timeout for slow test

  it('handles different output formats', async () => {
    const markdown = await peel('https://example.com', { format: 'markdown' });
    const text = await peel('https://example.com', { format: 'text' });
    const html = await peel('https://example.com', { format: 'html' });

    expect(markdown.content).toContain('#');
    expect(text.content).not.toContain('<');
    expect(html.content).toContain('<html');
  }, 20000);
});
