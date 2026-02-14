# Multi-stage Dockerfile for WebPeel API Server

# Stage 1: Build TypeScript and install dependencies
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and source
COPY package*.json tsconfig.json ./
COPY src ./src

# Install all dependencies (including dev for TypeScript compilation)
RUN npm ci --include=optional

# Build TypeScript to dist/
RUN npx tsc

# Stage 2: Production image with Playwright Chromium
FROM node:20-slim

# Install runtime dependencies for Playwright Chromium + curl for healthcheck
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    fonts-liberation \
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

# Copy package files and install production deps only
COPY --chown=webpeel:webpeel package*.json ./
RUN npm ci --omit=dev --include=optional && npm cache clean --force

# Install Playwright Chromium browser (as root, then fix permissions)
RUN npx playwright install --with-deps chromium && \
    mkdir -p /home/webpeel/.cache && \
    cp -r /root/.cache/ms-playwright /home/webpeel/.cache/ms-playwright && \
    chown -R webpeel:webpeel /home/webpeel/.cache

# Copy built output from builder
COPY --from=builder --chown=webpeel:webpeel /app/dist ./dist

# Switch to non-root user
USER webpeel

# Tell Playwright where to find browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/home/webpeel/.cache/ms-playwright

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/server/app.js"]
