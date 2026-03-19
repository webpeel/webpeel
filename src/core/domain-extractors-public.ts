/**
 * Public re-exports for domain extraction functions.
 *
 * This module is always available (npm + repo + server).
 * It lazy-loads the full domain-extractors.js (compiled, ships in npm).
 * If compiled JS is missing (bare repo clone), returns null gracefully.
 *
 * TypeScript source for domain-extractors is .gitignore'd (not on GitHub).
 */

import type { DomainExtractResult } from './domain-extractors-basic.js';

// Top-level await: module fully loaded before any exports are called.
// This is safe in ESM (Node 14.8+, all modern bundlers).
let _getDomainExtractor: ((url: string) => any) | null = null;
let _extractDomainData: ((html: string, url: string) => Promise<DomainExtractResult | null>) | null = null;

try {
  const mod = await import('./domain-extractors.js');
  _getDomainExtractor = mod.getDomainExtractor;
  _extractDomainData = mod.extractDomainData;
} catch {
  // Compiled JS not available (bare repo clone) — stubs return null
}

/**
 * Check if a URL has a domain-specific extractor.
 * Returns the extractor function or null.
 */
export function getDomainExtractor(url: string): any {
  return _getDomainExtractor ? _getDomainExtractor(url) : null;
}

/**
 * Run domain-specific extraction on HTML content.
 * Returns structured domain data or null.
 */
export async function extractDomainData(html: string, url: string): Promise<DomainExtractResult | null> {
  return _extractDomainData ? _extractDomainData(html, url) : null;
}
