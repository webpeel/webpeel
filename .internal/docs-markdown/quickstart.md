# Quickstart — WebPeel in 5 Minutes

Get your first page fetched in under 5 minutes.

---

## 1. Get an API Key

1. Go to [app.webpeel.dev/signup](https://app.webpeel.dev/signup)
2. Create a free account (no credit card required)
3. Copy your API key — it starts with `wp_`

Your free plan includes **500 requests/week**.

---

## 2. Make Your First Request

Pick your preferred method:

### curl (no install needed)

```bash
export WEBPEEL_API_KEY=wp_your_key_here

curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

### Node.js / TypeScript

```bash
npm install webpeel
```

```typescript
import { WebPeel } from 'webpeel';

const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });
const result = await wp.fetch('https://news.ycombinator.com');
console.log(result.markdown);
```

### Python

```bash
pip install webpeel
```

```python
import os
from webpeel import WebPeel

wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])
result = wp.fetch("https://news.ycombinator.com")
print(result.markdown)
```

### CLI (no SDK, no code)

```bash
npx webpeel "https://news.ycombinator.com"
```

---

## 3. Try Other Operations

```bash
# Search the web
curl "https://api.webpeel.dev/v1/search?q=best+vector+databases" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"

# Extract structured data
curl -X POST "https://api.webpeel.dev/v1/extract" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://stripe.com/pricing", "schema": { "type": "object", "properties": { "plans": { "type": "array" } } } }'

# Take a screenshot
curl "https://api.webpeel.dev/v1/screenshot?url=https://webpeel.dev&fullPage=true" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  | jq -r '.image' | base64 -d > screenshot.png
```

---

## 4. Add to Your AI Agent (MCP)

If you're using Claude, Cursor, or VS Code, add WebPeel as an MCP server:

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": { "WEBPEEL_API_KEY": "wp_your_key_here" }
    }
  }
}
```

Your agent now has 18 web tools available. [Full MCP setup →](./mcp.md)

---

## Next Steps

- [Authentication](./authentication.md) — API key management and security
- [Endpoints](./endpoints.md) — Full endpoint reference
- [MCP Setup](./mcp.md) — Connect to Claude, Cursor, and more
- [Rate Limits](./rate-limits.md) — Plan limits and upgrade options
- [Error Codes](./errors.md) — Troubleshooting
