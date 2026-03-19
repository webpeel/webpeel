/**
 * Strategy hooks — plugin interface for premium server-side optimizations.
 *
 * The base `smartFetch()` in strategies.ts provides solid simple→browser→stealth
 * escalation.  Hooks allow the server (or any host) to layer on caching, domain
 * intelligence, and parallel-race strategies *without* shipping that logic in
 * the npm package.
 *
 * Register hooks once at startup via `registerStrategyHooks()`.
 * All hook methods are optional — unset hooks are simply skipped.
 */

import type { FetchResult } from './fetcher.js';
import type { DomainExtractResult } from './domain-extractors.js';

/* ---------- public types ------------------------------------------------- */

export interface StrategyResult extends FetchResult {
  method: 'simple' | 'browser' | 'stealth' | 'cached' | 'cloaked' | 'cycle' | 'peeltls' | 'cf-worker' | 'google-cache';
  /**
   * Set to true when the final response still appears to be a bot-challenge
   * page after all escalation attempts have been exhausted.
   * Consumers should warn the user when this is true.
   */
  challengeDetected?: boolean;
}

export interface DomainRecommendation {
  mode: 'browser' | 'stealth';
}

export interface CacheCheckResult {
  /** Cached response to serve immediately. */
  value: StrategyResult;
  /** When true the caller should trigger a background revalidation. */
  stale: boolean;
}

export interface StrategyHooks {
  /* ---- cache ------------------------------------------------------------ */

  /**
   * Look up `url` in the cache.
   * Return `null` for a cache miss.
   * When `stale` is true the result can be served but should be refreshed.
   */
  checkCache?(url: string): CacheCheckResult | null;

  /**
   * Attempt to mark `url` as "currently revalidating" so that only one
   * background refresh runs at a time.  Return `true` if this call won
   * the race (caller should revalidate), `false` otherwise.
   */
  markRevalidating?(url: string): boolean;

  /**
   * Store a fresh result in the cache.
   */
  setCache?(url: string, result: StrategyResult): void;

  /* ---- domain intelligence ---------------------------------------------- */

  /**
   * Return a recommendation for how to fetch `url` based on historical
   * success/failure data for the domain.  Return `null` to let the default
   * escalation logic decide.
   */
  getDomainRecommendation?(url: string): DomainRecommendation | null;

  /**
   * Record the outcome of a fetch so the intelligence layer can learn.
   */
  recordDomainResult?(
    url: string,
    method: 'simple' | 'browser' | 'stealth',
    latencyMs: number,
  ): void;

  /* ---- race strategy ---------------------------------------------------- */

  /**
   * Whether to use the parallel race strategy (fire browser after a short
   * timeout if simple fetch hasn't resolved).  Default: false (no race).
   */
  shouldRace?(): boolean;

  /**
   * Timeout (ms) before the race starts a parallel browser fetch.
   * Only called when `shouldRace()` returns true.  Default: 2000.
   */
  getRaceTimeoutMs?(): number;

  /* ---- domain extraction ------------------------------------------------- */

  /**
   * Premium domain extraction hook — 55+ domain extractors.
   * Return null to fall back to basic/no extraction.
   */
  extractDomainData?(html: string, url: string): Promise<DomainExtractResult | null>;

  /**
   * Returns a function that checks if a URL has a known domain extractor.
   * Premium knows which domains have extractors; basic returns null for all.
   */
  getDomainExtractor?(url: string): ((html: string, url: string) => Promise<DomainExtractResult | null>) | null;

  /* ---- SPA detection ----------------------------------------------------- */

  /**
   * Premium SPA domain list — knows which sites require browser rendering.
   * Basic: returns empty set (no SPA auto-detection).
   */
  getSPADomains?(): Set<string>;

  /**
   * Premium SPA URL patterns — matches specific paths needing render.
   * Basic: returns empty array.
   */
  getSPAPatterns?(): RegExp[];

  /* ---- challenge solving ------------------------------------------------- */

  /**
   * Premium CAPTCHA/challenge solving hook.
   * Return null to fall back to default challenge handling.
   */
  solveChallenge?(page: any, url: string): Promise<{ solved: boolean; html?: string } | null>;

  /* ---- content stability ------------------------------------------------- */

  /**
   * Premium wait-for-stable content logic — smarter than waitForLoadState.
   * Return null/undefined to fall back to default wait logic.
   */
  waitForContentStable?(page: any, options?: any): Promise<void>;
}

/* ---------- singleton registry ------------------------------------------- */

let registeredHooks: StrategyHooks = {};

/**
 * Register premium strategy hooks.  Should be called once at server startup.
 * Calling again replaces the previous hooks entirely.
 */
export function registerStrategyHooks(hooks: StrategyHooks): void {
  registeredHooks = { ...hooks };
}

/**
 * Clear all registered hooks (useful in tests).
 */
export function clearStrategyHooks(): void {
  registeredHooks = {};
}

/**
 * Retrieve the current hooks (internal — used by strategies.ts).
 */
export function getStrategyHooks(): Readonly<StrategyHooks> {
  return registeredHooks;
}

/**
 * Get the premium domain extraction hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getDomainExtractHook(): StrategyHooks['extractDomainData'] {
  return registeredHooks.extractDomainData;
}

/**
 * Get the premium domain extractor lookup hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getDomainExtractorHook(): StrategyHooks['getDomainExtractor'] {
  return registeredHooks.getDomainExtractor;
}

/**
 * Get the premium SPA domains hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getSPADomainsHook(): StrategyHooks['getSPADomains'] {
  return registeredHooks.getSPADomains;
}

/**
 * Get the premium SPA patterns hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getSPAPatternsHook(): StrategyHooks['getSPAPatterns'] {
  return registeredHooks.getSPAPatterns;
}

/**
 * Get the premium challenge solver hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getChallengeHook(): StrategyHooks['solveChallenge'] {
  return registeredHooks.solveChallenge;
}

/**
 * Get the premium content stability hook, if registered.
 * Returns undefined when no premium hooks are active (basic/npm mode).
 */
export function getStabilityHook(): StrategyHooks['waitForContentStable'] {
  return registeredHooks.waitForContentStable;
}
