#!/usr/bin/env bash
# CLI DX Test — simulates a new user's first experience
# Tests verb aliases, --format flag, error messages, doctor command

set -euo pipefail

CLI="node dist/cli.js"
PASS=0
FAIL=0
TESTS=0

check() {
  TESTS=$((TESTS + 1))
  local desc="$1"
  local result="$2"
  local expected="$3"

  if echo "$result" | grep -qi "$expected"; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ $desc"
    echo "     Expected: $expected"
    echo "     Got: $(echo "$result" | head -1 | cut -c1-100)"
  fi
}

echo "CLI DX Test — New User Experience"
echo "═══════════════════════════════════"

# ── Verb-first aliases ──
echo ""
echo "▸ Verb-first aliases"

for verb in fetch get scrape peel; do
  RESULT=$($CLI $verb "https://example.com" --silent --json 2>&1 || true)
  check "webpeel $verb <url>" "$RESULT" "example.com"
done

# ── --format flag ──
echo ""
echo "▸ --format flag"

RESULT=$($CLI "https://example.com" --format text --silent 2>&1 || true)
check "--format text returns plain text" "$RESULT" "Example Domain"

RESULT=$($CLI "https://example.com" --format html --silent 2>&1 || true)
check "--format html returns HTML" "$RESULT" "<html\|DOCTYPE\|<head"

RESULT=$($CLI "https://example.com" --format json --silent 2>&1 || true)
check "--format json returns JSON object" "$RESULT" '"url"'

RESULT=$($CLI "https://example.com" --format markdown --silent 2>&1 || true)
check "--format markdown returns content" "$RESULT" "Example Domain"

RESULT=$($CLI "https://example.com" --format bogus --silent 2>&1 || true)
check "--format bogus shows error" "$RESULT" "Unknown format"

# ── Backward compat ──
echo ""
echo "▸ Backward compatibility"

RESULT=$($CLI "https://example.com" --json --silent 2>&1 || true)
check "old --json flag" "$RESULT" '"url"'

RESULT=$($CLI "https://example.com" --text --silent 2>&1 || true)
check "old --text flag" "$RESULT" "Example Domain"

RESULT=$($CLI "https://example.com" --html --silent 2>&1 || true)
check "old --html flag" "$RESULT" "<html\|DOCTYPE\|<head"

# ── Smart error messages ──
echo ""
echo "▸ Smart error messages"

RESULT=$($CLI curl --silent 2>&1 || true)
check "verb mistake → helpful hint" "$RESULT" "Did you mean\|No verb needed\|webpeel"

RESULT=$($CLI example.com --silent 2>&1 || true)
check "missing protocol → suggest https://" "$RESULT" "https://\|protocol\|Invalid URL"

# ── Doctor command ──
echo ""
echo "▸ Doctor command"

RESULT=$($CLI doctor 2>&1 || true)
check "doctor shows version" "$RESULT" "Version"
check "doctor checks API health" "$RESULT" "API Health\|healthy\|Health"
check "doctor checks API key" "$RESULT" "API Key\|Valid\|Key"
check "doctor runs fetch test" "$RESULT" "Fetch Test\|fetch\|Test"

# ── read subcommand NOT broken ──
echo ""
echo "▸ Subcommand integrity"

RESULT=$($CLI read --help 2>&1 || true)
check "'read' subcommand still works (not eaten by verb alias)" "$RESULT" "Read a page\|reader\|clean"

# ── Results ──
echo ""
echo "═══════════════════════════════════"
echo "  Results: $PASS passed  $FAIL failed  ($TESTS total)"
echo "═══════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
