/**
 * DNS Pre-Resolution Cache
 *
 * Warms a local Map<hostname, ip[]> on startup for the top ~50 popular domains
 * and exposes a custom lookup function compatible with undici's Agent `connect.lookup`.
 */
import dns from 'node:dns';
export declare function getCachedDns(hostname: string): string[] | null;
export declare function resolveAndCache(hostname: string): Promise<string[]>;
/**
 * Custom lookup function compatible with undici's Agent `connect.lookup`.
 *
 * undici passes `{ hints: 1024, all: true }` — so when `all` is true the
 * callback must receive `(err, entries: { address, family }[])`.
 * When `all` is false (or absent), the callback is `(err, address, family)`.
 */
export declare function cachedLookup(hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void): void;
export declare function warmupDnsCache(domains?: string[]): Promise<void>;
export declare function startDnsWarmup(): void;
export declare function clearDnsCache(): void;
//# sourceMappingURL=dns-cache.d.ts.map