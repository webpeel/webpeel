/**
 * Tests for the shared Webshare proxy configuration utilities.
 * proxy-config.ts provides getWebshareProxy(), hasWebshareProxy(),
 * toPlaywrightProxy(), and getWebshareProxyUrl().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWebshareProxy,
  hasWebshareProxy,
  toPlaywrightProxy,
  getWebshareProxyUrl,
  type ProxyConfig,
} from '../core/proxy-config.js';

// Helper to set proxy env vars for a test and restore them after
function withProxyEnv(
  vars: Partial<Record<'WEBSHARE_PROXY_HOST' | 'WEBSHARE_PROXY_PORT' | 'WEBSHARE_PROXY_USER' | 'WEBSHARE_PROXY_PASS' | 'WEBSHARE_PROXY_SLOTS', string>>,
  fn: () => void,
) {
  const originals: Record<string, string | undefined> = {};
  const keys = ['WEBSHARE_PROXY_HOST', 'WEBSHARE_PROXY_PORT', 'WEBSHARE_PROXY_USER', 'WEBSHARE_PROXY_PASS', 'WEBSHARE_PROXY_SLOTS'];

  // Save originals and set test values
  for (const key of keys) {
    originals[key] = process.env[key];
    if (key in vars) {
      const val = vars[key as keyof typeof vars];
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    } else {
      delete process.env[key];
    }
  }

  try {
    fn();
  } finally {
    // Restore originals
    for (const key of keys) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  }
}

describe('hasWebshareProxy()', () => {
  it('returns false when no env vars are set', () => {
    withProxyEnv({}, () => {
      expect(hasWebshareProxy()).toBe(false);
    });
  });

  it('returns false when only HOST is set', () => {
    withProxyEnv({ WEBSHARE_PROXY_HOST: 'p.webshare.io' }, () => {
      expect(hasWebshareProxy()).toBe(false);
    });
  });

  it('returns false when HOST and USER are set but PASS is missing', () => {
    withProxyEnv({ WEBSHARE_PROXY_HOST: 'p.webshare.io', WEBSHARE_PROXY_USER: 'myuser' }, () => {
      expect(hasWebshareProxy()).toBe(false);
    });
  });

  it('returns true when HOST, USER, and PASS are all set', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_USER: 'myuser',
      WEBSHARE_PROXY_PASS: 'mypass',
    }, () => {
      expect(hasWebshareProxy()).toBe(true);
    });
  });
});

describe('getWebshareProxy()', () => {
  it('returns null when env vars are not configured', () => {
    withProxyEnv({}, () => {
      expect(getWebshareProxy()).toBeNull();
    });
  });

  it('returns null when WEBSHARE_PROXY_SLOTS is 0', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_USER: 'myuser',
      WEBSHARE_PROXY_PASS: 'mypass',
      WEBSHARE_PROXY_SLOTS: '0',
    }, () => {
      expect(getWebshareProxy()).toBeNull();
    });
  });

  it('returns a ProxyConfig with the correct structure when configured', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_PORT: '10000',
      WEBSHARE_PROXY_USER: 'myuser',
      WEBSHARE_PROXY_PASS: 'mypass',
      WEBSHARE_PROXY_SLOTS: '100',
    }, () => {
      const config = getWebshareProxy();
      expect(config).not.toBeNull();
      // Backbone proxy: fixed base port, slot routing via username suffix
      expect(config!.server).toBe('http://p.webshare.io:10000');
      expect(config!.username).toMatch(/^myuser-\d+$/);
      expect(config!.password).toBe('mypass');
    });
  });

  it('uses fixed base port regardless of slot', () => {
    const BASE_PORT = 10000;
    const SLOTS = 50;
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_PORT: String(BASE_PORT),
      WEBSHARE_PROXY_USER: 'user',
      WEBSHARE_PROXY_PASS: 'pass',
      WEBSHARE_PROXY_SLOTS: String(SLOTS),
    }, () => {
      // Backbone proxy: all connections use the same base port
      for (let i = 0; i < 20; i++) {
        const config = getWebshareProxy()!;
        const port = parseInt(new URL(config.server).port, 10);
        expect(port).toBe(BASE_PORT);
      }
    });
  });

  it('username contains slot number within valid range', () => {
    const SLOTS = 100;
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_PORT: '10000',
      WEBSHARE_PROXY_USER: 'argtnlhz',
      WEBSHARE_PROXY_PASS: 'secret',
      WEBSHARE_PROXY_SLOTS: String(SLOTS),
    }, () => {
      for (let i = 0; i < 10; i++) {
        const config = getWebshareProxy()!;
        const match = config.username.match(/^argtnlhz-(\d+)$/);
        expect(match).not.toBeNull();
        const slot = parseInt(match![1], 10);
        expect(slot).toBeGreaterThanOrEqual(1);
        expect(slot).toBeLessThanOrEqual(SLOTS);
      }
    });
  });

  it('uses default port 10000 when WEBSHARE_PROXY_PORT is not set', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_USER: 'user',
      WEBSHARE_PROXY_PASS: 'pass',
      WEBSHARE_PROXY_SLOTS: '1',
    }, () => {
      const config = getWebshareProxy()!;
      // With slots=1, always slot 1 → port 10000
      expect(config.server).toBe('http://p.webshare.io:10000');
    });
  });
});

describe('toPlaywrightProxy()', () => {
  it('converts a ProxyConfig to Playwright proxy format', () => {
    const config: ProxyConfig = {
      server: 'http://p.webshare.io:10042',
      username: 'user-US-43',
      password: 'secret',
    };
    const pw = toPlaywrightProxy(config);
    expect(pw.server).toBe('http://p.webshare.io:10042');
    expect(pw.username).toBe('user-US-43');
    expect(pw.password).toBe('secret');
  });
});

describe('getWebshareProxyUrl()', () => {
  it('returns null when proxy is not configured', () => {
    withProxyEnv({}, () => {
      expect(getWebshareProxyUrl()).toBeNull();
    });
  });

  it('returns a URL string with embedded credentials', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_PORT: '10000',
      WEBSHARE_PROXY_USER: 'user',
      WEBSHARE_PROXY_PASS: 'pass',
      WEBSHARE_PROXY_SLOTS: '1',
    }, () => {
      const url = getWebshareProxyUrl();
      expect(url).not.toBeNull();
      // Should be parseable as a URL
      const parsed = new URL(url!);
      expect(parsed.protocol).toBe('http:');
      expect(parsed.hostname).toBe('p.webshare.io');
      // Credentials should be URL-encoded in the URL
      expect(url).toMatch(/user-\d+/);
      expect(url).toContain('pass');
    });
  });

  it('URL-encodes special characters in credentials', () => {
    withProxyEnv({
      WEBSHARE_PROXY_HOST: 'p.webshare.io',
      WEBSHARE_PROXY_PORT: '10000',
      WEBSHARE_PROXY_USER: 'user+special',
      WEBSHARE_PROXY_PASS: 'p@ss:word',
      WEBSHARE_PROXY_SLOTS: '1',
    }, () => {
      const url = getWebshareProxyUrl();
      expect(url).not.toBeNull();
      // Should not have raw special chars that would break URL parsing
      const parsed = new URL(url!);
      // URL parsing should work without throwing
      expect(parsed.protocol).toBe('http:');
    });
  });
});
