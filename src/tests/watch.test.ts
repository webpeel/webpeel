/**
 * Tests for the WatchManager — fingerprinting, paragraph diff, and CRUD.
 *
 * Database operations are mocked so these tests run without a real Postgres
 * instance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeFingerprint, computeParagraphDiff, WatchManager } from '../core/watch-manager.js';
import type { WatchEntry } from '../core/watch-manager.js';

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

describe('computeFingerprint', () => {
  it('returns a 64-character hex SHA-256 digest', () => {
    const fp = computeFingerprint('hello world');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces identical fingerprints for the same content', () => {
    const fp1 = computeFingerprint('pricing: $99/mo');
    const fp2 = computeFingerprint('pricing: $99/mo');
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for different content', () => {
    const fp1 = computeFingerprint('pricing: $99/mo');
    const fp2 = computeFingerprint('pricing: $149/mo');
    expect(fp1).not.toBe(fp2);
  });

  it('normalises whitespace — extra spaces/newlines do not affect fingerprint', () => {
    const fp1 = computeFingerprint('hello   world');
    const fp2 = computeFingerprint('hello world');
    expect(fp1).toBe(fp2);
  });

  it('normalises leading/trailing whitespace', () => {
    const fp1 = computeFingerprint('  hello world  ');
    const fp2 = computeFingerprint('hello world');
    expect(fp1).toBe(fp2);
  });

  it('handles empty strings', () => {
    const fp = computeFingerprint('');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Paragraph diff
// ---------------------------------------------------------------------------

describe('computeParagraphDiff', () => {
  it('returns empty arrays for identical content', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const { addedText, removedText } = computeParagraphDiff(text, text);
    expect(addedText).toHaveLength(0);
    expect(removedText).toHaveLength(0);
  });

  it('detects an added paragraph', () => {
    const old = 'Paragraph one.\n\nParagraph two.';
    const next = 'Paragraph one.\n\nParagraph two.\n\nNew enterprise tier at $299/mo.';
    const { addedText, removedText } = computeParagraphDiff(old, next);
    expect(addedText).toHaveLength(1);
    expect(addedText[0]).toContain('enterprise tier');
    expect(removedText).toHaveLength(0);
  });

  it('detects a removed paragraph', () => {
    const old = 'Paragraph one.\n\nObsolete section with old pricing.\n\nParagraph three.';
    const next = 'Paragraph one.\n\nParagraph three.';
    const { addedText, removedText } = computeParagraphDiff(old, next);
    expect(removedText).toHaveLength(1);
    expect(removedText[0]).toContain('Obsolete section');
    expect(addedText).toHaveLength(0);
  });

  it('detects both added and removed paragraphs', () => {
    const old = 'Old plan: Business $79/mo.\n\nUnchanged section.';
    const next = 'New plan: Enterprise $99/mo.\n\nUnchanged section.';
    const { addedText, removedText } = computeParagraphDiff(old, next);
    expect(addedText.some(t => t.includes('Enterprise'))).toBe(true);
    expect(removedText.some(t => t.includes('Business'))).toBe(true);
  });

  it('ignores very short blocks (≤ 10 chars)', () => {
    // Short lines like "---" should not appear in the diff
    const old = '---\n\nA real paragraph with meaningful content here.';
    const next = '===\n\nA real paragraph with meaningful content here.';
    const { addedText, removedText } = computeParagraphDiff(old, next);
    // "---" and "===" are ≤ 10 chars and should be filtered
    expect(addedText.every(t => t.length > 10)).toBe(true);
    expect(removedText.every(t => t.length > 10)).toBe(true);
  });

  it('truncates very long paragraph blocks to 500 chars in the output', () => {
    const longPara = 'A'.repeat(1000);
    const old = longPara;
    const next = 'B'.repeat(1000);
    const { addedText, removedText } = computeParagraphDiff(old, next);
    expect(addedText[0].length).toBeLessThanOrEqual(500);
    expect(removedText[0].length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// WatchManager — CRUD (with mocked database)
// ---------------------------------------------------------------------------

/** Build a fake pg.Pool that returns canned query results. */
function buildMockPool(queryFn: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  return { query: vi.fn(queryFn) } as unknown as import('pg').Pool;
}

/** Canonical DB row for a watch entry. */
function makeWatchRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'watch-uuid-1',
    account_id: 'acct-uuid-1',
    url: 'https://example.com/pricing',
    webhook_url: 'https://hooks.example.com/alert',
    check_interval_minutes: 60,
    selector: null,
    last_fingerprint: null,
    last_checked_at: null,
    last_changed_at: null,
    change_count: 0,
    status: 'active',
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('WatchManager.create', () => {
  it('inserts a row and returns a WatchEntry', async () => {
    const row = makeWatchRow();
    const pool = buildMockPool(() => ({ rows: [row] }));
    const manager = new WatchManager(pool);

    const entry = await manager.create('acct-uuid-1', 'https://example.com/pricing', {
      webhookUrl: 'https://hooks.example.com/alert',
      checkIntervalMinutes: 60,
    });

    expect(pool.query).toHaveBeenCalledOnce();
    expect(entry.id).toBe('watch-uuid-1');
    expect(entry.accountId).toBe('acct-uuid-1');
    expect(entry.url).toBe('https://example.com/pricing');
    expect(entry.webhookUrl).toBe('https://hooks.example.com/alert');
    expect(entry.checkIntervalMinutes).toBe(60);
    expect(entry.status).toBe('active');
    expect(entry.changeCount).toBe(0);
  });
});

describe('WatchManager.list', () => {
  it('returns all watches for an account', async () => {
    const rows = [
      makeWatchRow({ id: 'watch-1', url: 'https://example.com/pricing' }),
      makeWatchRow({ id: 'watch-2', url: 'https://example.com/about' }),
    ];
    const pool = buildMockPool(() => ({ rows }));
    const manager = new WatchManager(pool);

    const watches = await manager.list('acct-uuid-1');

    expect(watches).toHaveLength(2);
    expect(watches[0].id).toBe('watch-1');
    expect(watches[1].id).toBe('watch-2');
  });

  it('returns an empty array when no watches exist', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    const watches = await manager.list('acct-uuid-1');
    expect(watches).toHaveLength(0);
  });
});

describe('WatchManager.get', () => {
  it('returns a WatchEntry when found', async () => {
    const row = makeWatchRow();
    const pool = buildMockPool(() => ({ rows: [row] }));
    const manager = new WatchManager(pool);

    const entry = await manager.get('watch-uuid-1');
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('watch-uuid-1');
  });

  it('returns null when the watch does not exist', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    const entry = await manager.get('nonexistent-id');
    expect(entry).toBeNull();
  });
});

describe('WatchManager.pause / resume', () => {
  it('calls UPDATE with status paused on pause()', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    await manager.pause('watch-uuid-1');

    const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toMatch(/status = 'paused'/);
  });

  it('calls UPDATE with status active on resume()', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    await manager.resume('watch-uuid-1');

    const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toMatch(/status = 'active'/);
  });
});

describe('WatchManager.delete', () => {
  it('calls DELETE with the correct watch ID', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    await manager.delete('watch-uuid-1');

    const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toMatch(/DELETE FROM watches/);
    expect(callArgs[1]).toContain('watch-uuid-1');
  });
});

describe('WatchManager.update', () => {
  it('returns updated WatchEntry when the row exists', async () => {
    const updatedRow = makeWatchRow({ check_interval_minutes: 30 });
    const pool = buildMockPool(() => ({ rows: [updatedRow] }));
    const manager = new WatchManager(pool);

    const result = await manager.update('watch-uuid-1', { checkIntervalMinutes: 30 });
    expect(result).not.toBeNull();
    expect(result!.checkIntervalMinutes).toBe(30);
  });

  it('returns null when the row does not exist', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    const result = await manager.update('nonexistent', { checkIntervalMinutes: 30 });
    expect(result).toBeNull();
  });

  it('builds SET clause with only provided fields', async () => {
    const pool = buildMockPool(() => ({ rows: [] }));
    const manager = new WatchManager(pool);

    await manager.update('watch-uuid-1', { webhookUrl: 'https://new-hook.example.com' });

    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('webhook_url');
    expect(sql).not.toContain('check_interval_minutes');
  });
});

// ---------------------------------------------------------------------------
// WatchEntry mapping
// ---------------------------------------------------------------------------

describe('WatchEntry field mapping', () => {
  it('maps optional DB nulls to undefined', async () => {
    const row = makeWatchRow({
      webhook_url: null,
      selector: null,
      last_fingerprint: null,
      last_checked_at: null,
      last_changed_at: null,
      error_message: null,
    });
    const pool = buildMockPool(() => ({ rows: [row] }));
    const manager = new WatchManager(pool);

    const entry = await manager.create('acct-uuid-1', 'https://example.com', {});
    expect(entry.webhookUrl).toBeUndefined();
    expect(entry.selector).toBeUndefined();
    expect(entry.lastFingerprint).toBeUndefined();
    expect(entry.lastCheckedAt).toBeUndefined();
    expect(entry.lastChangedAt).toBeUndefined();
    expect(entry.errorMessage).toBeUndefined();
  });

  it('maps status correctly', async () => {
    const row = makeWatchRow({ status: 'paused' });
    const pool = buildMockPool(() => ({ rows: [row] }));
    const manager = new WatchManager(pool);

    const entry = await manager.create('acct-uuid-1', 'https://example.com', {});
    expect(entry.status).toBe('paused');
  });
});
