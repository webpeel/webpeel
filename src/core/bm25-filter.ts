/**
 * BM25 Query-Focused Content Filter
 *
 * Filters markdown content by BM25 relevance to a query, keeping only the
 * blocks that are most relevant. This can reduce token usage by 70-90% for
 * focused tasks (e.g., "find hotel prices" should not return navigation menus,
 * footer text, or unrelated article sections).
 *
 * Algorithm: BM25 (Best Matching 25) — Okapi BM25
 *   score(D, Q) = Σ IDF(qi) * tf(qi,D)*(k1+1) / (tf(qi,D) + k1*(1 - b + b*|D|/avgdl))
 */

export interface BM25FilterOptions {
  /** Query to rank content against */
  query: string;
  /** BM25 threshold score. Blocks below this are removed. Default: auto-calculated */
  threshold?: number;
  /** Whether to return scores in output. Default: false */
  includeScores?: boolean;
}

export interface BM25FilterResult {
  /** Filtered content (relevant paragraphs only) */
  content: string;
  /** Number of blocks kept */
  kept: number;
  /** Total number of blocks */
  total: number;
  /** Percentage of content removed */
  reductionPercent: number;
}

// BM25 tuning parameters
const K1 = 1.5; // term frequency saturation
const B = 0.75; // length normalization

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase terms, stripping punctuation.
 * Markdown formatting characters are also stripped.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Strip markdown formatting (bold, italic, code, links, images, headings)
    .replace(/!\[.*?\]\(.*?\)/g, ' ')  // images
    .replace(/\[.*?\]\(.*?\)/g, ' ')   // links
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ') // inline code
    .replace(/[#*_~`>|\\]/g, ' ')      // formatting chars
    .replace(/[^\w\s]/g, ' ')          // remaining punctuation
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Strip markdown formatting from text for scoring purposes.
 * Preserves words but removes symbols.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')    // fenced code blocks
    .replace(/`[^`]+`/g, ' ')           // inline code
    .replace(/!\[.*?\]\(.*?\)/g, ' ')   // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '')        // headings
    .replace(/[*_~`>|\\]/g, ' ')        // formatting
    .replace(/^\s*[-*+]\s+/gm, ' ')     // list bullets
    .replace(/^\s*\d+\.\s+/gm, ' ')     // numbered list
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Block splitting
// ---------------------------------------------------------------------------

interface ContentBlock {
  /** Original markdown text (preserved verbatim in output) */
  raw: string;
  /** Index in the original block list (for order preservation) */
  index: number;
}

/**
 * Split markdown content into logical blocks for scoring:
 * - Code fences (``` ... ```) → single block
 * - Heading + immediately following paragraph → single block
 * - Lists (contiguous lines starting with - / * / + / number.) → single block
 * - Tables → single block
 * - Paragraphs → one block each
 */
export function splitIntoBlocks(content: string): ContentBlock[] {
  // Normalise line endings
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // First, extract fenced code blocks so they aren't broken apart
  // We'll replace them with placeholders, split, then restore.
  const codeBlocks: string[] = [];
  const withPlaceholders = text.replace(/```[\s\S]*?```/g, (match) => {
    const id = codeBlocks.length;
    codeBlocks.push(match);
    return `\x00CODE_BLOCK_${id}\x00`;
  });

  // Split on double newlines
  const rawChunks = withPlaceholders.split(/\n{2,}/);

  // Re-join heading with its following paragraph
  const merged: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i].trim();
    if (!chunk) continue;

    const isHeading = /^#{1,6}\s/.test(chunk);
    const nextChunk = rawChunks[i + 1]?.trim();

    if (isHeading && nextChunk && !/^#{1,6}\s/.test(nextChunk)) {
      // Merge heading + following paragraph
      merged.push(chunk + '\n\n' + nextChunk);
      i++; // skip next
    } else {
      merged.push(chunk);
    }
  }

  // Now merge contiguous list lines that got split
  const regrouped: string[] = [];
  for (const chunk of merged) {
    const lines = chunk.split('\n');
    const isListBlock = lines.every(
      l => l.trim() === '' || /^\s*[-*+]\s/.test(l) || /^\s*\d+\.\s/.test(l) || /^\s*\d+\)\s/.test(l)
    ) && lines.some(l => /^\s*[-*+]\s/.test(l) || /^\s*\d+[.)]\s/.test(l));

    const isTableBlock = lines.some(l => /^\|/.test(l.trim()));

    if (isListBlock || isTableBlock) {
      // Check if previous block was the same type (adjacent lists should merge)
      const prev = regrouped[regrouped.length - 1];
      if (prev) {
        const prevLines = prev.split('\n');
        const prevIsListOrTable = prevLines.some(
          l => /^\s*[-*+]\s/.test(l) || /^\s*\d+[.)]\s/.test(l) || /^\|/.test(l.trim())
        );
        if (prevIsListOrTable && isListBlock === prevIsListOrTable) {
          regrouped[regrouped.length - 1] = prev + '\n' + chunk;
          continue;
        }
      }
    }
    regrouped.push(chunk);
  }

  // Restore code blocks and build final ContentBlock array
  const blocks: ContentBlock[] = [];
  for (let i = 0; i < regrouped.length; i++) {
    let raw = regrouped[i];

    // Restore code block placeholders
    raw = raw.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_m, idx) => codeBlocks[Number(idx)]);

    if (raw.trim()) {
      blocks.push({ raw: raw.trim(), index: i });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// BM25 Scoring
// ---------------------------------------------------------------------------

/**
 * Calculate BM25 scores for all blocks against a query.
 * Returns array of scores in same order as blocks.
 */
export function scoreBM25(blocks: ContentBlock[], queryTerms: string[]): number[] {
  if (blocks.length === 0 || queryTerms.length === 0) {
    return blocks.map(() => 0);
  }

  const N = blocks.length;

  // Tokenize each block (strip markdown for scoring)
  const blockTokens: string[][] = blocks.map(b => tokenize(stripMarkdown(b.raw)));
  const blockLengths = blockTokens.map(t => t.length);
  const avgdl = blockLengths.reduce((s, l) => s + l, 0) / N || 1;

  // Build term frequency maps for each block
  const tfMaps: Map<string, number>[] = blockTokens.map(tokens => {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    return tf;
  });

  // For each query term, compute IDF and score contribution
  const scores = new Array<number>(N).fill(0);

  for (const term of queryTerms) {
    // n(qi) = number of documents containing the term
    let nqi = 0;
    for (const tf of tfMaps) {
      if (tf.has(term)) nqi++;
    }

    // IDF(qi) = log((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
    const idf = Math.log((N - nqi + 0.5) / (nqi + 0.5) + 1);

    for (let d = 0; d < N; d++) {
      const tf = tfMaps[d].get(term) ?? 0;
      if (tf === 0) continue;

      const dl = blockLengths[d];
      // BM25 term score
      const termScore = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / avgdl));
      scores[d] += termScore;
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Relevance scoring (document-level)
// ---------------------------------------------------------------------------

/**
 * Compute a normalized relevance score (0-1) for content against a query.
 * Uses BM25 at the block level and returns the weighted average score,
 * normalized by query term count for comparability across queries.
 *
 * This is more meaningful than `reductionPercent` for ranking search results,
 * because it measures actual term overlap and importance rather than how much
 * content was filtered out.
 */
export function computeRelevanceScore(content: string, query: string): number {
  if (!content || !query || !query.trim()) return 0;

  const blocks = splitIntoBlocks(content);
  if (blocks.length === 0) return 0;

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;

  const scores = scoreBM25(blocks, queryTerms);

  // Compute weighted average score — weight by block length to avoid
  // short blocks (e.g. headers) dominating the score
  const blockTexts = blocks.map(b => stripMarkdown(b.raw));
  const blockLens = blockTexts.map(t => t.length);
  const totalLen = blockLens.reduce((s, l) => s + l, 0) || 1;

  let weightedSum = 0;
  for (let i = 0; i < scores.length; i++) {
    weightedSum += scores[i] * (blockLens[i] / totalLen);
  }

  // Normalize: divide by query term count to make scores comparable
  // across queries with different numbers of terms, then apply sigmoid
  // to squash to [0, 1] range. The constant 8 is tuned so that a
  // well-matching document scores ~0.6-0.9 and a poor match ~0.0-0.2.
  // perTermScore typical range: 0 (no match) to ~0.5+ (strong match)
  const perTermScore = weightedSum / queryTerms.length;
  const normalized = 2 / (1 + Math.exp(-perTermScore * 8)) - 1;

  return Math.max(0, Math.min(1, normalized));
}

// ---------------------------------------------------------------------------
// Main filter function
// ---------------------------------------------------------------------------

/**
 * Filter markdown content by BM25 relevance to a query.
 * Splits content into blocks (paragraphs, headings+body, list items),
 * scores each by BM25, and returns only blocks above threshold.
 */
export function filterByRelevance(content: string, options: BM25FilterOptions): BM25FilterResult {
  const { query, threshold, includeScores = false } = options;

  // Empty query → return full content
  if (!query || !query.trim()) {
    return {
      content,
      kept: 0,
      total: 0,
      reductionPercent: 0,
    };
  }

  const blocks = splitIntoBlocks(content);
  const total = blocks.length;

  if (total === 0) {
    return { content, kept: 0, total: 0, reductionPercent: 0 };
  }

  const queryTerms = tokenize(query);

  if (queryTerms.length === 0) {
    return { content, kept: total, total, reductionPercent: 0 };
  }

  const scores = scoreBM25(blocks, queryTerms);

  // Determine threshold
  let effectiveThreshold: number;
  if (threshold !== undefined) {
    effectiveThreshold = threshold;
  } else {
    const meanScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    effectiveThreshold = meanScore * 0.5;
  }

  // Select blocks above threshold
  let keptIndices = scores
    .map((score, i) => ({ score, i }))
    .filter(({ score }) => score >= effectiveThreshold)
    .map(({ i }) => i);

  // Fallback: never return empty — keep top 3
  if (keptIndices.length === 0) {
    keptIndices = scores
      .map((score, i) => ({ score, i }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ i }) => i)
      .sort((a, b) => a - b); // restore document order
  }

  // Preserve original document order
  keptIndices.sort((a, b) => a - b);

  const keptBlocks = keptIndices.map(i => blocks[i]);
  const kept = keptBlocks.length;

  // Build output content
  let outputParts: string[];
  if (includeScores) {
    outputParts = keptBlocks.map(b => {
      const score = scores[b.index];
      return `<!-- BM25: ${score.toFixed(4)} -->\n${b.raw}`;
    });
  } else {
    outputParts = keptBlocks.map(b => b.raw);
  }

  const filteredContent = outputParts.join('\n\n');

  // Calculate reduction percent based on character count
  const originalLen = content.length;
  const filteredLen = filteredContent.length;
  const reductionPercent = originalLen > 0
    ? Math.round(((originalLen - filteredLen) / originalLen) * 100)
    : 0;

  return {
    content: filteredContent,
    kept,
    total,
    reductionPercent,
  };
}
