#!/bin/bash
# WebPeel setup script — installs the CLI globally
# This script is optional. The skill works with just the API too.

set -e

echo "🌐 Setting up WebPeel..."

# Check if already installed
if command -v webpeel &> /dev/null; then
    CURRENT_VERSION=$(webpeel --version 2>/dev/null || echo "unknown")
    echo "✅ WebPeel CLI already installed (version: $CURRENT_VERSION)"
    exit 0
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "⚠️  npm not found. Install Node.js first, or use the API directly:"
    echo "   curl -s 'https://api.webpeel.dev/v1/fetch?url=URL' -H 'Authorization: Bearer KEY'"
    exit 0
fi

# Install
echo "📦 Installing webpeel CLI..."
npm install -g webpeel

# Verify
if command -v webpeel &> /dev/null; then
    echo "✅ WebPeel CLI installed: $(webpeel --version)"
else
    echo "⚠️  Installation may have succeeded but 'webpeel' not found in PATH."
    echo "   Try: npx webpeel 'https://example.com'"
fi
