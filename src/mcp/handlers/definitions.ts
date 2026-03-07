/**
 * Tool schema definitions — single source of truth for both transports.
 * Imported by the standalone MCP server and the HTTP MCP route for tools/list.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const toolDefinitions: Tool[] = [
  {
    name: 'webpeel',
    description:
      "Your complete web toolkit. Describe what you want in plain language. " +
      "Examples: 'read https://stripe.com', 'screenshot bbc.com on mobile', " +
      "'find best AI frameworks', 'extract prices from stripe.com/pricing', " +
      "'watch stripe.com/pricing for changes'",
    annotations: {
      title: 'WebPeel Smart Web Tool',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Plain English description of what you want to do with the web.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'webpeel_read',
    description:
      'Read any URL and return clean markdown. Handles web pages, YouTube videos, and PDFs ' +
      'automatically. Use question= for Q&A about the page, summary=true for a summary.',
    annotations: {
      title: 'Read Web Page',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: 'Output format (default: markdown)',
          default: 'markdown',
        },
        render: {
          type: 'boolean',
          description: 'Force browser rendering for JS-heavy sites',
          default: false,
        },
        question: {
          type: 'string',
          description: 'Ask a question about the page content (BM25, no LLM needed)',
        },
        summary: {
          type: 'boolean',
          description: 'Return a summary instead of full content',
          default: false,
        },
        budget: {
          type: 'number',
          description: 'Smart token budget — distill content to N tokens',
        },
        readable: {
          type: 'boolean',
          description: 'Reader mode — extract only article content',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_see',
    description:
      "See any page visually. Returns a screenshot. Use mode='design' for design analysis, " +
      "mode='compare' with compare_url for visual comparison.",
    annotations: {
      title: 'See Page Visually',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to screenshot' },
        mode: {
          type: 'string',
          enum: ['screenshot', 'design', 'compare'],
          description: "Mode: 'screenshot' (default), 'design' (analysis), 'compare' (visual diff)",
          default: 'screenshot',
        },
        compare_url: {
          type: 'string',
          description: "Second URL to compare against (for mode='compare')",
        },
        viewport: {
          description: "Viewport size: 'mobile' | 'tablet' | {width, height}",
          oneOf: [
            { type: 'string', enum: ['mobile', 'tablet', 'desktop'] },
            {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
              required: ['width', 'height'],
            },
          ],
        },
        full_page: {
          type: 'boolean',
          description: 'Capture the full scrollable page',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_find',
    description:
      'Find anything on the web. Pass a query to search, or a url to discover all pages on ' +
      "that domain. Use depth='deep' for multi-source research.",
    annotations: {
      title: 'Find on the Web',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        url: { type: 'string', description: 'Domain URL to map/discover all pages' },
        depth: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: "Search depth: 'quick' = single search, 'deep' = multi-source research",
          default: 'quick',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'webpeel_extract',
    description:
      "Extract structured data from any URL. Pass fields=['price','title'] for specific data, " +
      'or omit for auto-detection. Returns typed JSON.',
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
        url: { type: 'string', description: 'URL to extract from' },
        schema: { type: 'object', description: 'JSON schema describing desired output structure' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: "Specific fields to extract, e.g. ['price', 'title', 'description']",
        },
        format: {
          type: 'string',
          enum: ['json', 'markdown'],
          description: 'Output format (default: json)',
          default: 'json',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_monitor',
    description:
      'Watch a URL for changes. Returns diff on subsequent calls. ' +
      'Add webhook= for persistent monitoring with notifications.',
    annotations: {
      title: 'Monitor URL for Changes',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to monitor' },
        webhook: {
          type: 'string',
          description: 'Webhook URL to notify when content changes',
        },
        interval: {
          type: 'string',
          description: "Check interval, e.g. '1h', '30m', '1d'",
          default: '1h',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to monitor a specific part of the page',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_act',
    description:
      'Interact with a web page. Click buttons, fill forms, navigate. ' +
      'Returns screenshot + extracted content after actions complete.',
    annotations: {
      title: 'Act on Web Page',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to interact with' },
        actions: {
          type: 'array',
          description:
            'Actions to perform, e.g. [{type:"click",selector:".btn"}, {type:"type",selector:"#q",value:"hello"}]',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'type', 'fill', 'scroll', 'wait', 'press', 'hover', 'select'],
              },
              selector: { type: 'string' },
              value: { type: 'string' },
              key: { type: 'string' },
              milliseconds: { type: 'number' },
            },
            required: ['type'],
          },
        },
        extract_after: {
          type: 'boolean',
          description: 'Extract content after actions complete',
          default: true,
        },
        screenshot_after: {
          type: 'boolean',
          description: 'Take screenshot after actions complete',
          default: false,
        },
      },
      required: ['url', 'actions'],
    },
  },
];
