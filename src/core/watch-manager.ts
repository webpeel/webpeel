/**
 * WebPeel WatchManager — Database-backed persistent URL monitoring
 *
 * Stores watch entries in PostgreSQL, periodically fetches watched URLs,
 * compares content fingerprints to detect changes, and fires webhook
 * notifications when a page is updated.
 *
 * This module is complementary to the in-process `watch.ts` poller:
 *  - `watch.ts`        → ephemeral, CLI/in-process, no DB
 *  - `watch-manager.ts` → persistent, server-side, PostgreSQL-backed
 */

import { createHash } from 'crypto';
import { fetch as undiciFetch } from 'undici';
import pg from 'pg';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface WatchEntry {
  id: string;
  accountId: string;
  url: string;
  webhookUrl?: string;
  checkIntervalMinutes: number;
  selector?: string;
  lastFingerprint?: string;
  lastCheckedAt?: Date;
  lastChangedAt?: Date;
  changeCount: number;
  status: 'active' | 'paused' | 'error';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWatchOptions {
  webhookUrl?: string;
  checkIntervalMinutes?: number;
  selector?: string;
}

export interface WatchDiff {
  /** Whether content changed since the last recorded fingerprint. */
  changed: boolean;
  /** SHA-256 fingerprint of the previous content (empty string if none). */
  previousFingerprint: string;
  /** SHA-256 fingerprint of the current content. */
  currentFingerprint: string;
  /** Human-readable description of the change. */
  summary: string;
  /** Paragraph-level text blocks present in new content but not in old. */
  addedText: string[];
  /** Paragraph-level text blocks present in old content but not in new. */
  removedText: string[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute a stable SHA-256 fingerprint of page content.
 * Normalises whitespace so cosmetic-only reformatting doesn't trigger alerts.
 */
export function computeFingerprint(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Paragraph-level diff — splits both versions of a page into paragraph blocks
 * (separated by blank lines), then finds paragraphs that appear exclusively in
 * each version.  Only blocks longer than 10 characters are considered to avoid
 * noise from short punctuation-only lines.
 */
export function computeParagraphDiff(
  oldContent: string,
  newContent: string,
): { addedText: string[]; removedText: string[] } {
  const toSet = (text: string): Set<string> =>
    new Set(
      text
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p.length > 10),
    );

  const oldSet = toSet(oldContent);
  const newSet = toSet(newContent);

  const addedText: string[] = [];
  const removedText: string[] = [];

  for (const p of newSet) {
    if (!oldSet.has(p)) addedText.push(p.slice(0, 500));
  }
  for (const p of oldSet) {
    if (!newSet.has(p)) removedText.push(p.slice(0, 500));
  }

  return { addedText, removedText };
}

/** Post a JSON payload to a webhook URL, silently swallowing delivery errors. */
async function sendWatchWebhook(webhookUrl: string, payload: unknown): Promise<void> {
  try {
    await undiciFetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WebPeel-Watch/1.0 (+https://webpeel.dev)',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    process.stderr.write(
      `[watch-manager] Webhook delivery failed to ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** Map a raw database row to a typed {@link WatchEntry}. */
function rowToEntry(row: Record<string, unknown>): WatchEntry {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    url: row.url as string,
    webhookUrl: (row.webhook_url as string | null) ?? undefined,
    checkIntervalMinutes: (row.check_interval_minutes as number) ?? 60,
    selector: (row.selector as string | null) ?? undefined,
    lastFingerprint: (row.last_fingerprint as string | null) ?? undefined,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at as string) : undefined,
    lastChangedAt: row.last_changed_at ? new Date(row.last_changed_at as string) : undefined,
    changeCount: (row.change_count as number) ?? 0,
    status: (row.status as 'active' | 'paused' | 'error') ?? 'active',
    errorMessage: (row.error_message as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ─── WatchManager ──────────────────────────────────────────────────────────────

/**
 * Database-backed URL watch manager.
 *
 * Stores watch entries in a PostgreSQL `watches` table (see
 * `migrations/007_watch.sql`) and handles periodic checks, change detection,
 * and webhook delivery.
 *
 * @example
 * ```typescript
 * const manager = new WatchManager(pool);
 * const watch = await manager.create('acct-uuid', 'https://example.com/pricing', {
 *   webhookUrl: 'https://hooks.example.com/alert',
 *   checkIntervalMinutes: 30,
 * });
 * const diff = await manager.check(watch.id);
 * console.log(diff.summary);
 * ```
 */
export class WatchManager {
  constructor(private readonly db: pg.Pool) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * Create a new watch entry for the given URL.
   * The watch is immediately active; the first check will establish the baseline.
   */
  async create(
    accountId: string,
    url: string,
    options: CreateWatchOptions = {},
  ): Promise<WatchEntry> {
    const { webhookUrl, checkIntervalMinutes = 60, selector } = options;

    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO watches (account_id, url, webhook_url, check_interval_minutes, selector)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [accountId, url, webhookUrl ?? null, checkIntervalMinutes, selector ?? null],
    );

    return rowToEntry(result.rows[0]);
  }

  /** List all watches owned by the given account, most recent first. */
  async list(accountId: string): Promise<WatchEntry[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM watches WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId],
    );
    return result.rows.map(rowToEntry);
  }

  /** Get a single watch by ID, or null if not found. */
  async get(watchId: string): Promise<WatchEntry | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM watches WHERE id = $1`,
      [watchId],
    );
    if (result.rows.length === 0) return null;
    return rowToEntry(result.rows[0]);
  }

  /** Pause a watch — it will not be included in {@link checkDue} runs. */
  async pause(watchId: string): Promise<void> {
    await this.db.query(
      `UPDATE watches SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [watchId],
    );
  }

  /** Resume a previously paused (or errored) watch. */
  async resume(watchId: string): Promise<void> {
    await this.db.query(
      `UPDATE watches
       SET status = 'active', error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [watchId],
    );
  }

  /** Permanently delete a watch. */
  async delete(watchId: string): Promise<void> {
    await this.db.query(`DELETE FROM watches WHERE id = $1`, [watchId]);
  }

  /**
   * Update mutable properties of a watch.
   * Only the fields present in `updates` are changed.
   */
  async update(
    watchId: string,
    updates: Partial<Pick<WatchEntry, 'webhookUrl' | 'checkIntervalMinutes' | 'selector' | 'status'>>,
  ): Promise<WatchEntry | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if ('webhookUrl' in updates) {
      setClauses.push(`webhook_url = $${idx++}`);
      values.push(updates.webhookUrl ?? null);
    }
    if ('checkIntervalMinutes' in updates) {
      setClauses.push(`check_interval_minutes = $${idx++}`);
      values.push(updates.checkIntervalMinutes);
    }
    if ('selector' in updates) {
      setClauses.push(`selector = $${idx++}`);
      values.push(updates.selector ?? null);
    }
    if ('status' in updates) {
      setClauses.push(`status = $${idx++}`);
      values.push(updates.status);
    }

    values.push(watchId);

    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE watches SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) return null;
    return rowToEntry(result.rows[0]);
  }

  // ─── Checking ────────────────────────────────────────────────────────────────

  /**
   * Perform an immediate content check for the given watch ID.
   *
   * Steps:
   * 1. Load watch entry and previous content snapshot from disk (if any).
   * 2. Fetch the current page via `peel()`.
   * 3. Compute a SHA-256 fingerprint of the normalised content.
   * 4. If the fingerprint changed, compute a paragraph-level diff and fire the webhook.
   * 5. Persist `last_fingerprint`, `last_checked_at`, and `change_count` to the DB.
   * 6. Return a {@link WatchDiff} describing what changed.
   */
  async check(watchId: string): Promise<WatchDiff> {
    const watch = await this.get(watchId);
    if (!watch) throw new Error(`Watch not found: ${watchId}`);

    const now = new Date();

    try {
      // Load previous content snapshot for text-diff computation.
      const { getSnapshot } = await import('./change-tracking.js');
      const prevSnapshot = await getSnapshot(watch.url);

      // Fetch current content.
      const { peel } = await import('../index.js');
      const peelResult = await peel(watch.url, {
        format: 'markdown',
        selector: watch.selector,
        timeout: 30_000,
        // Enable change tracking so the snapshot is persisted for future diffs.
        changeTracking: true,
      });

      const currentContent = peelResult.content;
      const currentFingerprint = computeFingerprint(currentContent);
      const previousFingerprint = watch.lastFingerprint ?? '';

      // Determine whether content actually changed relative to our DB record.
      const isFirstCheck = !previousFingerprint;
      const changed = !isFirstCheck && currentFingerprint !== previousFingerprint;

      // Compute text diff when changed and we have old content to compare against.
      let addedText: string[] = [];
      let removedText: string[] = [];
      let summary: string;

      if (isFirstCheck) {
        summary = 'Baseline fingerprint established — monitoring active.';
      } else if (changed) {
        const oldContent = prevSnapshot?.content ?? '';
        if (oldContent) {
          const diff = computeParagraphDiff(oldContent, currentContent);
          addedText = diff.addedText;
          removedText = diff.removedText;
          summary =
            addedText.length > 0 || removedText.length > 0
              ? `Page updated: ${addedText.length} block${addedText.length !== 1 ? 's' : ''} added, ` +
                `${removedText.length} block${removedText.length !== 1 ? 's' : ''} removed.`
              : 'Page content changed (fingerprint mismatch — no paragraph-level diff available).';
        } else {
          summary = 'Page content changed (no previous snapshot available for text diff).';
        }
      } else {
        summary = 'No changes detected.';
      }

      // Update DB.
      if (changed) {
        await this.db.query(
          `UPDATE watches
           SET last_fingerprint    = $1,
               last_checked_at     = $2,
               last_changed_at     = $2,
               change_count        = change_count + 1,
               status              = 'active',
               error_message       = NULL,
               updated_at          = $2
           WHERE id = $3`,
          [currentFingerprint, now, watchId],
        );

        // Reload to get the latest change_count for the webhook payload.
        const updated = await this.get(watchId);

        // Fire webhook.
        if (watch.webhookUrl && updated) {
          const payload = {
            event: 'watch.changed',
            watchId: watch.id,
            url: watch.url,
            changedAt: now.toISOString(),
            changeCount: updated.changeCount,
            diff: { addedText, removedText, summary },
          };
          await sendWatchWebhook(watch.webhookUrl, payload);
        }
      } else {
        await this.db.query(
          `UPDATE watches
           SET last_fingerprint = COALESCE($1, last_fingerprint),
               last_checked_at  = $2,
               status           = 'active',
               error_message    = NULL,
               updated_at       = $2
           WHERE id = $3`,
          [currentFingerprint || null, now, watchId],
        );
      }

      return {
        changed,
        previousFingerprint,
        currentFingerprint,
        summary,
        addedText,
        removedText,
      };
    } catch (error) {
      const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 500);

      // Mark the watch as errored so operators can investigate.
      await this.db.query(
        `UPDATE watches
         SET status        = 'error',
             error_message = $1,
             last_checked_at = $2,
             updated_at    = $2
         WHERE id = $3`,
        [errMsg, now, watchId],
      );

      throw error;
    }
  }

  /**
   * Scan the database for watches that are due for a check and run them.
   *
   * A watch is "due" when:
   *  - `status = 'active'`
   *  - `last_checked_at` is NULL (never checked) OR older than `check_interval_minutes`
   *
   * Processes up to 50 watches per invocation to avoid long-running cycles.
   */
  async checkDue(): Promise<void> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM watches
       WHERE status = 'active'
         AND (
           last_checked_at IS NULL
           OR last_checked_at < NOW() - (check_interval_minutes * INTERVAL '1 minute')
         )
       ORDER BY last_checked_at ASC NULLS FIRST
       LIMIT 50`,
    );

    for (const row of result.rows) {
      const watch = rowToEntry(row);
      try {
        await this.check(watch.id);
      } catch (err) {
        process.stderr.write(
          `[watch-manager] Error checking watch ${watch.id} (${watch.url}): ` +
            `${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
}

// ─── Background checker ────────────────────────────────────────────────────────

/**
 * Start a background interval that calls {@link WatchManager.checkDue} every
 * minute.  Wire this up in `app.ts` after the server starts.
 *
 * @returns The interval handle (pass to `clearInterval` for clean shutdown).
 *
 * @example
 * ```typescript
 * const handle = startWatchChecker(pool);
 * process.on('SIGTERM', () => clearInterval(handle));
 * ```
 */
export function startWatchChecker(db: pg.Pool): ReturnType<typeof setInterval> {
  const manager = new WatchManager(db);

  return setInterval(async () => {
    try {
      await manager.checkDue();
    } catch (err) {
      process.stderr.write(
        `[watch-manager] Background checker error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }, 60_000); // Every 1 minute
}
