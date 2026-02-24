#!/bin/bash
# Single Source of Truth — updates all marketing/docs from code reality
# Run after ANY change to tool count, test count, version, or free tier
set -e

echo "📊 Computing current values from source code..."

VERSION=$(node -p "require('./package.json').version")
TOOL_COUNT=$(grep -c "name: 'webpeel_" src/mcp/server.ts)
LICENSE=$(node -p "require('./package.json').license")

echo "  Version: $VERSION"
echo "  MCP tools: $TOOL_COUNT"
echo "  License: $LICENSE"
echo ""

# Run tests to get count (cached if recent)
echo "  Running tests for count..."
TEST_OUTPUT=$(npm test 2>&1 | grep -oP '\d+ passed' | head -1)
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -oP '^\d+')
echo "  Tests: $TEST_COUNT passing"
echo ""

echo "📝 Files to check/update:"
echo ""

ISSUES=0

check_file() {
  local file="$1" pattern="$2" expected="$3" label="$4"
  if [ ! -f "$file" ]; then return; fi
  if grep -q "$pattern" "$file" 2>/dev/null; then
    FOUND=$(grep -c "$pattern" "$file")
    echo "  ⚠️  $file: found '$pattern' ($FOUND occurrences) — should be '$expected' [$label]"
    ((ISSUES++))
  fi
}

# Stale tool counts
for old in 7 11 12 13 14 15 16 17; do
  if [ "$old" -lt "$TOOL_COUNT" ]; then
    check_file "site/index.html" "\b${old} tool\|\b${old} MCP" "$TOOL_COUNT tools" "tool count"
    check_file "README.md" "\b${old} tool\|\b${old} MCP" "$TOOL_COUNT tools" "tool count"
    check_file "llms.txt" "\b${old} tool\|\b${old} MCP" "$TOOL_COUNT tools" "tool count"
    for blog in site/blog/*.html; do
      check_file "$blog" "\b${old} tool\|\b${old} MCP" "$TOOL_COUNT tools" "tool count"
    done
  fi
done

# Dockerfile version
check_file "Dockerfile.api" "webpeel@" "" "version pin"
DOCKER_VER=$(grep -o 'webpeel@[0-9.]*' Dockerfile.api 2>/dev/null || echo "none")
if [ "$DOCKER_VER" != "webpeel@$VERSION" ]; then
  echo "  ⚠️  Dockerfile.api: has $DOCKER_VER (should be webpeel@$VERSION)"
  ((ISSUES++))
fi

echo ""
if [ "$ISSUES" -gt 0 ]; then
  echo "❌ Found $ISSUES inconsistencies. Fix them before releasing."
  exit 1
else
  echo "✅ All constants consistent across the codebase."
fi
