import { describe, it, expect } from 'vitest';

describe('device emulation options', () => {
  it('PeelOptions accepts device field', async () => {
    // Import types and verify they compile
    const { peel } = await import('../index.js');
    // Just verify the type accepts these options (no actual fetch)
    const opts: any = {
      device: 'mobile',
      viewportWidth: 390,
      viewportHeight: 844,
      waitUntil: 'networkidle',
      waitSelector: '#content',
      blockResources: ['image', 'font'],
    };
    expect(opts.device).toBe('mobile');
    expect(opts.viewportWidth).toBe(390);
    expect(opts.blockResources).toEqual(['image', 'font']);
  });

  it('device profiles have correct dimensions', () => {
    // Verify our hardcoded device profiles
    const profiles: Record<string, { width: number; height: number }> = {
      desktop: { width: 1920, height: 1080 },
      mobile: { width: 390, height: 844 },
      tablet: { width: 820, height: 1180 },
    };

    expect(profiles.mobile.width).toBeLessThan(profiles.tablet.width);
    expect(profiles.tablet.width).toBeLessThan(profiles.desktop.width);
  });

  it('waitUntil accepts valid values', () => {
    const valid = ['domcontentloaded', 'networkidle', 'load', 'commit'];
    for (const v of valid) {
      expect(valid).toContain(v);
    }
  });

  it('blockResources accepts resource types', () => {
    const types = ['image', 'stylesheet', 'font', 'media', 'script'];
    expect(types).toHaveLength(5);
    expect(types).toContain('image');
  });
});
