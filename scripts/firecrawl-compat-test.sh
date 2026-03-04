#!/bin/bash
# ============================================================
# Test Firecrawl → WebPeel migration compatibility
# Usage: ./scripts/firecrawl-compat-test.sh [API_BASE_URL]
#
# Defaults to https://api.webpeel.dev (production).
# Pass a local URL to test against a running local instance:
#   ./scripts/firecrawl-compat-test.sh http://localhost:3000
# ============================================================
set -euo pipefail

API="${1:-https://api.webpeel.dev}"
PASS=0
FAIL=0
WARN=0

# ── helpers ────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass()  { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; WARN=$((WARN+1)); }
info()  { echo "       $1"; }

err_type() {
  # Extract error.type from a JSON response
  echo "$1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
e=d.get('error')
if isinstance(e,dict): print(e.get('type',''))
else: print('')
" 2>/dev/null || echo ""
}

is_rate_limited() {
  [[ "$(err_type "$1")" == "rate_limited" ]]
}

check_field() {
  local label="$1"
  local json="$2"
  local jq_path="$3"
  local expected="$4"   # optional; if empty, just checks existence (non-null)

  # Skip if rate limited
  if is_rate_limited "$json"; then
    warn "$label: SKIPPED (rate limited — rerun with a valid API key)"
    return 0
  fi

  local val
  val=$(echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
keys = '$jq_path'.split('.')
v = d
for k in keys:
    if k == '': continue
    if isinstance(v, dict) and k in v:
        v = v[k]
    else:
        v = None
        break
if v is None:
    print('__MISSING__')
elif isinstance(v, bool):
    print(str(v).lower())
elif isinstance(v, (dict,list)):
    print(type(v).__name__)
else:
    print(str(v)[:80])
" 2>/dev/null || echo "__ERROR__")

  if [[ "$val" == "__MISSING__" || "$val" == "__ERROR__" ]]; then
    fail "$label: field '$jq_path' missing or null"
    return 1
  fi

  if [[ -n "$expected" && "$val" != "$expected" ]]; then
    fail "$label: expected '$expected', got '$val'"
    return 1
  fi

  pass "$label: $jq_path = '$val'"
  return 0
}

echo ""
echo "==========================================="
echo "  WebPeel ↔ Firecrawl Compatibility Audit"
echo "  API: $API"
echo "==========================================="
echo ""

# ──────────────────────────────────────────────────────────
# TEST 1 — POST /v1/scrape (minimal Firecrawl format)
# ──────────────────────────────────────────────────────────
echo "── TEST 1: POST /v1/scrape (basic markdown) ──"
T1=$(curl -s -X POST "$API/v1/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown"]}' 2>/dev/null)

check_field "T1 success flag"    "$T1" "success"             "true"
check_field "T1 data.markdown"   "$T1" "data.markdown"       ""   # just existence
check_field "T1 data.metadata.title"     "$T1" "data.metadata.title"     ""
check_field "T1 data.metadata.sourceURL" "$T1" "data.metadata.sourceURL" ""
check_field "T1 data.metadata.statusCode" "$T1" "data.metadata.statusCode" "200"

# Firecrawl always returns description; check for it
if is_rate_limited "$T1"; then
  warn "T1 data.metadata.description: SKIPPED (rate limited)"
else
  DESC=$(echo "$T1" | python3 -c "
import sys,json; d=json.load(sys.stdin)
desc = d.get('data',{}).get('metadata',{}).get('description')
print('present' if desc is not None else 'missing')
" 2>/dev/null || echo "error")
  if [[ "$DESC" == "missing" ]]; then
    warn "T1 data.metadata.description: MISSING (Firecrawl always returns this field)"
  else
    pass "T1 data.metadata.description: present"
  fi
fi

echo ""

# ──────────────────────────────────────────────────────────
# TEST 2 — POST /v1/scrape with formats: ["markdown","html"]
# ──────────────────────────────────────────────────────────
echo "── TEST 2: POST /v1/scrape with formats: [markdown, html] ──"
T2=$(curl -s -X POST "$API/v1/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown","html"]}' 2>/dev/null)

check_field "T2 success"      "$T2" "success"       "true"
check_field "T2 data.markdown" "$T2" "data.markdown"  ""
check_field "T2 data.html"    "$T2" "data.html"      ""
echo ""

# ──────────────────────────────────────────────────────────
# TEST 3 — POST /v1/scrape with formats: ["links"]
# ──────────────────────────────────────────────────────────
echo "── TEST 3: POST /v1/scrape with formats: [links] ──"
T3=$(curl -s -X POST "$API/v1/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["links"]}' 2>/dev/null)

check_field "T3 success"      "$T3" "success"      "true"
check_field "T3 data.links"   "$T3" "data.links"   "list"

# Firecrawl omits markdown when not in formats; check for extra markdown
if ! is_rate_limited "$T3"; then
  EXTRA_MD=$(echo "$T3" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('yes' if 'markdown' in d.get('data',{}) else 'no')
" 2>/dev/null)
  if [[ "$EXTRA_MD" == "yes" ]]; then
    warn "T3 data.markdown: present even though formats=[links] only — Firecrawl would omit it"
  fi
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 4 — POST /v1/crawl (async start)
# ──────────────────────────────────────────────────────────
echo "── TEST 4: POST /v1/crawl (async) ──"
T4=$(curl -s -X POST "$API/v1/crawl" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "limit": 3}' 2>/dev/null)

T4_ERR_TYPE=$(echo "$T4" | python3 -c "
import sys,json; d=json.load(sys.stdin)
e = d.get('error')
if isinstance(e, dict): print(e.get('type',''))
else: print('')
" 2>/dev/null || echo "")

JOB_ID=""
if [[ "$T4_ERR_TYPE" == "rate_limited" ]]; then
  warn "T4 /v1/crawl: rate limited — skipping (run with valid API key)"
else
  check_field "T4 success"  "$T4" "success"  "true"
  check_field "T4 id"       "$T4" "id"       ""
  JOB_ID=$(echo "$T4" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(d.get('id',''))
" 2>/dev/null || echo "")
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 5 — GET /v1/crawl/:id (poll job)
# ──────────────────────────────────────────────────────────
echo "── TEST 5: GET /v1/crawl/:id ──"
if [[ -n "$JOB_ID" ]]; then
  sleep 6
  T5=$(curl -s "$API/v1/crawl/$JOB_ID" 2>/dev/null)
  check_field "T5 success"   "$T5" "success"   "true"
  check_field "T5 status"    "$T5" "status"    ""
  check_field "T5 completed" "$T5" "completed" ""
  check_field "T5 total"     "$T5" "total"     ""
  check_field "T5 creditsUsed" "$T5" "creditsUsed" ""
  check_field "T5 data"      "$T5" "data"      "list"

  # Check crawl item structure (Firecrawl format per item)
  T5_ITEM=$(echo "$T5" | python3 -c "
import sys,json; d=json.load(sys.stdin)
items = d.get('data',[])
print(json.dumps(items[0]) if items else '{}')
" 2>/dev/null || echo "{}")
  if [[ "$T5_ITEM" != "{}" ]]; then
    check_field "T5 item.markdown"          "$T5_ITEM" "markdown"              ""
    check_field "T5 item.metadata.title"    "$T5_ITEM" "metadata.title"        ""
    check_field "T5 item.metadata.sourceURL" "$T5_ITEM" "metadata.sourceURL"   ""
    check_field "T5 item.metadata.statusCode" "$T5_ITEM" "metadata.statusCode" "200"
  fi
else
  warn "T5 skipped (no job ID from T4)"
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 6 — POST /v1/map
# ──────────────────────────────────────────────────────────
echo "── TEST 6: POST /v1/map ──"
T6=$(curl -s -X POST "$API/v1/map" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}' 2>/dev/null)

T6_SUCCESS=$(echo "$T6" | python3 -c "
import sys,json; d=json.load(sys.stdin); print(str(d.get('success','')).lower())
" 2>/dev/null || echo "")

T6_ERR_TYPE=$(echo "$T6" | python3 -c "
import sys,json; d=json.load(sys.stdin)
e = d.get('error')
if isinstance(e, dict): print(e.get('type',''))
else: print('')
" 2>/dev/null || echo "")

if [[ "$T6_ERR_TYPE" == "rate_limited" ]]; then
  warn "T6 /v1/map: rate limited — skipping functional check (run with valid API key for real test)"
elif [[ "$T6_SUCCESS" == "true" ]]; then
  pass "T6 /v1/map: success=true"
  check_field "T6 links" "$T6" "links" "list"
  LINK_COUNT=$(echo "$T6" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(len(d.get('links',[])))
" 2>/dev/null || echo "0")
  if [[ "$LINK_COUNT" == "0" ]]; then
    warn "T6 /v1/map returned 0 links for example.com — Firecrawl returns at least the root URL; may indicate sitemap/crawler gap"
  else
    info "T6 returned $LINK_COUNT link(s)"
  fi
else
  fail "T6 /v1/map: unexpected failure — $T6"
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 7 — POST /v2/scrape
# ──────────────────────────────────────────────────────────
echo "── TEST 7: POST /v2/scrape ──"
T7=$(curl -s -X POST "$API/v2/scrape" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown"]}' 2>/dev/null)

T7_ERR_TYPE=$(echo "$T7" | python3 -c "
import sys,json; d=json.load(sys.stdin)
e = d.get('error')
if isinstance(e, dict): print(e.get('type',''))
else: print('')
" 2>/dev/null || echo "")

if [[ "$T7_ERR_TYPE" == "rate_limited" ]]; then
  warn "T7 /v2/scrape: rate limited — skipping (run with valid API key for real test)"
else
  check_field "T7 success"          "$T7" "success"          "true"
  check_field "T7 data.markdown"    "$T7" "data.markdown"    ""
  check_field "T7 data.metadata.sourceURL" "$T7" "data.metadata.sourceURL" ""
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 8 — Auth error format (Firecrawl vs WebPeel)
# ──────────────────────────────────────────────────────────
echo "── TEST 8: Auth error format (bad API key) ──"
T8=$(curl -s -X POST "$API/v1/scrape" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer fc-invalid-bad-key' \
  -d '{"url": "https://example.com"}' 2>/dev/null)

T8_RATE=$(err_type "$T8")
if [[ "$T8_RATE" == "rate_limited" ]]; then
  warn "T8 auth error format: SKIPPED (rate limited)"
else
  T8_SUCCESS=$(echo "$T8" | python3 -c "
import sys,json; d=json.load(sys.stdin); print(str(d.get('success','')).lower())
" 2>/dev/null || echo "")
  T8_ERROR_TYPE=$(echo "$T8" | python3 -c "
import sys,json; d=json.load(sys.stdin)
e = d.get('error')
print('string' if isinstance(e,str) else 'object' if isinstance(e,dict) else 'unknown')
" 2>/dev/null || echo "")

  if [[ "$T8_SUCCESS" == "false" ]]; then
    pass "T8 auth error: success=false"
  else
    fail "T8 auth error: expected success=false"
  fi

  if [[ "$T8_ERROR_TYPE" == "string" ]]; then
    pass "T8 auth error format: Firecrawl-compatible (error is a string)"
  elif [[ "$T8_ERROR_TYPE" == "object" ]]; then
    warn "T8 auth error format: NOT Firecrawl-compatible — error is an object {type,message,...} instead of a plain string. Auth middleware fires before compat route, so Firecrawl-format error strings are NOT returned for auth failures."
  else
    warn "T8 auth error format: unexpected ($T8_ERROR_TYPE)"
  fi
fi
echo ""

# ──────────────────────────────────────────────────────────
# TEST 9 — Validation error format (compat route)
# ──────────────────────────────────────────────────────────
echo "── TEST 9: Validation error format (missing URL) ──"
T9=$(curl -s -X POST "$API/v1/scrape" \
  -H 'Content-Type: application/json' \
  -d '{}' 2>/dev/null)

if is_rate_limited "$T9"; then
  warn "T9 validation error: SKIPPED (rate limited)"
else
  T9_ERROR_TYPE=$(echo "$T9" | python3 -c "
import sys,json; d=json.load(sys.stdin)
e = d.get('error')
print('string' if isinstance(e,str) else 'object' if isinstance(e,dict) else 'unknown')
" 2>/dev/null || echo "")

  if [[ "$T9_ERROR_TYPE" == "string" ]]; then
    pass "T9 validation error: Firecrawl-compatible (error is a string)"
  else
    fail "T9 validation error: error type is '$T9_ERROR_TYPE', expected string"
  fi
fi
echo ""

# ──────────────────────────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────────────────────────
echo "==========================================="
echo "  RESULTS"
echo "==========================================="
echo -e "${GREEN}PASS: $PASS${NC}"
echo -e "${YELLOW}WARN: $WARN${NC}"
echo -e "${RED}FAIL: $FAIL${NC}"
echo ""

echo "== Compatibility Gap Summary =="
echo ""
echo "GAP 1 [AUTH ERROR FORMAT] — INCOMPATIBLE"
echo "  Firecrawl: {success: false, error: \"string message\"}"
echo "  WebPeel:   {success: false, error: {type,message,hint,docs}, metadata:{requestId}}"
echo "  Impact: Code that parses error.message on auth failures will break."
echo "  Fix: Wrap auth middleware error for /v1/* routes to emit Firecrawl error format."
echo ""
echo "GAP 2 [metadata.description] — MINOR"
echo "  Firecrawl: always includes description (empty string if none)"
echo "  WebPeel:   sometimes omits description for pages with no <meta description>"
echo "  Impact: Code doing 'result.data.metadata.description' may get undefined."
echo "  Root cause: ...result.metadata spread can overwrite description:'' with undefined."
echo "  Fix: Ensure description defaults to '' even after spread."
echo ""
echo "GAP 3 [markdown always returned] — MINOR"
echo "  Firecrawl: only returns markdown if 'markdown' is in formats[]"
echo "  WebPeel:   always returns markdown regardless of formats[] requested"
echo "  Impact: Extra data in response — not a breaking change, just extra bandwidth."
echo ""
echo "GAP 4 [/v1/map returns empty] — FUNCTIONAL GAP"
echo "  Firecrawl: returns sitemap URLs for most sites"
echo "  WebPeel:   returned 0 links for example.com and news.ycombinator.com"
echo "  Impact: /v1/map may not be usable as a drop-in for Firecrawl's map endpoint."
echo "  Likely cause: mapDomain() relies on sitemap.xml; anonymous rate limits may restrict."
echo ""
echo "GAP 5 [crawl item 'description'] — MINOR"
echo "  Firecrawl: crawl data items include metadata.description"
echo "  WebPeel:   crawl items explicitly set description: '' in their metadata object"
echo "  Status: Observed as '' in crawl results — COMPATIBLE (empty string, not missing)"
echo ""

exit $((FAIL > 0 ? 1 : 0))
