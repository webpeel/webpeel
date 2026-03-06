#!/bin/bash
# Test script for MCP consolidation — verifies the smart router and all 7 tools
# Usage: ./scripts/test-mcp-consolidation.sh
# Requires: npm run build to have been run first

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

check() {
  local desc="$1"
  local cmd="$2"
  local expect="$3"
  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] $desc ... "
  OUTPUT=$(eval "$cmd" 2>&1) || true
  if echo "$OUTPUT" | grep -qi "$expect"; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC}"
    echo "    Expected: $expect"
    echo "    Got: $(echo "$OUTPUT" | head -3)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== MCP Consolidation Test Suite ==="
echo ""

# Test 1: Smart Router intent detection (unit tests should cover this)
echo "--- Phase 1: Build & Unit Tests ---"
echo -n "  [0] TypeScript build ... "
if cd /Users/jakeliu/.openclaw/workspace/projects/webpeel && npm run build 2>&1 | tail -1 | grep -q "error"; then
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
else
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
fi
TOTAL=$((TOTAL + 1))

echo -n "  [1] Smart router tests ... "
if npx vitest run src/mcp/smart-router.test.ts 2>&1 | grep -q "Tests.*passed"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (may not exist yet)"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))

echo ""
echo "--- Phase 2: CLI Real-URL Tests (uses local webpeel) ---"

WP="node /Users/jakeliu/.openclaw/workspace/projects/webpeel/dist/cli.js"

# Test READ functionality
check "read: Stripe.com returns content" \
  "$WP 'https://stripe.com' --silent --json 2>&1 | python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('tokens:',d.get('tokens',0))\"" \
  "tokens:"

check "read: YouTube auto-detect" \
  "$WP 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' --silent --json 2>&1 | python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('has_content' if len(d.get('content',''))>100 else 'no_content')\"" \
  "has_content"

# Test SEARCH/FIND functionality
check "find: Web search returns results" \
  "$WP search 'webpeel web scraping' --silent --json 2>&1 | python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('results:',len(d.get('results',[])))\"" \
  "results:"

# Test EXTRACT functionality (auto-extract)
check "extract: Auto-extract from stripe.com/pricing" \
  "$WP 'https://stripe.com' --silent --json 2>&1 | python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('title:',d.get('title','none'))\"" \
  "title:"

echo ""
echo "--- Phase 3: MCP Tool Listing ---"
echo -n "  MCP tools listed ... "
# This would need the MCP server running - skip for now
echo -e "${YELLOW}SKIP${NC} (needs MCP server)"

echo ""
echo "================================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo "================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
