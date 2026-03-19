/**
 * Basic domain extraction — public/free tier.
 *
 * Handles a few common domains with simple logic.
 * Full 55+ domain extractors are premium/server-only.
 *
 * This module is safe to include in the npm package.
 * The full `domain-extractors.ts` is compiled for the server
 * but wired in only when premium hooks are registered.
 */

import type { DomainExtractResult } from './domain-extractors.js';

/**
 * Basic domain data extractor — free tier stub.
 *
 * Always returns null (delegates all extraction to the normal pipeline).
 * Premium servers override this via the `extractDomainData` strategy hook.
 */
export async function extractDomainDataBasic(
  _html: string,
  _url: string,
): Promise<DomainExtractResult | null> {
  // Basic (free) tier: no domain-specific extraction.
  // The normal fetch + markdown pipeline handles everything.
  // Premium hook provides 55+ domain extractors (Twitter, Reddit, GitHub, HN, etc.)
  return null;
}

/**
 * Basic domain extractor lookup — free tier stub.
 *
 * Always returns null (no domain is recognized in basic mode).
 * Premium servers override this via the `getDomainExtractor` strategy hook.
 */
export function getDomainExtractorBasic(
  _url: string,
): ((html: string, url: string) => Promise<DomainExtractResult | null>) | null {
  return null;
}
