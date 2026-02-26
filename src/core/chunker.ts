/**
 * Content chunker for RAG pipelines.
 * Splits markdown content into overlapping chunks with rich metadata.
 */

export interface ChunkOptions {
  /** Max tokens per chunk (approximate, using ~4 chars/token) */
  maxTokens?: number;
  /** Overlap tokens between chunks */
  overlap?: number;
  /** Chunking strategy */
  strategy?: 'section' | 'paragraph' | 'fixed';
}

export interface ContentChunk {
  /** Chunk index (0-based) */
  index: number;
  /** The chunk text content */
  text: string;
  /** Approximate token count (~4 chars per token) */
  tokenCount: number;
  /** Word count */
  wordCount: number;
  /** Section heading this chunk belongs to (if any) */
  section: string | null;
  /** Section depth (1=h1, 2=h2, etc.) */
  sectionDepth: number | null;
  /** Character offset in original content */
  startOffset: number;
  /** Character end offset */
  endOffset: number;
}

export interface ChunkResult {
  /** Array of content chunks */
  chunks: ContentChunk[];
  /** Total chunks */
  totalChunks: number;
  /** Original content length (chars) */
  originalLength: number;
  /** Chunking strategy used */
  strategy: string;
  /** Options used */
  options: Required<ChunkOptions>;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP = 50;
const CHARS_PER_TOKEN = 4; // rough approximation

/**
 * Split content into RAG-ready chunks with metadata.
 */
export function chunkContent(content: string, options: ChunkOptions = {}): ChunkResult {
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const overlap = options.overlap || DEFAULT_OVERLAP;
  const strategy = options.strategy || 'section';

  const opts: Required<ChunkOptions> = { maxTokens, overlap, strategy };

  let chunks: ContentChunk[];

  switch (strategy) {
    case 'section':
      chunks = chunkBySection(content, maxTokens, overlap);
      break;
    case 'paragraph':
      chunks = chunkByParagraph(content, maxTokens, overlap);
      break;
    case 'fixed':
      chunks = chunkByFixed(content, maxTokens, overlap);
      break;
    default:
      chunks = chunkBySection(content, maxTokens, overlap);
  }

  return {
    chunks,
    totalChunks: chunks.length,
    originalLength: content.length,
    strategy,
    options: opts,
  };
}

/**
 * Section-based chunking (recommended for RAG).
 * Splits on markdown headings (## / ### etc.), then splits large sections by paragraph.
 * Each chunk includes its section heading for context.
 */
function chunkBySection(content: string, maxTokens: number, overlap: number): ContentChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const chunks: ContentChunk[] = [];

  // Split content into sections by headings
  const sections = splitByHeadings(content);

  let chunkIndex = 0;

  for (const section of sections) {
    const { heading, depth, body, startOffset } = section;

    if (!body.trim()) continue;

    // If section fits in one chunk, use it directly
    if (body.length <= maxChars) {
      const text = heading ? `${heading}\n\n${body.trim()}` : body.trim();
      chunks.push({
        index: chunkIndex++,
        text,
        tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
        wordCount: text.split(/\s+/).filter(Boolean).length,
        section: heading ? heading.replace(/^#+\s*/, '') : null,
        sectionDepth: depth,
        startOffset,
        endOffset: startOffset + body.length,
      });
    } else {
      // Large section — split by paragraphs with overlap
      const paragraphs = body.split(/\n\n+/).filter(p => p.trim());
      let currentText = '';
      let currentStart = startOffset;

      for (const para of paragraphs) {
        const candidate = currentText ? `${currentText}\n\n${para}` : para;

        if (candidate.length > maxChars && currentText) {
          // Emit current chunk
          const text = heading ? `${heading}\n\n${currentText.trim()}` : currentText.trim();
          chunks.push({
            index: chunkIndex++,
            text,
            tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
            wordCount: text.split(/\s+/).filter(Boolean).length,
            section: heading ? heading.replace(/^#+\s*/, '') : null,
            sectionDepth: depth,
            startOffset: currentStart,
            endOffset: currentStart + currentText.length,
          });

          // Start new chunk with overlap from end of previous
          if (overlapChars > 0 && currentText.length > overlapChars) {
            currentText = currentText.slice(-overlapChars) + '\n\n' + para;
          } else {
            currentText = para;
          }
          currentStart = startOffset + body.indexOf(para);
        } else {
          currentText = candidate;
        }
      }

      // Emit remaining
      if (currentText.trim()) {
        const text = heading ? `${heading}\n\n${currentText.trim()}` : currentText.trim();
        chunks.push({
          index: chunkIndex++,
          text,
          tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
          wordCount: text.split(/\s+/).filter(Boolean).length,
          section: heading ? heading.replace(/^#+\s*/, '') : null,
          sectionDepth: depth,
          startOffset: currentStart,
          endOffset: currentStart + currentText.length,
        });
      }
    }
  }

  return chunks;
}

/**
 * Paragraph-based chunking.
 * Groups paragraphs together up to maxTokens, with overlap.
 */
function chunkByParagraph(content: string, maxTokens: number, overlap: number): ContentChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const chunks: ContentChunk[] = [];
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

  let currentText = '';
  let currentStart = 0;
  let chunkIndex = 0;

  // Track current section heading
  let currentHeading: string | null = null;
  let currentDepth: number | null = null;

  for (const para of paragraphs) {
    // Check if paragraph is a heading
    const headingMatch = para.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      currentHeading = headingMatch[2];
      currentDepth = headingMatch[1].length;
    }

    const candidate = currentText ? `${currentText}\n\n${para}` : para;

    if (candidate.length > maxChars && currentText) {
      chunks.push({
        index: chunkIndex++,
        text: currentText.trim(),
        tokenCount: Math.ceil(currentText.length / CHARS_PER_TOKEN),
        wordCount: currentText.split(/\s+/).filter(Boolean).length,
        section: currentHeading,
        sectionDepth: currentDepth,
        startOffset: currentStart,
        endOffset: currentStart + currentText.length,
      });

      if (overlapChars > 0 && currentText.length > overlapChars) {
        currentText = currentText.slice(-overlapChars) + '\n\n' + para;
      } else {
        currentText = para;
      }
      currentStart = content.indexOf(para, currentStart);
    } else {
      currentText = candidate;
    }
  }

  if (currentText.trim()) {
    chunks.push({
      index: chunkIndex++,
      text: currentText.trim(),
      tokenCount: Math.ceil(currentText.length / CHARS_PER_TOKEN),
      wordCount: currentText.split(/\s+/).filter(Boolean).length,
      section: currentHeading,
      sectionDepth: currentDepth,
      startOffset: currentStart,
      endOffset: currentStart + currentText.length,
    });
  }

  return chunks;
}

/**
 * Fixed-size chunking with overlap.
 * Simple character-based splitting for predictable chunk sizes.
 */
function chunkByFixed(content: string, maxTokens: number, overlap: number): ContentChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const step = Math.max(maxChars - overlapChars, 100);
  const chunks: ContentChunk[] = [];

  let chunkIndex = 0;
  for (let i = 0; i < content.length; i += step) {
    const text = content.slice(i, i + maxChars).trim();
    if (!text) continue;

    // Try to find section heading within this chunk
    const headingMatch = text.match(/^(#{1,6})\s+(.+)/m);

    chunks.push({
      index: chunkIndex++,
      text,
      tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
      wordCount: text.split(/\s+/).filter(Boolean).length,
      section: headingMatch ? headingMatch[2] : null,
      sectionDepth: headingMatch ? headingMatch[1].length : null,
      startOffset: i,
      endOffset: Math.min(i + maxChars, content.length),
    });
  }

  return chunks;
}

/** Split content into sections based on markdown headings */
function splitByHeadings(content: string): Array<{ heading: string | null; depth: number | null; body: string; startOffset: number }> {
  const lines = content.split('\n');
  const sections: Array<{ heading: string | null; depth: number | null; body: string; startOffset: number }> = [];

  let currentHeading: string | null = null;
  let currentDepth: number | null = null;
  let currentBody: string[] = [];
  let currentStart = 0;
  let offset = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      // Save previous section
      if (currentBody.length > 0 || currentHeading) {
        sections.push({
          heading: currentHeading,
          depth: currentDepth,
          body: currentBody.join('\n'),
          startOffset: currentStart,
        });
      }

      currentHeading = line;
      currentDepth = headingMatch[1].length;
      currentBody = [];
      currentStart = offset;
    } else {
      currentBody.push(line);
    }

    offset += line.length + 1; // +1 for newline
  }

  // Don't forget last section
  if (currentBody.length > 0 || currentHeading) {
    sections.push({
      heading: currentHeading,
      depth: currentDepth,
      body: currentBody.join('\n'),
      startOffset: currentStart,
    });
  }

  return sections;
}
