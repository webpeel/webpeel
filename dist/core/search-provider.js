/**
 * Search provider abstraction
 *
 * WebPeel supports multiple web search backends. DuckDuckGo is the default
 * (no API key required). Brave Search is supported via BYOK.
 */
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
export class DuckDuckGoProvider {
    id = 'duckduckgo';
    requiresApiKey = false;
    async searchWeb(query, options) {
        const { count, tbs, country, location, signal } = options;
        const params = new URLSearchParams();
        params.set('q', query);
        // DuckDuckGo HTML endpoint supports some filtering
        if (tbs) {
            // DDG uses `df` for time filtering on html endpoint
            params.set('df', tbs);
        }
        if (country || location) {
            const region = (country || location || '').toLowerCase();
            if (region)
                params.set('kl', region);
        }
        const searchUrl = `https://html.duckduckgo.com/html/?${params.toString()}`;
        const response = await undiciFetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            signal,
        });
        if (!response.ok) {
            throw new Error(`Search failed: HTTP ${response.status}`);
        }
        const html = await response.text();
        const $ = load(html);
        const results = [];
        $('.result').each((_i, elem) => {
            if (results.length >= count)
                return;
            const $result = $(elem);
            let title = $result.find('.result__title').text().trim();
            const rawUrl = $result.find('.result__a').attr('href') || '';
            let snippet = $result.find('.result__snippet').text().trim();
            if (!title || !rawUrl)
                return;
            // Extract actual URL from DuckDuckGo redirect
            let url = rawUrl;
            try {
                const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
                const uddg = ddgUrl.searchParams.get('uddg');
                if (uddg) {
                    url = decodeURIComponent(uddg);
                }
            }
            catch {
                // Use raw URL if parsing fails
            }
            // SECURITY: Validate and sanitize results — only allow HTTP/HTTPS URLs
            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    return;
                }
                url = parsed.href;
            }
            catch {
                return;
            }
            // Limit text lengths to prevent bloat
            title = title.slice(0, 200);
            snippet = snippet.slice(0, 500);
            results.push({ title, url, snippet });
        });
        return results;
    }
}
export class BraveSearchProvider {
    id = 'brave';
    requiresApiKey = true;
    async searchWeb(query, options) {
        const { count, apiKey, signal } = options;
        if (!apiKey || apiKey.trim().length === 0) {
            throw new Error('Brave Search requires an API key');
        }
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(Math.min(Math.max(count, 1), 10)));
        const response = await undiciFetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey,
            },
            signal,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Brave Search failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
        }
        const data = await response.json();
        const resultsArray = data?.web?.results;
        if (!Array.isArray(resultsArray)) {
            return [];
        }
        const results = [];
        for (const r of resultsArray) {
            if (results.length >= count)
                break;
            const title = typeof r?.title === 'string' ? r.title.trim() : '';
            const rawUrl = typeof r?.url === 'string' ? r.url.trim() : '';
            const snippet = typeof r?.description === 'string'
                ? r.description.trim()
                : typeof r?.snippet === 'string'
                    ? r.snippet.trim()
                    : '';
            if (!title || !rawUrl)
                continue;
            // SECURITY: Validate URL protocol
            try {
                const parsed = new URL(rawUrl);
                if (!['http:', 'https:'].includes(parsed.protocol))
                    continue;
            }
            catch {
                continue;
            }
            results.push({
                title: title.slice(0, 200),
                url: rawUrl,
                snippet: snippet.slice(0, 500),
            });
        }
        return results;
    }
}
export function getSearchProvider(id) {
    if (!id || id === 'duckduckgo')
        return new DuckDuckGoProvider();
    if (id === 'brave')
        return new BraveSearchProvider();
    // Exhaustive fallback (should be unreachable due to typing)
    return new DuckDuckGoProvider();
}
//# sourceMappingURL=search-provider.js.map