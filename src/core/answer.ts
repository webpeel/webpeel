/**
 * /answer core implementation
 *
 * Flow:
 * - search the web
 * - fetch top sources via WebPeel
 * - call an LLM (BYOK) to generate a cited answer
 */

import { peel } from '../index.js';
import { getSearchProvider, type SearchProviderId, type WebSearchResult } from './search-provider.js';

export type LLMProviderId = 'openai' | 'anthropic' | 'google';

export interface TokensUsed {
  input: number;
  output: number;
}

export interface AnswerCitation {
  title: string;
  url: string;
  snippet: string;
}

export interface AnswerRequest {
  question: string;
  searchProvider?: SearchProviderId;
  searchApiKey?: string;
  llmProvider: LLMProviderId;
  llmApiKey: string;
  llmModel?: string;
  maxSources?: number;
  stream?: boolean;
  /** Called with incremental text when stream=true */
  onChunk?: (text: string) => void;
  /** Optional AbortSignal */
  signal?: AbortSignal;
}

export interface AnswerResponse {
  answer: string;
  citations: AnswerCitation[];
  searchProvider: SearchProviderId;
  llmProvider: LLMProviderId;
  llmModel: string;
  tokensUsed: TokensUsed;
}

function defaultModelForProvider(provider: LLMProviderId): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'google':
      return 'gemini-1.5-flash';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[Truncated]';
}

async function fetchSources(
  results: WebSearchResult[],
  maxSources: number,
  signal?: AbortSignal
): Promise<Array<{ result: WebSearchResult; content: string }>> {
  const chosen = results.slice(0, maxSources);

  // Fetch in parallel, but keep it modest to avoid resource spikes.
  const concurrency = 3;
  const out: Array<{ result: WebSearchResult; content: string }> = [];

  for (let i = 0; i < chosen.length; i += concurrency) {
    const batch = chosen.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const timeoutMs = 30_000;

        if (signal?.aborted) {
          throw new Error('Aborted');
        }

        const pr = await peel(r.url, {
          format: 'markdown',
          maxTokens: 1800,
          timeout: timeoutMs,
          // Keep it cheap/fast by default; users can always refetch with render=true.
          render: false,
        });

        return { result: r, content: pr.content };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === 'fulfilled') {
        out.push({
          result: s.value.result,
          content: s.value.content,
        });
      } else {
        out.push({
          result: batch[j],
          content: `[Failed to fetch: ${s.reason instanceof Error ? s.reason.message : 'Unknown error'}]`,
        });
      }
    }
  }

  return out;
}

function buildCitedContext(sources: Array<{ result: WebSearchResult; content: string }>): string {
  const parts: string[] = [];

  sources.forEach((s, i) => {
    const n = i + 1;
    const title = s.result.title || '(untitled)';
    const url = s.result.url;
    const snippet = s.result.snippet || '';

    parts.push(
      `SOURCE [${n}]\nTitle: ${title}\nURL: ${url}\nSnippet: ${truncateChars(snippet, 800)}\n\nContent (markdown):\n${truncateChars(s.content || '', 20_000)}`
    );
  });

  return parts.join('\n\n---\n\n');
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal
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

      // Process complete SSE events separated by blank lines
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

async function callOpenAI(
  params: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    stream: boolean;
    onChunk?: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<{ text: string; usage: TokensUsed }>{
  const { apiKey, model, messages, stream, onChunk, signal } = params;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      stream,
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
    const usage: TokensUsed = {
      input: Number(json?.usage?.prompt_tokens || 0),
      output: Number(json?.usage?.completion_tokens || 0),
    };
    return { text, usage };
  }

  if (!resp.body) throw new Error('OpenAI stream error: missing body');

  let out = '';
  let usage: TokensUsed = { input: 0, output: 0 };

  await readTextStream(
    resp.body,
    (data) => {
      if (data === '[DONE]') return;
      let obj: any;
      try {
        obj = JSON.parse(data);
      } catch {
        return;
      }

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
    signal
  );

  return { text: out.trim(), usage };
}

async function callAnthropic(
  params: {
    apiKey: string;
    model: string;
    system: string;
    user: string;
    stream: boolean;
    onChunk?: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<{ text: string; usage: TokensUsed }>{
  const { apiKey, model, system, user, stream, onChunk, signal } = params;

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
      system,
      messages: [{ role: 'user', content: user }],
      max_tokens: 4096,
      temperature: 0.2,
      stream,
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
    const usage: TokensUsed = {
      input: Number(json?.usage?.input_tokens || 0),
      output: Number(json?.usage?.output_tokens || 0),
    };
    return { text, usage };
  }

  if (!resp.body) throw new Error('Anthropic stream error: missing body');

  let out = '';
  let usage: TokensUsed = { input: 0, output: 0 };

  await readTextStream(
    resp.body,
    (data) => {
      let obj: any;
      try {
        obj = JSON.parse(data);
      } catch {
        return;
      }

      // Streaming event types: content_block_delta, message_delta, message_stop, etc.
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

      if (obj?.type === 'message_stop' && obj?.message?.usage) {
        usage = {
          input: Number(obj.message.usage.input_tokens || usage.input),
          output: Number(obj.message.usage.output_tokens || usage.output),
        };
      }
    },
    signal
  );

  return { text: out.trim(), usage };
}

async function callGoogle(
  params: {
    apiKey: string;
    model: string;
    system: string;
    user: string;
    signal?: AbortSignal;
  }
): Promise<{ text: string; usage: TokensUsed }>{
  const { apiKey, model, system, user, signal } = params;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${system}\n\n${user}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
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

  const usage: TokensUsed = {
    input: Number(json?.usageMetadata?.promptTokenCount || 0),
    output: Number(json?.usageMetadata?.candidatesTokenCount || 0),
  };

  return { text: String(text || '').trim(), usage };
}

function systemPrompt(): string {
  return [
    'You are a helpful assistant that answers questions using ONLY the provided sources.',
    'You must cite sources using bracketed numbers like [1], [2], etc. corresponding to the sources list.',
    'If the sources do not contain the answer, say you do not know.',
    'Do not fabricate URLs or citations.',
  ].join('\n');
}

export async function answerQuestion(req: AnswerRequest): Promise<AnswerResponse> {
  const question = (req.question || '').trim();
  if (!question) throw new Error('Missing or invalid "question"');
  if (question.length > 2000) throw new Error('Question too long (max 2000 characters)');

  const searchProvider: SearchProviderId = req.searchProvider || 'duckduckgo';
  const maxSources = clamp(req.maxSources ?? 5, 1, 10);

  const llmProvider = req.llmProvider;
  const llmApiKey = (req.llmApiKey || '').trim();
  if (!llmApiKey) throw new Error('Missing or invalid "llmApiKey" (BYOK required)');

  const llmModel = (req.llmModel || '').trim() || defaultModelForProvider(llmProvider);

  // 1) Search
  const provider = getSearchProvider(searchProvider);
  const searchResults = await provider.searchWeb(question, {
    count: maxSources,
    apiKey: req.searchApiKey,
    signal: req.signal,
  });

  const citations: AnswerCitation[] = searchResults.slice(0, maxSources).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
  }));

  // 2) Fetch sources
  const fetched = await fetchSources(searchResults, maxSources, req.signal);
  const context = buildCitedContext(fetched);

  // 3) LLM
  const sys = systemPrompt();
  const user = `Question:\n${question}\n\nSources:\n\n${context}\n\nWrite the best possible answer. Remember to cite sources like [1], [2].`;

  const stream = req.stream === true;

  let answer = '';
  let tokensUsed: TokensUsed = { input: 0, output: 0 };

  if (llmProvider === 'openai') {
    const messages: ChatMessage[] = [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];

    const r = await callOpenAI({
      apiKey: llmApiKey,
      model: llmModel,
      messages,
      stream,
      onChunk: req.onChunk,
      signal: req.signal,
    });

    answer = r.text;
    tokensUsed = r.usage;
  } else if (llmProvider === 'anthropic') {
    const r = await callAnthropic({
      apiKey: llmApiKey,
      model: llmModel,
      system: sys,
      user,
      stream,
      onChunk: req.onChunk,
      signal: req.signal,
    });

    answer = r.text;
    tokensUsed = r.usage;
  } else if (llmProvider === 'google') {
    // Google streaming is not implemented here; when stream=true, the caller can
    // still stream the final text in chunks.
    const r = await callGoogle({
      apiKey: llmApiKey,
      model: llmModel,
      system: sys,
      user,
      signal: req.signal,
    });

    answer = r.text;
    tokensUsed = r.usage;

    if (stream && req.onChunk) {
      // Emit reasonable chunks so SSE clients can start rendering.
      const chunkSize = 120;
      for (let i = 0; i < answer.length; i += chunkSize) {
        req.onChunk(answer.slice(i, i + chunkSize));
      }
    }
  } else {
    throw new Error(`Unsupported llmProvider: ${llmProvider}`);
  }

  return {
    answer,
    citations,
    searchProvider,
    llmProvider,
    llmModel,
    tokensUsed,
  };
}
