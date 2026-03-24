/**
 * Tool schema definitions — single source of truth for both transports.
 * Imported by the standalone MCP server and the HTTP MCP route for tools/list.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const toolDefinitions: Tool[] = [
  {
    name: 'webpeel',
    description:
      "Your complete web toolkit — fetch, search, screenshot, extract, monitor, and interact with any website. " +
      "Handles JS rendering, Cloudflare, CAPTCHAs, and 55+ domain extractors automatically. 65-98% token savings. " +
      "Describe what you want in plain English. " +
      "Examples: 'read https://stripe.com/pricing', 'screenshot bbc.com on mobile', " +
      "'search for best AI frameworks 2024', 'extract product prices from amazon.com/dp/...', " +
      "'watch stripe.com/pricing for price changes', 'get YouTube transcript from youtu.be/...'. " +
      "For JavaScript-heavy SPAs (React, Vue, Next.js, Polymarket, Airbnb, etc.), mention 'render' or 'use browser' in your task. " +
      "For infinite scroll or lazy-loaded content, say 'scroll to bottom'. " +
      "For bot-protected sites (Cloudflare), say 'stealth mode'. " +
      "If you get sparse or empty content, retry and mention 'render' — the site likely requires JavaScript.",
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
        llmProvider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google'],
          description: 'LLM provider for schema extraction (BYOK). Pass when asking for structured data extraction.',
        },
        llmApiKey: {
          type: 'string',
          description: 'Your LLM API key (BYOK). Pass when asking for structured data extraction with llmProvider.',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model name (optional). Defaults: gpt-4o-mini (OpenAI), claude-haiku-4-5 (Anthropic), gemini-2.0-flash (Google).',
        },
        llmBaseUrl: {
          type: 'string',
          description: 'Custom OpenAI-compatible API base URL. Use for OpenRouter, Glama, or self-hosted models.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'webpeel_read',
    description:
      'Fetch any URL and return clean, LLM-optimized markdown. 65-98% fewer tokens than raw HTML. ' +
      'Automatically handles: web pages, YouTube transcripts (with timestamps), PDFs, ' +
      'JS-rendered SPAs, Cloudflare-protected sites, and 55+ domain-specific extractors (Amazon, Reddit, GitHub, etc.). ' +
      'IMPORTANT: Use render=true for ANY JavaScript-heavy site (React, Vue, Angular, Svelte, Next.js, SPAs). ' +
      'Known SPAs that need render=true: Polymarket, Airbnb, Booking.com, Expedia, Indeed, Zillow, Google, and more. ' +
      'If content is sparse or empty, ALWAYS retry with render=true before concluding the page has no content. ' +
      'Use actions= to interact with the page before extraction (scroll, click, type, wait). ' +
      'Use stealth=true for Cloudflare-protected or bot-blocked sites (auto-enables render). ' +
      'Use question= for instant Q&A (no LLM needed). ' +
      'Use summary=true for a short summary. Use budget=N to distill to N tokens.',
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
        actions: {
          type: 'array',
          description:
            'Browser actions to perform before extracting content. Requires render=true (auto-enabled). ' +
            'Each action is a string: "scroll:bottom" (infinite scroll), "wait:2000" (wait 2s), ' +
            '"click:.selector" (click element), "type:#input:text" (type into field), ' +
            '"waitFor:.selector" (wait for element), "hover:.element" (hover), ' +
            '"scroll:down:500" (scroll 500px), "scroll:0,1500" (scroll to coords). ' +
            'Chain multiple actions: ["scroll:bottom", "wait:2000"] to load lazy content.',
          items: { type: 'string' },
        },
        stealth: {
          type: 'boolean',
          description:
            'Stealth mode for bot-protected sites (Cloudflare, fingerprinting, rate limiting). ' +
            'Use when render=true still returns a challenge page or access denied. Auto-enables render.',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_see',
    description:
      "Capture a screenshot of any web page. Returns the page as an image for visual inspection. " +
      "Supports mobile, tablet, and desktop viewports. " +
      "Use mode='design' for AI-powered design analysis and suggestions. " +
      "Use mode='compare' with compare_url to diff two pages visually. " +
      "Use full_page=true to capture the entire scrollable page.",
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
      "Search the web or discover all pages on a site. " +
      "Pass query= to search the web and get ranked results with titles, URLs, and snippets. " +
      "Pass url= to map/crawl a domain and discover all its pages. " +
      "Use depth='deep' for multi-source research that synthesizes answers from multiple pages. " +
      "Smart search detects intent for restaurants, products, flights, hotels, and more.",
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
      "Extract structured JSON data from any URL. No LLM needed for built-in schemas. " +
      "Pass fields=['price','title','description'] to extract specific named fields. " +
      "Pass schema={...} with a full JSON schema for custom structured output. " +
      "Built-in schemas: product, article, recipe, job, event, contact, business, review, listing. " +
      "Works on Amazon, Yelp, LinkedIn, job boards, e-commerce sites, and any web page.",
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
        llmProvider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google'],
          description: 'LLM provider for schema extraction (BYOK). Required when using custom schema.',
        },
        llmApiKey: {
          type: 'string',
          description: 'Your LLM API key (BYOK). Required when using custom schema with llmProvider.',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model name (optional). Defaults: gpt-4o-mini (OpenAI), claude-haiku-4-5 (Anthropic), gemini-2.0-flash (Google).',
        },
        llmBaseUrl: {
          type: 'string',
          description: 'Custom OpenAI-compatible API base URL. Use for OpenRouter, Glama, or self-hosted models.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_monitor',
    description:
      "Track a web page for content changes over time. Call once to take a snapshot, call again to get a diff. " +
      "Use selector= to monitor a specific CSS element (e.g. a price, a status badge). " +
      "Use webhook= for persistent monitoring with automatic notifications when content changes. " +
      "Use interval= to set how frequently to check ('1h', '30m', '1d'). " +
      "Ideal for: price tracking, job listing changes, release monitoring, competitor updates.",
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
      "Automate interactions with any web page using a real browser. " +
      "Click buttons, fill forms, select dropdowns, scroll, wait for elements, and press keys. " +
      "Returns extracted content and optionally a screenshot after all actions complete. " +
      "Use for: logging into sites, submitting forms, navigating multi-step flows, " +
      "interacting with dynamic content that requires user input. " +
      "Actions: click, type, fill, scroll, wait, press, hover, select.",
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
