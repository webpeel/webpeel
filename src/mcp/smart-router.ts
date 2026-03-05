/**
 * Smart Router — Natural language intent parser for WebPeel.
 * Rule-based keyword matching. No LLM required.
 */

export interface ParsedIntent {
  intent: 'read' | 'see' | 'find' | 'extract' | 'monitor' | 'act';
  url?: string;
  query?: string;
  params: Record<string, unknown>;
}

// Multi-word phrases must be checked before single-word keywords to avoid false matches
const MULTI_WORD_PATTERNS: Array<{ intent: ParsedIntent['intent']; pattern: RegExp }> = [
  { intent: 'act',     pattern: /\bsign[\s-]up\b/ },
  { intent: 'find',   pattern: /\blook\s+up\b/ },
  { intent: 'extract', pattern: /\bget\s+data\b/ },
  { intent: 'read',   pattern: /\bwhat\s+does\b/ },
];

// Single-word keywords in descending priority order
// act > monitor > extract > see > find > read
const KEYWORD_INTENTS: Array<{ intent: ParsedIntent['intent']; keywords: string[] }> = [
  {
    intent: 'act',
    keywords: ['click', 'fill', 'submit', 'navigate', 'type', 'login', 'interact', 'press', 'select'],
  },
  {
    intent: 'monitor',
    keywords: ['watch', 'monitor', 'track', 'alert', 'notify', 'change', 'diff'],
  },
  {
    intent: 'extract',
    keywords: ['extract', 'scrape', 'pull', 'fields', 'schema', 'price', 'structured', 'brand', 'logo', 'colors'],
  },
  {
    intent: 'see',
    keywords: ['screenshot', 'see', 'show', 'look', 'visual', 'image', 'capture', 'design', 'compare'],
  },
  {
    intent: 'find',
    keywords: ['find', 'search', 'google', 'research', 'discover', 'map', 'sitemap'],
  },
  {
    intent: 'read',
    keywords: ['read', 'fetch', 'get', 'content', 'text', 'markdown', 'summarize', 'summary', 'answer', 'question'],
  },
];

// TLD pattern used for domain detection
const KNOWN_TLDS =
  'com|org|net|io|co|dev|ai|app|info|uk|de|fr|jp|cn|us|edu|gov|me|tv|cc|ly|gg|sh|tech|online|site|xyz|store|cloud|api|blog|news';

const DOMAIN_RE = new RegExp(
  `\\b(?:[a-zA-Z0-9-]+\\.)+(?:${KNOWN_TLDS})\\b(?:\\/[^\\s"'<>)]*)?`,
  'i'
);

const DOMAIN_RE_GLOBAL = new RegExp(
  `\\b(?:[a-zA-Z0-9-]+\\.)+(?:${KNOWN_TLDS})\\b(?:\\/[^\\s"'<>)]*)?`,
  'gi'
);

/** Strip trailing punctuation from a URL string. */
function stripTrailing(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

/** Extract the first URL from a task string (http/https or domain-like). */
export function extractUrl(task: string): string | undefined {
  // Prefer explicit http/https URLs
  const httpMatch = task.match(/https?:\/\/[^\s"'<>)]+/);
  if (httpMatch) return stripTrailing(httpMatch[0]);

  // Fall back to domain-like patterns
  const domainMatch = task.match(DOMAIN_RE);
  if (domainMatch) return stripTrailing(`https://${domainMatch[0]}`);

  return undefined;
}

/** Extract all URLs from a task string. */
export function extractAllUrls(task: string): string[] {
  const urls: string[] = [];

  const httpMatches = task.match(/https?:\/\/[^\s"'<>)]+/g);
  if (httpMatches) {
    // If explicit URLs found, don't also add domain-only matches
    return httpMatches.map(stripTrailing);
  }

  let m: RegExpExecArray | null;
  DOMAIN_RE_GLOBAL.lastIndex = 0;
  while ((m = DOMAIN_RE_GLOBAL.exec(task)) !== null) {
    urls.push(stripTrailing(`https://${m[0]}`));
  }
  return urls;
}

/** For find intent: strip the URL and intent verbs, returning the bare query. */
function extractFindQuery(task: string, url?: string): string | undefined {
  let q = task;

  // Remove http/https URL
  if (url?.startsWith('http')) {
    q = q.replace(url, '');
  } else if (url) {
    // Remove the raw domain portion
    const raw = url.replace(/^https?:\/\//, '');
    q = q.replace(new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }

  // Remove domain-like patterns that didn't become the primary URL
  q = q.replace(DOMAIN_RE_GLOBAL, '');

  // Remove intent verbs and stop words
  q = q
    .replace(/\b(find|search\s+(?:for\s+|the\s+)?|google|look\s+up|research|discover|map|sitemap|for)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return q || undefined;
}

/** Extract viewport, format, and other params from natural language. */
function extractParams(task: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const lower = task.toLowerCase();

  if (/\bon\s+mobile\b/.test(lower)) {
    params['viewport'] = { width: 390, height: 844 };
  } else if (/\bon\s+tablet\b/.test(lower)) {
    params['viewport'] = { width: 768, height: 1024 };
  }

  if (/\bfull[\s-]?page\b/.test(lower)) {
    params['fullPage'] = true;
  }

  if (/\bas\s+json\b/.test(lower) || /\bstructured\b/.test(lower)) {
    params['format'] = 'json';
  }

  if (/\bsummar(?:y|ize|izing)\b/.test(lower)) {
    params['summary'] = true;
  }

  return params;
}

/**
 * Strip all URLs from a string so they don't pollute keyword detection.
 * e.g. "https://youtube.com/watch?v=abc" → "" (removes "watch" from the URL)
 */
function stripUrlsForKeywordCheck(task: string): string {
  // Remove http/https URLs first
  let stripped = task.replace(/https?:\/\/[^\s"'<>)]+/gi, ' ');
  // Remove bare domain-like patterns
  stripped = stripped.replace(DOMAIN_RE_GLOBAL, ' ');
  return stripped;
}

/** Detect the primary intent from a task string. */
export function detectIntent(task: string): ParsedIntent['intent'] {
  const lower = task.toLowerCase();
  // Strip URLs so that URL paths (e.g. "/watch") don't trigger wrong intents
  const keywordTarget = stripUrlsForKeywordCheck(lower);

  // Multi-word patterns take priority (checked against URL-stripped version)
  for (const { intent, pattern } of MULTI_WORD_PATTERNS) {
    if (pattern.test(keywordTarget)) return intent;
  }

  // Single-word keywords in priority order
  for (const { intent, keywords } of KEYWORD_INTENTS) {
    if (keywords.some((kw) => keywordTarget.includes(kw))) return intent;
  }

  // Default: bare URL (or no recognized verb) → read
  return 'read';
}

/**
 * Parse a natural language task string into a structured intent.
 *
 * @param task - Plain English description of what you want to do.
 * @returns ParsedIntent with intent, optional url, optional query, and params.
 */
export function parseIntent(task: string): ParsedIntent {
  const intent = detectIntent(task);
  const url = extractUrl(task);
  const params = extractParams(task);

  // Enrich 'see' intent with mode and compare_url
  if (intent === 'see') {
    const lower = task.toLowerCase();
    if (/\bcompare\b/.test(lower)) {
      params['mode'] = 'compare';
      const all = extractAllUrls(task);
      if (all.length >= 2) params['compare_url'] = all[1];
    } else if (/\bdesign\b/.test(lower) || /\bdesign[\s-]?analysis\b/.test(lower)) {
      params['mode'] = 'design';
    }
  }

  // Extract query for find intent
  let query: string | undefined;
  if (intent === 'find') {
    query = extractFindQuery(task, url);
  }

  return { intent, url, query, params };
}
