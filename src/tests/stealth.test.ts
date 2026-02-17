/**
 * Stealth mode tests
 * These tests verify anti-bot bypass capabilities
 */

import { describe, it, expect } from 'vitest';
import { peel } from '../index.js';

describe('stealth mode', () => {
  it('launches stealth browser correctly', async () => {
    // Force stealth mode even on simple page
    const result = await peel('https://example.com', {
      stealth: true,
      timeout: 15000,
    });

    expect(result.url).toMatch(/^https:\/\/example\.com\/?$/);
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.method).toBe('stealth');
    expect(result.elapsed).toBeGreaterThan(0);
  }, 20000);

  it('passes bot detection tests', async () => {
    // bot.sannysoft.com is a comprehensive bot detection test page
    const result = await peel('https://bot.sannysoft.com', {
      stealth: true,
      timeout: 15000,
    });

    expect(result.url).toContain('bot.sannysoft.com');
    expect(result.title).toBe('Antibot');
    expect(result.content).toBeTruthy();
    expect(result.method).toBe('stealth');
    
    // Check that key anti-bot tests passed
    expect(result.content).toContain('WebDriver');
    expect(result.content).toContain('missing (passed)');
    expect(result.content).toContain('Chrome');
    expect(result.content).toContain('present (passed)');
  }, 20000);

  it('handles escalation chain: simple → browser → stealth', async () => {
    // This site requires JavaScript rendering and might have bot protection
    const result = await peel('https://nowsecure.nl', {
      timeout: 15000,
      // Don't force method - let it escalate naturally
    });

    expect(result.url).toContain('nowsecure.nl');
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    // Method varies by environment — simple may succeed in CI, browser/stealth locally
    expect(['simple', 'browser', 'stealth']).toContain(result.method);
  }, 20000);

  // Skip: Cloudflare challenge pages are non-deterministic
  // This test passes locally but fails in CI when Cloudflare shows a JS challenge
  it.skip('bypasses Cloudflare-protected sites', async () => {
    const result = await peel('https://www.g2.com/products/firecrawl/reviews', {
      stealth: true,
      timeout: 15000,
    });

    expect(result.url).toContain('g2.com');
    expect(result.title).toBeTruthy();
    expect(result.method).toBe('stealth');
    expect(result.content.length).toBeGreaterThan(100);
  }, 20000);
});

describe('stealth CLI', () => {
  it('accepts --stealth flag', async () => {
    // This test would require spawning the CLI process
    // For now, we verify the programmatic API works with stealth
    const result = await peel('https://example.com', {
      stealth: true,
      timeout: 10000,
    });

    expect(result.method).toBe('stealth');
  }, 15000);
});
