/**
 * Tests for unified LLM provider config resolution (getDefaultLLMConfig, getQuickLLMConfig, baseUrl)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getDefaultLLMConfig,
  getQuickLLMConfig,
} from '../core/llm-provider.js';

// ---------------------------------------------------------------------------
// Helper: save and restore environment variables
// ---------------------------------------------------------------------------
const LLM_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'GOOGLE_API_KEY',
  'CEREBRAS_API_KEY',
  'GLAMA_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_URL',
  'OLLAMA_SECRET',
  'OLLAMA_MODEL',
  'LLM_MODEL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
] as const;

type EnvSnapshot = Record<string, string | undefined>;

function clearLLMEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of LLM_ENV_KEYS) {
    snap[key] = process.env[key];
    delete process.env[key];
  }
  return snap;
}

function restoreLLMEnv(snap: EnvSnapshot): void {
  for (const [key, val] of Object.entries(snap)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests: getDefaultLLMConfig
// ---------------------------------------------------------------------------

describe('getDefaultLLMConfig', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = clearLLMEnv();
  });
  afterEach(() => {
    restoreLLMEnv(envSnap);
  });

  it('returns anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.apiKey).toBe('sk-ant-test');
  });

  it('returns openai when OPENAI_API_KEY is set (no base URL)', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.baseUrl).toBeUndefined();
  });

  it('includes baseUrl when OPENAI_BASE_URL is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://custom.api.example.com/v1';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.baseUrl).toBe('https://custom.api.example.com/v1');
  });

  it('returns glama as openai with baseUrl when GLAMA_API_KEY is set', () => {
    process.env.GLAMA_API_KEY = 'glama-test';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('glama-test');
    expect(cfg.baseUrl).toBe('https://glama.ai/api/gateway/openai/v1');
    expect(cfg.model).toContain('gemini');
  });

  it('returns openrouter as openai with baseUrl when OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('or-test');
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('returns ollama when OLLAMA_URL is set', () => {
    process.env.OLLAMA_URL = 'http://localhost:11434';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('ollama');
    expect(cfg.endpoint).toBe('http://localhost:11434');
  });

  it('respects priority: anthropic > openai > glama', () => {
    process.env.ANTHROPIC_API_KEY = 'ant';
    process.env.OPENAI_API_KEY = 'oai';
    process.env.GLAMA_API_KEY = 'glm';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('anthropic');
  });

  it('respects priority: openai > glama', () => {
    process.env.OPENAI_API_KEY = 'oai';
    process.env.GLAMA_API_KEY = 'glm';
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('oai');
  });

  it('falls back to cloudflare when nothing is set', () => {
    const cfg = getDefaultLLMConfig();
    expect(cfg.provider).toBe('cloudflare');
  });

  it('respects LLM_MODEL override for glama', () => {
    process.env.GLAMA_API_KEY = 'glm';
    process.env.LLM_MODEL = 'custom-model';
    const cfg = getDefaultLLMConfig();
    expect(cfg.model).toBe('custom-model');
  });
});

// ---------------------------------------------------------------------------
// Tests: getQuickLLMConfig
// ---------------------------------------------------------------------------

describe('getQuickLLMConfig', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = clearLLMEnv();
  });
  afterEach(() => {
    restoreLLMEnv(envSnap);
  });

  it('returns null when no provider is configured', () => {
    expect(getQuickLLMConfig()).toBeNull();
  });

  it('prefers openai for quick calls (fast/cheap model)', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.provider).toBe('openai');
    expect(cfg!.model).toBe('gpt-4o-mini');
  });

  it('picks glama before anthropic (cheaper for quick calls)', () => {
    process.env.GLAMA_API_KEY = 'glm';
    process.env.ANTHROPIC_API_KEY = 'ant';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.apiKey).toBe('glm');
    expect(cfg!.baseUrl).toContain('glama.ai');
  });

  it('falls back to anthropic with haiku model', () => {
    process.env.ANTHROPIC_API_KEY = 'ant';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.provider).toBe('anthropic');
    expect(cfg!.model).toContain('haiku');
  });

  it('picks ollama with small model', () => {
    process.env.OLLAMA_URL = 'http://localhost:11434';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.provider).toBe('ollama');
    expect(cfg!.model).toBe('qwen3:1.7b');
  });

  it('respects OPENAI_BASE_URL in quick config', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://my-proxy.example.com/v1';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.baseUrl).toBe('https://my-proxy.example.com/v1');
  });

  it('respects LLM_MODEL override for openai', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.LLM_MODEL = 'gpt-3.5-turbo';
    const cfg = getQuickLLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.model).toBe('gpt-3.5-turbo');
  });
});
