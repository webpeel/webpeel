/**
 * Post-process BM25 quickAnswer passages to extract specific values.
 *
 * BM25 finds relevant passages but can't extract values. This module
 * applies field-type-aware regex extraction to pull the actual value
 * from the passage.
 */

/** Field type patterns for value extraction */
interface FieldExtractor {
  /** Regex patterns to try, in order. First match wins. */
  patterns: RegExp[];
  /** If no pattern matches, apply this transform to clean the raw passage */
  fallback?: (passage: string) => string;
  /** Optional post-processing for pattern match results (e.g. trim over-captured name words) */
  trimMatch?: (matched: string) => string;
}

const FIELD_EXTRACTORS: Record<string, FieldExtractor> = {
  // Price: find currency patterns
  price: {
    patterns: [
      /\$[\d,]+(?:\.\d{2})?/, // $999.99 or $1,299
      /USD\s*[\d,]+(?:\.\d{2})?/, // USD 999.99
      /€[\d,]+(?:\.\d{2})?/, // €999.99
      /£[\d,]+(?:\.\d{2})?/, // £999.99
      /¥[\d,]+/, // ¥9999
      /[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP|JPY)/, // 999.99 USD
      /(?:price|cost|costs?)\s*(?:is|:|\s)\s*\$?[\d,]+(?:\.\d{2})?/i, // "price is $999"
      /(?:starting\s+(?:at|from)|from)\s+\$?[\d,]+(?:\.\d{2})?/i, // "starting at $99"
    ],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 60),
  },

  // Date: find date patterns
  date: {
    patterns: [
      /\d{4}-\d{2}-\d{2}/, // 2023-11-21
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i, // November 21, 2023
      /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i, // 21 November 2023
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i, // Nov 21, 2023
      /\d{1,2}\/\d{1,2}\/\d{2,4}/, // 11/21/2023
      /\d{1,2}\.\d{1,2}\.\d{2,4}/, // 21.11.2023
    ],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 40),
  },

  // Author: find author patterns
  author: {
    patterns: [
      /(?:by|author|written by|posted by)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/i, // "by John Smith"
      /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s+(?:wrote|writes|reports|published)/i, // "John Smith wrote"
    ],
    // Trim captured group to only consecutive title-cased words (i flag makes [A-Z] match lowercase too)
    trimMatch: (s) => {
      const words = s.split(/\s+/);
      const result: string[] = [];
      for (const w of words) {
        if (/^[A-Z]/.test(w)) result.push(w);
        else break;
      }
      return result.join(' ') || s;
    },
    fallback: (p) => {
      // Try to find a capitalized name
      const nameMatch = p.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,2})/);
      return nameMatch?.[1] || p.split(/[.\n]/)[0].trim().slice(0, 50);
    },
  },

  // Title: extract from headings or first meaningful text
  title: {
    patterns: [
      /^#\s+(.+)$/m, // # Heading
      /^##\s+(.+)$/m, // ## Heading
    ],
    fallback: (p) => {
      // Take the first line that's not a date, whitespace, or metadata
      const lines = p.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const clean = line.replace(/^#+\s*/, '').trim();
        // Skip lines that look like dates or metadata
        if (/^\d{4}-\d{2}-\d{2}/.test(clean)) continue;
        if (/^\d+\s*min\s*read/i.test(clean)) continue;
        if (/^(by|author|posted|published|updated)/i.test(clean)) continue;
        if (clean.length > 10) return clean.slice(0, 120);
      }
      return p.split('\n')[0].trim().slice(0, 120);
    },
  },

  // Name (product, event, recipe): similar to title
  name: {
    patterns: [
      /^#\s+(.+)$/m,
      /^##\s+(.+)$/m,
    ],
    fallback: (p) => {
      const lines = p.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const clean = line.replace(/^#+\s*/, '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(clean)) continue;
        if (/^\d+\s*min\s*read/i.test(clean)) continue;
        if (clean.length > 5) return clean.slice(0, 100);
      }
      return p.split('\n')[0].trim().slice(0, 100);
    },
  },

  // Brand: extract proper nouns / company names
  brand: {
    patterns: [
      /(?:brand|manufacturer|made by|by)\s*:?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/i,
    ],
    // Trim to consecutive title-cased words only
    trimMatch: (s) => {
      const words = s.split(/\s+/);
      const result: string[] = [];
      for (const w of words) {
        if (/^[A-Z]/.test(w)) result.push(w);
        else break;
      }
      return result.join(' ') || s;
    },
    fallback: (p) => {
      // Find the first capitalized word that looks like a brand
      const brandMatch = p.match(/([A-Z][a-zA-Z]{2,})/);
      return brandMatch?.[1] || p.split(/[.\n]/)[0].trim().slice(0, 40);
    },
  },

  // Rating: extract numeric ratings
  rating: {
    patterns: [
      /(\d+(?:\.\d+)?)\s*(?:\/\s*\d+|out of \d+|stars?)/i, // 4.5/5, 4.5 out of 5, 4.5 stars
      /(?:rating|rated|score)\s*:?\s*(\d+(?:\.\d+)?)/i, // rating: 4.5
      /(\d+(?:\.\d+)?)\s*%/, // 95%
    ],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 50),
  },

  // Email
  email: {
    patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 80),
  },

  // Phone
  phone: {
    patterns: [
      /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, // +1 (555) 123-4567
      /(?:\+\d{1,3}[-.\s]?)?[\d\s-]{7,15}/, // International
    ],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 40),
  },

  // URL / image / website
  url: {
    patterns: [/https?:\/\/[^\s"'<>]+/],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 120),
  },
  image: {
    patterns: [
      /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|avif)[^\s"'<>]*/i,
      /https?:\/\/[^\s"'<>]+/,
    ],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 120),
  },
  website: {
    patterns: [/https?:\/\/[^\s"'<>]+/],
    fallback: (p) => p.split(/[.\n]/)[0].trim().slice(0, 120),
  },
};

// Default extractor: take first sentence
const DEFAULT_EXTRACTOR: FieldExtractor = {
  patterns: [],
  fallback: (p) => {
    // Split into sentences, return the most relevant one (first non-trivial)
    const sentences = p.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
    return sentences[0]?.trim().slice(0, 150) || p.trim().slice(0, 150);
  },
};

/**
 * Post-process a BM25 passage to extract the actual value for a given field name.
 */
export function extractValueFromPassage(passage: string, fieldName: string): string {
  if (!passage || !passage.trim()) return '';

  const normalizedField = fieldName.toLowerCase().trim();
  const extractor = FIELD_EXTRACTORS[normalizedField] || DEFAULT_EXTRACTOR;

  // Try each pattern
  for (const pattern of extractor.patterns) {
    const match = passage.match(pattern);
    if (match) {
      // If there's a capture group, use it; otherwise use the full match
      const raw = (match[1] || match[0]).trim();
      return extractor.trimMatch ? extractor.trimMatch(raw) : raw;
    }
  }

  // No pattern matched — use fallback
  if (extractor.fallback) {
    return extractor.fallback(passage);
  }

  // Last resort
  return passage.split(/[.\n]/)[0].trim().slice(0, 100);
}

/**
 * Smart schema extraction that uses structural signals before falling back to BM25.
 *
 * For title/name: uses the page title or first heading
 * For author: scans first 1000 chars for "by X" patterns
 * For date: scans first 1000 chars for date patterns
 * For price/email/phone/url: regex scan of full content
 * For everything else: BM25 quickAnswer + post-processing
 */
export function smartExtractSchemaFields(
  content: string,
  templateFields: Record<string, string>,
  quickAnswerFn: (opts: { content: string; question: string; url?: string }) => { answer: string; confidence: number },
  options?: {
    pageTitle?: string;
    pageUrl?: string;
    metadata?: Record<string, any>;
  },
): Record<string, string> {
  const { pageTitle, pageUrl, metadata } = options || {};
  const extracted: Record<string, string> = {};
  const topContent = content.slice(0, 1500); // First 1500 chars for structural extraction

  for (const [field, question] of Object.entries(templateFields)) {
    const normalizedField = field.toLowerCase().trim();
    let value = '';

    // === STRUCTURAL EXTRACTION (try first) ===

    if (normalizedField === 'title' || normalizedField === 'name') {
      // 1. Use page title if available
      if (pageTitle && pageTitle.length > 3) {
        value = pageTitle.replace(/\s*[-|–—]\s*.+$/, '').trim(); // Strip " - Site Name" suffix
      }
      // 2. Try first heading in content
      if (!value) {
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) value = headingMatch[1].trim();
      }
      // 3. Try ## heading
      if (!value) {
        const h2Match = content.match(/^##\s+(.+)$/m);
        if (h2Match) value = h2Match[1].trim();
      }
    } else if (normalizedField === 'author') {
      // Scan top of page for author patterns
      const authorPatterns = [
        /(?:^|\n)\s*(?:by|author|written by|posted by)[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})/im,
        /(?:^|\n)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,2})\s*[|·•]\s*(?:\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/im,
      ];
      for (const pat of authorPatterns) {
        const match = topContent.match(pat);
        if (match?.[1]) {
          // Trim to only capitalized words
          const words = match[1].split(/\s+/);
          const nameWords: string[] = [];
          for (const w of words) {
            if (/^[A-Z]/.test(w)) nameWords.push(w);
            else break;
          }
          if (nameWords.length >= 1) {
            value = nameWords.join(' ');
            break;
          }
        }
      }
      // Also check metadata
      if (!value && metadata?.author) {
        value = String(metadata.author);
      }
    } else if (normalizedField === 'date') {
      // Scan top of page for date patterns
      const datePatterns = [
        /\d{4}-\d{2}-\d{2}/,
        /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
        /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i,
      ];
      for (const pat of datePatterns) {
        const match = topContent.match(pat);
        if (match) {
          value = match[0].trim();
          break;
        }
      }
      // Also check metadata
      if (!value && metadata?.date) {
        value = String(metadata.date);
      }
      if (!value && metadata?.publishedTime) {
        value = String(metadata.publishedTime).split('T')[0];
      }
    } else if (normalizedField === 'price') {
      // Scan full content for currency patterns
      const pricePatterns = [
        /\$[\d,]+(?:\.\d{2})?/,
        /€[\d,]+(?:\.\d{2})?/,
        /£[\d,]+(?:\.\d{2})?/,
        /(?:price|cost|starting at|from)\s*:?\s*\$[\d,]+(?:\.\d{2})?/i,
      ];
      for (const pat of pricePatterns) {
        const match = content.match(pat);
        if (match) {
          // Extract just the currency amount from the match
          const currMatch = match[0].match(/[$€£¥][\d,]+(?:\.\d{2})?/);
          value = currMatch ? currMatch[0] : match[0];
          break;
        }
      }
    } else if (normalizedField === 'email') {
      const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) value = emailMatch[0];
    } else if (normalizedField === 'phone') {
      const phoneMatch = content.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) value = phoneMatch[0];
    } else if (normalizedField === 'url' || normalizedField === 'website' || normalizedField === 'image') {
      if (normalizedField === 'image') {
        const imgMatch = content.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|avif)[^\s"'<>]*/i);
        if (imgMatch) value = imgMatch[0];
      }
      if (!value) {
        const urlMatch = content.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) value = urlMatch[0];
      }
    } else if (normalizedField === 'rating') {
      const ratingPatterns = [
        /(\d+(?:\.\d+)?)\s*(?:\/\s*\d+|out of \d+|stars?)/i,
        /(?:rating|rated|score)\s*:?\s*(\d+(?:\.\d+)?)/i,
      ];
      for (const pat of ratingPatterns) {
        const match = content.match(pat);
        if (match) {
          value = match[1] || match[0];
          break;
        }
      }
    } else if (normalizedField === 'brand') {
      // 1. Look for "by Brand" or "developed by Brand" etc. in content (highest priority)
      const brandByPatterns = [
        /(?:by|from|developed by|manufactured by|made by|produced by|created by)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]*)?)/,
      ];
      for (const pat of brandByPatterns) {
        const match = topContent.match(pat);
        if (match?.[1]) {
          // Trim to just the brand name (first 1-2 capitalized words)
          const words = match[1].split(/\s+/);
          const brandWords: string[] = [];
          for (const w of words) {
            if (/^[A-Z]/.test(w) && !/^(The|This|That|And|For|With|From)$/.test(w)) brandWords.push(w);
            else break;
          }
          if (brandWords.length >= 1) {
            value = brandWords.join(' ');
            break;
          }
        }
      }
      // 2. Check metadata
      if (!value && metadata?.brand) {
        value = String(metadata.brand);
      }
      // 3. Fallback: first word of page title (lower priority than content patterns)
      if (!value && pageTitle) {
        const brandMatch = pageTitle.match(/^([A-Z][a-zA-Z]+)/);
        if (brandMatch) value = brandMatch[1];
      }
      // BM25 fallback will handle the rest
    } else if (normalizedField === 'source') {
      // 1. Try title suffix first "Article Title - Site Name" or "Article Title | Site Name"
      //    (more human-readable, more specific than domain)
      if (pageTitle) {
        const suffixMatch = pageTitle.match(/\s*[-|–—]\s*(.+)$/);
        if (suffixMatch?.[1] && suffixMatch[1].length < 40) {
          value = suffixMatch[1].trim();
        }
      }
      // 2. Extract from URL domain
      if (!value && pageUrl) {
        try {
          const parsed = new URL(pageUrl);
          const host = parsed.hostname.replace(/^www\./, '');
          const parts = host.split('.');
          const siteName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          // Handle subdomains like blog.cloudflare.com
          const subdomain = parts[0];
          if (subdomain && !['www', 'en', 'm', 'mobile', 'api', 'app'].includes(subdomain) && subdomain !== siteName) {
            value = `${subdomain.charAt(0).toUpperCase() + subdomain.slice(1)} ${siteName.charAt(0).toUpperCase() + siteName.slice(1)}`;
          } else {
            value = siteName.charAt(0).toUpperCase() + siteName.slice(1);
          }
        } catch {
          // ignore malformed URLs
        }
      }
    } else if (normalizedField === 'summary' || normalizedField === 'description') {
      // Find the first substantive paragraph (skip headings, dates, metadata)
      const lines = content.split('\n');
      const summaryParts: string[] = [];
      let charCount = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) continue;  // skip headings
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) continue;  // skip dates
        if (/^\d+\s*min\s*read/i.test(trimmed)) continue;  // skip "5 min read"
        if (/^(by|author|posted|published|updated|written)/i.test(trimmed)) continue;
        if (/^\*[^*]+\*$/.test(trimmed)) continue;  // skip italic-only lines
        if (trimmed.length > 30) {  // substantive line
          summaryParts.push(trimmed);
          charCount += trimmed.length;
          if (charCount > 300) break;  // ~2-3 sentences
        }
      }
      if (summaryParts.length > 0) {
        value = summaryParts.join(' ').slice(0, 400);
      }
    } else if (normalizedField === 'body') {
      // Body IS the content — return it directly (truncated for JSON output)
      value = content.slice(0, 2000);
    } else if (normalizedField === 'tags') {
      // Extract topic keywords from headings (skip the first one which is the title)
      const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
      const topics: string[] = [];
      for (const h of headings.slice(1, 6)) {  // skip title, take up to 5
        const clean = h.replace(/^#+\s*/, '').replace(/[*\[\](){}]/g, '').trim();
        if (clean.length > 3 && clean.length < 60) {
          topics.push(clean);
        }
      }
      if (topics.length >= 2) {
        value = topics.join(', ');
      }
      // If fewer than 2 headings, fall back to BM25
    }

    // === BM25 FALLBACK (only for fields without structural signal) ===
    if (!value) {
      try {
        const qa = quickAnswerFn({
          content,
          question: typeof question === 'string' ? question : field,
          url: pageUrl || '',
        });
        value = qa.answer ? extractValueFromPassage(qa.answer, field) : '';
      } catch {
        value = '';
      }
    }

    extracted[field] = value;
  }

  return extracted;
}
