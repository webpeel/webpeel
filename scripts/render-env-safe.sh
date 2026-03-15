#!/bin/bash
# render-env-safe.sh — Safely add/update Render env vars WITHOUT wiping existing ones
# Usage: ./scripts/render-env-safe.sh KEY VALUE
#
# IMPORTANT: The Render API PUT /env-vars REPLACES ALL vars.
# This script reads existing vars first, adds/updates the new one, and PUTs them all back.
# This prevents the catastrophic wipe that happened on 2026-03-14.

set -euo pipefail

SERVICE_ID="srv-d673vsogjchc73ahgj6g"
API_KEY=$(grep 'key:' ~/.render/cli.yaml | head -1 | awk '{print $2}')

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 KEY VALUE"
  echo "Example: $0 ENABLE_CACHE_WARM true"
  exit 1
fi

NEW_KEY="$1"
NEW_VALUE="$2"

echo "▶ Reading existing env vars from Render..."
EXISTING=$(curl -s "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $API_KEY")

# Build new payload: existing vars + new/updated var
PAYLOAD=$(echo "$EXISTING" | node -e "
const existing = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const vars = existing.map(e => {
  const ev = e.envVar || e;
  return { key: ev.key, value: ev.value };
});

// Add or update the new var
const idx = vars.findIndex(v => v.key === '$NEW_KEY');
if (idx >= 0) {
  vars[idx].value = '$NEW_VALUE';
  console.error('  Updated: $NEW_KEY');
} else {
  vars.push({ key: '$NEW_KEY', value: '$NEW_VALUE' });
  console.error('  Added: $NEW_KEY');
}

console.log(JSON.stringify(vars));
console.error('  Total vars:', vars.length);
")

echo "▶ Writing back ALL env vars (safe merge)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Env var '$NEW_KEY' set safely (HTTP $HTTP_CODE)"
else
  echo "❌ Failed (HTTP $HTTP_CODE)"
  exit 1
fi
