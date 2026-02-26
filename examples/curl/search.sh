#!/usr/bin/env bash
# WebPeel — Search Examples (curl)
#
# Setup:
#   export WEBPEEL_API_KEY=wp_your_key_here

BASE="https://api.webpeel.dev/v1"
KEY="${WEBPEEL_API_KEY:?Set WEBPEEL_API_KEY first}"

echo "=== WebPeel Search Examples ==="
echo ""

# ─────────────────────────────────────────────────────────
# 1. Basic web search
# ─────────────────────────────────────────────────────────
echo "--- 1. Basic Search ---"
curl -s "$BASE/search?q=best+vector+databases+2025&limit=5" \
  -H "Authorization: Bearer $KEY" \
  | jq '.results[] | {title, url, snippet}'

echo ""

# ─────────────────────────────────────────────────────────
# 2. Search and fetch full content for top results
# ─────────────────────────────────────────────────────────
echo "--- 2. Search + Fetch Content ---"
curl -s "$BASE/search?q=typescript+orm+comparison&limit=3&fetchContent=true" \
  -H "Authorization: Bearer $KEY" \
  | jq '.results[] | {title, url, wordCount: .content.wordCount}'

echo ""
echo "Done!"
