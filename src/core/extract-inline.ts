/**
 * Inline structured extraction using BYOK LLM
 *
 * After fetching page content, pass it + a JSON schema + optional prompt
 * to an LLM and get back structured JSON matching the schema.
 *
 * Supports OpenAI, Anthropic, and Google (same BYOK pattern as /v1/answer).
 */

export type LLMProvider = 'openai' | 'anthropic' | 'google';

export interface InlineExtractOptions {
  /** JSON Schema describing the desired output structure */
  schema?: Record<string, any>;
  /** Natural language prompt describing what to extract */
  prompt?: string;
  /** LLM provider (required) */
  llmProvider: LLMProvider;
  /** LLM API key — BYOK (required) */
  llmApiKey: string;
  /** LLM model name (optional — uses provider default) */
  llmModel?: string;
}

export interface InlineExtractResult {
  /** Extracted structured data */
  data: Record<string, any>;
  /** Tokens consumed */
  tokensUsed: { input: number; output: number };
}

function defaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'google':
      return 'gemini-1.5-flash';
  }
}

function buildSystemPrompt(schema?: Record<string, any>, prompt?: string): string {
  const parts: string[] = [
    'You are a structured data extraction assistant.',
    'Extract data from the provided web page content and return ONLY valid JSON — no markdown fences, no explanation, no extra text.',
  ];

  if (prompt) {
    parts.push(`\nInstruction: ${prompt}`);
  }

  if (schema) {
    parts.push(`\nReturn a JSON object that conforms to this JSON Schema:\n${JSON.stringify(schema, null, 2)}`);
  }

  parts.push('\nReturn ONLY the JSON object.');

  return parts.join('\n');
}

function truncateContent(content: string, maxChars = 24_000): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n[Content truncated]';
}

function parseJsonResponse(text: string): Record<string, any> {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Strip markdown code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }

    // Try to find the first { ... } block
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(text.slice(braceStart, braceEnd + 1));
      } catch {
        // fall through
      }
    }

    throw new Error(`LLM returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Provider-specific calls (mirrors core/answer.ts patterns)
// ---------------------------------------------------------------------------

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI API error: HTTP ${resp.status}${errText ? ` - ${errText}` : ''}`);
  }

  const json = (await resp.json()) as any;
  return {
    text: String(json?.choices?.[0]?.message?.content || '').trim(),
    usage: {
      input: Number(json?.usage?.prompt_tokens || 0),
      output: Number(json?.usage?.completion_tokens || 0),
    },
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096,
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic API error: HTTP ${resp.status}${errText ? ` - ${errText}` : ''}`);
  }

  const json = (await resp.json()) as any;
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
    .join('')
    .trim();

  return {
    text,
    usage: {
      input: Number(json?.usage?.input_tokens || 0),
      output: Number(json?.usage?.output_tokens || 0),
    },
  };
}

async function callGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userContent}` }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Google API error: HTTP ${resp.status}${errText ? ` - ${errText}` : ''}`);
  }

  const json = (await resp.json()) as any;
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';

  return {
    text: String(text || '').trim(),
    usage: {
      input: Number(json?.usageMetadata?.promptTokenCount || 0),
      output: Number(json?.usageMetadata?.candidatesTokenCount || 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract structured JSON from page content using an LLM (BYOK).
 *
 * @param content - Page content (markdown or text)
 * @param options - Extraction options including schema, prompt, and LLM credentials
 * @returns Extracted structured data + token usage
 */
export async function extractInlineJson(
  content: string,
  options: InlineExtractOptions,
): Promise<InlineExtractResult> {
  const { schema, prompt, llmProvider, llmApiKey, llmModel } = options;

  if (!llmApiKey) {
    throw new Error('Inline extraction requires "llmApiKey" (BYOK)');
  }

  if (!llmProvider) {
    throw new Error('Inline extraction requires "llmProvider" (openai, anthropic, or google)');
  }

  if (!schema && !prompt) {
    throw new Error('Inline extraction requires "schema" or "prompt" (or both)');
  }

  const model = (llmModel || '').trim() || defaultModel(llmProvider);
  const systemPrompt = buildSystemPrompt(schema, prompt);
  const userContent = truncateContent(content);

  let result: { text: string; usage: { input: number; output: number } };

  switch (llmProvider) {
    case 'openai':
      result = await callOpenAI(llmApiKey, model, systemPrompt, userContent);
      break;
    case 'anthropic':
      result = await callAnthropic(llmApiKey, model, systemPrompt, userContent);
      break;
    case 'google':
      result = await callGoogle(llmApiKey, model, systemPrompt, userContent);
      break;
    default:
      throw new Error(`Unsupported llmProvider: ${llmProvider}`);
  }

  const data = parseJsonResponse(result.text);

  return {
    data,
    tokensUsed: result.usage,
  };
}
