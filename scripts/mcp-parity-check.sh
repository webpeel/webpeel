#!/usr/bin/env bash
# MCP Parity Check — ensures standalone and HTTP MCP endpoints expose the same tools
# and each declared tool has a corresponding handler implementation.

set -euo pipefail

STANDALONE="src/mcp/server.ts"
HTTP_ROUTE="src/server/routes/mcp.ts"
ERRORS=0

echo "MCP Parity Check"
echo "═══════════════════"

# 1. Extract tool names from schema declarations
echo ""
echo "Tool declarations:"
STANDALONE_TOOLS=$(grep -o "name: 'webpeel_[a-z_]*'" "$STANDALONE" | sort -u | sed "s/name: '//;s/'//")
HTTP_TOOLS=$(grep -o "name: 'webpeel_[a-z_]*'" "$HTTP_ROUTE" | sort -u | sed "s/name: '//;s/'//")

echo "  Standalone: $(echo $STANDALONE_TOOLS | tr '\n' ' ')"
echo "  HTTP route: $(echo $HTTP_TOOLS | tr '\n' ' ')"

# 2. Check for tools in standalone but missing from HTTP
for tool in $STANDALONE_TOOLS; do
  if ! echo "$HTTP_TOOLS" | grep -q "^${tool}$"; then
    echo "  ❌ $tool declared in standalone but MISSING from HTTP route"
    ERRORS=$((ERRORS + 1))
  fi
done

# 3. Check for tools in HTTP but missing from standalone
for tool in $HTTP_TOOLS; do
  if ! echo "$STANDALONE_TOOLS" | grep -q "^${tool}$"; then
    echo "  ❌ $tool declared in HTTP route but MISSING from standalone"
    ERRORS=$((ERRORS + 1))
  fi
done

# 4. Check that each HTTP tool has a HANDLER (not just schema)
# A handler is: if (name === 'toolname') or case 'toolname'
echo ""
echo "Handler check (HTTP route):"
for tool in $HTTP_TOOLS; do
  # Look for handler patterns: if (name === 'tool') or name === 'tool' or case 'tool'
  if grep -q "name === '$tool'\|name === \"$tool\"\|case '$tool'" "$HTTP_ROUTE"; then
    echo "  ✅ $tool has handler"
  else
    echo "  ❌ $tool declared in schema but NO HANDLER found!"
    ERRORS=$((ERRORS + 1))
  fi
done

# 5. Check standalone handlers too
echo ""
echo "Handler check (standalone):"
for tool in $STANDALONE_TOOLS; do
  if grep -q "name === '$tool'\|name === \"$tool\"\|case '$tool'" "$STANDALONE"; then
    echo "  ✅ $tool has handler"
  else
    echo "  ❌ $tool declared in schema but NO HANDLER found!"
    ERRORS=$((ERRORS + 1))
  fi
done

# 6. Check legacy tool routing (all 20 old names should map somewhere)
echo ""
echo "Legacy tool routing:"
LEGACY_COUNT=$(grep -c "webpeel_screenshot\|webpeel_search\|webpeel_crawl\|webpeel_map\|webpeel_watch\|webpeel_batch\|webpeel_deep_fetch\|webpeel_youtube\|webpeel_hotels" "$HTTP_ROUTE" 2>/dev/null || echo 0)
if [ "$LEGACY_COUNT" -gt 0 ]; then
  echo "  ✅ Legacy tool names found ($LEGACY_COUNT references)"
else
  echo "  ⚠️  No legacy tool routing found — old MCP clients may break"
fi

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ MCP parity check PASSED"
else
  echo "❌ MCP parity check FAILED ($ERRORS errors)"
  exit 1
fi
