/**
 * DNS Pre-Resolution Cache
 *
 * Warms a local Map<hostname, ip[]> on startup for the top ~50 popular domains
 * and exposes a custom lookup function compatible with undici's Agent `connect.lookup`.
 */
import dns from 'node:dns';
import net from 'node:net';
const DNS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DNS_WARMUP_DOMAINS = [
    'github.com',
    'www.github.com',
    'raw.githubusercontent.com',
    'api.github.com',
    'wikipedia.org',
    'en.wikipedia.org',
    'news.ycombinator.com',
    'stackoverflow.com',
    'www.stackoverflow.com',
    'developer.mozilla.org',
    'react.dev',
    'nextjs.org',
    'vercel.com',
    'tailwindcss.com',
    'supabase.com',
    'npmjs.com',
    'www.npmjs.com',
    'reddit.com',
    'www.reddit.com',
    'www.cloudflare.com',
    'medium.com',
    'linkedin.com',
    'www.linkedin.com',
    'www.bloomberg.com',
    'www.glassdoor.com',
    'arxiv.org',
    'www.sec.gov',
    'w3.org',
    'www.w3.org',
    'tools.ietf.org',
    'unicode.org',
    'www.bbc.com',
    'news.google.com',
    'www.youtube.com',
    'example.com',
    'httpbin.org',
    'docs.python.org',
    'nodejs.org',
    'openai.com',
    'anthropic.com',
    'x.com',
    'twitter.com',
    'www.nytimes.com',
    'www.wsj.com',
    'www.reuters.com',
    'www.theverge.com',
    'www.cnn.com',
    'www.amazon.com',
    'www.apple.com',
    'www.microsoft.com',
];
const dnsCache = new Map();
let warmupStarted = false;
let roundRobinCursor = 0;
function normalizeHostname(hostname) {
    return hostname.trim().toLowerCase();
}
function pruneIfExpired(hostname) {
    const entry = dnsCache.get(hostname);
    if (!entry)
        return;
    if (entry.expiresAt <= Date.now()) {
        dnsCache.delete(hostname);
    }
}
export function getCachedDns(hostname) {
    const normalized = normalizeHostname(hostname);
    pruneIfExpired(normalized);
    const entry = dnsCache.get(normalized);
    if (!entry || entry.ips.length === 0)
        return null;
    return [...entry.ips];
}
function setCachedDns(hostname, ips) {
    if (ips.length === 0)
        return;
    const normalized = normalizeHostname(hostname);
    dnsCache.set(normalized, {
        ips: [...new Set(ips)],
        expiresAt: Date.now() + DNS_CACHE_TTL_MS,
    });
}
export async function resolveAndCache(hostname) {
    const normalized = normalizeHostname(hostname);
    const cached = getCachedDns(normalized);
    if (cached)
        return cached;
    try {
        const ips = await dns.promises.resolve4(normalized);
        if (ips.length > 0)
            setCachedDns(normalized, ips);
        return ips;
    }
    catch {
        return [];
    }
}
function selectCachedIp(ips) {
    if (ips.length === 1)
        return ips[0];
    const selected = ips[roundRobinCursor % ips.length];
    roundRobinCursor = (roundRobinCursor + 1) % Number.MAX_SAFE_INTEGER;
    return selected;
}
/**
 * Custom lookup function compatible with undici's Agent `connect.lookup`.
 *
 * undici passes `{ hints: 1024, all: true }` — so when `all` is true the
 * callback must receive `(err, entries: { address, family }[])`.
 * When `all` is false (or absent), the callback is `(err, address, family)`.
 */
export function cachedLookup(hostname, options, callback) {
    // If hostname is already an IP, return immediately
    const ipFamily = net.isIP(hostname);
    if (ipFamily === 4 || ipFamily === 6) {
        if (options?.all) {
            callback(null, [{ address: hostname, family: ipFamily }]);
        }
        else {
            callback(null, hostname, ipFamily);
        }
        return;
    }
    // Only use cache for IPv4 lookups (family 0 or 4)
    const requestedFamily = typeof options?.family === 'number' ? options.family : 0;
    if (requestedFamily !== 6) {
        const cachedIps = getCachedDns(hostname);
        if (cachedIps && cachedIps.length > 0) {
            if (options?.all) {
                callback(null, cachedIps.map(ip => ({ address: ip, family: 4 })));
            }
            else {
                callback(null, selectCachedIp(cachedIps), 4);
            }
            return;
        }
        // Async resolve, fall back to native lookup on failure
        void resolveAndCache(hostname)
            .then((resolvedIps) => {
            if (resolvedIps.length > 0) {
                if (options?.all) {
                    callback(null, resolvedIps.map(ip => ({ address: ip, family: 4 })));
                }
                else {
                    callback(null, selectCachedIp(resolvedIps), 4);
                }
            }
            else {
                dns.lookup(hostname, options, callback);
            }
        })
            .catch(() => {
            dns.lookup(hostname, options, callback);
        });
        return;
    }
    // IPv6 requested — fall through to native lookup
    dns.lookup(hostname, options, callback);
}
export async function warmupDnsCache(domains = DNS_WARMUP_DOMAINS) {
    await Promise.allSettled(domains.map((d) => resolveAndCache(d)));
}
export function startDnsWarmup() {
    if (warmupStarted)
        return;
    warmupStarted = true;
    void warmupDnsCache().catch(() => {
        // Best-effort only.
    });
}
export function clearDnsCache() {
    dnsCache.clear();
}
//# sourceMappingURL=dns-cache.js.map