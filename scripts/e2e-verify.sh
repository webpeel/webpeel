#!/usr/bin/env bash
# e2e-verify.sh — End-to-end verification with real URLs
# Run after every feature batch to ensure nothing is broken
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'
PASS=0
FAIL=0
WARN=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo -e "${GREEN}✓${NC} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $desc"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local desc="$1"
  echo -e "${YELLOW}⚠${NC} $desc"
  WARN=$((WARN + 1))
}

echo "╔══════════════════════════════════════════════╗"
echo "║  WebPeel E2E Verification Suite              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. API Health ──────────────────────────────────
echo "── API Health ──"
API_HEALTH=$(curl -s "https://api.webpeel.dev/health" 2>/dev/null || echo '{}')
API_STATUS=$(echo "$API_HEALTH" | jq -r '.status // "unknown"')
API_VERSION=$(echo "$API_HEALTH" | jq -r '.version // "unknown"')
check "API healthy: $API_STATUS" "$([ "$API_STATUS" = "healthy" ] && echo 0 || echo 1)"
echo "  Version: $API_VERSION"
echo ""

# ── 2. Site Health ──────────────────────────────────
echo "── Site Health ──"
SITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://webpeel.dev" 2>/dev/null || echo "000")
check "webpeel.dev returns 200 (got $SITE_CODE)" "$([ "$SITE_CODE" = "200" ] && echo 0 || echo 1)"

DASH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://app.webpeel.dev" 2>/dev/null || echo "000")
check "app.webpeel.dev responds (got $DASH_CODE)" "$([ "$DASH_CODE" = "200" ] || [ "$DASH_CODE" = "307" ] && echo 0 || echo 1)"

DOCS_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "https://webpeel.dev/docs/" 2>/dev/null || echo "000")
check "docs returns 200 (got $DOCS_CODE)" "$([ "$DOCS_CODE" = "200" ] && echo 0 || echo 1)"
echo ""

# ── 3. CLI Fetch — Real URLs ──────────────────────
echo "── CLI Fetch (Real URLs) ──"
CLI="node $(dirname "$0")/../dist/cli.js"

# Test 1: Simple HTML page
RESULT=$($CLI "https://example.com" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "example.com: $TOKENS tokens" "$([ "$TOKENS" -gt 10 ] && echo 0 || echo 1)"

# Test 2: JS-heavy page (Hacker News)
RESULT=$($CLI "https://news.ycombinator.com" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "news.ycombinator.com: $TOKENS tokens" "$([ "$TOKENS" -gt 100 ] && echo 0 || echo 1)"

# Test 3: Wikipedia
RESULT=$($CLI "https://en.wikipedia.org/wiki/Web_scraping" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "wikipedia.org: $TOKENS tokens" "$([ "$TOKENS" -gt 500 ] && echo 0 || echo 1)"

# Test 4: Search
# Search outputs debug lines then multiline JSON — use node to extract count
RESULTS_COUNT=$($CLI search "what is webpeel" --silent --json 2>&1 | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { const m=d.match(/\{[\s\S]*\}/); const j=JSON.parse(m[0]); console.log(j.results?.length||j.count||0); }
    catch(e) { console.log(0); }
  });
" 2>/dev/null || echo 0)
check "search 'what is webpeel': $RESULTS_COUNT results" "$([ "$RESULTS_COUNT" -gt 0 ] && echo 0 || echo 1)"
echo ""

# ── 4. Screenshot ──────────────────────────────────
echo "── Screenshot ──"
SCREENSHOT_FILE="/tmp/webpeel-e2e-test.png"
$CLI screenshot "https://example.com" --width 1280 --height 720 -o "$SCREENSHOT_FILE" --silent 2>/dev/null
SCREENSHOT_SIZE=$(stat -f%z "$SCREENSHOT_FILE" 2>/dev/null || echo 0)
check "screenshot example.com: ${SCREENSHOT_SIZE} bytes" "$([ "$SCREENSHOT_SIZE" -gt 10000 ] && echo 0 || echo 1)"
rm -f "$SCREENSHOT_FILE"
echo ""

# ── 5. Build & Tests ──────────────────────────────
echo "── Build & Tests ──"
cd "$(dirname "$0")/.."
BUILD_RESULT=$(npm run build 2>&1)
check "TypeScript build clean" "$?"

TEST_OUTPUT=$(npm test -- --run 2>&1)
# vitest output: "Tests  1383 passed | 3 skipped (1386)" and "Test Files  55 passed (55)"
TESTS_PASSED=$(echo "$TEST_OUTPUT" | grep "Tests " | grep -o '[0-9]* passed' | grep -o '[0-9]*')
TESTS_FAILED=$(echo "$TEST_OUTPUT" | grep "Tests " | grep -o '[0-9]* failed' | grep -o '[0-9]*' || echo 0)
FILES_FAILED=$(echo "$TEST_OUTPUT" | grep "Test Files" | grep -o '[0-9]* failed' | grep -o '[0-9]*' || echo 0)
TOTAL_FAILED=$(( ${TESTS_FAILED:-0} + ${FILES_FAILED:-0} ))
check "Tests: ${TESTS_PASSED:-0} passed, ${TOTAL_FAILED} failed" "$([ "$TOTAL_FAILED" = "0" ] && echo 0 || echo 1)"
echo ""

# ── Summary ────────────────────────────────────────
echo "╔══════════════════════════════════════════════╗"
echo "║  Results: ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$WARN warnings${NC}  ║"
echo "╚══════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}VERIFICATION FAILED${NC} — $FAIL checks need attention"
  exit 1
else
  echo -e "\n${GREEN}ALL CHECKS PASSED${NC}"
  exit 0
fi

# === Trending site tests (added 2026-03-06) ===
echo ""
echo "--- Trending Sites ---"

RESULT=$($CLI "https://reddit.com/r/programming" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "reddit.com/r/programming: $TOKENS tokens" "$([ "$TOKENS" -gt 100 ] && echo 0 || echo 1)"

RESULT=$($CLI "https://github.com/trending" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "github.com/trending: $TOKENS tokens" "$([ "$TOKENS" -gt 50 ] && echo 0 || echo 1)"

RESULT=$($CLI "https://techcrunch.com" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "techcrunch.com: $TOKENS tokens" "$([ "$TOKENS" -gt 200 ] && echo 0 || echo 1)"

RESULT=$($CLI "https://www.producthunt.com" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
METHOD=$(echo "$RESULT" | jq -r '.method // "unknown"')
check "producthunt.com ($METHOD): $TOKENS tokens" "$([ "$TOKENS" -gt 100 ] && echo 0 || echo 1)"

RESULT=$($CLI "https://arxiv.org/abs/2308.08155" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "arxiv.org paper: $TOKENS tokens" "$([ "$TOKENS" -gt 200 ] && echo 0 || echo 1)"

RESULT=$($CLI "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --silent --json 2>/dev/null || echo '{"error":true}')
TOKENS=$(echo "$RESULT" | jq -r '.tokens // 0')
check "youtube.com transcript: $TOKENS tokens" "$([ "$TOKENS" -gt 200 ] && echo 0 || echo 1)"
