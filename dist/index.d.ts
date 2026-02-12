/**
 * WebPeel - Fast web fetcher for AI agents
 *
 * Main library export
 */
import { cleanup } from './core/fetcher.js';
import type { PeelOptions, PeelResult } from './types.js';
export * from './types.js';
/**
 * Fetch and extract content from a URL
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Extracted content and metadata
 *
 * @example
 * ```typescript
 * import { peel } from 'webpeel';
 *
 * const result = await peel('https://example.com');
 * console.log(result.content); // Markdown content
 * console.log(result.metadata); // Structured metadata
 * ```
 */
export declare function peel(url: string, options?: PeelOptions): Promise<PeelResult>;
/**
 * Clean up any browser resources
 * Call this when you're done using WebPeel
 */
export { cleanup };
//# sourceMappingURL=index.d.ts.map