/**
 * Two-level response cache:
 * - L1: in-memory LRU (fast, process-local)
 * - L2: optional Redis (shared, persistent across instances)
 */

import { createHash } from 'node:crypto';
import { deserialize, serialize } from 'node:v8';

interface CacheEntry<T = unknown> {
  result: T;
  timestamp: number;
}

interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  connect?(): Promise<void>;
  disconnect?(): void;
}

const MAX_ENTRIES = 1000;
const DEFAULT_L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const L2_TTL_SECONDS = 15 * 60; // 15 minutes
const REDIS_KEY_PREFIX = 'webpeel:response:';
const REDIS_FAILURE_COOLDOWN_MS = 30 * 1000;

let cacheTTL = DEFAULT_L1_TTL_MS;
const responseCache = new Map<string, CacheEntry>();

let redisClient: RedisClientLike | null = null;
let redisInitPromise: Promise<RedisClientLike | null> | null = null;
let redisDisabledUntil = 0;

function normalizeUrl(url: string): string {
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    normalized.hostname = normalized.hostname.toLowerCase();

    if ((normalized.protocol === 'http:' && normalized.port === '80') ||
        (normalized.protocol === 'https:' && normalized.port === '443')) {
      normalized.port = '';
    }

    if (!normalized.pathname) {
      normalized.pathname = '/';
    }

    const sortedParams = [...normalized.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b));
    normalized.search = '';
    for (const [key, value] of sortedParams) {
      normalized.searchParams.append(key, value);
    }

    return normalized.toString();
  } catch {
    return url.trim();
  }
}

function getNormalizedUrlHash(url: string): string {
  const normalized = normalizeUrl(url);
  return createHash('sha256').update(normalized).digest('hex');
}

function buildRedisKey(hash: string): string {
  return `${REDIS_KEY_PREFIX}${hash}`;
}

function getMemoryByHash<T = unknown>(hash: string): T | null {
  const entry = responseCache.get(hash);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > cacheTTL) {
    responseCache.delete(hash);
    return null;
  }

  // LRU touch: move to the end when read.
  responseCache.delete(hash);
  responseCache.set(hash, entry);

  return entry.result as T;
}

function setMemoryByHash<T = unknown>(hash: string, result: T): void {
  if (responseCache.has(hash)) {
    responseCache.delete(hash);
  }

  responseCache.set(hash, {
    result,
    timestamp: Date.now(),
  });

  while (responseCache.size > MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    responseCache.delete(oldestKey);
  }
}

function encodeForRedis(result: unknown): string {
  return serialize(result).toString('base64');
}

function decodeFromRedis<T = unknown>(payload: string): T {
  return deserialize(Buffer.from(payload, 'base64')) as T;
}

function markRedisUnavailable(client?: RedisClientLike | null): void {
  redisDisabledUntil = Date.now() + REDIS_FAILURE_COOLDOWN_MS;

  if (client && typeof client.disconnect === 'function') {
    try {
      client.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
  }

  if (!client || redisClient === client) {
    redisClient = null;
  }
}

async function initializeRedisClient(): Promise<RedisClientLike | null> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  try {
    const moduleName = 'ioredis';
    const redisModule = await import(moduleName);
    const RedisCtor = (redisModule as { default?: new (...args: any[]) => RedisClientLike }).default;

    if (!RedisCtor) {
      return null;
    }

    const client = new RedisCtor(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });

    if (typeof client.on === 'function') {
      client.on('error', () => {
        markRedisUnavailable(client);
      });
    }

    if (typeof client.connect === 'function') {
      await client.connect();
    }

    return client;
  } catch {
    markRedisUnavailable();
    return null;
  }
}

async function getRedisClient(): Promise<RedisClientLike | null> {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (Date.now() < redisDisabledUntil) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (!redisInitPromise) {
    redisInitPromise = initializeRedisClient().finally(() => {
      redisInitPromise = null;
    });
  }

  const client = await redisInitPromise;
  if (client) {
    redisClient = client;
  }

  return client;
}

async function getRedisCachedByHash<T = unknown>(hash: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const payload = await client.get(buildRedisKey(hash));
    if (!payload) {
      return null;
    }

    return decodeFromRedis<T>(payload);
  } catch {
    markRedisUnavailable(client);
    return null;
  }
}

async function setRedisCachedByHash(hash: string, result: unknown): Promise<void> {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    const payload = encodeForRedis(result);
    await client.set(buildRedisKey(hash), payload, 'EX', L2_TTL_SECONDS);
  } catch {
    markRedisUnavailable(client);
  }
}

export function getCached<T = unknown>(url: string): T | null {
  const hash = getNormalizedUrlHash(url);
  return getMemoryByHash<T>(hash);
}

export async function getCachedAsync<T = unknown>(url: string): Promise<T | null> {
  const hash = getNormalizedUrlHash(url);

  const l1Hit = getMemoryByHash<T>(hash);
  if (l1Hit !== null) {
    return l1Hit;
  }

  const l2Hit = await getRedisCachedByHash<T>(hash);
  if (l2Hit !== null) {
    setMemoryByHash(hash, l2Hit);
    return l2Hit;
  }

  return null;
}

export function setCached<T = unknown>(url: string, result: T): void {
  const hash = getNormalizedUrlHash(url);
  setMemoryByHash(hash, result);
  void setRedisCachedByHash(hash, result);
}

export function clearCache(): void {
  responseCache.clear();
}

export function setCacheTTL(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error('Cache TTL must be a positive number of milliseconds');
  }

  cacheTTL = ms;
}
