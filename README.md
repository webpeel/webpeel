# WebPeel

Fast web content extraction for AI agents. Smart escalation from simple HTTP to headless browser when needed.

## Features

- **Smart Escalation**: Tries simple HTTP fetch first (~200ms), automatically escalates to browser for JS-heavy sites
- **Markdown-First**: Clean, token-efficient markdown output optimized for AI agents
- **Zero Config**: Works out of the box with `npx webpeel <url>`
- **TypeScript**: Fully typed with complete type definitions
- **Flexible**: Works as CLI, library, or (soon) self-hosted API

## Installation

```bash
npm install webpeel
```

For CLI usage without installation:

```bash
npx webpeel https://example.com
```

## CLI Usage

```bash
# Basic usage - outputs markdown
npx webpeel https://example.com

# JSON output with metadata
npx webpeel https://example.com --json

# Force browser mode (for JS-heavy sites)
npx webpeel https://x.com/username --render

# Wait for dynamic content
npx webpeel https://example.com --render --wait 5000

# Plain text output
npx webpeel https://example.com --text

# Raw HTML
npx webpeel https://example.com --html

# Silent mode (no spinner)
npx webpeel https://example.com --silent
```

## Library Usage

```typescript
import { peel } from 'webpeel';

// Basic usage
const result = await peel('https://example.com');
console.log(result.content); // Markdown content
console.log(result.metadata); // Structured metadata

// With options
const result = await peel('https://example.com', {
  render: true,           // Force browser mode
  wait: 3000,            // Wait 3s after page load
  format: 'markdown',    // 'markdown' | 'text' | 'html'
  timeout: 30000,        // Request timeout
});

// Result structure
interface PeelResult {
  url: string;           // Final URL (after redirects)
  title: string;         // Page title
  content: string;       // Page content in requested format
  metadata: {            // Structured metadata
    description?: string;
    author?: string;
    published?: string;
    image?: string;
    canonical?: string;
  };
  links: string[];       // All links on page (absolute URLs)
  tokens: number;        // Estimated token count
  method: 'simple' | 'browser';  // Method used
  elapsed: number;       // Time taken (ms)
}
```

## How It Works

1. **Simple Fetch First**: Tries basic HTTP with smart headers and Cheerio parsing
2. **Auto-Escalation**: If blocked (403, 503, Cloudflare), automatically switches to browser mode
3. **Smart Cleanup**: Removes nav, footer, ads, cookie banners while preserving content
4. **Clean Markdown**: Converts to readable markdown optimized for LLM token efficiency

## Error Handling

```typescript
import { peel, TimeoutError, BlockedError, NetworkError } from 'webpeel';

try {
  const result = await peel('https://example.com');
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error('Request timed out');
  } else if (error instanceof BlockedError) {
    console.error('Site blocked the request - try --render mode');
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## Roadmap

- [ ] Self-hosted API server (`webpeel serve`)
- [ ] MCP server for Claude Desktop (`webpeel mcp`)
- [ ] DuckDuckGo search integration (`webpeel search`)
- [ ] Rate limiting and caching
- [ ] Batch processing
- [ ] Screenshot capture

## License

MIT - Jake Liu

## Credits

Built with:
- [Playwright](https://playwright.dev/) - Headless browser automation
- [Cheerio](https://cheerio.js.org/) - Fast HTML parsing
- [Turndown](https://github.com/mixmark-io/turndown) - HTML to Markdown conversion
- [Commander](https://github.com/tj/commander.js) - CLI framework
