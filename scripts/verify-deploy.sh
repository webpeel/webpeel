#!/usr/bin/env bash
# Post-deploy verification — tests real production endpoints
set -uo pipefail

API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
API_URL="https://api.webpeel.dev"
PASS=0
FAIL=0
EXPECTED_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

echo "═══════════════════════════════════════════════"
echo "  WebPeel Deploy Verification"
echo "  Expected version: $EXPECTED_VER"
echo "═══════════════════════════════════════════════"
echo ""

# Helper function
check() {
  local label="$1"
  local expected_method="$2"
  local min_words="$3"
  local url="$4"

  local result=$(curl -s --max-time 15 "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$url\"}" 2>/dev/null)

  local method=$(echo "$result" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).method||'?')}catch{console.log('ERR')}" 2>/dev/null)
  local words=$(echo "$result" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(r.content?.trim().split(/\s+/).length||0)}catch{console.log(0)}" 2>/dev/null)
  local elapsed=$(echo "$result" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).elapsed||'?')}catch{console.log('?')}" 2>/dev/null)

  local status="❌"
  if [ "$words" -ge "$min_words" ] 2>/dev/null; then
    status="✅"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi

  printf "  %s %-16s %-12s %4sw  %sms\n" "$status" "$label" "$method" "$words" "$elapsed"
}

# Health check
echo "▶ Health Check"
HEALTH=$(curl -s --max-time 5 "$API_URL/health" 2>/dev/null)
LIVE_VER=$(echo "$HEALTH" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version)}catch{console.log('DOWN')}" 2>/dev/null)
if [ "$LIVE_VER" = "$EXPECTED_VER" ]; then
  echo "  ✅ Version $LIVE_VER matches expected"
  PASS=$((PASS + 1))
elif [ "$LIVE_VER" = "DOWN" ]; then
  echo "  ❌ Server is DOWN (502)"
  FAIL=$((FAIL + 1))
else
  echo "  ⚠️  Version mismatch: live=$LIVE_VER expected=$EXPECTED_VER"
  FAIL=$((FAIL + 1))
fi
echo ""

# Endpoint tests
echo "▶ Endpoint Tests"
check "example.com"     "simple"     10  "https://example.com"
check "github/react"    "domain-api" 20  "https://github.com/facebook/react"
check "wikipedia/dog"   "any"        100 "https://en.wikipedia.org/wiki/Dog"
check "npm/express"     "any"        50  "https://www.npmjs.com/package/express"
check "hackernews"      "domain-api" 100 "https://news.ycombinator.com"
check "arxiv"           "domain-api" 50  "https://arxiv.org/abs/2501.00001"
check "pypi/requests"   "any"        50  "https://pypi.org/project/requests/"
check "youtube"         "any"        50  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
echo ""

# Search test
echo "▶ Search Test"
SEARCH_RESULT=$(curl -s --max-time 10 "$API_URL/v1/search?q=javascript+framework" \
  -H "Authorization: Bearer $API_KEY" 2>/dev/null)
SEARCH_COUNT=$(echo "$SEARCH_RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.data?.web?.length||0)}catch{console.log(0)}" 2>/dev/null)
if [ "$SEARCH_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ✅ Search returned $SEARCH_COUNT results"
  PASS=$((PASS + 1))
else
  echo "  ❌ Search returned 0 results"
  FAIL=$((FAIL + 1))
fi
echo ""

# Summary
echo "═══════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  Result: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠️  $FAIL test(s) FAILED"
  exit 1
else
  echo "  ✅ All tests passed!"
  exit 0
fi
