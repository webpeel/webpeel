/**
 * Structured JSON Extraction Engine
 *
 * Extracts structured data from markdown/text content using either:
 *   1. LLM (via callLLM from llm-provider.ts) when an LLM config is provided
 *   2. Heuristic regex/BM25-style extraction as a zero-key fallback
 *
 * Firecrawl-compatible: accepts a JSON schema, returns typed structured data.
 */

import { callLLM, type LLMConfig } from './llm-provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface ExtractionResult {
  data: Record<string, unknown>;
  /** Confidence score 0-1. LLM: 0.85-0.95. Heuristic: 0.3-0.5. */
  confidence: number;
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'Extract the following fields from the content. Return valid JSON matching the schema. Only use information present in the content. If a field is not found in the content, set it to null.';

// ---------------------------------------------------------------------------
// Schema validation / type coercion
// ---------------------------------------------------------------------------

function coerceValue(value: unknown, expectedType: string): unknown {
  if (value === null || value === undefined) return null;

  switch (expectedType) {
    case 'string':
      return typeof value === 'string' ? value : String(value);

    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const str = String(value).toLowerCase().trim();
      if (['true', 'yes', '1', 'open', 'enabled'].includes(str)) return true;
      if (['false', 'no', '0', 'closed', 'disabled'].includes(str)) return false;
      return null;
    }

    case 'number': {
      if (typeof value === 'number') return isNaN(value) ? null : value;
      const num = parseFloat(String(value).replace(/,/g, ''));
      return isNaN(num) ? null : num;
    }

    case 'array':
      return Array.isArray(value) ? value : [value];

    case 'object':
      return typeof value === 'object' ? value : null;

    default:
      return value;
  }
}

function validateAndCoerce(
  raw: Record<string, unknown>,
  schema: ExtractionSchema,
): { data: Record<string, unknown>; missingRequired: string[] } {
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  for (const [field, fieldDef] of Object.entries(schema.properties)) {
    const coerced = coerceValue(raw[field], fieldDef.type);
    data[field] = coerced;

    if ((coerced === null || coerced === undefined) && schema.required?.includes(field)) {
      missingRequired.push(field);
    }
  }

  return { data, missingRequired };
}

// ---------------------------------------------------------------------------
// Parse JSON out of LLM text (handles code fences + raw JSON)
// ---------------------------------------------------------------------------

function parseLLMJson(text: string): Record<string, unknown> {
  const stripped = text.trim();

  // Extract from ```json ... ``` or ``` ... ``` code fences
  const fenceMatch = stripped.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try direct parse
  try {
    return JSON.parse(stripped);
  } catch {
    // Find first {...} in the text
    const objMatch = stripped.match(/\{[\s\S]+\}/);
    if (objMatch) {
      return JSON.parse(objMatch[0]);
    }
    throw new Error(`Could not parse JSON from LLM response: ${stripped.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Heuristic extraction helpers (no LLM key needed)
// ---------------------------------------------------------------------------

/**
 * For string fields: search for field name in content, extract surrounding text.
 */
function heuristicExtractString(fieldName: string, content: string): string | null {
  const humanName = fieldName.replace(/_/g, ' ');

  const patterns = [
    // "field_name: value" or "Field Name: value" patterns
    new RegExp(`(?:^|\\n)[ \\t]*${humanName}[:\\s]+([^\\n]{5,200})`, 'i'),
    // JSON-like "field": "value"
    new RegExp(`"${fieldName}"\\s*:\\s*"([^"]{1,300})"`, 'i'),
    // Markdown bold **Field Name**: value
    new RegExp(`\\*{1,2}${humanName}\\*{0,2}[:\\s]+([^\\n]{5,200})`, 'i'),
    // Heading followed by content
    new RegExp(`#+\\s*${humanName}\\s*\\n+([^\\n]{5,300})`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/[|*_`]/g, '').slice(0, 300);
    }
  }
  return null;
}

/**
 * For boolean fields: search for positive/negative indicators near the field name.
 */
function heuristicExtractBoolean(fieldName: string, content: string): boolean | null {
  const humanName = fieldName.replace(/_/g, ' ').toLowerCase();
  const ctx = content.toLowerCase();

  // Search both underscore and spaced variants
  let fieldIdx = ctx.indexOf(fieldName.toLowerCase());
  if (fieldIdx === -1) fieldIdx = ctx.indexOf(humanName);
  if (fieldIdx === -1) return null;

  // Look at a window of ±150 chars around the field name
  const window = ctx.slice(Math.max(0, fieldIdx - 80), fieldIdx + 200);

  const positive = ['yes', 'true', 'open source', 'open-source', 'available', 'enabled', 'supported', 'free', 'included'];
  const negative = ['no', 'false', 'closed', 'proprietary', 'unavailable', 'disabled', 'not supported', 'excluded'];

  for (const pos of positive) {
    if (window.includes(pos)) return true;
  }
  for (const neg of negative) {
    if (window.includes(neg)) return false;
  }
  return null;
}

/**
 * For number fields: find digits near the field name.
 */
function heuristicExtractNumber(fieldName: string, content: string): number | null {
  const humanName = fieldName.replace(/_/g, '[\\s_-]*');
  const pattern = new RegExp(`${humanName}[:\\s$]*([\\d,]+\\.?\\d*)`, 'i');
  const match = content.match(pattern);
  if (match?.[1]) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    return isNaN(num) ? null : num;
  }
  return null;
}

async function heuristicExtract(
  content: string,
  schema: ExtractionSchema,
): Promise<ExtractionResult> {
  const data: Record<string, unknown> = {};
  let fieldsFound = 0;
  const totalFields = Object.keys(schema.properties).length;

  for (const [field, fieldDef] of Object.entries(schema.properties)) {
    const type = fieldDef.type;
    let value: unknown = null;

    if (type === 'string') {
      value = heuristicExtractString(field, content);
    } else if (type === 'boolean') {
      value = heuristicExtractBoolean(field, content);
    } else if (type === 'number') {
      value = heuristicExtractNumber(field, content);
    }
    // For array/object types, heuristic returns null (not enough context)

    if (value !== null && value !== undefined) fieldsFound++;
    data[field] = value;
  }

  // Confidence: 0.3 base, up to 0.5 based on fill rate
  const fillRate = totalFields > 0 ? fieldsFound / totalFields : 0;
  const confidence = 0.3 + fillRate * 0.2;

  return {
    data,
    confidence: parseFloat(confidence.toFixed(2)),
    tokensUsed: 0,
  };
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract structured data from markdown content using an LLM or heuristics.
 *
 * @param content   Markdown/text content to extract from
 * @param schema    JSON schema describing what to extract
 * @param llmConfig Optional LLM config (if omitted, uses heuristic fallback)
 * @param prompt    Optional user guidance added to the LLM prompt
 */
export async function extractStructured(
  content: string,
  schema: ExtractionSchema,
  llmConfig?: LLMConfig,
  prompt?: string,
): Promise<ExtractionResult> {
  // Guard: empty content
  if (!content || content.trim().length === 0) {
    return { data: {}, confidence: 0, tokensUsed: 0 };
  }

  // Guard: invalid schema
  if (!schema || schema.type !== 'object' || typeof schema.properties !== 'object') {
    throw new Error('Invalid schema: must be { type: "object", properties: { ... } }');
  }

  // ── LLM extraction ──────────────────────────────────────────────────────

  if (llmConfig) {
    const schemaStr = JSON.stringify(schema, null, 2);

    const userContent = [
      `Schema:\n${schemaStr}`,
      prompt ? `\nInstructions: ${prompt}` : '',
      `\nContent:\n${content.slice(0, 12000)}`,
    ]
      .filter(Boolean)
      .join('');

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: userContent },
    ];

    try {
      const llmResult = await callLLM(llmConfig, { messages, maxTokens: 2048, temperature: 0.1 });
      const tokensUsed = llmResult.usage.input + llmResult.usage.output;

      let parsed: Record<string, unknown>;
      try {
        parsed = parseLLMJson(llmResult.text);
      } catch {
        // Malformed LLM response — fall back to heuristic
        const heuristic = await heuristicExtract(content, schema);
        return heuristic;
      }

      const { data, missingRequired } = validateAndCoerce(parsed, schema);

      // Confidence: 0.9 base, penalised for missing required fields
      const penalty = missingRequired.length * 0.05;
      const filledCount = Object.values(data).filter((v) => v !== null && v !== undefined).length;
      const totalCount = Object.keys(schema.properties).length;
      const fillBonus = totalCount > 0 ? (filledCount / totalCount) * 0.05 : 0;
      const confidence = Math.max(0.5, Math.min(0.98, 0.9 + fillBonus - penalty));

      return {
        data,
        confidence: parseFloat(confidence.toFixed(2)),
        tokensUsed,
      };
    } catch (err) {
      // Re-throw auth/rate-limit/quota errors; fall back on parse/network errors
      const msg = String(err instanceof Error ? err.message : err);
      if (
        msg.includes('free_tier_limit') ||
        msg.includes('API key') ||
        msg.includes('Unauthorized') ||
        msg.includes('401') ||
        msg.includes('403')
      ) {
        throw err;
      }
      // Network / parse failure → heuristic fallback
      return heuristicExtract(content, schema);
    }
  }

  // ── Heuristic extraction ─────────────────────────────────────────────────

  return heuristicExtract(content, schema);
}

// ---------------------------------------------------------------------------
// Helper: convert simple { field: "type" } map → ExtractionSchema
// ---------------------------------------------------------------------------

/**
 * Convert a shorthand schema `{ field: "string", active: "boolean" }` to a
 * full ExtractionSchema.  Useful for CLI --extract flag.
 */
export function simpleToExtractionSchema(
  simple: Record<string, string>,
): ExtractionSchema {
  const properties: Record<string, { type: string }> = {};
  for (const [field, type] of Object.entries(simple)) {
    properties[field] = { type };
  }
  return { type: 'object', properties };
}

/**
 * Check if a JSON object looks like a simple type-schema
 * (`{ field: "string" | "boolean" | "number" }`) rather than CSS selectors.
 */
export function isTypeSchema(obj: Record<string, unknown>): boolean {
  const typeNames = new Set(['string', 'boolean', 'number', 'array', 'object', 'integer']);
  const values = Object.values(obj);
  return values.length > 0 && values.every((v) => typeof v === 'string' && typeNames.has(v));
}
