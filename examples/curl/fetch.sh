#!/usr/bin/env bash
# WebPeel — Fetch Examples (curl)
#
# Setup:
#   export WEBPEEL_API_KEY=wp_your_key_here
#
# Run individual examples by copying any command below.

BASE="https://api.webpeel.dev/v1"
KEY="${WEBPEEL_API_KEY:?Set WEBPEEL_API_KEY first}"

echo "=== WebPeel Fetch Examples ==="
echo ""

# ─────────────────────────────────────────────────────────
# 1. Basic fetch — returns clean markdown
# ─────────────────────────────────────────────────────────
echo "--- 1. Basic Fetch ---"
curl -s "$BASE/fetch?url=https://news.ycombinator.com" \
  -H "Authorization: Bearer $KEY" \
  | jq -r '.markdown' | head -30

echo ""

# ─────────────────────────────────────────────────────────
# 2. Fetch with JSON metadata
# ─────────────────────────────────────────────────────────
echo "--- 2. Fetch with metadata ---"
curl -s "$BASE/fetch?url=https://stripe.com/pricing&format=markdown" \
  -H "Authorization: Bearer $KEY" \
  | jq '{title, url, wordCount, responseTime}'

echo ""

# ─────────────────────────────────────────────────────────
# 3. Fetch as raw HTML
# ─────────────────────────────────────────────────────────
echo "--- 3. Fetch as HTML ---"
curl -s "$BASE/fetch?url=https://example.com&format=html" \
  -H "Authorization: Bearer $KEY" \
  | jq -r '.html' | head -10

echo ""

# ─────────────────────────────────────────────────────────
# 4. Fetch with screenshot
# ─────────────────────────────────────────────────────────
echo "--- 4. Fetch + Screenshot ---"
curl -s "$BASE/fetch?url=https://webpeel.dev&screenshot=true" \
  -H "Authorization: Bearer $KEY" \
  | jq '{title, screenshot: (.screenshot | length | tostring + " bytes base64")}'

echo ""
echo "Done!"
