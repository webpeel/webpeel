import { describe, it, expect } from 'vitest';
import { peel } from '../index.js';
import { BlockedError } from '../types.js';

describe('BlockedError metadata', () => {
  it('has blocked flag set to true', () => {
    const err = new BlockedError('test message');
    expect(err.blocked).toBe(true);
  });

  it('has retryable flag defaulting to true', () => {
    const err = new BlockedError('test message');
    expect(err.retryable).toBe(true);
  });

  it('supports non-retryable BlockedError', () => {
    const err = new BlockedError('test message', false);
    expect(err.retryable).toBe(false);
    expect(err.blocked).toBe(true);
  });

  it('has correct error name', () => {
    const err = new BlockedError('test');
    expect(err.name).toBe('BlockedError');
  });
});

describe('graceful error handling', () => {
  it('should throw NetworkError for unreachable domains', async () => {
    try {
      await peel('https://this-domain-definitely-does-not-exist-12345.com');
      expect.fail('Should have thrown');
    } catch (e: any) {
      // Should be a clean error, not a raw Playwright crash
      expect(e.message).toBeDefined();
      expect(e.message).not.toContain('page.goto');
      // Should mention the domain or "not found" or "network"
      expect(e.message.toLowerCase()).toMatch(/not found|network|dns|resolve|refused|enotfound/);
    }
  }, 30000);

  it('should provide helpful error messages', async () => {
    try {
      await peel('https://this-domain-definitely-does-not-exist-12345.com', { render: true });
      expect.fail('Should have thrown');
    } catch (e: any) {
      expect(e.message).toBeDefined();
      expect(e.message.length).toBeGreaterThan(10);
      // Should NOT be a raw Playwright internal error
      expect(e.message).not.toContain('=== logs ===');
    }
  }, 30000);
});
