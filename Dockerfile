# WebPeel MCP Server — Docker Hub MCP Catalog
# Runs in stdio mode by default (compatible with Claude Desktop, Cursor, Windsurf)
# Set MCP_HTTP_MODE=true to switch to HTTP Streamable transport on port 3100

FROM node:22-slim

# Install Playwright system deps + Chromium for browser rendering
RUN npx --yes playwright install --with-deps chromium

WORKDIR /app

# Install WebPeel globally from npm
RUN npm install -g webpeel@latest

# Default: stdio mode (required for Docker MCP catalog)
ENTRYPOINT ["webpeel", "--mcp"]

# HTTP Streamable transport:
#   docker run -e MCP_HTTP_MODE=true -p 3100:3100 webpeel/mcp
#
# stdio mode (default):
#   docker run -i webpeel/mcp
