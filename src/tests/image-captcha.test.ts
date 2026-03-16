/**
 * Unit tests for image CAPTCHA solving logic in challenge-solver.ts
 *
 * We mock:
 *  - fetch (the Ollama API call)
 *  - Playwright Page (for screenshot, element selection, clicking)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askVisionModel, detectImageCaptchaTarget, solveImageCaptcha } from '../core/challenge-solver.js';

// ── Mock fetch globally ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockOllamaResponse(responseText: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: responseText }),
  };
}

function makeFakeBase64() {
  return Buffer.from('fake-png-data').toString('base64');
}

// ── Mock Playwright Page ──────────────────────────────────────────────────────

type MockPage = {
  $: ReturnType<typeof vi.fn>;
  $$: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
};

function makeMockPage(overrides: Partial<MockPage> = {}): import('playwright').Page {
  const page: MockPage = {
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    title: vi.fn().mockResolvedValue('CAPTCHA'),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return page as unknown as import('playwright').Page;
}

// ── askVisionModel tests ───────────────────────────────────────────────────────

describe('askVisionModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses grid positions from response', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('1,3,7'));
    const result = await askVisionModel(makeFakeBase64(), 'traffic lights');
    expect(result).toEqual([1, 3, 7]);
  });

  it('handles response with extra text around numbers', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('The positions are 2, 5, and 8.'));
    const result = await askVisionModel(makeFakeBase64(), 'buses');
    expect(result).toEqual([2, 5, 8]);
  });

  it('filters out 0 and values > 9', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('0, 1, 9, 10'));
    const result = await askVisionModel(makeFakeBase64(), 'chairs');
    expect(result).toEqual([1, 9]);
  });

  it('returns null when response has no digits', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('I see no traffic lights'));
    const result = await askVisionModel(makeFakeBase64(), 'traffic lights');
    expect(result).toBeNull();
  });

  it('returns null when response array is empty after filtering', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('0, 10, 11'));
    const result = await askVisionModel(makeFakeBase64(), 'cars');
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await askVisionModel(makeFakeBase64(), 'bikes');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    const result = await askVisionModel(makeFakeBase64(), 'cars');
    expect(result).toBeNull();
  });

  it('sends correct model and auth headers', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('1'));
    await askVisionModel(makeFakeBase64(), 'buses');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('178.156.229.86:11435');
    expect((opts.headers as Record<string, string>)['Authorization']).toContain('Bearer');
    const body = JSON.parse(opts.body as string) as { model: string };
    expect(body.model).toBe('moondream');
  });

  it('includes the target object in the prompt', async () => {
    mockFetch.mockResolvedValueOnce(makeMockOllamaResponse('4'));
    await askVisionModel(makeFakeBase64(), 'fire hydrants');

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { prompt: string };
    expect(body.prompt).toContain('fire hydrants');
  });
});

// ── detectImageCaptchaTarget tests ────────────────────────────────────────────

describe('detectImageCaptchaTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects reCAPTCHA target from rc-imageselect-desc-wrapper', async () => {
    const mockEl = {
      innerText: vi.fn().mockResolvedValue('Select all images with traffic lights'),
    };
    const page = makeMockPage({
      $: vi.fn().mockImplementation(async (sel: string) => {
        if (sel === '.rc-imageselect-desc-wrapper') return mockEl;
        return null;
      }),
    });

    const target = await detectImageCaptchaTarget(page);
    expect(target).toBe('traffic lights');
  });

  it('detects hCaptcha target from prompt-text', async () => {
    const mockEl = {
      innerText: vi.fn().mockResolvedValue('Please click each image containing a bus'),
    };
    const page = makeMockPage({
      $: vi.fn().mockImplementation(async (sel: string) => {
        if (sel === '.rc-imageselect-desc-wrapper') return null;
        if (sel === '.rc-imageselect-desc') return null;
        if (sel === '.prompt-text') return mockEl;
        return null;
      }),
    });

    const target = await detectImageCaptchaTarget(page);
    expect(target).toBe('bus');
  });

  it('returns null when no CAPTCHA instruction found', async () => {
    const page = makeMockPage({
      $: vi.fn().mockResolvedValue(null),
    });

    const target = await detectImageCaptchaTarget(page);
    expect(target).toBeNull();
  });

  it('returns null when instruction text does not match known patterns', async () => {
    const mockEl = {
      innerText: vi.fn().mockResolvedValue('Type the characters you see in the image'),
    };
    const page = makeMockPage({
      $: vi.fn().mockResolvedValue(mockEl),
    });

    const target = await detectImageCaptchaTarget(page);
    expect(target).toBeNull();
  });

  it('handles innerText throwing gracefully', async () => {
    const mockEl = {
      innerText: vi.fn().mockRejectedValue(new Error('detached')),
    };
    const page = makeMockPage({
      $: vi.fn().mockResolvedValue(mockEl),
    });

    const target = await detectImageCaptchaTarget(page);
    expect(target).toBeNull();
  });
});

// ── solveImageCaptcha tests ───────────────────────────────────────────────────

describe('solveImageCaptcha', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ENABLE_LOCAL_CHALLENGE_SOLVE: 'true' };
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  it('returns not-enabled error when env var is not set', async () => {
    delete process.env.ENABLE_LOCAL_CHALLENGE_SOLVE;
    delete process.env.BROWSER_WORKER_URL;

    const page = makeMockPage();
    const result = await solveImageCaptcha(page, 'cars');

    expect(result.solved).toBe(false);
    expect(result.error).toContain('not enabled');
  });

  it('returns error when no grid screenshot is possible', async () => {
    const page = makeMockPage({
      $: vi.fn().mockResolvedValue(null),
      screenshot: vi.fn().mockRejectedValue(new Error('screenshot failed')),
    });

    const result = await solveImageCaptcha(page, 'buses');
    expect(result.solved).toBe(false);
    expect(result.rounds).toBe(1);
  });

  it('returns error when vision model returns null', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const mockGridEl = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
      $$: vi.fn().mockResolvedValue([]),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const page = makeMockPage({
      $: vi.fn().mockImplementation(async (sel: string) => {
        if (sel === '.rc-imageselect-table') return mockGridEl;
        return null;
      }),
    });

    const result = await solveImageCaptcha(page, 'chairs');
    expect(result.solved).toBe(false);
    expect(result.error).toContain('no valid positions');
  });

  it('clicks cells and returns solved when vision model responds', async () => {
    // Vision model says positions 1, 5, 9
    mockFetch.mockResolvedValue(makeMockOllamaResponse('1,5,9'));

    const mockCell = { click: vi.fn().mockResolvedValue(undefined) };
    const mockGridEl = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
      $$: vi.fn().mockResolvedValue([mockCell, mockCell, mockCell, mockCell, mockCell, mockCell, mockCell, mockCell, mockCell]),
    };
    const mockVerifyBtn = { click: vi.fn().mockResolvedValue(undefined) };
    const mockSuccessEl = {};

    const page = makeMockPage({
      $: vi.fn().mockImplementation(async (sel: string) => {
        if (sel === '.rc-imageselect-table') return mockGridEl;
        if (sel === '#recaptcha-verify-button') return mockVerifyBtn;
        if (sel === '.recaptcha-checkbox-checked, .rc-anchor-normal-footer, [aria-checked="true"]') return mockSuccessEl;
        return null;
      }),
      title: vi.fn().mockResolvedValue('Example Domain'),
    });

    const result = await solveImageCaptcha(page, 'crosswalks');
    expect(result.solved).toBe(true);
    expect(result.rounds).toBe(1);
  });

  it('handles up to max rounds when new grid appears', async () => {
    // Vision model always responds with positions
    mockFetch.mockResolvedValue(makeMockOllamaResponse('2,4'));

    const mockInstructionEl = {
      innerText: vi.fn().mockResolvedValue('Select all images with bicycles'),
    };
    const mockGridEl = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
      $$: vi.fn().mockResolvedValue([]),
    };
    const mockVerifyBtn = { click: vi.fn().mockResolvedValue(undefined) };

    // CAPTCHA never solves — new round always appears
    let callCount = 0;
    const page = makeMockPage({
      $: vi.fn().mockImplementation(async (sel: string) => {
        // Grid always present
        if (sel === '.rc-imageselect-table') return mockGridEl;
        // Verify button present
        if (sel === '#recaptcha-verify-button') return mockVerifyBtn;
        // Success never appears
        if (sel === '.recaptcha-checkbox-checked, .rc-anchor-normal-footer, [aria-checked="true"]') return null;
        // Instruction always present (new round always appears)
        if (['.rc-imageselect-desc-wrapper', '.rc-imageselect-desc', '.prompt-text'].includes(sel)) {
          callCount++;
          return mockInstructionEl;
        }
        return null;
      }),
      title: vi.fn().mockResolvedValue('CAPTCHA Page'),
    });

    const result = await solveImageCaptcha(page, 'bicycles');
    expect(result.solved).toBe(false);
    expect(result.rounds).toBe(3); // hit max rounds
    expect(result.error).toContain('max rounds');
  });
});
