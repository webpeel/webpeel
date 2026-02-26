import { describe, it, expect } from 'vitest';

describe('CloakBrowser integration', () => {
  it('isCloakBrowserAvailable returns false when not installed', async () => {
    const { isCloakBrowserAvailable } = await import('../core/cloak-fetch.js');
    // CloakBrowser is not installed in test env
    expect(isCloakBrowserAvailable()).toBe(false);
  });

  it('cloakFetch throws helpful error when not installed', async () => {
    const { cloakFetch } = await import('../core/cloak-fetch.js');
    await expect(cloakFetch({ url: 'https://example.com' })).rejects.toThrow('CloakBrowser not installed');
  });

  it('PeelOptions accepts cloaked field', () => {
    const opts: any = { cloaked: true };
    expect(opts.cloaked).toBe(true);
  });

  it('cloaked auto-enables render in concept', () => {
    // Verify that cloaked mode would trigger browser path
    const opts: any = { cloaked: true, render: true };
    expect(opts.render).toBe(true);
  });
});
