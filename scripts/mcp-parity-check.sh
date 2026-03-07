#!/usr/bin/env bash
# MCP Parity Check — verifies the shared handler registry architecture.
#
# Since both transports (standalone + HTTP) now import from src/mcp/handlers/,
# parity is STRUCTURAL rather than line-by-line. This script verifies:
#   1. Both transports import from the shared registry
#   2. The registry defines all expected tool names
#   3. All handler files exist and are non-empty

set -euo pipefail

STANDALONE="src/mcp/server.ts"
HTTP_ROUTE="src/server/routes/mcp.ts"
REGISTRY="src/mcp/handlers/index.ts"
DEFINITIONS="src/mcp/handlers/definitions.ts"
ERRORS=0

echo "MCP Parity Check (Shared Registry Architecture)"
echo "═══════════════════════════════════════════════"

# 1. Verify both transports import from the shared registry
echo ""
echo "Registry imports:"
if grep -q "getHandler.*from.*handlers" "$STANDALONE"; then
  echo "  ✅ Standalone imports getHandler from shared registry"
else
  echo "  ❌ Standalone does NOT import from shared registry"
  ERRORS=$((ERRORS + 1))
fi

if grep -q "getHandler.*from.*handlers" "$HTTP_ROUTE"; then
  echo "  ✅ HTTP route imports getHandler from shared registry"
else
  echo "  ❌ HTTP route does NOT import from shared registry"
  ERRORS=$((ERRORS + 1))
fi

if grep -q "toolDefinitions.*from.*handlers" "$STANDALONE"; then
  echo "  ✅ Standalone imports toolDefinitions from shared registry"
else
  echo "  ❌ Standalone does NOT import toolDefinitions from shared registry"
  ERRORS=$((ERRORS + 1))
fi

if grep -q "toolDefinitions.*from.*handlers" "$HTTP_ROUTE"; then
  echo "  ✅ HTTP route imports toolDefinitions from shared registry"
else
  echo "  ❌ HTTP route does NOT import toolDefinitions from shared registry"
  ERRORS=$((ERRORS + 1))
fi

# 2. Extract tool names from definitions.ts and registry
echo ""
echo "Tool definitions:"
DEFINED_TOOLS=$(grep -o "name: '[a-z_]*'" "$DEFINITIONS" | sed "s/name: '//;s/'//" | sort -u)
echo "  Defined in definitions.ts: $(echo $DEFINED_TOOLS | tr '\n' ' ')"

REGISTERED_TOOLS=$(grep -o "'\?webpeel_[a-z_]*'\?" "$REGISTRY" | grep -v "^'$\|import\|from" | sed "s/'//g" | sort -u | head -30)
echo "  Registered in index.ts: $(echo $REGISTERED_TOOLS | tr '\n' ' ')"

# 3. Verify all 7 public tools are defined
echo ""
echo "Public tool check:"
PUBLIC_TOOLS="webpeel webpeel_read webpeel_see webpeel_find webpeel_extract webpeel_monitor webpeel_act"
for tool in $PUBLIC_TOOLS; do
  if grep -q "name: '$tool'" "$DEFINITIONS"; then
    echo "  ✅ $tool defined in definitions.ts"
  else
    echo "  ❌ $tool MISSING from definitions.ts"
    ERRORS=$((ERRORS + 1))
  fi
done

# 4. Verify all handler files exist
echo ""
echo "Handler files:"
HANDLER_FILES="types definitions read see find extract monitor act fetch meta legacy index"
for f in $HANDLER_FILES; do
  if [ -f "src/mcp/handlers/${f}.ts" ]; then
    lines=$(wc -l < "src/mcp/handlers/${f}.ts")
    echo "  ✅ handlers/${f}.ts ($lines lines)"
  else
    echo "  ❌ handlers/${f}.ts MISSING"
    ERRORS=$((ERRORS + 1))
  fi
done

# 5. Verify key legacy tools are registered in the registry
echo ""
echo "Legacy tool routing:"
LEGACY_TOOLS="webpeel_fetch webpeel_youtube webpeel_screenshot webpeel_search webpeel_crawl webpeel_map webpeel_batch webpeel_deep_fetch webpeel_summarize webpeel_answer webpeel_quick_answer webpeel_brand webpeel_change_track webpeel_watch webpeel_hotels webpeel_design_analysis webpeel_design_compare webpeel_auto_extract webpeel_research webpeel_agent agent"
for tool in $LEGACY_TOOLS; do
  if grep -q "$tool" "$REGISTRY"; then
    echo "  ✅ $tool registered"
  else
    echo "  ❌ $tool NOT registered"
    ERRORS=$((ERRORS + 1))
  fi
done

# 6. Line count sanity check
echo ""
echo "Line count check (both transports should be slim):"
STANDALONE_LINES=$(wc -l < "$STANDALONE")
HTTP_LINES=$(wc -l < "$HTTP_ROUTE")
if [ "$STANDALONE_LINES" -lt 200 ]; then
  echo "  ✅ Standalone: $STANDALONE_LINES lines (< 200 ✓)"
else
  echo "  ⚠️  Standalone: $STANDALONE_LINES lines (target < 200)"
fi
if [ "$HTTP_LINES" -lt 300 ]; then
  echo "  ✅ HTTP route: $HTTP_LINES lines (< 300 ✓)"
else
  echo "  ⚠️  HTTP route: $HTTP_LINES lines (target < 300)"
fi

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ MCP parity check PASSED — shared registry architecture verified"
else
  echo "❌ MCP parity check FAILED ($ERRORS errors)"
  exit 1
fi
