/**
 * Local-first content change tracking
 * Stores snapshots in ~/.webpeel/snapshots/ and provides diffing
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

// Snapshot storage directory
const SNAPSHOTS_DIR = join(homedir(), '.webpeel', 'snapshots');

/**
 * Get storage path for a URL
 */
function getSnapshotPath(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(SNAPSHOTS_DIR, `${hash}.json`);
}

/**
 * Ensure snapshots directory exists
 */
async function ensureSnapshotsDir(): Promise<void> {
  try {
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  } catch (error) {
    // Ignore if already exists
  }
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
export async function getSnapshot(url: string): Promise<Snapshot | null> {
  try {
    const path = getSnapshotPath(url);
    const data = await fs.readFile(path, 'utf-8');
    return JSON.parse(data) as Snapshot;
  } catch (error) {
    return null;
  }
}

/**
 * Save a snapshot for a URL
 */
async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await ensureSnapshotsDir();
  const path = getSnapshotPath(snapshot.url);
  await fs.writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/**
 * Simple LCS-based unified diff implementation
 * Returns unified diff format and change statistics
 */
function computeDiff(oldContent: string, newContent: string): ChangeResult['diff'] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Compute LCS (Longest Common Subsequence) using dynamic programming
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  
  // Backtrack to build diff
  const changes: Array<{ type: 'add' | 'del' | 'normal'; line: number; content: string }> = [];
  let i = m;
  let j = n;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({ type: 'normal', line: j, content: newLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      changes.unshift({ type: 'add', line: j, content: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      changes.unshift({ type: 'del', line: i, content: oldLines[i - 1] });
      i--;
    }
  }
  
  // Count additions and deletions
  let additions = 0;
  let deletions = 0;
  
  for (const change of changes) {
    if (change.type === 'add') additions++;
    if (change.type === 'del') deletions++;
  }
  
  // Build unified diff text
  const diffLines: string[] = [];
  let contextStart = 0;
  
  for (let idx = 0; idx < changes.length; idx++) {
    const change = changes[idx];
    
    // Find chunks of changes
    if (change.type !== 'normal') {
      // Add context header
      const chunkStart = Math.max(0, idx - 3);
      const chunkEnd = Math.min(changes.length, idx + 10);
      
      // Skip if we're continuing from previous chunk
      if (idx > contextStart) {
        diffLines.push(`@@ -${chunkStart + 1},${chunkEnd - chunkStart} +${chunkStart + 1},${chunkEnd - chunkStart} @@`);
      }
      
      // Add changes
      for (let k = chunkStart; k < chunkEnd; k++) {
        const c = changes[k];
        const prefix = c.type === 'add' ? '+' : c.type === 'del' ? '-' : ' ';
        diffLines.push(`${prefix}${c.content}`);
      }
      
      contextStart = chunkEnd;
      idx = chunkEnd - 1;
    }
  }
  
  return {
    text: diffLines.join('\n'),
    additions,
    deletions,
    changes,
  };
}

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
export async function trackChange(
  url: string,
  content: string,
  fingerprint: string
): Promise<ChangeResult> {
  try {
    const previous = await getSnapshot(url);
    
    if (!previous) {
      // First time seeing this URL
      await saveSnapshot({
        url,
        fingerprint,
        content,
        timestamp: Date.now(),
      });
      
      return {
        changeStatus: 'new',
        previousScrapeAt: null,
      };
    }
    
    // Compare fingerprints
    if (previous.fingerprint === fingerprint) {
      // Content unchanged, just update timestamp
      await saveSnapshot({
        ...previous,
        timestamp: Date.now(),
      });
      
      return {
        changeStatus: 'same',
        previousScrapeAt: new Date(previous.timestamp).toISOString(),
      };
    }
    
    // Content changed - compute diff
    const diff = computeDiff(previous.content, content);
    
    // Save new snapshot
    await saveSnapshot({
      url,
      fingerprint,
      content,
      timestamp: Date.now(),
      metadata: {
        previousFingerprint: previous.fingerprint,
        previousTimestamp: previous.timestamp,
      },
    });
    
    return {
      changeStatus: 'changed',
      previousScrapeAt: new Date(previous.timestamp).toISOString(),
      diff,
    };
    
  } catch (error) {
    console.error('Change tracking error:', error);
    // On error, treat as new
    return {
      changeStatus: 'new',
      previousScrapeAt: null,
    };
  }
}

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
export async function clearSnapshots(urlPattern?: string): Promise<number> {
  try {
    await ensureSnapshotsDir();
    const files = await fs.readdir(SNAPSHOTS_DIR);
    let cleared = 0;
    
    const pattern = urlPattern ? new RegExp(urlPattern) : null;
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const path = join(SNAPSHOTS_DIR, file);
      
      if (pattern) {
        // Check if URL matches pattern
        try {
          const data = await fs.readFile(path, 'utf-8');
          const snapshot = JSON.parse(data) as Snapshot;
          if (pattern.test(snapshot.url)) {
            await fs.unlink(path);
            cleared++;
          }
        } catch {
          // Skip malformed snapshots
        }
      } else {
        // Clear all
        await fs.unlink(path);
        cleared++;
      }
    }
    
    return cleared;
  } catch (error) {
    console.error('Clear snapshots error:', error);
    return 0;
  }
}
