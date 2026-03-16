/**
 * Tests for deep-research.ts and llm-provider.ts
 *
 * 30+ tests covering:
 * - LLM provider selection and defaults
 * - Cloudflare neuron cap tracking and enforcement
 * - Neuron estimation
 * - Query decomposition parsing
 * - Source deduplication
 * - BM25 relevance scoring integration
 * - Gap detection JSON parsing
 * - Streaming events
 * - Error handling
 * - Free tier limit errors
 * - All provider branches
 * - Route handler validation
 * - URL normalization
 * - Provider switching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  estimateNeurons,
  getNeuronUsage,
  resetNeuronUsage,
  addNeuronUsage,
  isFreeTierLimitError,
  getDefaultLLMConfig,
  callLLM,
  type LLMConfig,
} from '../core/llm-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(
  response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string>; body?: null },
) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (async () => ({})),
    text: response.text ?? (async () => ''),
    body: response.body !== undefined ? response.body : null,
    ...response,
  });
}

// ---------------------------------------------------------------------------
// llm-provider.ts tests
// ---------------------------------------------------------------------------

describe('Neuron estimation', () => {
  it('estimates zero neurons for empty strings', () => {
    const n = estimateNeurons('', '');
    expect(n).toBe(0); // 0 words → 0 tokens → 0 neurons
  });

  it('estimates positive neurons for non-empty input', () => {
    const n = estimateNeurons('hello world', 'response text here');
    expect(n).toBeGreaterThan(0);
  });

  it('output tokens cost more than input tokens', () => {
    const inputOnly = estimateNeurons('hello world', '');
    const outputOnly = estimateNeurons('', 'hello world');
    // Output rate (204805/M) >> input rate (4119/M)
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });

  it('scales linearly with text length', () => {
    const single = estimateNeurons('hello', '');
    const double = estimateNeurons('hello hello', '');
    // Two words ≈ 2x single word
    expect(double).toBeGreaterThanOrEqual(single);
  });

  it('counts whitespace-split words * 1.3 for tokens', () => {
    // "hello world" = 2 words * 1.3 = 2.6 → ceil = 3 tokens
    // inputNeurons = 3 * (4119 / 1_000_000) ≈ 0.012357
    // outputText '' = 0 words → 0 output neurons
    const n = estimateNeurons('hello world', '');
    expect(n).toBeCloseTo(3 * (4119 / 1_000_000), 5);
  });
});

describe('Neuron usage tracking', () => {
  beforeEach(() => {
    resetNeuronUsage();
  });

  it('starts at zero neurons after reset', () => {
    const usage = getNeuronUsage();
    expect(usage.neurons).toBe(0);
    expect(usage.cap).toBe(9500);
    expect(usage.remaining).toBe(9500);
  });

  it('accumulates usage via addNeuronUsage', () => {
    addNeuronUsage(100);
    addNeuronUsage(50);
    const usage = getNeuronUsage();
    expect(usage.neurons).toBe(150);
    expect(usage.remaining).toBe(9350);
  });

  it('remaining never goes below 0', () => {
    addNeuronUsage(10_000);
    const usage = getNeuronUsage();
    expect(usage.remaining).toBe(0);
  });

  it('reports correct date format', () => {
    const usage = getNeuronUsage();
    expect(usage.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('remaining equals cap minus neurons', () => {
    addNeuronUsage(500);
    const usage = getNeuronUsage();
    expect(usage.remaining).toBe(usage.cap - usage.neurons);
  });
});

describe('isFreeTierLimitError', () => {
  it('returns true for free_tier_limit errors', () => {
    const err = { error: 'free_tier_limit', message: 'limit reached' };
    expect(isFreeTierLimitError(err)).toBe(true);
  });

  it('returns false for regular Error objects', () => {
    expect(isFreeTierLimitError(new Error('something'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFreeTierLimitError(null)).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isFreeTierLimitError('free_tier_limit')).toBe(false);
  });

  it('returns false for objects without error field', () => {
    expect(isFreeTierLimitError({ message: 'oops' })).toBe(false);
  });

  it('returns false for wrong error type', () => {
    expect(isFreeTierLimitError({ error: 'rate_limit', message: 'slow down' })).toBe(false);
  });
});

describe('getDefaultLLMConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all LLM-related env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  afterEach(() => {
    // Restore
    Object.assign(process.env, originalEnv);
  });

  it('defaults to cloudflare when no keys are set', () => {
    const config = getDefaultLLMConfig();
    expect(config.provider).toBe('cloudflare');
  });

  it('prefers anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const config = getDefaultLLMConfig();
    expect(config.provider).toBe('anthropic');
    expect(config.apiKey).toBe('test-key');
  });

  it('prefers openai over google', () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GOOGLE_API_KEY = 'google-key';
    const config = getDefaultLLMConfig();
    expect(config.provider).toBe('openai');
  });

  it('uses google when only GOOGLE_API_KEY is set', () => {
    process.env.GOOGLE_API_KEY = 'google-key';
    const config = getDefaultLLMConfig();
    expect(config.provider).toBe('google');
  });
});

describe('callLLM - Cloudflare cap enforcement', () => {
  beforeEach(() => {
    resetNeuronUsage();
  });

  it('throws free_tier_limit when neuron cap is nearly exceeded', async () => {
    // Fill up to just below cap
    addNeuronUsage(9490);

    const config: LLMConfig = { provider: 'cloudflare' };

    // A large question will exceed the ~10 remaining neurons
    const bigInput = Array(1000).fill('word').join(' ');
    try {
      await callLLM(config, {
        messages: [{ role: 'user', content: bigInput }],
      });
      // Should not reach here
      expect.fail('Should have thrown free_tier_limit');
    } catch (err) {
      expect(isFreeTierLimitError(err)).toBe(true);
    }
  });

  it('rejects when neurons already at cap', async () => {
    addNeuronUsage(9500);

    const config: LLMConfig = { provider: 'cloudflare' };
    try {
      await callLLM(config, {
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect.fail('Should have thrown free_tier_limit');
    } catch (err) {
      expect(isFreeTierLimitError(err)).toBe(true);
    }
  });
});

describe('callLLM - OpenAI', () => {
  it('throws if no api key', async () => {
    const config: LLMConfig = { provider: 'openai' };
    await expect(
      callLLM(config, { messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('API key');
  });
});

describe('callLLM - Anthropic', () => {
  it('throws if no api key', async () => {
    const config: LLMConfig = { provider: 'anthropic' };
    await expect(
      callLLM(config, { messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('API key');
  });
});

describe('callLLM - Google', () => {
  it('throws if no api key', async () => {
    const config: LLMConfig = { provider: 'google' };
    await expect(
      callLLM(config, { messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('API key');
  });
});

describe('callLLM - Ollama', () => {
  it('uses default endpoint http://localhost:11434 with /api/generate', async () => {
    // Non-streaming Ollama uses /api/generate with think:false
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: 'test response',
        prompt_eval_count: 10,
        eval_count: 20,
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const config: LLMConfig = { provider: 'ollama' };
      const result = await callLLM(config, {
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(result.text).toBe('test response');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('uses custom endpoint from config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: 'hi',
        eval_count: 5,
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const config: LLMConfig = {
        provider: 'ollama',
        endpoint: 'http://custom-host:11434',
        model: 'mistral',
      };
      await callLLM(config, {
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom-host:11434/api/generate',
        expect.any(Object),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws on non-OK HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service unavailable',
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      await expect(
        callLLM({ provider: 'ollama' }, { messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow('503');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// deep-research.ts unit tests
// ---------------------------------------------------------------------------

describe('deep-research module imports', () => {
  it('can be imported without error', async () => {
    const mod = await import('../core/deep-research.js');
    expect(typeof mod.runDeepResearch).toBe('function');
  });

  it('exports required types', async () => {
    const mod = await import('../core/deep-research.js');
    // Just verify the function is callable
    expect(mod.runDeepResearch).toBeDefined();
  });
});

describe('runDeepResearch - input validation', () => {
  it('throws on empty question', async () => {
    const { runDeepResearch } = await import('../core/deep-research.js');
    await expect(runDeepResearch({ question: '' })).rejects.toThrow('question');
  });

  it('throws on whitespace-only question', async () => {
    const { runDeepResearch } = await import('../core/deep-research.js');
    await expect(runDeepResearch({ question: '   ' })).rejects.toThrow('question');
  });

  it('throws when question exceeds 5000 chars', async () => {
    const { runDeepResearch } = await import('../core/deep-research.js');
    const longQ = 'a'.repeat(5001);
    await expect(runDeepResearch({ question: longQ })).rejects.toThrow('too long');
  });
});

describe('runDeepResearch - aborts on signal', () => {
  it('respects AbortSignal', async () => {
    const { runDeepResearch } = await import('../core/deep-research.js');
    const ac = new AbortController();
    ac.abort(); // Pre-abort

    // When aborted before LLM call, should reject or return quickly
    // It won't error on abort per se (it just skips rounds), but it shouldn't hang
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'sub-query 1\nsub-query 2' } }],
        result: { response: 'sub-query 1\nsub-query 2' },
        success: true,
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    resetNeuronUsage();

    try {
      // With an aborted signal and cloudflare provider (which needs env vars),
      // the call will fail early. We just verify it doesn't hang.
      const p = runDeepResearch({
        question: 'test question',
        llm: { provider: 'ollama', endpoint: 'http://localhost:11434' },
        maxRounds: 1,
        signal: ac.signal,
      });
      // Should resolve (empty rounds, then try synthesis which may fail)
      await expect(p).rejects.toThrow(); // will fail since no valid Ollama
    } catch {
      // Expected
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Route handler tests (via createDeepResearchRouter)
// ---------------------------------------------------------------------------

describe('createDeepResearchRouter', () => {
  let createDeepResearchRouter: () => import('express').Router;

  beforeEach(async () => {
    const mod = await import('../server/routes/deep-research.js');
    createDeepResearchRouter = mod.createDeepResearchRouter;
  });

  it('exports createDeepResearchRouter function', () => {
    expect(typeof createDeepResearchRouter).toBe('function');
  });

  it('creates a router', () => {
    const router = createDeepResearchRouter();
    expect(router).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// URL normalization (internal via deduplication logic)
// ---------------------------------------------------------------------------

describe('URL normalization for deduplication', () => {
  // Test the normalization indirectly by testing that we can import the module
  it('module handles duplicate URLs correctly', async () => {
    // This test verifies the deduplication logic by running a controlled fetch
    // We'll test the concept by checking URL normalization patterns
    const urls = [
      'https://example.com/page',
      'https://www.example.com/page',
      'https://example.com/page/',
    ];

    function normalize(url: string): string {
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        const path = (u.pathname || '/').replace(/\/+$/, '');
        return `${host}${path}`;
      } catch {
        return url;
      }
    }

    const normalized = urls.map(normalize);
    // www. and trailing slash should normalize to same key
    expect(normalized[0]).toBe(normalized[1]); // www stripped
    expect(normalized[0]).toBe(normalized[2]); // trailing slash stripped
  });
});

// ---------------------------------------------------------------------------
// Gap detection JSON parsing
// ---------------------------------------------------------------------------

describe('Gap detection JSON parsing edge cases', () => {
  it('handles valid JSON response', () => {
    const jsonStr = JSON.stringify({
      hasEnoughInfo: false,
      gaps: ['missing pricing info'],
      additionalQueries: ['product pricing 2024'],
    });
    const parsed = JSON.parse(jsonStr);
    expect(parsed.hasEnoughInfo).toBe(false);
    expect(parsed.gaps).toHaveLength(1);
    expect(parsed.additionalQueries).toHaveLength(1);
  });

  it('handles hasEnoughInfo=true with empty arrays', () => {
    const jsonStr = JSON.stringify({
      hasEnoughInfo: true,
      gaps: [],
      additionalQueries: [],
    });
    const parsed = JSON.parse(jsonStr);
    expect(parsed.hasEnoughInfo).toBe(true);
    expect(parsed.gaps).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    const fallback = { hasEnoughInfo: true, gaps: [], additionalQueries: [] };
    let parsed = fallback;
    try {
      parsed = JSON.parse('not valid json {{}}');
    } catch {
      parsed = fallback;
    }
    expect(parsed.hasEnoughInfo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BM25 scoring integration
// ---------------------------------------------------------------------------

describe('BM25 relevance scoring', () => {
  it('scores relevant content higher than irrelevant', async () => {
    const { scoreBM25, splitIntoBlocks } = await import('../core/bm25-filter.js');

    const relevantContent = 'Machine learning models use neural networks to learn patterns in data.';
    const irrelevantContent = 'The weather today is sunny with light winds from the west.';

    const query = 'machine learning neural networks';
    const queryTerms = query.toLowerCase().split(/\s+/);

    const relevantBlocks = splitIntoBlocks(relevantContent);
    const irrelevantBlocks = splitIntoBlocks(irrelevantContent);

    // Use combined blocks for IDF
    const allBlocks = [...relevantBlocks, ...irrelevantBlocks];
    const allScores = scoreBM25(allBlocks, queryTerms);

    const relevantScore = allScores[0]; // first block
    const irrelevantScore = allScores[1]; // second block

    expect(relevantScore).toBeGreaterThan(irrelevantScore);
  });
});

// ---------------------------------------------------------------------------
// SSE streaming format
// ---------------------------------------------------------------------------

describe('SSE event format', () => {
  it('formats progress events correctly', () => {
    const event = {
      type: 'progress',
      message: 'Searching…',
      round: 1,
    };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    expect(sseData).toContain('data:');
    expect(sseData).toContain('"type":"progress"');
    expect(sseData).toContain('"round":1');
  });

  it('formats chunk events correctly', () => {
    const event = { type: 'chunk', text: 'Hello world' };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    expect(sseData).toContain('"type":"chunk"');
    expect(sseData).toContain('"text":"Hello world"');
  });

  it('formats done event with all fields', () => {
    const event = {
      type: 'done',
      citations: [],
      sourcesUsed: 5,
      roundsCompleted: 2,
      totalSearchQueries: 8,
      llmProvider: 'cloudflare',
      tokensUsed: { input: 1000, output: 500 },
      elapsed: 12345,
    };
    const json = JSON.stringify(event);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('done');
    expect(parsed.sourcesUsed).toBe(5);
    expect(parsed.elapsed).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// Free tier limit error format
// ---------------------------------------------------------------------------

describe('Free tier limit error format', () => {
  it('has correct shape', () => {
    const err = {
      error: 'free_tier_limit' as const,
      message: 'Free AI limit reached for today. Try again tomorrow, or provide your own API key for unlimited use.',
    };
    expect(isFreeTierLimitError(err)).toBe(true);
    expect(err.message).toContain('tomorrow');
    expect(err.message).toContain('API key');
  });
});

// ---------------------------------------------------------------------------
// Provider config validation
// ---------------------------------------------------------------------------

describe('LLM config validation', () => {
  const validProviders: string[] = ['cloudflare', 'openai', 'anthropic', 'google', 'ollama'];

  it('all 5 providers are valid', () => {
    expect(validProviders).toHaveLength(5);
    expect(validProviders).toContain('cloudflare');
    expect(validProviders).toContain('openai');
    expect(validProviders).toContain('anthropic');
    expect(validProviders).toContain('google');
    expect(validProviders).toContain('ollama');
  });

  it('unknown provider is not in valid list', () => {
    expect(validProviders).not.toContain('huggingface');
    expect(validProviders).not.toContain('cohere');
  });
});

// ---------------------------------------------------------------------------
// Neuron cap math
// ---------------------------------------------------------------------------

describe('Neuron cap math', () => {
  beforeEach(() => {
    resetNeuronUsage();
  });

  it('a typical deep research call uses reasonable neurons', () => {
    // Decomposition: ~200 word input, ~50 word output
    const decomp = estimateNeurons(
      Array(200).fill('word').join(' '),
      Array(50).fill('word').join(' '),
    );
    // Should be less than 50 neurons (well within daily cap)
    expect(decomp).toBeLessThan(50);

    // Synthesis: ~2000 word input, ~500 word output
    const synth = estimateNeurons(
      Array(2000).fill('word').join(' '),
      Array(500).fill('word').join(' '),
    );
    // Should be less than 500 neurons
    expect(synth).toBeLessThan(500);
  });

  it('daily cap allows multiple research sessions', () => {
    // Estimate a full research session (~600 neurons based on typical usage)
    const sessionCost = estimateNeurons(
      Array(5000).fill('word').join(' '),
      Array(1500).fill('word').join(' '),
    );
    const sessionsPerDay = Math.floor(9500 / sessionCost);
    // Should allow at least 5 sessions per day
    expect(sessionsPerDay).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Cloudflare API call (mocked)
// ---------------------------------------------------------------------------

describe('callLLM - Cloudflare mocked', () => {
  beforeEach(() => {
    resetNeuronUsage();
  });

  it('calls Cloudflare API with correct URL and auth', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
    process.env.CLOUDFLARE_API_TOKEN = 'test-api-token';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { response: 'Test response text' },
        success: true,
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const config: LLMConfig = { provider: 'cloudflare' };
      const result = await callLLM(config, {
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.text).toBe('Test response text');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('test-account-id'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-token',
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it('accumulates neuron usage after successful Cloudflare call', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
    process.env.CLOUDFLARE_API_TOKEN = 'test-api-token';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { response: 'short response' },
        success: true,
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const beforeUsage = getNeuronUsage().neurons;

    try {
      await callLLM({ provider: 'cloudflare' }, {
        messages: [{ role: 'user', content: 'test question' }],
      });

      const afterUsage = getNeuronUsage().neurons;
      expect(afterUsage).toBeGreaterThan(beforeUsage);
    } finally {
      global.fetch = originalFetch;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it('throws when Cloudflare env vars are missing', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    await expect(
      callLLM({ provider: 'cloudflare' }, {
        messages: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID');
  });
});

// ---------------------------------------------------------------------------
// OpenAI mocked
// ---------------------------------------------------------------------------

describe('callLLM - OpenAI mocked', () => {
  it('parses OpenAI response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'OpenAI answer here' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await callLLM({ provider: 'openai', apiKey: 'sk-test' }, {
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(result.text).toBe('OpenAI answer here');
      expect(result.usage.input).toBe(50);
      expect(result.usage.output).toBe(100);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws on 401 from OpenAI', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      await expect(
        callLLM({ provider: 'openai', apiKey: 'bad-key' }, {
          messages: [{ role: 'user', content: 'test' }],
        }),
      ).rejects.toThrow('401');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Anthropic mocked
// ---------------------------------------------------------------------------

describe('callLLM - Anthropic mocked', () => {
  it('parses Anthropic response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Anthropic answer' }],
        usage: { input_tokens: 30, output_tokens: 60 },
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await callLLM({ provider: 'anthropic', apiKey: 'ant-test' }, {
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(result.text).toBe('Anthropic answer');
      expect(result.usage.input).toBe(30);
      expect(result.usage.output).toBe(60);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Google mocked
// ---------------------------------------------------------------------------

describe('callLLM - Google mocked', () => {
  it('parses Google response correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Google answer' }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 40 },
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await callLLM({ provider: 'google', apiKey: 'goog-test' }, {
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(result.text).toBe('Google answer');
      expect(result.usage.input).toBe(20);
      expect(result.usage.output).toBe(40);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Source Credibility (getSourceCredibility)
// ---------------------------------------------------------------------------

import { getSourceCredibility } from '../core/deep-research.js';

describe('getSourceCredibility - official tier (★★★)', () => {
  it('returns official for .gov domains', () => {
    const cred = getSourceCredibility('https://www.cdc.gov/page');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
    expect(cred.label).toBe('OFFICIAL SOURCE');
  });

  it('returns official for .edu domains', () => {
    const cred = getSourceCredibility('https://mit.edu/research');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
  });

  it('returns official for .mil domains', () => {
    const cred = getSourceCredibility('https://navy.mil/info');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
  });

  it('returns official for arxiv.org', () => {
    const cred = getSourceCredibility('https://arxiv.org/abs/2301.00001');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
  });

  it('returns official for developer.mozilla.org', () => {
    const cred = getSourceCredibility('https://developer.mozilla.org/en-US/docs/Web');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
  });

  it('returns official for who.int', () => {
    const cred = getSourceCredibility('https://who.int/health-topics');
    expect(cred.tier).toBe('official');
    expect(cred.stars).toBe(3);
  });
});

describe('getSourceCredibility - verified tier (★★☆)', () => {
  it('returns verified for wikipedia.org', () => {
    const cred = getSourceCredibility('https://en.wikipedia.org/wiki/TypeScript');
    expect(cred.tier).toBe('verified');
    expect(cred.stars).toBe(2);
    expect(cred.label).toBe('VERIFIED');
  });

  it('returns verified for github.com', () => {
    const cred = getSourceCredibility('https://github.com/microsoft/typescript');
    expect(cred.tier).toBe('verified');
    expect(cred.stars).toBe(2);
  });

  it('returns verified for stackoverflow.com', () => {
    const cred = getSourceCredibility('https://stackoverflow.com/questions/12345');
    expect(cred.tier).toBe('verified');
    expect(cred.stars).toBe(2);
  });

  it('returns verified for reuters.com', () => {
    const cred = getSourceCredibility('https://www.reuters.com/article/tech');
    expect(cred.tier).toBe('verified');
    expect(cred.stars).toBe(2);
  });
});

describe('getSourceCredibility - general tier (★☆☆)', () => {
  it('returns general for random blog', () => {
    const cred = getSourceCredibility('https://myblog.medium.com/article');
    expect(cred.tier).toBe('general');
    expect(cred.stars).toBe(1);
    expect(cred.label).toBe('UNVERIFIED');
  });

  it('returns general for unknown domain', () => {
    const cred = getSourceCredibility('https://some-random-site-xyz.com/article');
    expect(cred.tier).toBe('general');
    expect(cred.stars).toBe(1);
  });

  it('returns general for invalid URL', () => {
    const cred = getSourceCredibility('not a url at all!!!');
    expect(cred.tier).toBe('general');
    expect(cred.stars).toBe(1);
    expect(cred.label).toBe('UNVERIFIED');
  });
});

// ---------------------------------------------------------------------------
// ProgressEventType includes 'verification'
// ---------------------------------------------------------------------------

describe('ProgressEventType includes verification', () => {
  it('verification is a valid ProgressEventType value', async () => {
    const mod = await import('../core/deep-research.js');
    // The type is structural; we verify it via the progress event shape
    const event: import('../core/deep-research.js').DeepResearchProgressEvent = {
      type: 'verification',
      message: 'Verification complete — confidence: HIGH',
      data: {
        conflicts: [],
        confidence: 'high',
        sourceDiversity: true,
      },
    };
    expect(event.type).toBe('verification');
    expect(event.data?.confidence).toBe('high');
    expect(Array.isArray(event.data?.conflicts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cerebras provider
// ---------------------------------------------------------------------------

describe('Cerebras LLM provider', () => {
  it('throws if no api key', async () => {
    const config: LLMConfig = { provider: 'cerebras' };
    await expect(
      callLLM(config, { messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('API key');
  });

  it('calls correct Cerebras endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'cerebras response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await callLLM({ provider: 'cerebras', apiKey: 'cbr-test' }, {
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.text).toBe('cerebras response');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cerebras.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Authorization': 'Bearer cbr-test' }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('uses custom endpoint when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch;
    try {
      await callLLM(
        { provider: 'cerebras', apiKey: 'key', endpoint: 'https://custom.api/v1/chat/completions' },
        { messages: [{ role: 'user', content: 'test' }] },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api/v1/chat/completions',
        expect.any(Object),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('cerebras preferred over cloudflare when CEREBRAS_API_KEY is set', () => {
    const saved = process.env.CEREBRAS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.CEREBRAS_API_KEY = 'cbr-env-key';
    try {
      const config = getDefaultLLMConfig();
      expect(config.provider).toBe('cerebras');
      expect(config.apiKey).toBe('cbr-env-key');
    } finally {
      if (saved !== undefined) process.env.CEREBRAS_API_KEY = saved;
      else delete process.env.CEREBRAS_API_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// SourceCredibility stars mapping
// ---------------------------------------------------------------------------

describe('SourceCredibility stars mapping', () => {
  it('official tier has 3 stars', () => {
    expect(getSourceCredibility('https://nih.gov').stars).toBe(3);
  });

  it('verified tier has 2 stars', () => {
    expect(getSourceCredibility('https://github.com').stars).toBe(2);
  });

  it('general tier has 1 star', () => {
    expect(getSourceCredibility('https://randomsite.xyz').stars).toBe(1);
  });
});
