/**
 * Local-first content change tracking
 * Stores snapshots in ~/.webpeel/snapshots/ and provides diffing
 */
export interface Snapshot {
    url: string;
    fingerprint: string;
    content: string;
    timestamp: number;
    metadata?: Record<string, any>;
}
export interface ChangeResult {
    changeStatus: 'new' | 'same' | 'changed' | 'removed';
    previousScrapeAt: string | null;
    diff?: {
        text: string;
        additions: number;
        deletions: number;
        changes: Array<{
            type: 'add' | 'del' | 'normal';
            line: number;
            content: string;
        }>;
    };
}
/**
 * Get a snapshot for a URL
 *
 * @param url - URL to get snapshot for
 * @returns Snapshot if exists, null otherwise
 *
 * @example
 * ```typescript
 * const snapshot = await getSnapshot('https://example.com');
 * if (snapshot) {
 *   console.log('Last scraped:', new Date(snapshot.timestamp));
 * }
 * ```
 */
export declare function getSnapshot(url: string): Promise<Snapshot | null>;
/**
 * Track content changes for a URL
 * Compares with previous snapshot and saves new one
 *
 * @param url - URL being tracked
 * @param content - Current content
 * @param fingerprint - Content fingerprint (SHA256 hash)
 * @returns Change detection result
 *
 * @example
 * ```typescript
 * const result = await trackChange('https://example.com', content, fingerprint);
 * if (result.changeStatus === 'changed') {
 *   console.log('Content changed!');
 *   console.log(`+${result.diff.additions} -${result.diff.deletions}`);
 * }
 * ```
 */
export declare function trackChange(url: string, content: string, fingerprint: string): Promise<ChangeResult>;
/**
 * Clear snapshots matching a URL pattern
 *
 * @param urlPattern - Optional regex pattern to match URLs (if not provided, clears all)
 * @returns Number of snapshots cleared
 *
 * @example
 * ```typescript
 * // Clear all snapshots
 * const count = await clearSnapshots();
 *
 * // Clear specific domain
 * const count = await clearSnapshots('example\\.com');
 * ```
 */
export declare function clearSnapshots(urlPattern?: string): Promise<number>;
//# sourceMappingURL=change-tracking.d.ts.map