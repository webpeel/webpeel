/**
 * Tests for the Design Compare feature:
 *   - buildDesignComparison() — pure gap-detection and scoring logic
 *   - GET /v1/design-compare  — HTTP route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { buildDesignComparison, type DesignGap } from '../core/design-compare.js';
import type { DesignAnalysis } from '../core/design-analysis.js';
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
  takeDesignAnalysis: vi.fn(),
  takeDesignComparison: vi.fn(),
}));

import { takeDesignComparison as mockTakeDesignComparison } from '../core/screenshot.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<DesignAnalysis> = {}): DesignAnalysis {
  const base: DesignAnalysis = {
    visualEffects: {
      glassmorphism: [],
      shadows: [{ selector: 'div.card', properties: { 'box-shadow': '0 2px 8px rgba(0,0,0,0.1)', type: 'drop' } }],
      gradients: [{ selector: 'section.hero', properties: { 'background-image': 'linear-gradient(90deg,#6366f1,#a855f7)', type: 'linear', colors: '#6366f1,#a855f7' } }],
      animations: [],
      transforms: [],
      filters: [],
    },
    palette: {
      dominant: ['#ffffff', '#000000'],
      backgrounds: ['#ffffff'],
      texts: ['#111827'],
      accents: ['#6366f1'],
      gradientColors: ['#6366f1', '#a855f7'],
      scheme: 'light',
    },
    layout: {
      sections: [],
      gridSystem: 'flexbox',
      maxWidth: '1280px',
      breakpoints: ['(max-width: 768px)'],
    },
    typeScale: {
      sizes: ['12px', '14px', '16px', '20px', '24px', '32px', '48px'],
      isModular: true,
      ratio: 1.25,
      baseSize: '16px',
      families: ['Inter'],
      headingStyle: { family: 'Inter', weights: [700] },
      bodyStyle: { family: 'Inter', weight: 400, lineHeight: '24px' },
    },
    qualitySignals: {
      spacingConsistency: 0.9,
      typographyConsistency: 0.9,
      colorHarmony: 0.9,
      visualHierarchy: 1.0,
      overall: 0.93,
    },
  };

  return { ...base, ...overrides };
}

// ── HTTP route helpers ────────────────────────────────────────────────────────

function createTestApp(router: express.Router): Express {
  const app = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      keyInfo: { accountId: 'test-user-id', key: 'test-api-key-00000000' } as never,
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
  const router = createScreenshotRouter(authStore);
  return createTestApp(router);
}

// ── Unit tests: buildDesignComparison (pure function) ─────────────────────────

describe('buildDesignComparison()', () => {
  it('returns score 10 and no gaps when analyses are identical', () => {
    const analysis = makeAnalysis();
    const result = buildDesignComparison(
      'https://subject.com',
      'https://reference.com',
      analysis,
      analysis,
    );

    expect(result.score).toBe(10);
    expect(result.gaps).toHaveLength(0);
    expect(result.summary).toContain('No significant gaps');
  });

  it('detects heading font family mismatch as high severity', () => {
    const subject = makeAnalysis({
      typeScale: {
        sizes: ['16px'],
        isModular: false,
        baseSize: '16px',
        families: ['Georgia'],
        headingStyle: { family: 'Georgia', weights: [700] },
        bodyStyle: { family: 'Georgia', weight: 400, lineHeight: '24px' },
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const headingGap = result.gaps.find((g) => g.property === 'typeScale.headingStyle.family');
    expect(headingGap).toBeDefined();
    expect(headingGap?.severity).toBe('high');
    expect(headingGap?.subject).toBe('Georgia');
    expect(headingGap?.reference).toBe('Inter');
    expect(headingGap?.suggestion).toContain('Inter');
  });

  it('detects body font family mismatch as high severity', () => {
    const subject = makeAnalysis({
      typeScale: {
        sizes: ['16px'],
        isModular: false,
        baseSize: '16px',
        families: ['Times New Roman'],
        headingStyle: { family: 'Inter', weights: [700] },
        bodyStyle: { family: 'Times New Roman', weight: 400, lineHeight: '24px' },
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const bodyGap = result.gaps.find((g) => g.property === 'typeScale.bodyStyle.family');
    expect(bodyGap).toBeDefined();
    expect(bodyGap?.severity).toBe('high');
    expect(bodyGap?.suggestion).toContain('font-family');
  });

  it('detects color scheme mismatch as medium severity', () => {
    const subject = makeAnalysis({
      palette: {
        dominant: ['#000000'],
        backgrounds: ['#000000'],
        texts: ['#ffffff'],
        accents: ['#6366f1'],
        gradientColors: [],
        scheme: 'dark',
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const schemeGap = result.gaps.find((g) => g.property === 'palette.scheme');
    expect(schemeGap).toBeDefined();
    expect(schemeGap?.severity).toBe('medium');
    expect(schemeGap?.subject).toBe('dark');
    expect(schemeGap?.reference).toBe('light');
  });

  it('detects absence of shadows as low severity when reference has them', () => {
    const subject = makeAnalysis({
      visualEffects: {
        glassmorphism: [],
        shadows: [],
        gradients: [],
        animations: [],
        transforms: [],
        filters: [],
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const shadowGap = result.gaps.find((g) => g.property === 'visualEffects.shadows');
    expect(shadowGap).toBeDefined();
    expect(shadowGap?.severity).toBe('low');
    expect(shadowGap?.suggestion).toContain('box-shadow');
  });

  it('detects absence of gradients as low severity when reference has them', () => {
    const subject = makeAnalysis({
      visualEffects: {
        glassmorphism: [],
        shadows: [],
        gradients: [],
        animations: [],
        transforms: [],
        filters: [],
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const gradientGap = result.gaps.find((g) => g.property === 'visualEffects.gradients');
    expect(gradientGap).toBeDefined();
    expect(gradientGap?.severity).toBe('low');
  });

  it('detects poor spacing consistency as high severity (diff = 0.4, at the >= 0.4 boundary)', () => {
    const subject = makeAnalysis({
      qualitySignals: {
        spacingConsistency: 0.5,
        typographyConsistency: 0.9,
        colorHarmony: 0.9,
        visualHierarchy: 1.0,
        overall: 0.83,
      },
    });
    const reference = makeAnalysis(); // spacingConsistency: 0.9 → diff = 0.4

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const spacingGap = result.gaps.find((g) => g.property === 'qualitySignals.spacingConsistency');
    expect(spacingGap).toBeDefined();
    expect(spacingGap?.severity).toBe('high'); // diff = 0.4 → >= 0.4 → high
  });

  it('detects poor spacing consistency as high severity (diff >= 0.4)', () => {
    const subject = makeAnalysis({
      qualitySignals: {
        spacingConsistency: 0.3,
        typographyConsistency: 0.9,
        colorHarmony: 0.9,
        visualHierarchy: 1.0,
        overall: 0.78,
      },
    });
    const reference = makeAnalysis(); // spacingConsistency: 0.9 → diff = 0.6

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const spacingGap = result.gaps.find((g) => g.property === 'qualitySignals.spacingConsistency');
    expect(spacingGap?.severity).toBe('high');
  });

  it('detects non-modular type scale when reference is modular', () => {
    const subject = makeAnalysis({
      typeScale: {
        sizes: ['16px', '18px', '22px'],
        isModular: false,
        baseSize: '16px',
        families: ['Inter'],
        headingStyle: { family: 'Inter', weights: [700] },
        bodyStyle: { family: 'Inter', weight: 400, lineHeight: '24px' },
      },
    });
    const reference = makeAnalysis(); // isModular: true, ratio: 1.25

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const modularGap = result.gaps.find((g) => g.property === 'typeScale.isModular');
    expect(modularGap).toBeDefined();
    expect(modularGap?.severity).toBe('medium');
    expect(modularGap?.suggestion).toContain('1.25');
  });

  it('score calculation: deducts correctly per severity', () => {
    // 1 high gap (-1.5), 1 medium gap (-0.8) → 10 - 1.5 - 0.8 = 7.7
    const subject = makeAnalysis({
      typeScale: {
        sizes: ['16px'],
        isModular: false,
        baseSize: '16px',
        families: ['Times New Roman'],
        headingStyle: { family: 'Times New Roman', weights: [400] }, // high: heading family mismatch
        bodyStyle: { family: 'Inter', weight: 400, lineHeight: '24px' },
      },
      palette: {
        dominant: ['#000000'],
        backgrounds: ['#000000'],
        texts: ['#ffffff'],
        accents: [],
        gradientColors: [],
        scheme: 'dark', // medium: scheme mismatch
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    const highGaps = result.gaps.filter((g: DesignGap) => g.severity === 'high');
    const mediumGaps = result.gaps.filter((g: DesignGap) => g.severity === 'medium');

    expect(highGaps.length).toBeGreaterThanOrEqual(1);
    expect(mediumGaps.length).toBeGreaterThanOrEqual(1);

    // Score must be <= 10 - 1.5 (high) - 0.8 (medium) = 7.7
    expect(result.score).toBeLessThanOrEqual(7.7);
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('score never drops below 1', () => {
    const subject = makeAnalysis({
      palette: { dominant: ['#000'], backgrounds: ['#000'], texts: ['#fff'], accents: [], gradientColors: [], scheme: 'dark' },
      layout: { sections: [], gridSystem: 'none', maxWidth: '960px', breakpoints: [] },
      typeScale: {
        sizes: ['12px'],
        isModular: false,
        baseSize: '12px',
        families: ['Comic Sans MS'],
        headingStyle: { family: 'Comic Sans MS', weights: [400] },
        bodyStyle: { family: 'Comic Sans MS', weight: 400, lineHeight: '18px' },
      },
      qualitySignals: { spacingConsistency: 0.1, typographyConsistency: 0.1, colorHarmony: 0.1, visualHierarchy: 0.1, overall: 0.1 },
      visualEffects: { glassmorphism: [], shadows: [], gradients: [], animations: [], transforms: [], filters: [] },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('returns correct subjectUrl, referenceUrl, and populated analysis objects', () => {
    const subject = makeAnalysis();
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://subject.com', 'https://reference.com', subject, reference);

    expect(result.subjectUrl).toBe('https://subject.com');
    expect(result.referenceUrl).toBe('https://reference.com');
    expect(result.subjectAnalysis).toBe(subject);
    expect(result.referenceAnalysis).toBe(reference);
  });

  it('summary mentions gaps count and priority when high-severity gaps exist', () => {
    const subject = makeAnalysis({
      typeScale: {
        sizes: ['16px'],
        isModular: false,
        baseSize: '16px',
        families: ['Georgia'],
        headingStyle: { family: 'Georgia', weights: [700] },
        bodyStyle: { family: 'Georgia', weight: 400, lineHeight: '24px' },
      },
    });
    const reference = makeAnalysis();

    const result = buildDesignComparison('https://s.com', 'https://r.com', subject, reference);

    expect(result.summary).toContain('gap');
    expect(result.summary).toContain('high-severity');
    expect(result.summary).toContain('Priority:');
  });
});

// ── Integration tests: GET /v1/design-compare ─────────────────────────────────

describe('GET /v1/design-compare', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  function mockComparison() {
    const analysis = makeAnalysis();
    const comparison = buildDesignComparison(
      'https://subject.com',
      'https://reference.com',
      analysis,
      analysis,
    );
    (mockTakeDesignComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      subjectUrl: 'https://subject.com',
      referenceUrl: 'https://reference.com',
      comparison,
    });
    return comparison;
  }

  it('returns 400 when "url" is missing', async () => {
    const res = await request(app).get('/v1/design-compare?ref=https://reference.com');
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request');
    expect(res.body.error.message).toContain('"url"');
  });

  it('returns 400 when "ref" is missing', async () => {
    const res = await request(app).get('/v1/design-compare?url=https://subject.com');
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request');
    expect(res.body.error.message).toContain('"ref"');
  });

  it('returns 400 when url and ref are the same', async () => {
    const res = await request(app).get(
      '/v1/design-compare?url=https://example.com&ref=https://example.com',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request');
  });

  it('returns 200 with full comparison shape for valid request', async () => {
    mockComparison();

    const res = await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com',
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data).toHaveProperty('subjectUrl');
    expect(res.body.data).toHaveProperty('referenceUrl');
    expect(res.body.data).toHaveProperty('score');
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('gaps');
    expect(res.body.data).toHaveProperty('subjectAnalysis');
    expect(res.body.data).toHaveProperty('referenceAnalysis');
  });

  it('passes width and height to takeDesignComparison', async () => {
    mockComparison();

    await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com&width=1920&height=1080',
    );

    expect(mockTakeDesignComparison).toHaveBeenCalledWith(
      'https://subject.com',
      'https://reference.com',
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
  });

  it('returns 400 for invalid width', async () => {
    const res = await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com&width=99',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('width');
  });

  it('score is a number between 1 and 10', async () => {
    mockComparison();

    const res = await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com',
    );

    expect(typeof res.body.data.score).toBe('number');
    expect(res.body.data.score).toBeGreaterThanOrEqual(1);
    expect(res.body.data.score).toBeLessThanOrEqual(10);
  });

  it('gaps is an array', async () => {
    mockComparison();

    const res = await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com',
    );

    expect(Array.isArray(res.body.data.gaps)).toBe(true);
  });

  it('returns 401 when no auth provided', async () => {
    const authStore = new InMemoryAuthStore();
    const router = createScreenshotRouter(authStore);
    const noAuthApp = express();
    noAuthApp.use(express.json());
    noAuthApp.use(router);

    const res = await request(noAuthApp).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com',
    );
    expect(res.status).toBe(401);
  });

  it('returns 500 when takeDesignComparison throws', async () => {
    (mockTakeDesignComparison as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Browser launch failed'),
    );

    const res = await request(app).get(
      '/v1/design-compare?url=https://subject.com&ref=https://reference.com',
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
