/**
 * Structured data extraction using CSS selectors and heuristics
 */
import type { ExtractOptions } from '../types.js';
/**
 * Extract structured data using an LLM (OpenAI-compatible API)
 */
export declare function extractWithLLM(content: string, options: ExtractOptions): Promise<Record<string, any>>;
export declare function extractStructured(html: string, options: ExtractOptions): Record<string, any>;
//# sourceMappingURL=extract.d.ts.map