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
const server = new Server({
    name: 'webpeel',
    version: '0.3.0',
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
        description: 'Fetch a URL and return clean, AI-ready markdown content. Handles JavaScript rendering and anti-bot protections automatically. Use this when you need to read the content of a web page. For protected sites, use stealth=true to bypass bot detection.',
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
        description: 'Crawl a website starting from a URL, following links and extracting content. Respects robots.txt and rate limits. Perfect for gathering documentation or site content.',
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
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === 'webpeel_fetch') {
            const { url, render, stealth, wait, format, screenshot, screenshotFullPage, selector, exclude, headers } = args;
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
            const { url, maxPages, maxDepth, allowedDomains, excludePatterns, respectRobotsTxt, rateLimitMs, render, stealth, } = args;
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