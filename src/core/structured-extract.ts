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
/** Extract first H1 or page title from markdown content */
function extractPageTitle(content: string): string | null {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].replace(/[*_`]/g, '').trim();
  return null;
}

/** Extract meta description (after *X min read* pattern common in WebPeel output) */
function extractDescription(content: string): string | null {
  // First paragraph after the title
  const lines = content.split('\n').filter(l => l.trim());
  let seenH1 = false;
  for (const line of lines) {
    if (line.startsWith('#')) { seenH1 = true; continue; }
    if (line.startsWith('*') && line.endsWith('*')) continue; // byline
    if (seenH1 && line.length > 30) return line.replace(/[*_`]/g, '').trim().slice(0, 300);
  }
  return null;
}

/** Extract company/brand name from title (before " — ", " - ", " | ", " · ") */
function extractCompanyFromTitle(title: string): string | null {
  const sep = title.match(/^([^|·\-—]+)[|·\-—]/);
  if (sep?.[1]) return sep[1].trim();
  return title.trim().slice(0, 60);
}

/** Smart field-name-aware string extractor */
function heuristicExtractString(fieldName: string, content: string, pageUrl?: string): string | null {
  const lf = fieldName.toLowerCase();
  const humanName = fieldName.replace(/_/g, ' ');
  const title = extractPageTitle(content);

  // --- Concept-aware extraction ---

  // Company/brand/organization name
  if (/company|brand|organization|org_name/.test(lf)) {
    if (title) return extractCompanyFromTitle(title);
    // Fallback: extract from first heading of any level
    const anyHeading = content.match(/^#{1,3}\s+(.+)$/m);
    if (anyHeading?.[1]) return anyHeading[1].replace(/[*_`[\]]/g, '').trim().slice(0, 60);
  }

  // Title/name/product → first H1 or any heading, stripped of markdown
  if (/^(title|name|product_name|product|heading)$/.test(lf)) {
    const rawTitle = title ?? content.match(/^#{1,3}\s+(.+)$/m)?.[1];
    if (rawTitle) {
      // Strip markdown links [text](url) → text, badges ![...](url) → '', etc.
      return rawTitle
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // remove images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // [text](url) → text
        .replace(/\(https?:\/\/[^)]+\)/g, '')  // remove bare URLs in parens
        .replace(/[*_`[\]]/g, '')
        .replace(/&[a-z]+;/g, '')  // HTML entities
        // Strip leading emoji (📦🎬🎵🎮 etc.) that domain extractors add as decoration
        .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim().slice(0, 150);
    }
  }

  // Description/summary/about → first paragraph
  if (/description|summary|about|overview/.test(lf)) {
    return extractDescription(content) ?? null;
  }

  // URL/website/link → use the URL if we have it
  if (/^(url|website|link|homepage|site)$/.test(lf)) {
    if (pageUrl) return pageUrl;
  }

  // Director (for movies/films)
  if (/director/.test(lf)) {
    const m = content.match(/Director[:\s*]+([^\n|,]+)/i) ?? content.match(/Directed by[:\s]+([^\n|,]+)/i);
    if (m?.[1]) return m[1].replace(/[*_`]/g, '').trim().slice(0, 100);
  }

  // Author/writer/by
  if (/author|writer|by/.test(lf)) {
    const m = content.match(/\*By\s+([^·\n*]+)/i) ?? content.match(/Author[:\s]+([^\n,]+)/i);
    if (m?.[1]) return m[1].trim().slice(0, 100);
  }

  // Date/published/updated
  if (/date|published|updated|modified/.test(lf)) {
    const m = content.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b)/i)
      ?? content.match(/(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
  }

  // Email
  if (/email|contact/.test(lf)) {
    const m = content.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    if (m?.[0]) return m[0];
  }

  // Price/cost/pricing → extract value near $
  if (/price|cost|pricing|fee/.test(lf)) {
    const m = content.match(/\$\s*[\d,]+(?:\.\d{2})?(?:\s*\/\s*\w+)?/)
      ?? content.match(/(free|no cost|no charge)/i);
    if (m?.[0]) return m[0].trim();
  }

  // Language (for GitHub repos)
  if (/language|lang|tech/.test(lf)) {
    const m = content.match(/💻\s*(\w[\w#+.-]+)/) ?? content.match(/Language[:\s]+(\w[\w#+.-]+)/i);
    if (m?.[1]) return m[1];
  }

  // Stars (for GitHub)
  if (/stars?/.test(lf)) {
    const m = content.match(/⭐\s*([\d,]+)\s*stars?/i) ?? content.match(/([\d,]+)\s*stars?/i);
    if (m?.[1]) return m[1].replace(/,/g, '');
  }

  // License
  if (/license/.test(lf)) {
    const m = content.match(/📜\s*(\w+)/) ?? content.match(/License[:\s]+(MIT|Apache|GPL|BSD|ISC|AGPL|MPL)[^\s]*/i);
    if (m?.[1]) return m[1];
  }

  // --- Generic patterns (exact-ish match) ---
  const patterns = [
    new RegExp(`(?:^|\\n)[ \\t]*${humanName}[:\\s]+([^\\n]{5,200})`, 'i'),
    new RegExp(`"${fieldName}"\\s*:\\s*"([^"]{1,300})"`, 'i'),
    new RegExp(`\\*{1,2}${humanName}\\*{0,2}[:\\s]+([^\\n]{5,200})`, 'i'),
    new RegExp(`#+\\s*${humanName}\\s*\\n+([^\\n]{5,300})`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[|*_`]/g, '').slice(0, 300);
  }

  return null;
}

/**
 * For boolean fields: search the ENTIRE content for positive/negative indicators.
 */
function heuristicExtractBoolean(fieldName: string, content: string): boolean | null {
  const lf = fieldName.toLowerCase();
  const ctx = content.toLowerCase();

  // Concept-aware boolean extraction — search entire content, not just near field name

  // Free tier / free plan
  if (/free_tier|has_free|is_free/.test(lf)) {
    if (/free tier|free plan|\$0|no cost|no charge|free forever/.test(ctx)) return true;
    if (/no free|paid only|subscription required/.test(ctx)) return false;
  }

  // Open source
  if (/open_source|is_open|oss/.test(lf)) {
    if (/open[- ]source|mit license|apache license|gpl|bsd license|📜\s*mit|📜\s*apache/.test(ctx)) return true;
    if (/closed[- ]source|proprietary|commercial license/.test(ctx)) return false;
  }

  // API availability
  if (/has_api|api_available|has_rest/.test(lf)) {
    if (/rest api|graphql api|api endpoint|api key|\/v1\/|\/api\//.test(ctx)) return true;
  }

  // Authentication
  if (/requires_auth|has_auth|is_authenticated/.test(lf)) {
    if (/login|sign in|authentication|api key|bearer token/.test(ctx)) return true;
  }

  // General approach: search near field name concept
  const humanName = fieldName.replace(/_/g, ' ').toLowerCase();
  let fieldIdx = ctx.indexOf(fieldName.toLowerCase());
  if (fieldIdx === -1) fieldIdx = ctx.indexOf(humanName);

  if (fieldIdx !== -1) {
    const window = ctx.slice(Math.max(0, fieldIdx - 80), fieldIdx + 200);
    const positive = ['yes', 'true', 'open source', 'open-source', 'available', 'enabled', 'supported', 'free', 'included'];
    const negative = ['no', 'false', 'closed', 'proprietary', 'unavailable', 'disabled', 'not supported', 'excluded'];
    for (const pos of positive) { if (window.includes(pos)) return true; }
    for (const neg of negative) { if (window.includes(neg)) return false; }
  }

  return null;
}

/**
 * For number fields: find digits near the field name.
 */
function heuristicExtractNumber(fieldName: string, content: string): number | null {
  const lf = fieldName.toLowerCase();

  // Stars (GitHub)
  if (/stars?/.test(lf)) {
    const m = content.match(/⭐\s*([\d,]+)/) ?? content.match(/([\d,]+)\s*stars?/i);
    if (m?.[1]) { const n = parseFloat(m[1].replace(/,/g, '')); return isNaN(n) ? null : n; }
  }

  // Forks
  if (/forks?/.test(lf)) {
    const m = content.match(/🍴\s*([\d,]+)/) ?? content.match(/([\d,]+)\s*forks?/i);
    if (m?.[1]) { const n = parseFloat(m[1].replace(/,/g, '')); return isNaN(n) ? null : n; }
  }

  // Rating/score
  if (/rating|score/.test(lf)) {
    const m = content.match(/⭐\s*([\d.]+)\//) ?? content.match(/([\d.]+)\s*\/\s*10/) ?? content.match(/([\d.]+)\s*\/\s*5/);
    if (m?.[1]) { const n = parseFloat(m[1]); return isNaN(n) ? null : n; }
  }

  // Year
  if (/year/.test(lf)) {
    // Match 4-digit years (1900-2099), prefer explicit "Year: YYYY" pattern first
    const explicit = content.match(/\bYear[:\s]+(\d{4})\b/i);
    if (explicit?.[1]) { const n = parseInt(explicit[1]); return isNaN(n) ? null : n; }
    const m = content.match(/\b((?:19|20)\d{2})\b/);
    if (m?.[1]) { const n = parseInt(m[1]); return isNaN(n) ? null : n; }
  }

  // Generic: find number near field name
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

  // Confidence based on fill rate:
  // - ALL fields null → 0.1 (extraction found nothing useful)
  // - Some fields null → 0.3-0.5 based on fill ratio
  // - ALL fields populated → 0.6-0.7 (heuristic max — values may still be imprecise)
  const fillRate = totalFields > 0 ? fieldsFound / totalFields : 0;
  let confidence: number;
  if (fieldsFound === 0) {
    confidence = 0.1; // All null — heuristic found nothing
  } else if (fieldsFound === totalFields) {
    confidence = 0.65 + fillRate * 0.05; // 0.7 for fully populated heuristic
  } else {
    confidence = 0.3 + fillRate * 0.2; // 0.3–0.5 based on fill ratio
  }

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

      // Confidence for LLM extraction:
      // - ALL fields null → 0.1 (LLM couldn't extract anything)
      // - Partial fill → 0.85+ (LLM is generally reliable when it finds data)
      // - All populated → 0.90-0.98 based on fill rate
      const filledCount = Object.values(data).filter((v) => v !== null && v !== undefined).length;
      const totalCount = Object.keys(schema.properties).length;
      const fillRate = totalCount > 0 ? filledCount / totalCount : 0;
      const penalty = missingRequired.length * 0.05;
      let confidence: number;
      if (filledCount === 0) {
        confidence = 0.1; // LLM returned all nulls — extraction failed
      } else {
        const fillBonus = fillRate * 0.08; // Up to +0.08 for fully populated
        confidence = Math.min(0.98, 0.85 + fillBonus - penalty); // 0.85–0.93+ for LLM
      }

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
