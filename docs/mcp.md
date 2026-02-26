# MCP — WebPeel for AI Agents

WebPeel ships a full [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server with 18 tools.
Add it to any MCP-compatible agent and it can browse the web natively.

---

## Setup

### Claude Desktop

Edit `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see "webpeel" appear in the tools list.

### Cursor

Create `.cursor/mcp.json` in your project root (or edit the global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

### VS Code

Edit `.vscode/mcp.json`:

```json
{
  "servers": {
    "webpeel": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

### One-click install

[![Install in Claude Desktop](https://img.shields.io/badge/Install-Claude%20Desktop-5B3FFF?style=for-the-badge&logo=anthropic)](https://mcp.so/install/webpeel?for=claude)
[![Install in VS Code](https://img.shields.io/badge/Install-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode)](https://mcp.so/install/webpeel?for=vscode)

---

## Available Tools

### Core

| Tool | Description |
|------|-------------|
| `fetch` | Fetch a URL as markdown, HTML, or text |
| `search` | Search the web, returns structured results |
| `extract` | Extract structured data with a JSON Schema |
| `crawl` | Crawl a site, returns all pages as markdown |
| `batch_fetch` | Fetch multiple URLs in parallel |

### Media

| Tool | Description |
|------|-------------|
| `screenshot` | Full-page or viewport screenshot |
| `youtube` | Get video transcript with timestamps |
| `pdf` | Extract content from a PDF URL |

### Platforms

| Tool | Description |
|------|-------------|
| `reddit` | Get structured Reddit thread data |
| `twitter` | Get tweets from a profile or thread |
| `github` | Get repo info, issues, and PRs |

### Intelligence

| Tool | Description |
|------|-------------|
| `summarize` | Summarize a page in a given style/length |
| `qa` | Answer a question using a page as context |
| `diff` | Compare two snapshots of a page |
| `map_site` | Discover all URLs on a site |

### Monitoring

| Tool | Description |
|------|-------------|
| `monitor_start` | Watch a URL for changes |
| `monitor_stop` | Stop monitoring |
| `monitor_list` | List active monitors |

---

## Example Agent Prompts

Once WebPeel is connected, your agent can handle prompts like:

```
"Research the top 5 vector databases. For each one, find their pricing page and extract the plan names and prices."

"Crawl the docs at https://docs.example.com and summarize what the API does."

"Monitor https://openai.com/pricing and notify me if the prices change."

"Get the transcript of this YouTube video and answer: what are the three main points?"

"Take a screenshot of my competitor's landing page and describe the key changes since last week."
```

---

## Running the MCP Server Manually

```bash
# Start the MCP server directly (useful for debugging)
WEBPEEL_API_KEY=wp_... npx webpeel mcp

# The server communicates over stdio and responds to MCP protocol messages
```

---

## Troubleshooting

**Tools not showing up:**
- Check the API key is set correctly in the `env` block
- Restart Claude Desktop / Cursor after editing config
- Verify the config file path is correct for your OS

**Rate limit errors:**
- Free plan: 500 requests/week across all tools
- Upgrade at [app.webpeel.dev](https://app.webpeel.dev) for more

**Need help?**
- [Discord](https://discord.gg/webpeel)
- [support@webpeel.dev](mailto:support@webpeel.dev)
