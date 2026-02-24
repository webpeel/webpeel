#!/bin/bash
# WebPeel Content Consistency Checker
# Catches stale numbers before they ship. Run in CI.
set -e

FAIL=0
WARN=0

fail() { echo "  ❌ $1"; ((FAIL++)); }
warn() { echo "  ⚠️  $1"; ((WARN++)); }
pass() { echo "  ✅ $1"; }

echo "🔍 Content Consistency Check"
echo "============================"

# Get current values from source of truth
VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
TOOL_COUNT=$(grep -c "name: 'webpeel_" src/mcp/server.ts)
TEST_COUNT=$(npm test 2>&1 | grep -oP '\d+ passed' | head -1 | grep -oP '^\d+' || echo "?")

echo ""
echo "Source of truth: v$VERSION, $TOOL_COUNT MCP tools"
echo ""

# Check for OLD tool counts (anything less than current)
echo "1. Stale tool counts"
OLD_TOOLS=$(grep -rn "13 tool\|12 tool\|11 tool\|7 tool\|13 MCP\|12 MCP\|11 MCP\|7 MCP" site/ README.md llms.txt 2>/dev/null | grep -v node_modules | grep -v CHANGELOG || true)
if [ -n "$OLD_TOOLS" ]; then
  fail "Found stale tool counts:"
  echo "$OLD_TOOLS" | head -10
else
  pass "No stale tool counts"
fi

# Check for OLD free tier
echo ""
echo "2. Stale free tier numbers"
OLD_TIER=$(grep -rn "125/week\|125 per week\|125 free\|25/hr\b" site/ README.md llms.txt dashboard/src/ 2>/dev/null | grep -v node_modules | grep -v CHANGELOG || true)
if [ -n "$OLD_TIER" ]; then
  fail "Found stale free tier (should be 500/week, 50/hr):"
  echo "$OLD_TIER" | head -10
else
  pass "Free tier numbers consistent"
fi

# Check version in key files
echo ""
echo "3. Version consistency (should be $VERSION)"
for f in Dockerfile.api; do
  if [ -f "$f" ]; then
    if grep -q "webpeel@$VERSION" "$f"; then
      pass "$f has correct version"
    else
      ACTUAL=$(grep -oP 'webpeel@\S+' "$f" | head -1)
      fail "$f has $ACTUAL (should be webpeel@$VERSION)"
    fi
  fi
done

# Check MCP tool count matches marketing
echo ""
echo "4. MCP tool parity"
LOCAL_TOOLS=$(grep -c "name: 'webpeel_" src/mcp/server.ts)
HOSTED_TOOLS=$(grep -c "name: 'webpeel_" src/server/routes/mcp.ts)
if [ "$LOCAL_TOOLS" -eq "$HOSTED_TOOLS" ]; then
  pass "Local ($LOCAL_TOOLS) = Hosted ($HOSTED_TOOLS) tools"
else
  fail "Local ($LOCAL_TOOLS) != Hosted ($HOSTED_TOOLS) tools"
fi

# Check for leaked secrets patterns
echo ""
echo "5. Secret leak check"
LEAKED=$(grep -rn "wp_live_\|wp_test_\|rnd_\|sk-ant-\|OPENAI_API_KEY=sk-" src/ site/ README.md dashboard/src/ 2>/dev/null | grep -v node_modules | grep -v ".env" | grep -v "example\|placeholder\|YOUR_KEY\|your_key\|xxx" || true)
if [ -n "$LEAKED" ]; then
  fail "Possible secret leak in source:"
  echo "$LEAKED" | head -5
else
  pass "No secrets detected in source"
fi

# Summary
echo ""
echo "============================"
echo "✅ Checks passed"
[ "$FAIL" -gt 0 ] && echo "❌ Failures: $FAIL"
[ "$WARN" -gt 0 ] && echo "⚠️  Warnings: $WARN"
echo ""
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
