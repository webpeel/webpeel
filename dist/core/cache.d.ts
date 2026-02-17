/**
 * In-memory LRU response cache.
 */
export interface CacheResult<T = unknown> {
    value: T;
    stale: boolean;
}
export declare function getCached<T = unknown>(url: string): T | null;
export declare function getCachedWithSWR<T = unknown>(url: string): CacheResult<T> | null;
export declare function markRevalidating(url: string): boolean;
export declare function setCached<T = unknown>(url: string, result: T): void;
export declare function clearCache(): void;
export declare function setCacheTTL(ms: number): void;
//# sourceMappingURL=cache.d.ts.map