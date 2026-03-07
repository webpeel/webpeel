/**
 * LLM-based extraction: sends markdown/text content to an LLM
 * with instructions to extract structured data.
 *
 * Supports:
 *   - OpenAI-compatible APIs (OpenAI, custom models via baseUrl)
 *   - Anthropic (Claude Haiku, Sonnet, Opus)
 *   - Google (Gemini Flash, Pro)
 */

export type LLMProvider = 'openai' | 'anthropic' | 'google';

/** Default models per provider (cheapest/fastest) */
export const DEFAULT_PROVIDER_MODELS: Record<LLMProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.0-flash',
};

export interface LLMExtractionOptions {
  content: string;        // The markdown/text content to extract from
  instruction?: string;   // User instruction (e.g., "extract hotel names and prices")
  schema?: object;        // Optional JSON schema for structured output
  apiKey?: string;        // API key (or from OPENAI_API_KEY env)
  baseUrl?: string;       // API base URL (default: https://api.openai.com/v1)
  model?: string;         // Model name (default: gpt-4o-mini for cost efficiency)
  maxTokens?: number;     // Max response tokens (default: 4000)
  // Multi-provider fields (optional, for new API)
  url?: string;           // Source URL (informational)
  prompt?: string;        // Alias for instruction
  llmProvider?: LLMProvider;  // Provider: 'openai' | 'anthropic' | 'google'
  llmApiKey?: string;     // Alias for apiKey
  llmModel?: string;      // Alias for model (provider-specific override)
}

export interface LLMExtractionResult {
  items: Array<Record<string, any>>;  // Extracted items
  tokensUsed: { input: number; output: number };
  model: string;
  cost?: number;          // Estimated cost in USD
  provider?: LLMProvider; // Which provider was used
}

// Cost per 1M tokens (input, output) for known models
const MODEL_COSTS: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.60],
  'gpt-4o': [2.50, 10.0],
};

const GENERIC_SYSTEM_PROMPT = `You are a data extraction assistant. Extract structured data from the provided web content.
Return a JSON array of objects. Each object represents one item/listing found on the page.
Always include these fields when available: title, price, link, rating, description, image.
If the user provides additional instructions, follow them.
Return ONLY valid JSON — no markdown, no explanation, just the array.`;

const SCHEMA_SYSTEM_PROMPT = `You are a data extraction assistant. Extract structured data from the web content below.
Return a JSON object that EXACTLY matches the provided schema structure.
Fill in the values from the page content. Use null for fields you can't find.
Return ONLY valid JSON matching the schema — no markdown, no explanation.`;

/**
 * Detect if schema is a "full" JSON Schema (has type:"object" and properties).
 */
export function isFullJsonSchema(schema: object): boolean {
  const s = schema as Record<string, any>;
  return s['type'] === 'object' && typeof s['properties'] === 'object';
}

/**
 * Convert a simple example object to a proper JSON Schema.
 *
 * Supports:
 *   - Primitive values: "" → { type: "string" }, 0 → { type: "number" }
 *   - Arrays of objects: [{name:"", price:""}] → { type: "array", items: { type: "object", properties: {...} } }
 *   - Nested objects
 */
export function convertSimpleToJsonSchema(example: object): object {
  return buildSchemaFromValue(example);
}

function buildSchemaFromValue(value: unknown): object {
  if (value === null || value === undefined) {
    return { type: 'string' };
  }

  if (typeof value === 'string') {
    return { type: 'string' };
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: {} };
    }
    // Use the first element as the template for item schema
    const itemSchema = buildSchemaFromValue(value[0]);
    return { type: 'array', items: itemSchema };
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, object> = {};
    for (const [key, val] of Object.entries(obj)) {
      properties[key] = buildSchemaFromValue(val);
    }
    return {
      type: 'object',
      properties,
    };
  }

  return { type: 'string' };
}

/**
 * Build the user message from content + optional instruction + optional schema.
 */
export function buildUserMessage(content: string, instruction?: string, schema?: object): string {
  // Truncate content if over 100K chars
  const truncated = content.length > 100_000 ? content.slice(0, 50_000) : content;

  let msg = `Here is the web content to extract data from:\n\n${truncated}`;

  if (schema) {
    msg += `\n\nExtract data matching this schema: ${JSON.stringify(schema, null, 2)}`;
  }

  if (instruction) {
    msg += `\n\nAdditional instruction: ${instruction}`;
  }

  return msg;
}

/**
 * Calculate estimated cost in USD for a given model and token counts.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | undefined {
  // Normalize model key (strip version suffixes like -2024-11-20 for matching)
  const key = Object.keys(MODEL_COSTS).find(k => model.startsWith(k) || model === k);
  if (!key) return undefined;
  const [inputRate, outputRate] = MODEL_COSTS[key]!;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

/**
 * Parse the LLM response text into an items array.
 * Handles both `{ "items": [...] }` and `[...]` formats.
 * When a schema is provided, also handles single-object responses.
 */
export function parseItems(text: string, _schema?: object): Array<Record<string, any>> {
  const trimmed = text.trim();

  // Try to parse as-is first
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Try to extract JSON from the text (sometimes LLMs add preamble despite instructions)
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (arrayMatch) {
      try { parsed = JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
    } else if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
    if (parsed === undefined) {
      throw new Error(`Failed to parse LLM response as JSON: ${trimmed.slice(0, 200)}`);
    }
  }

  // Handle { items: [...] } or { data: [...] } or { results: [...] }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, any>;
    if (Array.isArray(obj['items'])) return obj['items'];
    if (Array.isArray(obj['data'])) return obj['data'];
    if (Array.isArray(obj['results'])) return obj['results'];
    // Single object — wrap in array
    return [obj];
  }

  // Handle bare array
  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [];
}

/**
 * Validate that a parsed result roughly matches the expected schema shape.
 * Logs a warning if the top-level keys don't match, but returns the result anyway.
 */
function validateSchemaShape(result: Array<Record<string, any>>, schema: object): void {
  if (result.length === 0) return;

  const schemaObj = schema as Record<string, any>;

  // For full JSON Schema: check that the object has the expected top-level properties
  if (isFullJsonSchema(schema)) {
    const expectedKeys = Object.keys(schemaObj['properties'] || {});
    if (expectedKeys.length > 0 && result[0]) {
      const actualKeys = Object.keys(result[0]);
      const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
      if (missingKeys.length > 0) {
        console.warn(`[webpeel] Schema validation warning: response missing expected keys: ${missingKeys.join(', ')}`);
      }
    }
    return;
  }

  // For simple example schema: check top-level keys exist
  const expectedTopLevelKeys = Object.keys(schemaObj);
  if (expectedTopLevelKeys.length > 0 && result[0]) {
    const actualKeys = Object.keys(result[0]);
    const missingKeys = expectedTopLevelKeys.filter(k => !actualKeys.includes(k));
    if (missingKeys.length > 0) {
      console.warn(`[webpeel] Schema validation warning: response missing expected keys: ${missingKeys.join(', ')}`);
    }
  }
}

/**
 * Build the response_format parameter for the OpenAI API call.
 */
function buildResponseFormat(schema?: object): object {
  if (!schema) {
    return { type: 'json_object' };
  }

  // Use structured output only for full JSON Schema (has type:"object" and properties)
  if (isFullJsonSchema(schema)) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'extraction',
        strict: true,
        schema,
      },
    };
  }

  // For simple example schemas, fall back to json_object
  return { type: 'json_object' };
}

// ─── Multi-provider helpers ────────────────────────────────────────────────

/**
 * Strip markdown code block wrappers from LLM output.
 * Handles ```json...``` or ```...``` patterns.
 */
function stripMarkdownCodeBlocks(text: string): string {
  // Match ```json ... ``` or ``` ... ``` (possibly multiline)
  const stripped = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m, '$1').trim();
  return stripped || text.trim();
}

/**
 * Attempt to fix common JSON issues: comments, trailing commas.
 */
function fixJsonString(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, '')           // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')     // multi-line comments
    .replace(/,(\s*[}\]])/g, '$1')        // trailing commas
    .trim();
}

/**
 * Parse a raw LLM response into a JSON value (object or array).
 * Strips markdown code blocks and attempts to fix invalid JSON.
 * Returns the parsed value, or throws with `rawOutput` attached.
 */
function parseJsonSafe(text: string): unknown {
  const cleaned = stripMarkdownCodeBlocks(text);

  // 1. Direct parse
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // 2. Fix comments/trailing commas
  try { return JSON.parse(fixJsonString(cleaned)); } catch { /* continue */ }

  // 3. Extract JSON object or array from surrounding text
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);

  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
    try { return JSON.parse(fixJsonString(objMatch[0])); } catch { /* continue */ }
  }
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* continue */ }
    try { return JSON.parse(fixJsonString(arrMatch[0])); } catch { /* continue */ }
  }

  const err = new Error(`Failed to parse LLM response as JSON: ${text.slice(0, 200)}`);
  (err as any).rawOutput = text;
  throw err;
}

/**
 * Normalize a parsed JSON value into an items array.
 */
function normalizeToItems(parsed: unknown): Array<Record<string, any>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, any>>;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, any>;
    if (Array.isArray(obj['items'])) return obj['items'];
    if (Array.isArray(obj['data'])) return obj['data'];
    if (Array.isArray(obj['results'])) return obj['results'];
    return [obj];
  }
  return [];
}

/**
 * Call the Anthropic Messages API for extraction.
 */
async function callAnthropicExtract(params: {
  content: string;
  schema: object;
  prompt?: string;
  llmApiKey: string;
  llmModel?: string;
}): Promise<{ items: Array<Record<string, any>>; tokens: { input: number; output: number }; model: string }> {
  const { content, schema, prompt, llmApiKey, llmModel } = params;
  const model = llmModel || DEFAULT_PROVIDER_MODELS.anthropic;
  const truncated = content.slice(0, 30_000);

  const userContent =
    `Extract data from this webpage content according to the JSON schema.\n\n` +
    `Schema: ${JSON.stringify(schema)}\n` +
    (prompt ? `Instructions: ${prompt}\n` : '') +
    `\nWebpage content:\n${truncated}\n\n` +
    `Return ONLY valid JSON matching the schema. No explanation.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': llmApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('LLM API authentication failed (401). Check your Anthropic API key.');
    if (response.status === 429) throw new Error('LLM API rate limit exceeded (429). Please wait and retry.');
    throw new Error(`Anthropic API error: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    model?: string;
  };

  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');

  let parsed: unknown;
  try {
    parsed = parseJsonSafe(text);
  } catch (err: any) {
    const e = new Error('llm_parse_error') as any;
    e.rawOutput = text;
    throw e;
  }

  return {
    items: normalizeToItems(parsed),
    tokens: {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
    },
    model: data.model || model,
  };
}

/**
 * Call the Google Gemini API for extraction.
 */
async function callGoogleExtract(params: {
  content: string;
  schema: object;
  prompt?: string;
  llmApiKey: string;
  llmModel?: string;
}): Promise<{ items: Array<Record<string, any>>; tokens: { input: number; output: number }; model: string }> {
  const { content, schema, prompt, llmApiKey, llmModel } = params;
  const model = llmModel || DEFAULT_PROVIDER_MODELS.google;
  const truncated = content.slice(0, 30_000);

  const userText =
    `Extract data from this webpage content according to the JSON schema.\n\n` +
    `Schema: ${JSON.stringify(schema)}\n` +
    (prompt ? `Instructions: ${prompt}\n` : '') +
    `\nWebpage content:\n${truncated}\n\n` +
    `Return ONLY valid JSON matching the schema. No explanation.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmApiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403)
      throw new Error('LLM API authentication failed. Check your Google API key.');
    if (response.status === 429) throw new Error('LLM API rate limit exceeded (429). Please wait and retry.');
    throw new Error(`Google API error: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    modelVersion?: string;
  };

  const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text).join('');

  let parsed: unknown;
  try {
    parsed = parseJsonSafe(text);
  } catch (err: any) {
    const e = new Error('llm_parse_error') as any;
    e.rawOutput = text;
    throw e;
  }

  return {
    items: normalizeToItems(parsed),
    tokens: {
      input: data.usageMetadata?.promptTokenCount ?? 0,
      output: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
    model: data.modelVersion || model,
  };
}

// ─── Main export ───────────────────────────────────────────────────────────

/**
 * Extract structured data from content using an LLM.
 *
 * Supports OpenAI (default), Anthropic, and Google providers.
 * Pass `llmProvider` + `llmApiKey` to select a provider.
 * Falls back to OpenAI-compatible path when no provider is specified.
 */
export async function extractWithLLM(options: LLMExtractionOptions): Promise<LLMExtractionResult> {
  // Resolve aliases: new-style params take precedence over old-style
  const resolvedProvider = (options.llmProvider || 'openai') as LLMProvider;
  const resolvedApiKey = options.llmApiKey || options.apiKey || process.env.OPENAI_API_KEY;
  const resolvedModel = options.llmModel || options.model;
  const resolvedInstruction = options.prompt || options.instruction;

  const {
    content,
    baseUrl = 'https://api.openai.com/v1',
    maxTokens = 4000,
  } = options;

  if (!resolvedApiKey) {
    throw new Error(
      'LLM extraction requires an API key.\n' +
      'Set OPENAI_API_KEY environment variable or provide llmApiKey in the request.'
    );
  }

  // ── Anthropic path ────────────────────────────────────────────────────────
  if (resolvedProvider === 'anthropic') {
    const schema = options.schema || {};
    const result = await callAnthropicExtract({
      content,
      schema,
      prompt: resolvedInstruction,
      llmApiKey: resolvedApiKey,
      llmModel: resolvedModel || DEFAULT_PROVIDER_MODELS.anthropic,
    });

    if (options.schema) {
      validateSchemaShape(result.items, options.schema);
    }

    return {
      items: result.items,
      tokensUsed: result.tokens,
      model: result.model,
      provider: 'anthropic',
    };
  }

  // ── Google path ───────────────────────────────────────────────────────────
  if (resolvedProvider === 'google') {
    const schema = options.schema || {};
    const result = await callGoogleExtract({
      content,
      schema,
      prompt: resolvedInstruction,
      llmApiKey: resolvedApiKey,
      llmModel: resolvedModel || DEFAULT_PROVIDER_MODELS.google,
    });

    if (options.schema) {
      validateSchemaShape(result.items, options.schema);
    }

    return {
      items: result.items,
      tokensUsed: result.tokens,
      model: result.model,
      provider: 'google',
    };
  }

  // ── OpenAI path (default, backward-compatible) ────────────────────────────
  const finalModel = resolvedModel || DEFAULT_PROVIDER_MODELS.openai;

  // Resolve schema: convert simple schemas to full JSON Schema if needed
  let resolvedSchema = options.schema;
  if (resolvedSchema && !isFullJsonSchema(resolvedSchema)) {
    resolvedSchema = convertSimpleToJsonSchema(resolvedSchema);
  }

  // Choose system prompt based on whether a schema is provided
  const systemPrompt = resolvedSchema ? SCHEMA_SYSTEM_PROMPT : GENERIC_SYSTEM_PROMPT;

  const userMessage = buildUserMessage(content, resolvedInstruction, resolvedSchema ?? options.schema);

  const responseFormat = buildResponseFormat(resolvedSchema);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify({
      model: finalModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      max_tokens: maxTokens,
      response_format: responseFormat,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error(`LLM API authentication failed (401). Check your API key.`);
    }
    if (response.status === 429) {
      throw new Error(`LLM API rate limit exceeded (429). Please wait and retry.`);
    }
    throw new Error(`LLM API error: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
    model?: string;
  };

  const rawText = data.choices?.[0]?.message?.content ?? '';
  const items = parseItems(rawText, resolvedSchema);

  // Validate schema shape and warn if mismatch
  if (resolvedSchema) {
    validateSchemaShape(items, resolvedSchema);
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const resolvedFinalModel = data.model ?? finalModel;
  const cost = estimateCost(resolvedFinalModel, inputTokens, outputTokens);

  return {
    items,
    tokensUsed: { input: inputTokens, output: outputTokens },
    model: resolvedFinalModel,
    cost,
    provider: 'openai',
  };
}
