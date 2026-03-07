#!/usr/bin/env bash
# Pre-publish gate — run this before every npm publish
# Catches: build errors, test failures, MCP sync issues, CLI DX regressions, live API failures

set -euo pipefail

ERRORS=0
STEP=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo "[$STEP] $1"
  echo "────────────────────────────────────"
}

fail() {
  ERRORS=$((ERRORS + 1))
  echo "  ❌ FAILED: $1"
}

pass() {
  echo "  ✅ $1"
}

echo "══════════════════════════════════════"
echo "  WebPeel Pre-Publish Gate"
echo "══════════════════════════════════════"

# 1. Build
step "TypeScript build"
if npm run build 2>&1 | tail -3 | grep -qi "error"; then
  fail "Build has TypeScript errors"
else
  pass "Build clean"
fi

# 2. Tests
step "Unit tests"
TEST_OUTPUT=$(npm test 2>&1 | tail -5)
PASSED=$(echo "$TEST_OUTPUT" | grep -o "[0-9]* passed" | head -1)
FAILED=$(echo "$TEST_OUTPUT" | grep -o "[0-9]* failed" | head -1)
if echo "$TEST_OUTPUT" | grep -q "failed"; then
  fail "Tests: $PASSED, $FAILED"
else
  pass "Tests: $PASSED"
fi

# 3. MCP parity
step "MCP parity check"
if bash scripts/mcp-parity-check.sh 2>&1 | tail -1 | grep -q "PASSED"; then
  pass "MCP parity"
else
  fail "MCP tools out of sync (run: bash scripts/mcp-parity-check.sh)"
fi

# 4. CLI DX
step "CLI DX test"
DX_OUTPUT=$(bash scripts/cli-dx-test.sh 2>&1)
DX_FAIL=$(echo "$DX_OUTPUT" | grep -c "❌" || true)
DX_PASS=$(echo "$DX_OUTPUT" | grep -c "✅" || true)
if [ "$DX_FAIL" -gt 0 ]; then
  fail "CLI DX: $DX_PASS passed, $DX_FAIL failed"
  echo "$DX_OUTPUT" | grep "❌"
else
  pass "CLI DX: $DX_PASS passed"
fi

# 5. e2e verify (if available, uses live API)
step "E2E verification"
if [ -f scripts/e2e-verify.sh ]; then
  E2E_OUTPUT=$(bash scripts/e2e-verify.sh 2>&1)
  E2E_FAIL=$(echo "$E2E_OUTPUT" | grep -c "FAIL\|❌" || true)
  E2E_PASS=$(echo "$E2E_OUTPUT" | grep -o "[0-9]* passed" | head -1)
  if [ "$E2E_FAIL" -gt 0 ]; then
    fail "E2E: some checks failed"
  else
    pass "E2E: $E2E_PASS"
  fi
else
  echo "  ⚠️  scripts/e2e-verify.sh not found — skipping"
fi

# 6. Version check
step "Version sanity"
PKG_VERSION=$(node -p "require('./package.json').version")
DOCKER_VERSION=$(grep "webpeel@" Dockerfile.api | grep -o "[0-9]*\.[0-9]*\.[0-9]*" | head -1)
if [ "$PKG_VERSION" = "$DOCKER_VERSION" ]; then
  pass "package.json ($PKG_VERSION) matches Dockerfile.api ($DOCKER_VERSION)"
else
  fail "Version mismatch: package.json=$PKG_VERSION, Dockerfile.api=$DOCKER_VERSION"
fi

# 7. No debug artifacts
step "Debug artifact scan"
DEBUG_HITS=$(grep -rn "console\.log.*DEBUG\|console\.log.*TODO\|debugger;" src/ --include="*.ts" 2>/dev/null | grep -v "node_modules\|test\|\.test\." | head -5)
if [ -n "$DEBUG_HITS" ]; then
  fail "Debug artifacts found:"
  echo "$DEBUG_HITS" | head -5
else
  pass "No debug artifacts"
fi

# Results
echo ""
echo "══════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo "  ✅ ALL GATES PASSED — safe to publish"
  echo ""
  echo "  Next: npm version patch && npm publish"
else
  echo "  ❌ $ERRORS GATE(S) FAILED — do NOT publish"
  echo ""
  echo "  Fix the failures above, then re-run:"
  echo "  bash scripts/pre-publish.sh"
fi
echo "══════════════════════════════════════"

exit $ERRORS
