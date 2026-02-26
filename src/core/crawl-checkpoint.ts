/**
 * Crawl checkpoint system for resume capability.
 * Saves progress to a JSON file so interrupted crawls can continue.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export interface CrawlCheckpoint {
  /** Unique crawl job ID (hash of start URL + options) */
  jobId: string;
  /** Starting URL */
  startUrl: string;
  /** URLs already crawled (with their results) */
  completed: Map<string, { status: number; contentLength: number; timestamp: number }>;
  /** URLs queued but not yet crawled */
  pending: string[];
  /** URLs discovered but not yet queued */
  discovered: string[];
  /** Crawl options (serialized) */
  options: Record<string, any>;
  /** When crawl started */
  startedAt: number;
  /** Last checkpoint time */
  lastCheckpoint: number;
  /** Total pages target */
  maxPages: number;
}

const CHECKPOINT_DIR = join(process.env.HOME || '/tmp', '.webpeel', 'checkpoints');

/**
 * Generate a deterministic job ID from URL + options.
 */
export function generateJobId(url: string, options: Record<string, any> = {}): string {
  const key = JSON.stringify({
    url,
    maxPages: options.maxPages,
    maxDepth: options.maxDepth,
    includes: options.includes,
    excludes: options.excludes,
  });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Get the checkpoint file path for a job.
 */
function getCheckpointPath(jobId: string): string {
  return join(CHECKPOINT_DIR, `${jobId}.json`);
}

/**
 * Save a checkpoint to disk.
 */
export function saveCheckpoint(checkpoint: CrawlCheckpoint): void {
  try {
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
    const data = {
      ...checkpoint,
      completed: Object.fromEntries(checkpoint.completed),
      lastCheckpoint: Date.now(),
    };
    writeFileSync(getCheckpointPath(checkpoint.jobId), JSON.stringify(data, null, 2));
  } catch (e) {
    if (process.env.DEBUG) {
      console.debug('[webpeel]', 'Failed to save checkpoint:', e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Load a checkpoint from disk.
 */
export function loadCheckpoint(jobId: string): CrawlCheckpoint | null {
  const path = getCheckpointPath(jobId);
  if (!existsSync(path)) return null;

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      ...raw,
      completed: new Map(Object.entries(raw.completed || {})),
    };
  } catch {
    return null;
  }
}

/**
 * Delete a checkpoint (crawl completed or abandoned).
 */
export function deleteCheckpoint(jobId: string): void {
  const path = getCheckpointPath(jobId);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch { /* ignore */ }
}

/**
 * List all active checkpoints.
 */
export function listCheckpoints(): Array<{
  jobId: string;
  startUrl: string;
  completed: number;
  pending: number;
  lastCheckpoint: number;
}> {
  try {
    if (!existsSync(CHECKPOINT_DIR)) return [];
    const files: string[] = readdirSync(CHECKPOINT_DIR).filter((f: string) => f.endsWith('.json'));

    return files.map(f => {
      try {
        const raw = JSON.parse(readFileSync(join(CHECKPOINT_DIR, f), 'utf-8'));
        return {
          jobId: raw.jobId,
          startUrl: raw.startUrl,
          completed: Object.keys(raw.completed || {}).length,
          pending: (raw.pending || []).length,
          lastCheckpoint: raw.lastCheckpoint,
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{
      jobId: string;
      startUrl: string;
      completed: number;
      pending: number;
      lastCheckpoint: number;
    }>;
  } catch {
    return [];
  }
}
