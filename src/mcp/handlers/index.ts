/**
 * Handler registry — maps tool names → handler functions.
 * Imported by both the standalone MCP server and the HTTP MCP route.
 * Single source of truth for all 24+ tool implementations.
 */

import type { McpHandler } from './types.js';
import { handleMeta } from './meta.js';
import { handleRead } from './read.js';
import { handleSee } from './see.js';
import { handleFind } from './find.js';
import { handleExtract } from './extract.js';
import { handleMonitor } from './monitor.js';
import { handleAct } from './act.js';
import { handleFetch } from './fetch.js';
import * as legacy from './legacy.js';

// ── Consolidated public tools (the 7 we expose) ────────────────────────────
export const handlers: Map<string, McpHandler> = new Map([
  ['webpeel', handleMeta],
  ['webpeel_read', handleRead],
  ['webpeel_see', handleSee],
  ['webpeel_find', handleFind],
  ['webpeel_extract', handleExtract],
  ['webpeel_monitor', handleMonitor],
  ['webpeel_act', handleAct],
]);

// ── Legacy tool names → route to appropriate handler ───────────────────────
const legacyRoutes: Record<string, McpHandler> = {
  webpeel_fetch: handleFetch,
  webpeel_youtube: legacy.handleYoutube,
  webpeel_screenshot: legacy.handleScreenshot,
  webpeel_search: legacy.handleSearch,
  webpeel_research: legacy.handleResearch,
  webpeel_crawl: legacy.handleCrawl,
  webpeel_map: legacy.handleMap,
  webpeel_batch: legacy.handleBatch,
  webpeel_deep_fetch: legacy.handleDeepFetch,
  webpeel_summarize: legacy.handleSummarize,
  webpeel_answer: legacy.handleAnswer,
  webpeel_quick_answer: legacy.handleQuickAnswer,
  webpeel_brand: legacy.handleBrand,
  webpeel_change_track: legacy.handleChangeTrack,
  webpeel_watch: legacy.handleWatch,
  webpeel_hotels: legacy.handleHotels,
  webpeel_design_analysis: legacy.handleDesignAnalysis,
  webpeel_design_compare: legacy.handleDesignCompare,
  webpeel_auto_extract: legacy.handleAutoExtract,
  webpeel_agent: legacy.handleAgent,
  // backward-compat alias (no webpeel_ prefix)
  agent: legacy.handleAgent,
};

for (const [name, handler] of Object.entries(legacyRoutes)) {
  handlers.set(name, handler);
}

/** Look up a handler by tool name. Returns undefined if unknown. */
export function getHandler(toolName: string): McpHandler | undefined {
  return handlers.get(toolName);
}

/** All registered tool names (public + legacy). */
export function getAllToolNames(): string[] {
  return [...handlers.keys()];
}

// Re-export types for convenience
export type { McpHandler, McpContext, McpToolResult } from './types.js';
export { textResult, errorResult, safeStringify } from './types.js';
