#!/bin/bash
# WebPeel Post-Deploy Smoke Test
# Run after every deploy: ./scripts/smoke-test.sh
set -e

API="https://api.webpeel.dev"
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✅ $name"
    ((PASS++))
  else
    echo "  ❌ $name (expected '$expected', got '$actual')"
    ((FAIL++))
  fi
}

echo "🔍 WebPeel Smoke Test"
echo "===================="

# 1. Health
echo ""
echo "1. Health"
HEALTH=$(curl -s "$API/health")
VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
check "API healthy" "healthy" "$STATUS"
echo "  ℹ️  Version: $VERSION"

# 2. Auth enforcement
echo ""
echo "2. Auth Enforcement"
NOAUTH_SEARCH=$(curl -s "$API/v1/search?q=test" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','none'))" 2>/dev/null)
check "Search requires auth" "authentication_required" "$NOAUTH_SEARCH"

NOAUTH_MCP=$(curl -s -X POST "$API/mcp" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('code','none'))" 2>/dev/null)
check "MCP requires auth" "-32001" "$NOAUTH_MCP"

# 3. SSRF protection
echo ""
echo "3. SSRF Protection"
SSRF_LOCAL=$(curl -s "$API/v1/fetch?url=http://localhost:3000" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','none'))" 2>/dev/null)
check "SSRF localhost blocked" "blocked" "$SSRF_LOCAL"

SSRF_META=$(curl -s "$API/v1/fetch?url=http://169.254.169.254/" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','none'))" 2>/dev/null)
check "SSRF metadata blocked" "blocked" "$SSRF_META"

# 4. Basic fetch
echo ""
echo "4. Core Functionality"
FETCH=$(curl -s "$API/v1/fetch?url=https://example.com")
TITLE=$(echo "$FETCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title','?'))" 2>/dev/null)
check "Simple fetch works" "Example Domain" "$TITLE"

# 5. Browser render
RENDER=$(curl -s "$API/v1/fetch?url=https://example.com&render=true")
METHOD=$(echo "$RENDER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('method','?'))" 2>/dev/null)
check "Browser render works" "browser" "$METHOD"

# 6. Websites
echo ""
echo "5. Websites"
SITE=$(curl -s -o /dev/null -w "%{http_code}" "https://webpeel.dev")
check "webpeel.dev" "200" "$SITE"

DASH=$(curl -s -o /dev/null -w "%{http_code}" "https://app.webpeel.dev")
check "app.webpeel.dev" "200\|307" "$DASH"

# 7. Content consistency
echo ""
echo "6. Content Consistency"
PKG_VER=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null)
check "API version matches package.json" "$PKG_VER" "$VERSION"

# Summary
echo ""
echo "===================="
echo "✅ Passed: $PASS"
echo "❌ Failed: $FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "🚨 SMOKE TEST FAILED — DO NOT PROCEED"
  exit 1
else
  echo "✅ ALL CLEAR"
fi
