import { describe, it, expect, afterEach } from 'vitest';
import {
  generateJobId,
  saveCheckpoint,
  loadCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
} from '../core/crawl-checkpoint.js';

describe('crawl-checkpoint', () => {
  const testJobId = 'test-' + Date.now();

  afterEach(() => {
    deleteCheckpoint(testJobId);
  });

  it('generates deterministic job IDs', () => {
    const id1 = generateJobId('https://example.com', { maxPages: 10 });
    const id2 = generateJobId('https://example.com', { maxPages: 10 });
    const id3 = generateJobId('https://example.com', { maxPages: 20 });
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it('generates 16-character hex job IDs', () => {
    const id = generateJobId('https://example.com', { maxPages: 5 });
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('saves and loads checkpoint', () => {
    const checkpoint = {
      jobId: testJobId,
      startUrl: 'https://example.com',
      completed: new Map([
        ['https://example.com', { status: 200, contentLength: 1000, timestamp: Date.now() }],
      ]),
      pending: ['https://example.com/page2'],
      discovered: ['https://example.com/page3'],
      options: { maxPages: 10 },
      startedAt: Date.now(),
      lastCheckpoint: Date.now(),
      maxPages: 10,
    };
    saveCheckpoint(checkpoint);
    const loaded = loadCheckpoint(testJobId);
    expect(loaded).not.toBeNull();
    expect(loaded!.startUrl).toBe('https://example.com');
    expect(loaded!.completed.size).toBe(1);
    expect(loaded!.pending).toEqual(['https://example.com/page2']);
    expect(loaded!.discovered).toEqual(['https://example.com/page3']);
    expect(loaded!.maxPages).toBe(10);
  });

  it('restores completed as a Map', () => {
    const checkpoint = {
      jobId: testJobId,
      startUrl: 'https://example.com',
      completed: new Map([
        ['https://example.com/a', { status: 200, contentLength: 500, timestamp: Date.now() }],
        ['https://example.com/b', { status: 200, contentLength: 800, timestamp: Date.now() }],
      ]),
      pending: [],
      discovered: [],
      options: {},
      startedAt: Date.now(),
      lastCheckpoint: Date.now(),
      maxPages: 10,
    };
    saveCheckpoint(checkpoint);
    const loaded = loadCheckpoint(testJobId);
    expect(loaded).not.toBeNull();
    expect(loaded!.completed).toBeInstanceOf(Map);
    expect(loaded!.completed.size).toBe(2);
    expect(loaded!.completed.has('https://example.com/a')).toBe(true);
  });

  it('returns null for non-existent checkpoint', () => {
    expect(loadCheckpoint('non-existent-job-12345')).toBeNull();
  });

  it('deletes checkpoint', () => {
    saveCheckpoint({
      jobId: testJobId,
      startUrl: 'https://example.com',
      completed: new Map(),
      pending: [],
      discovered: [],
      options: {},
      startedAt: Date.now(),
      lastCheckpoint: Date.now(),
      maxPages: 10,
    });
    deleteCheckpoint(testJobId);
    expect(loadCheckpoint(testJobId)).toBeNull();
  });

  it('delete is idempotent (no error on missing checkpoint)', () => {
    expect(() => deleteCheckpoint('never-existed')).not.toThrow();
  });

  it('lists checkpoints', () => {
    const list = listCheckpoints();
    expect(Array.isArray(list)).toBe(true);
  });

  it('lists saved checkpoint', () => {
    saveCheckpoint({
      jobId: testJobId,
      startUrl: 'https://example.com',
      completed: new Map([
        ['https://example.com', { status: 200, contentLength: 100, timestamp: Date.now() }],
      ]),
      pending: ['https://example.com/next'],
      discovered: [],
      options: {},
      startedAt: Date.now(),
      lastCheckpoint: Date.now(),
      maxPages: 10,
    });

    const list = listCheckpoints();
    const entry = list.find(c => c.jobId === testJobId);
    expect(entry).toBeDefined();
    expect(entry!.startUrl).toBe('https://example.com');
    expect(entry!.completed).toBe(1);
    expect(entry!.pending).toBe(1);
  });
});
