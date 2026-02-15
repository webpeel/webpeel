/**
 * Autonomous web research agent
 * Searches the web, fetches pages, and extracts structured data based on natural language prompts
 *
 * Supports:
 * - depth: "basic" (1 search, top 3) vs "thorough" (multi-step, up to 3 searches, top 10)
 * - maxSources: control how many sources to include (default 5, max 20)
 * - topic: "general" | "news" | "technical" | "academic" — adjusts queries & prioritization
 * - outputSchema: JSON Schema for structured output with validation
 * - streaming callbacks for SSE support
 */

import { load } from 'cheerio';
import { peel } from '../index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentDepth = 'basic' | 'thorough';
export type AgentTopic = 'general' | 'news' | 'technical' | 'academic';

export interface AgentOptions {
  /** Natural language description of what data to extract */
  prompt: string;
  /** Optional URLs to start from */
  urls?: string[];
  /** JSON schema for structured output (legacy — prefer outputSchema) */
  schema?: Record<string, any>;
  /** JSON Schema for structured output with validation */
  outputSchema?: Record<string, any>;
  /** LLM API key (BYOK - bring your own key) */
  llmApiKey: string;
  /** LLM API base URL (default: OpenAI) */
  llmApiBase?: string;
  /** LLM model (default: gpt-4o-mini) */
  llmModel?: string;
  /** Max pages to visit (default: 10) — legacy param */
  maxPages?: number;
  /** Max sources to include (default 5, max 20) */
  maxSources?: number;
  /** Research depth: "basic" or "thorough" */
  depth?: AgentDepth;
  /** Topic filter */
  topic?: AgentTopic;
  /** Max credits/cost to spend */
  maxCredits?: number;
  /** Progress callback (legacy — still supported) */
  onProgress?: (progress: AgentProgress) => void;
  /** Streaming event callback for SSE */
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AgentProgress {
  status: 'searching' | 'visiting' | 'extracting' | 'done';
  currentUrl?: string;
  pagesVisited: number;
  message: string;
}

export interface AgentResult {
  success: boolean;
  data: any;
  /** The synthesised answer (text). Only present when no outputSchema. */
  answer?: string;
  sources: string[];           // URL strings (backward compat)
  sourcesDetailed?: Array<{    // richer source info
    url: string;
    title: string;
  }>;
  pagesVisited: number;
  creditsUsed: number;
  tokensUsed?: { input: number; output: number };
}

/** Events emitted during streaming */
export type AgentStreamEvent =
  | { type: 'step'; action: 'searching'; query: string }
  | { type: 'step'; action: 'fetching'; url: string }
  | { type: 'step'; action: 'analyzing'; summary: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; answer: string; sources: Array<{ url: string; title: string }>; tokensUsed: { input: number; output: number } };

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Search DuckDuckGo HTML and parse results
 */
async function searchWeb(query: string, limit = 10): Promise<SearchResult[]> {
  const { fetch: undiciFetch } = await import('undici');
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  try {
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    const html = await response.text();
    const $ = load(html);

    const results: SearchResult[] = [];
    $('.result').each((_, el) => {
      const link = $(el).find('.result__a');
      const snippet = $(el).find('.result__snippet');

      const rawUrl = link.attr('href');
      const title = link.text().trim();
      const desc = snippet.text().trim();

      if (rawUrl && title) {
        try {
          const actualUrl = rawUrl.startsWith('//')
            ? `https:${rawUrl}`
            : rawUrl.includes('uddg=')
              ? decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0])
              : rawUrl;

          results.push({ url: actualUrl, title, snippet: desc });
        } catch {
          // Skip malformed URLs
        }
      }
    });

    return results.slice(0, limit);
  } catch (error: any) {
    console.error('Search failed:', error);
    return [];
  }
}

/**
 * Prioritise search results by topic relevance (higher = better)
 */
function scoreByTopic(result: SearchResult, topic: AgentTopic): number {
  const url = result.url.toLowerCase();
  const domain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();

  switch (topic) {
    case 'academic':
      if (/\.edu$|arxiv\.org|scholar\.google|pubmed|ieee\.org|acm\.org|researchgate\.net/.test(domain)) return 10;
      if (/\.gov$/.test(domain)) return 5;
      return 0;
    case 'technical':
      if (/github\.com|stackoverflow\.com|docs\.|developer\.|devdocs\.io|mdn\./.test(domain)) return 10;
      if (/\.dev$|\.io$/.test(domain)) return 3;
      return 0;
    case 'news':
      if (/reuters\.com|apnews\.com|bbc\.com|cnn\.com|nytimes\.com|theguardian\.com|bloomberg\.com|techcrunch\.com|theverge\.com|arstechnica\.com/.test(domain)) return 10;
      if (/news|press|blog/.test(domain)) return 3;
      return 0;
    default:
      return 0;
  }
}

/**
 * Add topic-specific modifiers to search queries
 */
function enhanceQueryForTopic(query: string, topic: AgentTopic): string {
  switch (topic) {
    case 'news':
      return `${query} latest news 2026`;
    case 'academic':
      return `${query} research paper study`;
    case 'technical':
      return `${query} documentation tutorial`;
    default:
      return query;
  }
}

interface LLMResponse {
  content: string;
  usage: { input: number; output: number };
}

/**
 * Call OpenAI-compatible LLM API (non-streaming)
 */
async function callLLM(
  messages: Array<{ role: string; content: string }>,
  options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    jsonMode?: boolean;
  },
): Promise<LLMResponse> {
  const { apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1', jsonMode } = options;
  const { fetch: undiciFetch } = await import('undici');

  const body: any = {
    model,
    messages,
    temperature: 0,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await undiciFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as any;
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('LLM returned empty response');
  }

  const usage = result.usage
    ? { input: result.usage.prompt_tokens ?? 0, output: result.usage.completion_tokens ?? 0 }
    : { input: 0, output: 0 };

  return { content, usage };
}

/**
 * Call OpenAI-compatible LLM API with streaming.
 * Invokes `onChunk` for each text delta, returns full content when done.
 */
async function callLLMStreaming(
  messages: Array<{ role: string; content: string }>,
  options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    jsonMode?: boolean;
  },
  onChunk?: (text: string) => void,
): Promise<LLMResponse> {
  if (!onChunk) return callLLM(messages, options);

  const { apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1', jsonMode } = options;
  const { fetch: undiciFetch } = await import('undici');

  const body: any = {
    model,
    messages,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await undiciFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  let fullContent = '';
  let usage = { input: 0, output: 0 };

  // Read the SSE stream
  const reader = (response.body as any)?.getReader?.();
  if (!reader) {
    // Fallback: consume entire body
    const text = await response.text();
    return { content: text, usage };
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }
        // Final chunk may include usage
        if (parsed.usage) {
          usage = {
            input: parsed.usage.prompt_tokens ?? 0,
            output: parsed.usage.completion_tokens ?? 0,
          };
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return { content: fullContent, usage };
}

/**
 * Validate JSON data against a JSON Schema (best-effort, no extra deps)
 */
function validateJsonSchema(data: any, schema: Record<string, any>): { valid: boolean; errors?: string } {
  // Lightweight validation: check required fields and top-level types
  if (schema.type === 'object' && schema.properties) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { valid: false, errors: 'Expected an object' };
    }
    if (schema.required && Array.isArray(schema.required)) {
      const missing = schema.required.filter((k: string) => !(k in data));
      if (missing.length > 0) {
        return { valid: false, errors: `Missing required fields: ${missing.join(', ')}` };
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      return { valid: false, errors: 'Expected an array' };
    }
  }
  return { valid: true };
}

/**
 * Truncate content to approximately N tokens (rough estimate: 1 token ≈ 4 chars)
 */
function truncateContent(content: string, maxTokens = 3000): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n[Content truncated...]';
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

/**
 * Run autonomous web research agent
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    prompt,
    urls: startUrls = [],
    schema: legacySchema,
    outputSchema,
    llmApiKey,
    llmApiBase = 'https://api.openai.com/v1',
    llmModel = 'gpt-4o-mini',
    maxPages,
    maxSources: rawMaxSources,
    depth = 'basic',
    topic = 'general',
    maxCredits,
    onProgress,
    onEvent,
  } = options;

  if (!llmApiKey) throw new Error('llmApiKey is required');
  if (!prompt) throw new Error('prompt is required');

  // Effective schema = outputSchema || legacy schema
  const effectiveSchema = outputSchema || legacySchema;

  // Determine effective maxSources:
  //   new param > legacy maxPages > depth-based default
  const depthDefaults = depth === 'thorough'
    ? { maxSources: 10, maxQueries: 3, resultsPerQuery: 10 }
    : { maxSources: 3, maxQueries: 1, resultsPerQuery: 5 };

  const maxSourcesLimit = Math.min(rawMaxSources ?? maxPages ?? depthDefaults.maxSources, 20);
  const maxQueries = depth === 'thorough' ? depthDefaults.maxQueries : depthDefaults.maxQueries;

  const visitedUrls = new Set<string>();
  const sources: string[] = [];
  const sourcesDetailed: Array<{ url: string; title: string }> = [];
  let pagesVisited = 0;
  let creditsUsed = 0;
  let totalUsage = { input: 0, output: 0 };

  const collectedData: Array<{ url: string; content: string; title: string }> = [];

  // Emit both legacy progress and new event
  const reportProgress = (status: AgentProgress['status'], message: string, currentUrl?: string) => {
    if (onProgress) {
      onProgress({ status, currentUrl, pagesVisited, message });
    }
  };

  const emit = (event: AgentStreamEvent) => {
    if (onEvent) onEvent(event);
  };

  const accUsage = (u: { input: number; output: number }) => {
    totalUsage.input += u.input;
    totalUsage.output += u.output;
  };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Determine search strategy & collect URLs
    // -----------------------------------------------------------------------
    let urlsToVisit: string[] = [...startUrls];

    if (urlsToVisit.length === 0) {
      reportProgress('searching', 'Planning research strategy...');

      const queryCount = depth === 'thorough' ? '3-5' : '2-3';
      const topicHint = topic !== 'general'
        ? `\nFocus queries on ${topic} sources.`
        : '';

      const planningMessages = [
        {
          role: 'system',
          content: `You are a web research assistant. Generate ${queryCount} specific search queries to find information for the user's request.${topicHint}\nReturn JSON only: {"queries": ["query1", "query2", ...]}`,
        },
        { role: 'user', content: `Research request: ${prompt}` },
      ];

      const planResponse = await callLLM(planningMessages, {
        apiKey: llmApiKey,
        model: llmModel,
        baseUrl: llmApiBase,
        jsonMode: true,
      });
      creditsUsed++;
      accUsage(planResponse.usage);

      let queries: string[] = [];
      try {
        const parsed = JSON.parse(planResponse.content);
        queries = parsed.queries || [];
      } catch {
        queries = [prompt];
      }

      // Limit queries to maxQueries
      const effectiveQueries = queries.slice(0, maxQueries);

      for (const rawQuery of effectiveQueries) {
        const query = topic !== 'general' ? enhanceQueryForTopic(rawQuery, topic) : rawQuery;

        reportProgress('searching', `Searching: ${query}`);
        emit({ type: 'step', action: 'searching', query });

        const results = await searchWeb(query, depthDefaults.resultsPerQuery);

        // Sort by topic relevance
        if (topic !== 'general') {
          results.sort((a, b) => scoreByTopic(b, topic) - scoreByTopic(a, topic));
        }

        urlsToVisit.push(...results.map(r => r.url));
        if (urlsToVisit.length >= maxSourcesLimit * 2) break; // fetch a bit more than needed to account for failures
      }

      // Deduplicate by hostname+pathname
      const seen = new Set<string>();
      urlsToVisit = urlsToVisit.filter(u => {
        try {
          const key = new URL(u).hostname + new URL(u).pathname;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        } catch {
          return false;
        }
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: Visit pages and collect data
    // -----------------------------------------------------------------------
    const maxToFetch = Math.min(urlsToVisit.length, maxSourcesLimit);

    for (const url of urlsToVisit.slice(0, maxToFetch + 5)) {
      // Enough data collected?
      if (collectedData.length >= maxSourcesLimit) break;
      if (maxCredits && creditsUsed >= maxCredits) {
        reportProgress('done', 'Credit limit reached');
        break;
      }
      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);

      reportProgress('visiting', `Fetching: ${url}`, url);
      emit({ type: 'step', action: 'fetching', url });

      try {
        const result = await peel(url, { format: 'markdown', timeout: 15000 });
        pagesVisited++;
        creditsUsed++;

        const truncated = truncateContent(result.content, depth === 'thorough' ? 4000 : 3000);
        collectedData.push({ url: result.url, title: result.title, content: truncated });
        sources.push(result.url);
        sourcesDetailed.push({ url: result.url, title: result.title });

        reportProgress('visiting', `Fetched: ${result.title}`, url);
      } catch (error: any) {
        console.error(`Failed to fetch ${url}:`, error.message);
      }
    }

    // -----------------------------------------------------------------------
    // Step 2b (thorough only): Cross-reference — ask LLM if more info needed
    // -----------------------------------------------------------------------
    if (depth === 'thorough' && collectedData.length > 0 && collectedData.length < maxSourcesLimit) {
      reportProgress('searching', 'Cross-referencing — checking for gaps...');
      emit({ type: 'step', action: 'analyzing', summary: 'Cross-referencing collected data for gaps...' });

      const gapMessages = [
        {
          role: 'system',
          content: 'You are a web research assistant. Given the user\'s research request and summaries of pages already visited, identify any gaps. If more searches would help, return JSON: {"queries":["q1"]}. If no gaps, return {"queries":[]}.',
        },
        {
          role: 'user',
          content: `Research request: ${prompt}\n\nPages visited:\n${collectedData.map(d => `- ${d.title} (${d.url})`).join('\n')}`,
        },
      ];

      try {
        const gapResponse = await callLLM(gapMessages, {
          apiKey: llmApiKey, model: llmModel, baseUrl: llmApiBase, jsonMode: true,
        });
        creditsUsed++;
        accUsage(gapResponse.usage);

        const gapParsed = JSON.parse(gapResponse.content);
        const gapQueries: string[] = (gapParsed.queries || []).slice(0, 2);

        for (const q of gapQueries) {
          emit({ type: 'step', action: 'searching', query: q });
          const results = await searchWeb(q, 5);

          for (const r of results) {
            if (collectedData.length >= maxSourcesLimit) break;
            if (visitedUrls.has(r.url)) continue;
            visitedUrls.add(r.url);

            emit({ type: 'step', action: 'fetching', url: r.url });
            try {
              const result = await peel(r.url, { format: 'markdown', timeout: 15000 });
              pagesVisited++;
              creditsUsed++;
              const truncated = truncateContent(result.content, 4000);
              collectedData.push({ url: result.url, title: result.title, content: truncated });
              sources.push(result.url);
              sourcesDetailed.push({ url: result.url, title: result.title });
            } catch {
              // skip
            }
          }
        }
      } catch {
        // Non-critical — continue with what we have
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: Extract / synthesise final answer
    // -----------------------------------------------------------------------
    if (collectedData.length === 0) {
      return {
        success: false,
        data: { error: 'No data could be collected from the web' },
        sources: [],
        pagesVisited,
        creditsUsed,
        tokensUsed: totalUsage,
      };
    }

    reportProgress('extracting', 'Analyzing collected data...');
    emit({ type: 'step', action: 'analyzing', summary: `Synthesizing answer from ${collectedData.length} sources...` });

    const context = collectedData
      .map(d => `Source: ${d.url}\nTitle: ${d.title}\n\n${d.content}`)
      .join('\n\n---\n\n');

    const truncatedContext = truncateContent(context, depth === 'thorough' ? 12000 : 8000);

    // Build system prompt based on schema or free-form
    let systemPrompt: string;
    if (effectiveSchema) {
      systemPrompt =
        'You are a web research assistant. Extract structured data from the provided web content based on the user\'s request. ' +
        `Return a JSON object matching this schema:\n${JSON.stringify(effectiveSchema, null, 2)}\n\nReturn ONLY valid JSON, no explanation.`;
    } else {
      systemPrompt =
        'You are a web research assistant. Based on the provided web content, answer the user\'s research question. ' +
        'Provide a comprehensive, well-structured answer. Return a JSON object with:\n' +
        '- "answer": your detailed answer as a string (use markdown formatting)\n' +
        '- "keyFindings": array of key facts/findings\n' +
        'Return ONLY valid JSON, no explanation.';
    }

    const extractMessages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Research request: ${prompt}\n\nCollected data from ${collectedData.length} web pages:\n\n${truncatedContext}`,
      },
    ];

    // Use streaming LLM call when onEvent is present
    const hasStreaming = !!onEvent;
    const extractResponse = await callLLMStreaming(
      extractMessages,
      { apiKey: llmApiKey, model: llmModel, baseUrl: llmApiBase, jsonMode: true },
      hasStreaming ? (text: string) => emit({ type: 'chunk', text }) : undefined,
    );
    creditsUsed++;
    accUsage(extractResponse.usage);

    // Parse final result
    let finalData: any;
    try {
      finalData = JSON.parse(extractResponse.content);
    } catch {
      finalData = { result: extractResponse.content };
    }

    // Validate against outputSchema if provided
    if (outputSchema) {
      const validation = validateJsonSchema(finalData, outputSchema);
      if (!validation.valid) {
        // Try once more: ask LLM to fix
        try {
          const fixMessages = [
            {
              role: 'system',
              content: `The previous response did not match the required JSON schema. Fix it.\nSchema: ${JSON.stringify(outputSchema)}\nErrors: ${validation.errors}\nReturn ONLY valid JSON.`,
            },
            { role: 'user', content: extractResponse.content },
          ];
          const fixResponse = await callLLM(fixMessages, {
            apiKey: llmApiKey, model: llmModel, baseUrl: llmApiBase, jsonMode: true,
          });
          creditsUsed++;
          accUsage(fixResponse.usage);
          finalData = JSON.parse(fixResponse.content);
        } catch {
          // Return what we have with a warning
          finalData._validationWarning = `Output did not match schema: ${validation.errors}`;
        }
      }
    }

    const answerText = typeof finalData?.answer === 'string' ? finalData.answer : undefined;

    reportProgress('done', `Completed: ${pagesVisited} pages visited`);
    emit({
      type: 'done',
      answer: answerText || JSON.stringify(finalData),
      sources: sourcesDetailed,
      tokensUsed: totalUsage,
    });

    return {
      success: true,
      data: finalData,
      answer: answerText,
      sources,
      sourcesDetailed,
      pagesVisited,
      creditsUsed,
      tokensUsed: totalUsage,
    };
  } catch (error: any) {
    console.error('Agent error:', error);

    return {
      success: false,
      data: { error: error.message || 'Unknown error occurred' },
      sources,
      sourcesDetailed,
      pagesVisited,
      creditsUsed,
      tokensUsed: totalUsage,
    };
  }
}
