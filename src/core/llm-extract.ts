/**
 * LLM-based extraction: sends markdown/text content to an LLM
 * with instructions to extract structured data.
 *
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local models).
 */

export interface LLMExtractionOptions {
  content: string;        // The markdown/text content to extract from
  instruction?: string;   // User instruction (e.g., "extract hotel names and prices")
  schema?: object;        // Optional JSON schema for structured output
  apiKey?: string;        // API key (or from OPENAI_API_KEY env)
  baseUrl?: string;       // API base URL (default: https://api.openai.com/v1)
  model?: string;         // Model name (default: gpt-4o-mini for cost efficiency)
  maxTokens?: number;     // Max response tokens (default: 4000)
}

export interface LLMExtractionResult {
  items: Array<Record<string, any>>;  // Extracted items
  tokensUsed: { input: number; output: number };
  model: string;
  cost?: number;          // Estimated cost in USD
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

/**
 * Extract structured data from content using an LLM.
 */
export async function extractWithLLM(options: LLMExtractionOptions): Promise<LLMExtractionResult> {
  const {
    content,
    instruction,
    baseUrl = 'https://api.openai.com/v1',
    model = 'gpt-4o-mini',
    maxTokens = 4000,
  } = options;

  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'LLM extraction requires an API key.\n' +
      'Set OPENAI_API_KEY environment variable or use --llm-key <key>'
    );
  }

  // Resolve schema: convert simple schemas to full JSON Schema if needed
  let resolvedSchema = options.schema;
  if (resolvedSchema && !isFullJsonSchema(resolvedSchema)) {
    resolvedSchema = convertSimpleToJsonSchema(resolvedSchema);
  }

  // Choose system prompt based on whether a schema is provided
  const systemPrompt = resolvedSchema ? SCHEMA_SYSTEM_PROMPT : GENERIC_SYSTEM_PROMPT;

  const userMessage = buildUserMessage(content, instruction, resolvedSchema ?? options.schema);

  const responseFormat = buildResponseFormat(resolvedSchema);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
  const resolvedModel = data.model ?? model;
  const cost = estimateCost(resolvedModel, inputTokens, outputTokens);

  return {
    items,
    tokensUsed: { input: inputTokens, output: outputTokens },
    model: resolvedModel,
    cost,
  };
}
