#!/usr/bin/env node
/**
 * MCP Server for WebPeel
 * Provides webpeel_fetch and webpeel_search tools for Claude Desktop / Cursor
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { peel } from '../index.js';
import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';
const server = new Server({
    name: 'webpeel',
    version: '1.0.0',
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
            let url = $result.find('.result__url').attr('href') || '';
            let snippet = $result.find('.result__snippet').text().trim();
            // SECURITY: Validate and sanitize results
            if (!title || !url)
                return;
            // Only allow HTTP/HTTPS URLs
            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    return;
                }
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
        description: 'Fetch a URL and return clean, AI-ready markdown content. Handles JavaScript rendering and anti-bot protections automatically. Use this when you need to read the content of a web page.',
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
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === 'webpeel_fetch') {
            const { url, render, wait, format } = args;
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
            const options = {
                render: render || false,
                wait: wait || 0,
                format: format || 'markdown',
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