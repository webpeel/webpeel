/**
 * In-memory LRU response cache.
 */
const MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_WHILE_REVALIDATE_MS = 10 * 60 * 1000; // 10 minutes
const REVALIDATION_TIMEOUT_MS = 30 * 1000; // 30 seconds — reset revalidating flag if fetch hangs
let cacheTTL = DEFAULT_TTL_MS;
const responseCache = new Map();
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
function getCacheEntry(key) {
    const entry = responseCache.get(key);
    if (!entry) {
        return null;
    }
    const ageMs = Date.now() - entry.timestamp;
    const maxAgeMs = cacheTTL + STALE_WHILE_REVALIDATE_MS;
    if (ageMs > maxAgeMs) {
        responseCache.delete(key);
        return null;
    }
    const stale = ageMs > cacheTTL;
    // LRU touch: move to the end when read.
    responseCache.delete(key);
    responseCache.set(key, entry);
    return {
        value: entry.result,
        stale,
    };
}
function setCacheEntry(key, result) {
    if (responseCache.has(key)) {
        responseCache.delete(key);
    }
    responseCache.set(key, {
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
export function getCached(url) {
    const entry = getCacheEntry(normalizeUrl(url));
    if (!entry || entry.stale) {
        return null;
    }
    return entry.value;
}
export function getCachedWithSWR(url) {
    return getCacheEntry(normalizeUrl(url));
}
export function markRevalidating(url) {
    const key = normalizeUrl(url);
    const entry = responseCache.get(key);
    if (!entry) {
        return false;
    }
    const ageMs = Date.now() - entry.timestamp;
    const maxAgeMs = cacheTTL + STALE_WHILE_REVALIDATE_MS;
    if (ageMs > maxAgeMs) {
        responseCache.delete(key);
        return false;
    }
    const stale = ageMs > cacheTTL;
    if (!stale) {
        return false;
    }
    // If already revalidating, check if the attempt has timed out
    if (entry.revalidating && entry.revalidatingAt) {
        if (Date.now() - entry.revalidatingAt < REVALIDATION_TIMEOUT_MS) {
            return false; // Still within timeout, don't retry
        }
        // Timed out — allow a new attempt
    }
    entry.revalidating = true;
    entry.revalidatingAt = Date.now();
    // LRU touch: move to the end when updated.
    responseCache.delete(key);
    responseCache.set(key, entry);
    return true;
}
export function setCached(url, result) {
    setCacheEntry(normalizeUrl(url), result);
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