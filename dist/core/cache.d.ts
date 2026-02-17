/**
 * Two-level response cache:
 * - L1: in-memory LRU (fast, process-local)
 * - L2: optional Redis (shared, persistent across instances)
 */
export declare function getCached<T = unknown>(url: string): T | null;
export declare function getCachedAsync<T = unknown>(url: string): Promise<T | null>;
export declare function setCached<T = unknown>(url: string, result: T): void;
export declare function clearCache(): void;
export declare function setCacheTTL(ms: number): void;
//# sourceMappingURL=cache.d.ts.map