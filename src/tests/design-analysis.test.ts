/**
 * Tests for the Design Analysis feature:
 *   - POST /v1/screenshot/design-analysis (API route)
 *   - takeDesignAnalysis() shape validation
 *   - DesignAnalysis interface completeness
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
  takeDesignAnalysis: vi.fn(),
}));

import {
  takeDesignAnalysis as mockTakeDesignAnalysis,
} from '../core/screenshot.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestApp(router: express.Router): Express {
  const app = express();
  app.use(express.json());

  // Fake auth
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
  const router = createScreenshotRouter(authStore);
  return createTestApp(router);
}

function makeMockAnalysis() {
  return {
    visualEffects: {
      glassmorphism: [
        { selector: 'div#hero', properties: { 'backdrop-filter': 'blur(10px)', background: 'rgba(255,255,255,0.2)', 'box-shadow': '0 4px 30px rgba(0,0,0,0.1)' } },
      ],
      shadows: [
        { selector: 'div.card', properties: { 'box-shadow': '0 2px 10px rgba(0,0,0,0.15)', type: 'drop' } },
      ],
      gradients: [
        { selector: 'section.hero', properties: { 'background-image': 'linear-gradient(90deg, #6366f1, #a855f7)', type: 'linear', colors: '#6366f1, #a855f7' } },
      ],
      animations: [
        { selector: 'div.spinner', properties: { animation: 'spin 1s linear infinite' } },
      ],
      transforms: [
        { selector: 'div.rotated', properties: { transform: 'rotate(45deg)' } },
      ],
      filters: [
        { selector: 'img.blur', properties: { filter: 'blur(4px)' } },
      ],
    },
    palette: {
      dominant: ['#ffffff', '#000000', '#6366f1', '#f5f5f5', '#111827'],
      backgrounds: ['#ffffff', '#000000', '#6366f1', '#f5f5f5'],
      texts: ['#111827', '#374151', '#ffffff'],
      accents: ['#6366f1', '#a855f7'],
      gradientColors: ['#6366f1', '#a855f7'],
      scheme: 'light' as const,
    },
    layout: {
      sections: [
        { tag: 'section', id: 'hero', className: 'hero-section', height: 600, background: 'rgba(0,0,0,0)' },
        { tag: 'div', id: 'features', height: 400, background: 'rgb(245,245,245)' },
      ],
      gridSystem: 'flexbox' as const,
      maxWidth: '1280px',
      breakpoints: ['(max-width: 768px)', '(max-width: 1024px)'],
    },
    typeScale: {
      sizes: ['12px', '14px', '16px', '20px', '24px', '32px', '48px'],
      isModular: true,
      ratio: 1.25,
      baseSize: '16px',
      families: ['Inter', 'system-ui'],
      headingStyle: { family: 'Inter', weights: [600, 700] },
      bodyStyle: { family: 'Inter', weight: 400, lineHeight: '24px' },
    },
    qualitySignals: {
      spacingConsistency: 0.87,
      typographyConsistency: 0.92,
      colorHarmony: 0.85,
      visualHierarchy: 1.0,
      overall: 0.91,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /v1/screenshot/design-analysis', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  // Test 1: Missing URL returns 400
  it('returns 400 when url is missing', async () => {
    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({});

    expect(res.status).toBe(400);
  });

  // Test 2: Valid request returns 200 with correct shape
  it('returns 200 with full DesignAnalysis shape for valid URL', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.url).toBe('https://linear.app');
    expect(res.body.data.analysis).toBeDefined();
  });

  // Test 3: All top-level fields are present
  it('response contains all required top-level analysis fields', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://vercel.com',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://vercel.com' });

    const { analysis } = res.body.data;
    expect(analysis).toHaveProperty('visualEffects');
    expect(analysis).toHaveProperty('palette');
    expect(analysis).toHaveProperty('layout');
    expect(analysis).toHaveProperty('typeScale');
    expect(analysis).toHaveProperty('qualitySignals');
  });

  // Test 4: visualEffects has all 6 sub-categories
  it('visualEffects contains all 6 sub-categories', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app' });

    const { visualEffects } = res.body.data.analysis;
    expect(visualEffects).toHaveProperty('glassmorphism');
    expect(visualEffects).toHaveProperty('shadows');
    expect(visualEffects).toHaveProperty('gradients');
    expect(visualEffects).toHaveProperty('animations');
    expect(visualEffects).toHaveProperty('transforms');
    expect(visualEffects).toHaveProperty('filters');
    expect(Array.isArray(visualEffects.glassmorphism)).toBe(true);
    expect(Array.isArray(visualEffects.shadows)).toBe(true);
  });

  // Test 5: Glassmorphism detection — Linear.app is known for glassmorphism
  it('detects glassmorphism elements (mock verifies effect shape)', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app' });

    const { glassmorphism } = res.body.data.analysis.visualEffects;
    expect(glassmorphism.length).toBeGreaterThan(0);
    const glass = glassmorphism[0];
    expect(glass).toHaveProperty('selector');
    expect(glass).toHaveProperty('properties');
    expect(glass.properties).toHaveProperty('backdrop-filter');
    expect(glass.properties['backdrop-filter']).toContain('blur');
  });

  // Test 6: Color palette has all required fields
  it('palette contains all required color fields', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://vercel.com',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://vercel.com' });

    const { palette } = res.body.data.analysis;
    expect(Array.isArray(palette.dominant)).toBe(true);
    expect(Array.isArray(palette.backgrounds)).toBe(true);
    expect(Array.isArray(palette.texts)).toBe(true);
    expect(Array.isArray(palette.accents)).toBe(true);
    expect(Array.isArray(palette.gradientColors)).toBe(true);
    expect(['light', 'dark', 'mixed']).toContain(palette.scheme);
    expect(palette.dominant.length).toBeGreaterThan(0);
    expect(palette.backgrounds.length).toBeGreaterThan(0);
    expect(palette.texts.length).toBeGreaterThan(0);
  });

  // Test 7: Typography scale analysis
  it('typeScale contains font size array and base size', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://vercel.com',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://vercel.com' });

    const { typeScale } = res.body.data.analysis;
    expect(Array.isArray(typeScale.sizes)).toBe(true);
    expect(typeScale.sizes.length).toBeGreaterThan(0);
    expect(typeof typeScale.baseSize).toBe('string');
    expect(typeScale.baseSize).toMatch(/^\d+(\.\d+)?px$/);
    expect(typeof typeScale.isModular).toBe('boolean');
    expect(Array.isArray(typeScale.families)).toBe(true);
    expect(typeScale.headingStyle).toHaveProperty('family');
    expect(typeScale.headingStyle).toHaveProperty('weights');
    expect(typeScale.bodyStyle).toHaveProperty('family');
    expect(typeScale.bodyStyle).toHaveProperty('weight');
    expect(typeScale.bodyStyle).toHaveProperty('lineHeight');
  });

  // Test 8: Quality signals are all between 0 and 1
  it('quality signals are all numbers between 0 and 1', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app' });

    const { qualitySignals } = res.body.data.analysis;
    for (const [key, val] of Object.entries(qualitySignals)) {
      expect(typeof val).toBe('number', `${key} should be a number`);
      expect(val as number).toBeGreaterThanOrEqual(0);
      expect(val as number).toBeLessThanOrEqual(1);
    }
    expect(qualitySignals).toHaveProperty('spacingConsistency');
    expect(qualitySignals).toHaveProperty('typographyConsistency');
    expect(qualitySignals).toHaveProperty('colorHarmony');
    expect(qualitySignals).toHaveProperty('visualHierarchy');
    expect(qualitySignals).toHaveProperty('overall');
  });

  // Test 9: Layout structure contains sections array
  it('layout contains sections, gridSystem, maxWidth, breakpoints', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://vercel.com',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://vercel.com' });

    const { layout } = res.body.data.analysis;
    expect(Array.isArray(layout.sections)).toBe(true);
    expect(['grid', 'flexbox', 'none']).toContain(layout.gridSystem);
    expect(typeof layout.maxWidth).toBe('string');
    expect(Array.isArray(layout.breakpoints)).toBe(true);
  });

  // Test 10: Simple site baseline — example.com has minimal styling
  it('returns valid analysis for minimal site (example.com baseline)', async () => {
    const simpleAnalysis = {
      visualEffects: {
        glassmorphism: [],
        shadows: [],
        gradients: [],
        animations: [],
        transforms: [],
        filters: [],
      },
      palette: {
        dominant: ['#ffffff'],
        backgrounds: ['#ffffff'],
        texts: ['#000000'],
        accents: [],
        gradientColors: [],
        scheme: 'light' as const,
      },
      layout: {
        sections: [],
        gridSystem: 'none' as const,
        maxWidth: 'none',
        breakpoints: [],
      },
      typeScale: {
        sizes: ['16px'],
        isModular: false,
        baseSize: '16px',
        families: ['Times New Roman'],
        headingStyle: { family: 'Times New Roman', weights: [700] },
        bodyStyle: { family: 'Times New Roman', weight: 400, lineHeight: '24px' },
      },
      qualitySignals: {
        spacingConsistency: 0.5,
        typographyConsistency: 0.5,
        colorHarmony: 1.0,
        visualHierarchy: 0.75,
        overall: 0.69,
      },
    };

    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://example.com',
      analysis: simpleAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    const { analysis } = res.body.data;

    // Even a simple site returns valid shapes
    expect(Array.isArray(analysis.visualEffects.glassmorphism)).toBe(true);
    expect(Array.isArray(analysis.palette.backgrounds)).toBe(true);
    expect(analysis.palette.backgrounds.length).toBeGreaterThan(0);
    expect(analysis.qualitySignals.colorHarmony).toBe(1.0); // Minimal colors = max harmony
    expect(analysis.qualitySignals.overall).toBeGreaterThanOrEqual(0);
    expect(analysis.qualitySignals.overall).toBeLessThanOrEqual(1);
  });

  // Test 11: Unauthorized request returns 401
  it('returns 401 for unauthorized requests', async () => {
    const authStore = new InMemoryAuthStore();
    const router = createScreenshotRouter(authStore);
    const noAuthApp = express();
    noAuthApp.use(express.json());
    noAuthApp.use(router);

    const res = await request(noAuthApp)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(401);
  });

  // Test 12: Error from takeDesignAnalysis is handled
  it('returns 500 when takeDesignAnalysis throws', async () => {
    (mockTakeDesignAnalysis as any).mockRejectedValue(new Error('Browser launch failed'));

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  // Test 13: Optional fields are forwarded to takeDesignAnalysis
  it('passes optional fields to takeDesignAnalysis', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app', width: 375, height: 812, stealth: true, waitFor: 2000 });

    expect(mockTakeDesignAnalysis).toHaveBeenCalledWith(
      'https://linear.app',
      expect.objectContaining({ width: 375, height: 812, stealth: true, waitFor: 2000 })
    );
  });

  // Test 14: EffectInstance shape is correct
  it('gradient EffectInstance has selector and properties', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://linear.app',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://linear.app' });

    const { gradients } = res.body.data.analysis.visualEffects;
    expect(gradients.length).toBeGreaterThan(0);
    const grad = gradients[0];
    expect(typeof grad.selector).toBe('string');
    expect(typeof grad.properties).toBe('object');
    expect(grad.properties).toHaveProperty('background-image');
    expect(grad.properties).toHaveProperty('type');
  });

  // Test 15: Modular scale detection — mock a modular scale
  it('typeScale.isModular is true when ratio is reported', async () => {
    const mockAnalysis = makeMockAnalysis();
    (mockTakeDesignAnalysis as any).mockResolvedValue({
      url: 'https://vercel.com',
      analysis: mockAnalysis,
    });

    const res = await request(app)
      .post('/v1/screenshot/design-analysis')
      .send({ url: 'https://vercel.com' });

    const { typeScale } = res.body.data.analysis;
    if (typeScale.isModular) {
      expect(typeof typeScale.ratio).toBe('number');
      expect(typeScale.ratio).toBeGreaterThan(1);
    } else {
      // ratio may be undefined when not modular
      expect(typeScale.ratio === undefined || typeof typeScale.ratio === 'number').toBe(true);
    }
  });
});
