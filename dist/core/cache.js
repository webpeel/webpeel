/**
 * Two-level response cache:
 * - L1: in-memory LRU (fast, process-local)
 * - L2: optional Redis (shared, persistent across instances)
 */
import { createHash } from 'node:crypto';
import { deserialize, serialize } from 'node:v8';
const MAX_ENTRIES = 1000;
const DEFAULT_L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const L2_TTL_SECONDS = 15 * 60; // 15 minutes
const REDIS_KEY_PREFIX = 'webpeel:response:';
const REDIS_FAILURE_COOLDOWN_MS = 30 * 1000;
let cacheTTL = DEFAULT_L1_TTL_MS;
const responseCache = new Map();
let redisClient = null;
let redisInitPromise = null;
let redisDisabledUntil = 0;
function normalizeUrl(url) {
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
    }
    catch {
        return url.trim();
    }
}
function getNormalizedUrlHash(url) {
    const normalized = normalizeUrl(url);
    return createHash('sha256').update(normalized).digest('hex');
}
function buildRedisKey(hash) {
    return `${REDIS_KEY_PREFIX}${hash}`;
}
function getMemoryByHash(hash) {
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
    return entry.result;
}
function setMemoryByHash(hash, result) {
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
function encodeForRedis(result) {
    return serialize(result).toString('base64');
}
function decodeFromRedis(payload) {
    return deserialize(Buffer.from(payload, 'base64'));
}
function markRedisUnavailable(client) {
    redisDisabledUntil = Date.now() + REDIS_FAILURE_COOLDOWN_MS;
    if (client && typeof client.disconnect === 'function') {
        try {
            client.disconnect();
        }
        catch {
            // Ignore disconnect errors.
        }
    }
    if (!client || redisClient === client) {
        redisClient = null;
    }
}
async function initializeRedisClient() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        return null;
    }
    try {
        const moduleName = 'ioredis';
        const redisModule = await import(moduleName);
        const RedisCtor = redisModule.default;
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
    }
    catch {
        markRedisUnavailable();
        return null;
    }
}
async function getRedisClient() {
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
async function getRedisCachedByHash(hash) {
    const client = await getRedisClient();
    if (!client) {
        return null;
    }
    try {
        const payload = await client.get(buildRedisKey(hash));
        if (!payload) {
            return null;
        }
        return decodeFromRedis(payload);
    }
    catch {
        markRedisUnavailable(client);
        return null;
    }
}
async function setRedisCachedByHash(hash, result) {
    const client = await getRedisClient();
    if (!client) {
        return;
    }
    try {
        const payload = encodeForRedis(result);
        await client.set(buildRedisKey(hash), payload, 'EX', L2_TTL_SECONDS);
    }
    catch {
        markRedisUnavailable(client);
    }
}
export function getCached(url) {
    const hash = getNormalizedUrlHash(url);
    return getMemoryByHash(hash);
}
export async function getCachedAsync(url) {
    const hash = getNormalizedUrlHash(url);
    const l1Hit = getMemoryByHash(hash);
    if (l1Hit !== null) {
        return l1Hit;
    }
    const l2Hit = await getRedisCachedByHash(hash);
    if (l2Hit !== null) {
        setMemoryByHash(hash, l2Hit);
        return l2Hit;
    }
    return null;
}
export function setCached(url, result) {
    const hash = getNormalizedUrlHash(url);
    setMemoryByHash(hash, result);
    void setRedisCachedByHash(hash, result);
}
export function clearCache() {
    responseCache.clear();
}
export function setCacheTTL(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error('Cache TTL must be a positive number of milliseconds');
    }
    cacheTTL = ms;
}
//# sourceMappingURL=cache.js.map