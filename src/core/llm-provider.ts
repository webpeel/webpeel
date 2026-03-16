/**
 * Unified LLM Provider Abstraction for Deep Research
 *
 * Supports 5 providers:
 *   1. Cloudflare Workers AI (free default, with daily neuron cap)
 *   2. OpenAI (BYOK)
 *   3. Anthropic (BYOK)
 *   4. Google Gemini (BYOK)
 *   5. Ollama (local, OpenAI-compatible)
 */

export type DeepResearchLLMProvider = 'cloudflare' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'cerebras';

export interface LLMConfig {
  provider: DeepResearchLLMProvider;
  apiKey?: string;
  model?: string;
  /** For Ollama: base endpoint URL. Default: http://localhost:11434 */
  endpoint?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  messages: LLMMessage[];
  stream?: boolean;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMCallResult {
  text: string;
  usage: { input: number; output: number };
}

export interface FreeTierLimitError {
  error: 'free_tier_limit';
  message: string;
}

// ---------------------------------------------------------------------------
// Cloudflare Neuron Tracker
// ---------------------------------------------------------------------------
// Neuron rates for llama-3.3-70b-instruct-fp8-fast:
//   ~4,119 neurons per 1M input tokens
//   ~204,805 neurons per 1M output tokens
// Daily cap: 9,500 neurons (reset 00:00 UTC)
// ---------------------------------------------------------------------------

const CF_INPUT_NEURONS_PER_TOKEN = 4119 / 1_000_000;   // ~0.004119
const CF_OUTPUT_NEURONS_PER_TOKEN = 204805 / 1_000_000; // ~0.204805
const CF_DAILY_NEURON_CAP = 9_500;

interface NeuronUsage {
  /** UTC date string YYYY-MM-DD */
  date: string;
  /** Neurons consumed today */
  neurons: number;
}

// Module-level singleton
const _neuronUsage: NeuronUsage = {
  date: currentUTCDate(),
  neurons: 0,
};

function currentUTCDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function resetIfNewDay(): void {
  const today = currentUTCDate();
  if (_neuronUsage.date !== today) {
    _neuronUsage.date = today;
    _neuronUsage.neurons = 0;
  }
}

/**
 * Estimate neuron cost for a Cloudflare Workers AI call.
 * Token count: split by whitespace * 1.3
 */
export function estimateNeurons(inputText: string, outputText: string): number {
  const inputWords = inputText.split(/\s+/).filter((s) => s.length > 0).length;
  const outputWords = outputText.split(/\s+/).filter((s) => s.length > 0).length;
  const inputTokens = Math.ceil(inputWords * 1.3);
  const outputTokens = Math.ceil(outputWords * 1.3);
  return inputTokens * CF_INPUT_NEURONS_PER_TOKEN + outputTokens * CF_OUTPUT_NEURONS_PER_TOKEN;
}

/** Get current neuron usage for today */
export function getNeuronUsage(): { date: string; neurons: number; cap: number; remaining: number } {
  resetIfNewDay();
  return {
    date: _neuronUsage.date,
    neurons: _neuronUsage.neurons,
    cap: CF_DAILY_NEURON_CAP,
    remaining: Math.max(0, CF_DAILY_NEURON_CAP - _neuronUsage.neurons),
  };
}

/** Add neurons to today's usage (for testing / external tracking) */
export function addNeuronUsage(neurons: number): void {
  resetIfNewDay();
  _neuronUsage.neurons += neurons;
}

/** Reset neuron usage (for testing) */
export function resetNeuronUsage(): void {
  _neuronUsage.date = currentUTCDate();
  _neuronUsage.neurons = 0;
}

/**
 * Check if Cloudflare free tier has capacity for the given estimated neurons.
 * Returns null if OK, or a FreeTierLimitError if cap would be exceeded.
 */
function checkCloudflareCapacity(estimatedNeurons: number): FreeTierLimitError | null {
  resetIfNewDay();
  if (_neuronUsage.neurons + estimatedNeurons > CF_DAILY_NEURON_CAP) {
    return {
      error: 'free_tier_limit',
      message:
        'Free AI limit reached for today. Try again tomorrow, or provide your own API key for unlimited use.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Default models per provider
// ---------------------------------------------------------------------------

function defaultModel(provider: DeepResearchLLMProvider): string {
  switch (provider) {
    case 'cloudflare':
      return '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'google':
      return 'gemini-1.5-flash';
    case 'ollama':
      return 'llama3';
    case 'cerebras':
      return 'llama-3.3-70b';
  }
}

// ---------------------------------------------------------------------------
// SSE stream reader (shared utility, same as answer.ts)
// ---------------------------------------------------------------------------

async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw new Error('Aborted');

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf('\n\n');
        if (idx === -1) break;

        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = event.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          onText(data);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI
// ---------------------------------------------------------------------------

async function callCloudflare(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const { messages, signal, maxTokens = 2048, temperature = 0.2 } = options;

  // Check neuron cap FIRST (fast early rejection before any I/O)
  const inputText = messages.map((m) => m.content).join(' ');
  // Assume ~500 output words as estimate for capacity check
  const estimatedOutputText = Array(500).fill('word').join(' ');
  const estimatedNeurons = estimateNeurons(inputText, estimatedOutputText);

  const capError = checkCloudflareCapacity(estimatedNeurons);
  if (capError) {
    throw capError;
  }

  // Now validate env vars
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = config.apiKey || process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables',
    );
  }

  const model = config.model || defaultModel('cloudflare');

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Cloudflare Workers AI error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  const json = await resp.json() as any;

  // Cloudflare response format: { result: { response: string }, success: true }
  const text = String(
    json?.result?.response ||
    json?.response ||
    json?.result?.text ||
    '',
  ).trim();

  // Calculate actual neuron usage based on response
  const actualNeurons = estimateNeurons(inputText, text);
  addNeuronUsage(actualNeurons);

  // Estimate token usage
  const inputTokens = Math.ceil(inputText.split(/\s+/).length * 1.3);
  const outputTokens = Math.ceil(text.split(/\s+/).length * 1.3);

  return {
    text,
    usage: { input: inputTokens, output: outputTokens },
  };
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

async function callOpenAI(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('OpenAI requires an API key (llm.apiKey)');

  const model = config.model || defaultModel('openai');
  const { messages, stream, onChunk, signal, maxTokens = 4096, temperature = 0.2 } = options;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: stream ?? false,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI API error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  if (!stream) {
    const json = await resp.json() as any;
    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    return {
      text,
      usage: {
        input: Number(json?.usage?.prompt_tokens || 0),
        output: Number(json?.usage?.completion_tokens || 0),
      },
    };
  }

  if (!resp.body) throw new Error('OpenAI stream: missing body');

  let out = '';
  let usage = { input: 0, output: 0 };

  await readTextStream(
    resp.body,
    (data) => {
      if (data === '[DONE]') return;
      let obj: any;
      try { obj = JSON.parse(data); } catch { return; }

      const delta = obj?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        out += delta;
        onChunk?.(delta);
      }
      if (obj?.usage) {
        usage = {
          input: Number(obj.usage.prompt_tokens || usage.input),
          output: Number(obj.usage.completion_tokens || usage.output),
        };
      }
    },
    signal,
  );

  return { text: out.trim(), usage };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function callAnthropic(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('Anthropic requires an API key (llm.apiKey)');

  const model = config.model || defaultModel('anthropic');
  const { messages, stream, onChunk, signal, maxTokens = 4096, temperature = 0.2 } = options;

  // Separate system prompt from user/assistant messages
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  const userMessages = messages.filter((m) => m.role !== 'system');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(stream ? { 'Accept': 'text/event-stream' } : {}),
    },
    body: JSON.stringify({
      model,
      system: systemMsg || undefined,
      messages: userMessages,
      max_tokens: maxTokens,
      temperature,
      stream: stream ?? false,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic API error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  if (!stream) {
    const json = await resp.json() as any;
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('').trim();
    return {
      text,
      usage: {
        input: Number(json?.usage?.input_tokens || 0),
        output: Number(json?.usage?.output_tokens || 0),
      },
    };
  }

  if (!resp.body) throw new Error('Anthropic stream: missing body');

  let out = '';
  let usage = { input: 0, output: 0 };

  await readTextStream(
    resp.body,
    (data) => {
      let obj: any;
      try { obj = JSON.parse(data); } catch { return; }

      if (obj?.type === 'content_block_delta') {
        const delta = obj?.delta?.text;
        if (typeof delta === 'string' && delta.length > 0) {
          out += delta;
          onChunk?.(delta);
        }
      }
      if (obj?.type === 'message_delta' && obj?.usage) {
        usage = {
          input: Number(obj.usage.input_tokens || usage.input),
          output: Number(obj.usage.output_tokens || usage.output),
        };
      }
    },
    signal,
  );

  return { text: out.trim(), usage };
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

async function callGoogle(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('Google requires an API key (llm.apiKey)');

  const model = config.model || defaultModel('google');
  const { messages, onChunk, signal, maxTokens = 4096, temperature = 0.2 } = options;

  // Combine system + user messages for Google
  const systemMsg = messages.find((m) => m.role === 'system')?.content;
  const userMessages = messages.filter((m) => m.role !== 'system');
  const combinedUser = systemMsg
    ? `${systemMsg}\n\n${userMessages.map((m) => m.content).join('\n\n')}`
    : userMessages.map((m) => m.content).join('\n\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: combinedUser }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google API error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  const json = await resp.json() as any;
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';

  const result = String(text || '').trim();

  const usage = {
    input: Number(json?.usageMetadata?.promptTokenCount || 0),
    output: Number(json?.usageMetadata?.candidatesTokenCount || 0),
  };

  // Simulate streaming for Google (no native streaming in this impl)
  if (onChunk && result) {
    const chunkSize = 120;
    for (let i = 0; i < result.length; i += chunkSize) {
      onChunk(result.slice(i, i + chunkSize));
    }
  }

  return { text: result, usage };
}

// ---------------------------------------------------------------------------
// Ollama (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callOllama(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const endpoint = (config.endpoint || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model = config.model || process.env.OLLAMA_MODEL || defaultModel('ollama');
  const { messages, stream, onChunk, signal, maxTokens = 4096, temperature = 0.2 } = options;

  const url = `${endpoint}/v1/chat/completions`;

  // Support bearer token auth (for nginx reverse proxy on Hetzner)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = config.apiKey || process.env.OLLAMA_SECRET;
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: stream ?? false,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama API error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  if (!stream) {
    const json = await resp.json() as any;
    const msg = json?.choices?.[0]?.message;
    // Ollama Qwen3 thinking: content may be empty, CoT goes to `reasoning` field
    let text = String(msg?.content || '').trim();
    if (!text && msg?.reasoning) text = String(msg.reasoning).trim();
    // Strip <think> tags from Qwen3 models
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return {
      text,
      usage: {
        input: Number(json?.usage?.prompt_tokens || 0),
        output: Number(json?.usage?.completion_tokens || 0),
      },
    };
  }

  if (!resp.body) throw new Error('Ollama stream: missing body');

  let out = '';

  await readTextStream(
    resp.body,
    (data) => {
      if (data === '[DONE]') return;
      let obj: any;
      try { obj = JSON.parse(data); } catch { return; }

      const delta = obj?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        out += delta;
        onChunk?.(delta);
      }
    },
    signal,
  );

  return { text: out.trim(), usage: { input: 0, output: 0 } };
}

// ---------------------------------------------------------------------------
// Cerebras (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callCerebras(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('Cerebras requires an API key (llm.apiKey)');

  const endpoint = (config.endpoint || 'https://api.cerebras.ai/v1/chat/completions');
  const model = config.model || defaultModel('cerebras');
  const { messages, stream, onChunk, signal, maxTokens = 4096, temperature = 0.2 } = options;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: stream ?? false,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Cerebras API error: HTTP ${resp.status}${text ? ` - ${text}` : ''}`);
  }

  if (!stream) {
    const json = await resp.json() as any;
    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    return {
      text,
      usage: {
        input: Number(json?.usage?.prompt_tokens || 0),
        output: Number(json?.usage?.completion_tokens || 0),
      },
    };
  }

  if (!resp.body) throw new Error('Cerebras stream: missing body');

  let out = '';
  let usage = { input: 0, output: 0 };

  await readTextStream(
    resp.body,
    (data) => {
      if (data === '[DONE]') return;
      let obj: any;
      try { obj = JSON.parse(data); } catch { return; }

      const delta = obj?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        out += delta;
        onChunk?.(delta);
      }
      if (obj?.usage) {
        usage = {
          input: Number(obj.usage.prompt_tokens || usage.input),
          output: Number(obj.usage.completion_tokens || usage.output),
        };
      }
    },
    signal,
  );

  return { text: out.trim(), usage };
}

// ---------------------------------------------------------------------------
// Main unified call function
// ---------------------------------------------------------------------------

/**
 * Call an LLM using the unified provider abstraction.
 *
 * @throws {FreeTierLimitError} if Cloudflare free tier cap is exceeded
 * @throws {Error} for other failures
 */
export async function callLLM(
  config: LLMConfig,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  const provider = config.provider;

  switch (provider) {
    case 'cloudflare':
      return callCloudflare(config, options);
    case 'openai':
      return callOpenAI(config, options);
    case 'anthropic':
      return callAnthropic(config, options);
    case 'google':
      return callGoogle(config, options);
    case 'ollama':
      return callOllama(config, options);
    case 'cerebras':
      return callCerebras(config, options);
    default: {
      // TypeScript exhaustiveness
      const _exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Get the default LLM config based on available environment variables.
 *
 * Priority order: Anthropic → OpenAI → Google → Cerebras → Cloudflare (free tier fallback).
 * If no BYOK key and no Cloudflare credentials are configured, returns a cloudflare config
 * that will throw a clear error when callLLM is invoked (CLOUDFLARE_ACCOUNT_ID missing).
 */
export function getDefaultLLMConfig(): LLMConfig {
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { provider: 'google', apiKey: process.env.GOOGLE_API_KEY };
  }
  if (process.env.CEREBRAS_API_KEY) {
    return { provider: 'cerebras', apiKey: process.env.CEREBRAS_API_KEY };
  }
  // Default: Cloudflare free tier (requires CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN at call time)
  return { provider: 'cloudflare' };
}

/** Type guard: check if a thrown value is a FreeTierLimitError */
export function isFreeTierLimitError(err: unknown): err is FreeTierLimitError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as FreeTierLimitError).error === 'free_tier_limit'
  );
}
