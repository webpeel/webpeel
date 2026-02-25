#!/bin/bash
# verify-deploy.sh — Run after every deploy to catch half-finished work
# This script verifies the FULL chain works, not just individual pieces.
# If anything fails, it exits with code 1 and tells you exactly what's broken.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo -e "${GREEN}✅ $desc${NC}"
    PASS=$((PASS + 1))
  elif [ "$result" = "warn" ]; then
    echo -e "${YELLOW}⚠️  $desc${NC}"
    WARN=$((WARN + 1))
  else
    echo -e "${RED}❌ $desc${NC}"
    FAIL=$((FAIL + 1))
  fi
}

echo "========================================"
echo "  WebPeel Deploy Verification"
echo "========================================"
echo ""

# 1. CLI has API key configured
CLI_CONFIG="$HOME/.webpeel/config.json"
if [ -f "$CLI_CONFIG" ]; then
  HAS_KEY=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CLI_CONFIG','utf8')); console.log(c.apiKey ? 'yes' : 'no')" 2>/dev/null)
  if [ "$HAS_KEY" = "yes" ]; then
    TIER=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CLI_CONFIG','utf8')); console.log(c.planTier || 'unknown')" 2>/dev/null)
    check "CLI authenticated (tier: $TIER)" "ok"
  else
    check "CLI has no API key — run 'webpeel login' or set WEBPEEL_API_KEY" "fail"
  fi
else
  check "CLI config missing ($CLI_CONFIG)" "fail"
fi

# 2. CLI can fetch without rate limit
WP="$(dirname "$0")/../dist/cli.js"
if [ -f "$WP" ]; then
  CLI_OUTPUT=$(node "$WP" "https://example.com" --silent --json 2>/dev/null)
  HAS_CONTENT=$(echo "$CLI_OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.content&&j.content.length>10?'ok':'fail')}catch{console.log('fail')}})" 2>/dev/null)
  check "CLI fetch works (no rate limit)" "$HAS_CONTENT"
else
  check "CLI not built (run npm run build)" "fail"
fi

# 3. TypeScript compiles
TSC_OUTPUT=$(cd "$(dirname "$0")/.." && npx tsc --noEmit 2>&1)
if [ $? -eq 0 ]; then
  check "TypeScript compiles (0 errors)" "ok"
else
  check "TypeScript has errors" "fail"
fi

# 4. Tests pass (skip if --quick flag)
if [ "${1:-}" != "--quick" ]; then
  TEST_OUTPUT=$(cd "$(dirname "$0")/.." && timeout 120 npx vitest run 2>&1 | tail -5)
  TESTS_PASS=$(echo "$TEST_OUTPUT" | grep -c "passed" 2>/dev/null || true)
  if [ "$TESTS_PASS" -gt 0 ]; then
    TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | head -1)
    check "Tests pass ($TEST_COUNT)" "ok"
  else
    check "Tests failing" "fail"
  fi
else
  check "Tests skipped (--quick mode)" "warn"
fi

# 5. API health (if deployed)
API_HEALTH=$(curl -s --max-time 5 "https://api.webpeel.dev/health" 2>/dev/null)
if [ -n "$API_HEALTH" ]; then
  API_VERSION=$(echo "$API_HEALTH" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.version)}catch{console.log('unknown')}" 2>/dev/null)
  LOCAL_VERSION=$(node -e "console.log(require('$(dirname "$0")/../package.json').version)" 2>/dev/null)
  if [ "$API_VERSION" = "$LOCAL_VERSION" ]; then
    check "API version matches local ($API_VERSION)" "ok"
  else
    check "API version mismatch (API: $API_VERSION, local: $LOCAL_VERSION) — deploy may be in progress" "warn"
  fi
  
  # Check for request ID header
  HAS_REQ_ID=$(curl -sI --max-time 5 "https://api.webpeel.dev/health" 2>/dev/null | grep -ci "x-request-id")
  if [ "$HAS_REQ_ID" -gt 0 ]; then
    check "API returns X-Request-Id headers" "ok"
  else
    check "API missing X-Request-Id headers" "warn"
  fi
else
  check "API unreachable" "warn"
fi

# 6. Landing page
SITE_STATUS=$(curl -s -o /dev/null --max-time 5 -w "%{http_code}" "https://webpeel.dev" 2>/dev/null)
if [ "$SITE_STATUS" = "200" ]; then
  check "Landing page (webpeel.dev)" "ok"
else
  check "Landing page returned $SITE_STATUS" "fail"
fi

# 7. Error docs page
DOCS_STATUS=$(curl -s -o /dev/null --max-time 5 -w "%{http_code}" "https://webpeel.dev/docs/errors" 2>/dev/null)
if [ "$DOCS_STATUS" = "200" ]; then
  check "Error docs page" "ok"
else
  check "Error docs page returned $DOCS_STATUS" "warn"
fi

# 8. npm package version
NPM_VERSION=$(npm view webpeel version 2>/dev/null)
LOCAL_VERSION=$(node -e "console.log(require('$(dirname "$0")/../package.json').version)" 2>/dev/null)
if [ "$NPM_VERSION" = "$LOCAL_VERSION" ]; then
  check "npm version matches local ($NPM_VERSION)" "ok"
else
  check "npm version mismatch (npm: $NPM_VERSION, local: $LOCAL_VERSION)" "warn"
fi

# Summary
echo ""
echo "========================================"
echo -e "  ${GREEN}$PASS passed${NC} | ${RED}$FAIL failed${NC} | ${YELLOW}$WARN warnings${NC}"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}DEPLOY VERIFICATION FAILED — fix the issues above before shipping.${NC}"
  exit 1
fi

echo -e "\n${GREEN}All checks passed.${NC}"
