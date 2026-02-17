/**
 * Search provider abstraction
 *
 * WebPeel supports multiple web search backends. DuckDuckGo is the default
 * (no API key required). Brave Search is supported via BYOK.
 */
export type SearchProviderId = 'duckduckgo' | 'brave';
export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}
export interface WebSearchOptions {
    /** Number of results (1-10) */
    count: number;
    /** Provider API key (required for some providers, e.g. Brave) */
    apiKey?: string;
    /** Time filter (DuckDuckGo: df param) */
    tbs?: string;
    /** Country code for geo-targeting */
    country?: string;
    /** Location/region for geo-targeting */
    location?: string;
    /** Optional AbortSignal */
    signal?: AbortSignal;
}
export interface SearchProvider {
    readonly id: SearchProviderId;
    readonly requiresApiKey: boolean;
    searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}
export declare class DuckDuckGoProvider implements SearchProvider {
    readonly id: SearchProviderId;
    readonly requiresApiKey = false;
    private buildQueryAttempts;
    private buildSearchUrl;
    private searchOnce;
    /**
     * Fallback: DuckDuckGo Lite endpoint. Different HTML structure, sometimes
     * works when the main HTML endpoint is temporarily blocked on datacenter IPs.
     */
    private searchLite;
    searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}
export declare class BraveSearchProvider implements SearchProvider {
    readonly id: SearchProviderId;
    readonly requiresApiKey = true;
    searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}
export declare function getSearchProvider(id: SearchProviderId | undefined): SearchProvider;
//# sourceMappingURL=search-provider.d.ts.map