/**
 * Domain-aware structured extractors for WebPeel.
 *
 * This file re-exports from individual extractor files for backward compatibility.
 * Each extractor now lives in its own file under src/ee/extractors/.
 */

// Re-exported from individual extractor files for backward compatibility
export {
  getDomainExtractor,
  hasDomainExtractor,
  extractDomainData,
  clearExtractorCache,
  setExtractorRedis,
} from './extractors/index.js';

export type { DomainExtractResult, DomainExtractor } from './extractors/index.js';
