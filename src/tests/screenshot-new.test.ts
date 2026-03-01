/**
 * Tests for the 4 new screenshot endpoints:
 *   - POST /v1/screenshot/audit
 *   - POST /v1/screenshot/animation
 *   - POST /v1/screenshot/viewports
 *   - POST /v1/screenshot/design-audit
 *
 * Also tests the design audit scoring logic (weighted penalties).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { createScreenshotRouter } from '../server/routes/screenshot.js';
import { InMemoryAuthStore } from '../server/auth-store.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../core/screenshot.js', () => ({
  takeScreenshot: vi.fn(),
  takeFilmstrip: vi.fn(),
  takeAuditScreenshots: vi.fn(),
  takeAnimationCapture: vi.fn(),
  takeViewportsBatch: vi.fn(),
  takeDesignAudit: vi.fn(),
  takeScreenshotDiff: vi.fn(),
}));

import {
  takeScreenshot as mockTakeScreenshot,
  takeAuditScreenshots as mockTakeAudit,
  takeAnimationCapture as mockTakeAnimation,
  takeViewportsBatch as mockTakeViewports,
  takeDesignAudit as mockTakeDesignAudit,
  takeScreenshotDiff as mockTakeScreenshotDiff,
} from '../core/screenshot.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestApp(router: express.Router): Express {
  const app = express();
  app.use(express.json());

  // Fake auth — give every request a free-tier identity so routes don't 401
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      keyInfo: { accountId: 'test-user-id', key: 'test-api-key-00000000' } as any,
      tier: 'free',
      rateLimit: 25,
      softLimited: false,
      extraUsageAvailable: false,
    };
    next();
  });

  app.use(router);
  return app;
}

function makeApp() {
  const authStore = new InMemoryAuthStore();
  return createTestApp(createScreenshotRouter(authStore));
}

// ── Default mock return values ────────────────────────────────────────────────

const auditResult = {
  url: 'https://example.com',
  format: 'jpeg' as const,
  sections: [
    { index: 0, tag: 'section', id: '', className: 'hero', top: 0, height: 800, screenshot: 'abc123==' },
  ],
};

const animationResult = {
  url: 'https://example.com',
  format: 'jpeg' as const,
  frameCount: 4,
  frames: [
    { index: 0, timestampMs: 0, screenshot: 'frame0==' },
    { index: 1, timestampMs: 500, screenshot: 'frame1==' },
    { index: 2, timestampMs: 1000, screenshot: 'frame2==' },
    { index: 3, timestampMs: 1500, screenshot: 'frame3==' },
  ],
};

const viewportsResult = {
  url: 'https://example.com',
  format: 'jpeg' as const,
  viewports: [
    { width: 375, height: 812, label: 'mobile', screenshot: 'mobile==' },
    { width: 1440, height: 900, label: 'desktop', screenshot: 'desktop==' },
  ],
};

const designAuditResult = {
  url: 'https://example.com',
  audit: {
    score: 85,
    summary: 'Found: 3 spacing violation(s).',
    spacingViolations: [
      { element: 'div.hero', property: 'paddingTop', value: 14, nearestGridValue: 16 },
      { element: 'p.body', property: 'marginBottom', value: 6, nearestGridValue: 8 },
      { element: 'section', property: 'gap', value: 10, nearestGridValue: 8 },
    ],
    touchTargetViolations: [],
    contrastViolations: [],
    typography: { fontSizes: ['16px', '24px'], lineHeights: ['1.5'], letterSpacings: [] },
    spacingScale: [6, 10, 14, 16, 24],
  },
};

// ── POST /v1/screenshot/audit ─────────────────────────────────────────────────

describe('POST /v1/screenshot/audit', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns audit sections for valid URL', async () => {
    (mockTakeAudit as any).mockResolvedValue(auditResult);

    const res = await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe('https://example.com');
    expect(res.body.data.sections).toHaveLength(1);
    expect(res.body.data.sections[0].tag).toBe('section');
    expect(res.body.data.sections[0].screenshot).toBe('abc123==');
    expect(res.headers['x-fetch-type']).toBe('audit');
  });

  it('passes selector and scrollThrough to takeAuditScreenshots', async () => {
    (mockTakeAudit as any).mockResolvedValue(auditResult);

    await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com', selector: '.card', scrollThrough: true });

    expect(mockTakeAudit).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ selector: '.card', scrollThrough: true })
    );
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot/audit')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('url');
  });

  it('returns 400 for SSRF (localhost)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'http://localhost:8080' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com', format: 'bmp' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('format');
  });

  it('uses default selector "section" when no selector given', async () => {
    (mockTakeAudit as any).mockResolvedValue(auditResult);

    await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com' });

    expect(mockTakeAudit).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ selector: 'section' })
    );
  });

  it('ignores non-string selector (falls back to default)', async () => {
    (mockTakeAudit as any).mockResolvedValue(auditResult);

    await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com', selector: 123 });

    expect(mockTakeAudit).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ selector: 'section' })
    );
  });

  it('returns 500 on internal error', async () => {
    (mockTakeAudit as any).mockRejectedValue(new Error('Playwright crashed'));

    const res = await request(app)
      .post('/v1/screenshot/audit')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /v1/screenshot/animation ────────────────────────────────────────────

describe('POST /v1/screenshot/animation', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns animation frames for valid URL', async () => {
    (mockTakeAnimation as any).mockResolvedValue(animationResult);

    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', frames: 4, intervalMs: 500 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.frameCount).toBe(4);
    expect(res.body.data.frames).toHaveLength(4);
    expect(res.body.data.frames[0].screenshot).toBe('frame0==');
    expect(res.headers['x-fetch-type']).toBe('animation');
  });

  it('passes frames and intervalMs through correctly', async () => {
    (mockTakeAnimation as any).mockResolvedValue(animationResult);

    await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', frames: 10, intervalMs: 200, scrollTo: 500 });

    expect(mockTakeAnimation).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ frames: 10, intervalMs: 200, scrollTo: 500 })
    );
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('url');
  });

  it('returns 400 for SSRF (localhost)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'http://127.0.0.1/secret' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', format: 'gif' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('format');
  });

  it('returns 400 for frames out of range — too low (0)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', frames: 0 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('frames');
  });

  it('returns 400 for frames out of range — too high (31)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', frames: 31 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('frames');
  });

  it('returns 400 for intervalMs too low (49ms)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', intervalMs: 49 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('intervalMs');
  });

  it('returns 400 for intervalMs too high (10001ms)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com', intervalMs: 10001 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('intervalMs');
  });

  it('returns 500 on internal error', async () => {
    (mockTakeAnimation as any).mockRejectedValue(new Error('Browser died'));

    const res = await request(app)
      .post('/v1/screenshot/animation')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /v1/screenshot/viewports ────────────────────────────────────────────

describe('POST /v1/screenshot/viewports', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns viewport screenshots for valid request', async () => {
    (mockTakeViewports as any).mockResolvedValue(viewportsResult);

    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: [
          { width: 375, height: 812, label: 'mobile' },
          { width: 1440, height: 900, label: 'desktop' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.viewports).toHaveLength(2);
    expect(res.body.data.viewports[0].label).toBe('mobile');
    expect(res.headers['x-fetch-type']).toBe('viewports');
    expect(res.headers['x-credits-used']).toBe('2');
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({ viewports: [{ width: 375, height: 812 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('url');
  });

  it('returns 400 for SSRF (localhost)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'http://localhost:3000',
        viewports: [{ width: 375, height: 812 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: [{ width: 375, height: 812 }],
        format: 'tiff',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing viewports array', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('viewports');
  });

  it('returns 400 for empty viewports array', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({ url: 'https://example.com', viewports: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('viewports');
  });

  it('returns 400 for more than 6 viewports', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: Array.from({ length: 7 }, (_, i) => ({ width: 400 + i * 100, height: 800 })),
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('6');
  });

  it('returns 400 for viewport with missing width', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: [{ height: 812 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('width');
  });

  it('returns 400 for viewport with out-of-range width', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: [{ width: 50, height: 800 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('dimensions');
  });

  it('returns 400 for viewport with out-of-range height', async () => {
    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({
        url: 'https://example.com',
        viewports: [{ width: 375, height: 99999 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('dimensions');
  });

  it('returns 500 on internal error', async () => {
    (mockTakeViewports as any).mockRejectedValue(new Error('Browser timed out'));

    const res = await request(app)
      .post('/v1/screenshot/viewports')
      .send({ url: 'https://example.com', viewports: [{ width: 375, height: 812 }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── POST /v1/screenshot/design-audit ─────────────────────────────────────────

describe('POST /v1/screenshot/design-audit', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns design audit for valid URL', async () => {
    (mockTakeDesignAudit as any).mockResolvedValue(designAuditResult);

    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe('https://example.com');
    expect(res.body.data.audit.score).toBe(85);
    expect(res.body.data.audit.spacingViolations).toHaveLength(3);
    expect(res.headers['x-fetch-type']).toBe('design-audit');
  });

  it('passes rules to takeDesignAudit', async () => {
    (mockTakeDesignAudit as any).mockResolvedValue(designAuditResult);

    await request(app)
      .post('/v1/screenshot/design-audit')
      .send({
        url: 'https://example.com',
        rules: { spacingGrid: 4, minTouchTarget: 48, minContrast: 7.0 },
        selector: '.main',
      });

    expect(mockTakeDesignAudit).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        rules: { spacingGrid: 4, minTouchTarget: 48, minContrast: 7.0 },
        selector: '.main',
      })
    );
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('url');
  });

  it('returns 400 for SSRF (localhost)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({ url: 'http://localhost:9000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for non-HTTP protocol', async () => {
    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid rules type (non-object)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({ url: 'https://example.com', rules: 'strict' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('rules');
  });

  it('returns 500 on internal error', async () => {
    (mockTakeDesignAudit as any).mockRejectedValue(new Error('Audit crashed'));

    const res = await request(app)
      .post('/v1/screenshot/design-audit')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it('old route /v1/design-audit no longer exists (returns 404)', async () => {
    const res = await request(app)
      .post('/v1/design-audit')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(404);
  });
});

// ── Design audit scoring logic (unit tests) ───────────────────────────────────

describe('design audit scoring — weighted penalties', () => {
  /**
   * Re-implements the scoring formula from browser-fetch.ts so we can unit
   * test it independently without spinning up a browser.
   *
   * Weights:  contrast × 5,  touchTarget × 3,  spacing × 1
   */
  function computeScore(
    contrastViolations: number,
    touchTargetViolations: number,
    spacingViolations: number
  ): number {
    const contrastPenalty = contrastViolations * 5;
    const touchPenalty = touchTargetViolations * 3;
    const spacingPenalty = spacingViolations * 1;
    const totalPenalty = contrastPenalty + touchPenalty + spacingPenalty;
    return Math.max(0, Math.round(100 - Math.min(100, totalPenalty)));
  }

  it('0 violations → score 100', () => {
    expect(computeScore(0, 0, 0)).toBe(100);
  });

  it('10 contrast violations → score 50 (10 × 5 = 50)', () => {
    expect(computeScore(10, 0, 0)).toBe(50);
  });

  it('20 contrast violations → score 0 (penalty 100, floor at 0)', () => {
    expect(computeScore(20, 0, 0)).toBe(0);
  });

  it('mix: 2 contrast + 3 touch + 10 spacing → correct weighted score', () => {
    // contrast: 2 × 5 = 10, touch: 3 × 3 = 9, spacing: 10 × 1 = 10  → penalty = 29
    expect(computeScore(2, 3, 10)).toBe(71);
  });

  it('50 spacing violations only → score 50 (not 0 like the old formula)', () => {
    // With new formula: 50 spacing × 1 = penalty 50 → score 50
    // Old formula would have been: 50 * 2 = 100 penalty → score 0
    expect(computeScore(0, 0, 50)).toBe(50);
  });

  it('>100 total penalty → floor at 0', () => {
    expect(computeScore(10, 10, 50)).toBe(0);
  });

  it('touch target violations use weight 3', () => {
    // 33 touch violations × 3 = 99 penalty → score 1
    expect(computeScore(0, 33, 0)).toBe(1);
    // 34 touch violations × 3 = 102 penalty → score 0
    expect(computeScore(0, 34, 0)).toBe(0);
  });

  it('contrast violations capped at 0 when very high', () => {
    expect(computeScore(100, 100, 100)).toBe(0);
  });
});

// ── POST /v1/screenshot — selector (element crop) ────────────────────────────

describe('POST /v1/screenshot — selector (element crop)', () => {
  let app: Express;

  const screenshotResult = {
    url: 'https://example.com',
    format: 'png' as const,
    contentType: 'image/png',
    screenshot: 'iVBORw0KGgo=',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('passes selector through to takeScreenshot', async () => {
    (mockTakeScreenshot as any).mockResolvedValue(screenshotResult);

    await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', selector: '.hero' });

    expect(mockTakeScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ selector: '.hero' })
    );
  });

  it('works without selector (backward compat)', async () => {
    (mockTakeScreenshot as any).mockResolvedValue(screenshotResult);

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(mockTakeScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ selector: undefined })
    );
  });

  it('returns 400 for non-string selector', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', selector: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('selector');
  });
});

// ── POST /v1/screenshot/diff ──────────────────────────────────────────────────

describe('POST /v1/screenshot/diff', () => {
  let app: Express;

  const diffResult = {
    diff: 'abc123==',
    diffPixels: 100,
    totalPixels: 921600,
    diffPercent: 0.01,
    dimensions: { width: 1280, height: 720 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns diff data for valid request', async () => {
    (mockTakeScreenshotDiff as any).mockResolvedValue(diffResult);

    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com/v2' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.diff).toBe('abc123==');
    expect(res.body.data.diffPixels).toBe(100);
    expect(res.body.data.totalPixels).toBe(921600);
    expect(res.body.data.diffPercent).toBe(0.01);
    expect(res.body.data.dimensions).toEqual({ width: 1280, height: 720 });
    expect(res.headers['x-fetch-type']).toBe('diff');
  });

  it('returns 400 for missing url1', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url2: 'https://example.com/v2' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for missing url2', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for SSRF on url1 (localhost)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'http://localhost:3000', url2: 'https://example.com/v2' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for SSRF on url2 (private network)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'http://192.168.1.1/admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid threshold (> 1)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com/v2', threshold: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('threshold');
  });

  it('returns 400 for invalid threshold (negative)', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com/v2', threshold: -0.1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('threshold');
  });

  it('returns 400 if url1 === url2', async () => {
    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('passes threshold and dimensions to takeScreenshotDiff', async () => {
    (mockTakeScreenshotDiff as any).mockResolvedValue(diffResult);

    await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com/v2', threshold: 0.05, width: 1440, height: 900 });

    expect(mockTakeScreenshotDiff).toHaveBeenCalledWith(
      'https://example.com',
      'https://example.com/v2',
      expect.objectContaining({ threshold: 0.05, width: 1440, height: 900 })
    );
  });
});

// ── Binary response format ────────────────────────────────────────────────────

describe('POST /v1/screenshot — responseFormat: binary', () => {
  let app: Express;

  const screenshotResult = {
    url: 'https://example.com',
    format: 'png' as const,
    contentType: 'image/png',
    screenshot: Buffer.from('PNG_BYTES').toString('base64'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('returns raw image bytes with correct Content-Type when responseFormat is binary', async () => {
    (mockTakeScreenshot as any).mockResolvedValue(screenshotResult);

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', responseFormat: 'binary' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Should be binary, not JSON
    expect(res.body).not.toHaveProperty('success');
  });

  it('returns JSON by default (no responseFormat)', async () => {
    (mockTakeScreenshot as any).mockResolvedValue(screenshotResult);

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['content-type']).toContain('json');
  });

  it('diff endpoint returns binary diff image when responseFormat is binary', async () => {
    const diffResult = {
      diff: Buffer.from('DIFF_PNG_BYTES').toString('base64'),
      diffPixels: 50,
      totalPixels: 921600,
      diffPercent: 0.005,
      dimensions: { width: 1280, height: 720 },
    };
    (mockTakeScreenshotDiff as any).mockResolvedValue(diffResult);

    const res = await request(app)
      .post('/v1/screenshot/diff')
      .send({ url1: 'https://example.com', url2: 'https://example.com/v2', responseFormat: 'binary' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body).not.toHaveProperty('success');
  });
});
