# Multi-stage Dockerfile for WebPeel API Server
# Stage 1: Build dependencies and install browsers
FROM node:20-slim AS builder

# Install dependencies for Playwright
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including optionalDependencies for server)
RUN npm ci --include=optional

# Install Playwright browsers (Chromium only for production)
RUN npx playwright install --with-deps chromium

# Stage 2: Production image
FROM node:20-slim

# Install runtime dependencies and curl for healthcheck
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd -r webpeel && useradd -r -g webpeel -G audio,video webpeel \
    && mkdir -p /home/webpeel/Downloads \
    && chown -R webpeel:webpeel /home/webpeel \
    && chown -R webpeel:webpeel /app

# Copy node_modules and Playwright browsers from builder
COPY --from=builder --chown=webpeel:webpeel /app/node_modules ./node_modules
COPY --from=builder --chown=webpeel:webpeel /root/.cache/ms-playwright /home/webpeel/.cache/ms-playwright

# Copy application files
COPY --chown=webpeel:webpeel package*.json ./
COPY --chown=webpeel:webpeel dist ./dist

# Switch to non-root user
USER webpeel

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/server/app.js"]
