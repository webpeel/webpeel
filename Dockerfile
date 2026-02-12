FROM node:20-slim

# Install Playwright dependencies
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production + optional dependencies (server needs pg, bcrypt, stripe, etc.)
RUN npm ci --omit=dev --include=optional

# Copy built files
COPY dist/ ./dist/

# Expose port (Render uses PORT env var, default 10000)
EXPOSE 10000

# Start server
CMD ["node", "dist/server/app.js"]
