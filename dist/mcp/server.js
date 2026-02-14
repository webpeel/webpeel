#!/usr/bin/env node
/**
 * MCP Server for WebPeel
 * Provides webpeel_fetch and webpeel_search tools for Claude Desktop / Cursor
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { peel, peelBatch } from '../index.js';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// Read version from package.json
let pkgVersion = '0.3.1';
try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    pkgVersion = pkg.version;
}
catch { /* fallback */ }
const server = new Server({
    name: 'webpeel',
    version: pkgVersion,
}, {
    capabilities: {
        tools: {},
    },
});
/**
 * Search DuckDuckGo HTML and return structured results
 */
async function searchWeb(query, count = 5) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
        const response = await undiciFetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
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
    catch (error) {
        const err = error;
        throw new Error(`Search failed: ${err.message}`);
    }
}
const tools = [
    {
        name: 'webpeel_fetch',
        description: 'Fetch a URL and return clean, AI-ready markdown content. Handles JavaScript rendering and anti-bot protections automatically. Supports page actions (click, scroll, type), structured extraction, and token budgets. Use stealth=true for protected sites.',
        annotations: {
            title: 'Fetch Web Page',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to fetch',
                },
                render: {
                    type: 'boolean',
                    description: 'Force browser rendering (slower but handles JavaScript-heavy sites)',
                    default: false,
                },
                stealth: {
                    type: 'boolean',
                    description: 'Use stealth mode to bypass bot detection (auto-enables render=true)',
                    default: false,
                },
                wait: {
                    type: 'number',
                    description: 'Milliseconds to wait for dynamic content (only used with render=true)',
                    default: 0,
                },
                format: {
                    type: 'string',
                    enum: ['markdown', 'text', 'html'],
                    description: 'Output format: markdown (default), text, or html',
                    default: 'markdown',
                },
                screenshot: {
                    type: 'boolean',
                    description: 'Capture a screenshot of the page (returns base64-encoded PNG)',
                    default: false,
                },
                screenshotFullPage: {
                    type: 'boolean',
                    description: 'Full-page screenshot (default: viewport only)',
                    default: false,
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector to extract specific content (e.g., "article", ".main-content")',
                },
                exclude: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'CSS selectors to exclude from content (e.g., [".sidebar", ".ads"])',
                },
                headers: {
                    type: 'object',
                    description: 'Custom HTTP headers to send',
                },
                actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                    },
                    description: 'Page actions to execute before extraction (e.g., [{type: "click", selector: ".btn"}, {type: "wait", ms: 2000}])',
                },
                maxTokens: {
                    type: 'number',
                    description: 'Maximum token count for output (truncates if exceeded)',
                },
                extract: {
                    type: 'object',
                    description: 'Structured data extraction options: {selectors: {field: "css"}} or {schema: {...}}',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'webpeel_search',
        description: 'Search the web using DuckDuckGo and return results with titles, URLs, and snippets. Use this to find relevant web pages before fetching them.',
        annotations: {
            title: 'Search the Web',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
                count: {
                    type: 'number',
                    description: 'Number of results to return (1-10)',
                    default: 5,
                    minimum: 1,
                    maximum: 10,
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'webpeel_batch',
        description: 'Fetch multiple URLs in batch with concurrency control. Returns an array of results or errors.',
        annotations: {
            title: 'Batch Fetch URLs',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'Array of URLs to fetch',
                },
                concurrency: {
                    type: 'number',
                    description: 'Max concurrent fetches (default: 3)',
                    default: 3,
                    minimum: 1,
                    maximum: 10,
                },
                render: {
                    type: 'boolean',
                    description: 'Force browser rendering for all URLs',
                    default: false,
                },
                format: {
                    type: 'string',
                    enum: ['markdown', 'text', 'html'],
                    description: 'Output format for all URLs',
                    default: 'markdown',
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector to extract specific content',
                },
            },
            required: ['urls'],
        },
    },
    {
        name: 'webpeel_crawl',
        description: 'Crawl a website starting from a URL, following links and extracting content. Supports sitemap-first discovery, BFS/DFS strategies, and content deduplication. Respects robots.txt and rate limits. Perfect for gathering documentation or site content.',
        annotations: {
            title: 'Crawl Website',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Starting URL to crawl from',
                },
                maxPages: {
                    type: 'number',
                    description: 'Maximum number of pages to crawl (default: 10, max: 100)',
                    default: 10,
                    minimum: 1,
                    maximum: 100,
                },
                maxDepth: {
                    type: 'number',
                    description: 'Maximum depth to crawl (default: 2, max: 5)',
                    default: 2,
                    minimum: 1,
                    maximum: 5,
                },
                allowedDomains: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'Only crawl URLs from these domains (default: same domain as starting URL)',
                },
                excludePatterns: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'Exclude URLs matching these regex patterns',
                },
                respectRobotsTxt: {
                    type: 'boolean',
                    description: 'Respect robots.txt (default: true)',
                    default: true,
                },
                rateLimitMs: {
                    type: 'number',
                    description: 'Rate limit between requests in milliseconds (default: 1000)',
                    default: 1000,
                    minimum: 100,
                },
                sitemapFirst: {
                    type: 'boolean',
                    description: 'Discover URLs via sitemap.xml before crawling (default: false)',
                    default: false,
                },
                render: {
                    type: 'boolean',
                    description: 'Use browser rendering for all pages',
                    default: false,
                },
                stealth: {
                    type: 'boolean',
                    description: 'Use stealth mode for all pages',
                    default: false,
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'webpeel_map',
        description: 'Discover all URLs on a domain using sitemap.xml and link crawling. Returns a comprehensive list of URLs without fetching their content. Perfect for understanding site structure or planning a crawl.',
        annotations: {
            title: 'Map Website URLs',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Starting URL or domain to map',
                },
                maxUrls: {
                    type: 'number',
                    description: 'Maximum URLs to discover (default: 5000, max: 10000)',
                    default: 5000,
                    minimum: 1,
                    maximum: 10000,
                },
                includePatterns: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'Only include URLs matching these patterns (regex)',
                },
                excludePatterns: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                    description: 'Exclude URLs matching these patterns (regex)',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'webpeel_extract',
        description: 'Extract structured data from a webpage using CSS selectors, JSON schema validation, or AI-powered extraction with natural language prompts. Perfect for scraping product data, article metadata, or any structured content.',
        annotations: {
            title: 'Extract Structured Data',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to extract from',
                },
                selectors: {
                    type: 'object',
                    description: 'Map of field names to CSS selectors, e.g., {"title": "h1", "price": ".price"}',
                },
                schema: {
                    type: 'object',
                    description: 'JSON schema describing expected output structure',
                },
                prompt: {
                    type: 'string',
                    description: 'Natural language prompt for AI-powered extraction (requires llmApiKey)',
                },
                llmApiKey: {
                    type: 'string',
                    description: 'API key for LLM-powered extraction (OpenAI-compatible)',
                },
                llmModel: {
                    type: 'string',
                    description: 'LLM model to use (default: gpt-4o-mini)',
                    default: 'gpt-4o-mini',
                },
                llmBaseUrl: {
                    type: 'string',
                    description: 'LLM API base URL (default: https://api.openai.com/v1)',
                    default: 'https://api.openai.com/v1',
                },
                render: {
                    type: 'boolean',
                    description: 'Use browser rendering',
                    default: false,
                },
            },
            required: ['url'],
        },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === 'webpeel_fetch') {
            const { url, render, stealth, wait, format, screenshot, screenshotFullPage, selector, exclude, headers, actions, maxTokens, extract } = args;
            // SECURITY: Validate input parameters
            if (!url || typeof url !== 'string') {
                throw new Error('Invalid URL parameter');
            }
            if (url.length > 2048) {
                throw new Error('URL too long (max 2048 characters)');
            }
            if (wait !== undefined) {
                if (typeof wait !== 'number' || isNaN(wait) || wait < 0 || wait > 60000) {
                    throw new Error('Invalid wait parameter: must be between 0 and 60000ms');
                }
            }
            if (format !== undefined && !['markdown', 'text', 'html'].includes(format)) {
                throw new Error('Invalid format parameter: must be "markdown", "text", or "html"');
            }
            if (selector !== undefined && typeof selector !== 'string') {
                throw new Error('Invalid selector parameter: must be a string');
            }
            if (exclude !== undefined && !Array.isArray(exclude)) {
                throw new Error('Invalid exclude parameter: must be an array');
            }
            if (headers !== undefined && typeof headers !== 'object') {
                throw new Error('Invalid headers parameter: must be an object');
            }
            if (actions !== undefined && !Array.isArray(actions)) {
                throw new Error('Invalid actions parameter: must be an array');
            }
            if (maxTokens !== undefined) {
                if (typeof maxTokens !== 'number' || isNaN(maxTokens) || maxTokens < 100) {
                    throw new Error('Invalid maxTokens parameter: must be at least 100');
                }
            }
            if (extract !== undefined && typeof extract !== 'object') {
                throw new Error('Invalid extract parameter: must be an object');
            }
            const options = {
                render: render || false,
                stealth: stealth || false,
                wait: wait || 0,
                format: format || 'markdown',
                screenshot: screenshot || false,
                screenshotFullPage: screenshotFullPage || false,
                selector,
                exclude,
                headers,
                actions,
                maxTokens,
                extract,
            };
            // SECURITY: Wrap in timeout (60 seconds max)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('MCP operation timed out after 60s')), 60000);
            });
            const result = await Promise.race([
                peel(url, options),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(result, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize result',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        if (name === 'webpeel_search') {
            const { query, count } = args;
            // SECURITY: Validate input parameters
            if (!query || typeof query !== 'string') {
                throw new Error('Invalid query parameter');
            }
            if (query.length > 500) {
                throw new Error('Query too long (max 500 characters)');
            }
            if (count !== undefined) {
                if (typeof count !== 'number' || isNaN(count) || count < 1 || count > 10) {
                    throw new Error('Invalid count parameter: must be between 1 and 10');
                }
            }
            const resultCount = Math.min(Math.max(count || 5, 1), 10);
            // SECURITY: Wrap in timeout (30 seconds max)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Search operation timed out after 30s')), 30000);
            });
            const results = await Promise.race([
                searchWeb(query, resultCount),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(results, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize results',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        if (name === 'webpeel_batch') {
            const { urls, concurrency, render, format, selector } = args;
            // SECURITY: Validate input parameters
            if (!urls || !Array.isArray(urls)) {
                throw new Error('Invalid urls parameter: must be an array');
            }
            if (urls.length === 0) {
                throw new Error('URLs array cannot be empty');
            }
            if (urls.length > 50) {
                throw new Error('Too many URLs (max 50)');
            }
            for (const url of urls) {
                if (!url || typeof url !== 'string') {
                    throw new Error('Invalid URL in array');
                }
                if (url.length > 2048) {
                    throw new Error('URL too long (max 2048 characters)');
                }
            }
            if (concurrency !== undefined) {
                if (typeof concurrency !== 'number' || isNaN(concurrency) || concurrency < 1 || concurrency > 10) {
                    throw new Error('Invalid concurrency parameter: must be between 1 and 10');
                }
            }
            const options = {
                concurrency: concurrency || 3,
                render: render || false,
                format: format || 'markdown',
                selector,
            };
            // SECURITY: Wrap in timeout (5 minutes max for batch)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Batch operation timed out after 5 minutes')), 300000);
            });
            const results = await Promise.race([
                peelBatch(urls, options),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(results, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize batch results',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        if (name === 'webpeel_crawl') {
            const { crawl } = await import('../core/crawler.js');
            const { url, maxPages, maxDepth, allowedDomains, excludePatterns, respectRobotsTxt, rateLimitMs, sitemapFirst, render, stealth, } = args;
            // SECURITY: Validate input parameters
            if (!url || typeof url !== 'string') {
                throw new Error('Invalid URL parameter');
            }
            if (url.length > 2048) {
                throw new Error('URL too long (max 2048 characters)');
            }
            if (maxPages !== undefined) {
                if (typeof maxPages !== 'number' || isNaN(maxPages) || maxPages < 1 || maxPages > 100) {
                    throw new Error('Invalid maxPages parameter: must be between 1 and 100');
                }
            }
            if (maxDepth !== undefined) {
                if (typeof maxDepth !== 'number' || isNaN(maxDepth) || maxDepth < 1 || maxDepth > 5) {
                    throw new Error('Invalid maxDepth parameter: must be between 1 and 5');
                }
            }
            if (allowedDomains !== undefined && !Array.isArray(allowedDomains)) {
                throw new Error('Invalid allowedDomains parameter: must be an array');
            }
            if (excludePatterns !== undefined && !Array.isArray(excludePatterns)) {
                throw new Error('Invalid excludePatterns parameter: must be an array');
            }
            if (rateLimitMs !== undefined) {
                if (typeof rateLimitMs !== 'number' || isNaN(rateLimitMs) || rateLimitMs < 100) {
                    throw new Error('Invalid rateLimitMs parameter: must be at least 100ms');
                }
            }
            // SECURITY: Wrap in timeout (10 minutes max for crawling)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Crawl operation timed out after 10 minutes')), 600000);
            });
            const results = await Promise.race([
                crawl(url, {
                    maxPages,
                    maxDepth,
                    allowedDomains,
                    excludePatterns,
                    respectRobotsTxt,
                    rateLimitMs,
                    sitemapFirst,
                    render,
                    stealth,
                }),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(results, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize crawl results',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        if (name === 'webpeel_map') {
            const { mapDomain } = await import('../core/map.js');
            const { url, maxUrls, includePatterns, excludePatterns, } = args;
            // SECURITY: Validate input parameters
            if (!url || typeof url !== 'string') {
                throw new Error('Invalid URL parameter');
            }
            if (url.length > 2048) {
                throw new Error('URL too long (max 2048 characters)');
            }
            if (maxUrls !== undefined) {
                if (typeof maxUrls !== 'number' || isNaN(maxUrls) || maxUrls < 1 || maxUrls > 10000) {
                    throw new Error('Invalid maxUrls parameter: must be between 1 and 10000');
                }
            }
            if (includePatterns !== undefined && !Array.isArray(includePatterns)) {
                throw new Error('Invalid includePatterns parameter: must be an array');
            }
            if (excludePatterns !== undefined && !Array.isArray(excludePatterns)) {
                throw new Error('Invalid excludePatterns parameter: must be an array');
            }
            // SECURITY: Wrap in timeout (10 minutes max for mapping)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Map operation timed out after 10 minutes')), 600000);
            });
            const results = await Promise.race([
                mapDomain(url, {
                    maxUrls,
                    includePatterns,
                    excludePatterns,
                }),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(results, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize map results',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        if (name === 'webpeel_extract') {
            const { url, selectors, schema, prompt, llmApiKey, llmModel, llmBaseUrl, render, } = args;
            // SECURITY: Validate input parameters
            if (!url || typeof url !== 'string') {
                throw new Error('Invalid URL parameter');
            }
            if (url.length > 2048) {
                throw new Error('URL too long (max 2048 characters)');
            }
            if (selectors !== undefined && typeof selectors !== 'object') {
                throw new Error('Invalid selectors parameter: must be an object');
            }
            if (schema !== undefined && typeof schema !== 'object') {
                throw new Error('Invalid schema parameter: must be an object');
            }
            if (prompt !== undefined && typeof prompt !== 'string') {
                throw new Error('Invalid prompt parameter: must be a string');
            }
            if (llmApiKey !== undefined && typeof llmApiKey !== 'string') {
                throw new Error('Invalid llmApiKey parameter: must be a string');
            }
            if (llmModel !== undefined && typeof llmModel !== 'string') {
                throw new Error('Invalid llmModel parameter: must be a string');
            }
            if (llmBaseUrl !== undefined && typeof llmBaseUrl !== 'string') {
                throw new Error('Invalid llmBaseUrl parameter: must be a string');
            }
            if (!selectors && !schema && !prompt) {
                throw new Error('Either selectors, schema, or prompt must be provided');
            }
            const options = {
                render: render || false,
                extract: {
                    selectors,
                    schema,
                    prompt,
                    llmApiKey,
                    llmModel,
                    llmBaseUrl,
                },
            };
            // SECURITY: Wrap in timeout (60 seconds max)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Extract operation timed out after 60s')), 60000);
            });
            const result = await Promise.race([
                peel(url, options),
                timeoutPromise,
            ]);
            // SECURITY: Handle JSON serialization errors
            let resultText;
            try {
                resultText = JSON.stringify(result, null, 2);
            }
            catch (jsonError) {
                resultText = JSON.stringify({
                    error: 'serialization_error',
                    message: 'Failed to serialize extract result',
                });
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: resultText,
                    },
                ],
            };
        }
        throw new Error(`Unknown tool: ${name}`);
    }
    catch (error) {
        const err = error;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: err.name || 'Error',
                        message: err.message || 'Unknown error occurred',
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WebPeel MCP server running on stdio');
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map