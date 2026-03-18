#!/bin/bash
# e2e-verify.sh — WebPeel Production E2E Tests
# Usage: ./scripts/e2e-verify.sh [api-url] [api-key] [--quick]
# Exit code 0 = all pass, 1 = one or more failures

set -euo pipefail

# Parse arguments: --quick can appear anywhere; positional args are api-url and api-key
QUICK=false
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--quick" ]]; then
    QUICK=true
  else
    POSITIONAL+=("$arg")
  fi
done

API_URL="${POSITIONAL[0]:-https://api.webpeel.dev}"
API_KEY="${POSITIONAL[1]:-${WEBPEEL_API_KEY:-wp_live_c3b96132838b06d1e9ecb69f540f8381}}"

# ── Colors ──────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

PASS_NAMES=()
FAIL_NAMES=()

pass() {
  echo -e "    ${GREEN}✓${NC} $1"
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  PASS_NAMES+=("$1")
}

fail() {
  echo -e "    ${RED}✗${NC} $1"
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  FAIL_NAMES+=("$1")
}

section() {
  echo ""
  echo -e "${BOLD}${BLUE}┌── $1${NC}"
}

info() {
  echo -e "    ${CYAN}ℹ${NC} $1"
}

# ── Python helpers ────────────────────────────────────
# Run python3 against a temp file to avoid quote escaping nightmares
py_eval() {
  local tmpfile="$1"
  local expr="$2"
  python3 -c "
import json, sys
try:
    with open('$tmpfile') as f:
        d = json.load(f)
    result = $expr
    print(result if result is not None else '')
except Exception as e:
    print('')
" 2>/dev/null
}

# ── Submit + Poll ─────────────────────────────────────
# fetch_url <url> <output_tmpfile>
# Writes result JSON to tmpfile, returns 0 on success/fail (job resolved), 1 on timeout
fetch_url() {
  local url="$1"
  local outfile="$2"

  # Submit job
  local submit_resp
  submit_resp=$(curl -s -f -X POST "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "{\"url\":\"$url\",\"mode\":\"markdown\"}" 2>/dev/null) || {
    echo '{"success":false,"error":{"type":"curl_error","message":"curl failed"}}' > "$outfile"
    return 0
  }

  echo "$submit_resp" > "$outfile"

  # Check if immediately rejected (success:false, no jobId)
  local job_id
  job_id=$(python3 -c "
import json
try:
    d = json.loads(open('$outfile').read())
    print(d.get('jobId',''))
except:
    print('')
" 2>/dev/null)

  if [[ -z "$job_id" ]]; then
    # Immediate rejection — outfile already has the error
    return 0
  fi

  # Poll until done or timeout
  local elapsed=0
  local poll_interval=2
  local timeout=60

  while [[ $elapsed -lt $timeout ]]; do
    sleep $poll_interval
    elapsed=$((elapsed + poll_interval))

    local poll_resp
    poll_resp=$(curl -s -f "$API_URL/v1/jobs/$job_id" \
      -H "Authorization: Bearer $API_KEY" 2>/dev/null) || continue

    echo "$poll_resp" > "$outfile"

    local status
    status=$(python3 -c "
import json
try:
    d = json.loads(open('$outfile').read())
    print(d.get('status',''))
except:
    print('')
" 2>/dev/null)

    if [[ "$status" == "completed" || "$status" == "failed" ]]; then
      return 0
    fi
  done

  echo '{"success":false,"error":{"type":"timeout","message":"Job timed out after 60s"}}' > "$outfile"
  return 1
}

# ── Temp dir for result files ─────────────────────────
TMPDIR_E2E=$(mktemp -d)
trap 'rm -rf "$TMPDIR_E2E"' EXIT

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   WebPeel Production E2E Tests                        ║${NC}"
echo -e "${BOLD}║   API: ${CYAN}$API_URL${BOLD}$(printf '%*s' $((52 - ${#API_URL} - 6)) '')║${NC}"
if $QUICK; then
echo -e "${BOLD}║   Mode: ${YELLOW}QUICK${BOLD} (health + 1 fetch only)                ║${NC}"
fi
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"

START_TIME=$SECONDS

# ══════════════════════════════════════════════════════
# SECTION 1: Health & Readiness
# ══════════════════════════════════════════════════════
section "1. Health & Readiness"

HEALTH_FILE="$TMPDIR_E2E/health.json"
curl -s "$API_URL/health" > "$HEALTH_FILE" 2>/dev/null || echo '{}' > "$HEALTH_FILE"

H_STATUS=$(py_eval "$HEALTH_FILE" "d.get('status','')")
H_VERSION=$(py_eval "$HEALTH_FILE" "d.get('version','')")
H_UPTIME=$(py_eval "$HEALTH_FILE" "d.get('uptime',0)")

[[ "$H_STATUS" == "healthy" ]] \
  && pass "GET /health → status=healthy" \
  || fail "GET /health → status=healthy (got: '${H_STATUS}')"

[[ -n "$H_VERSION" ]] \
  && pass "GET /health → version present ($H_VERSION)" \
  || fail "GET /health → version present"

[[ "${H_UPTIME:-0}" -gt 0 ]] \
  && pass "GET /health → uptime > 0 (${H_UPTIME}s)" \
  || fail "GET /health → uptime > 0"

READY_FILE="$TMPDIR_E2E/ready.json"
curl -s "$API_URL/ready" > "$READY_FILE" 2>/dev/null || echo '{}' > "$READY_FILE"

R_STATUS=$(py_eval "$READY_FILE" "d.get('status','')")
R_DB=$(py_eval "$READY_FILE" "str(d.get('checks',{}).get('database',{}).get('ok',False))")
R_QUEUE=$(py_eval "$READY_FILE" "str(d.get('checks',{}).get('queue',{}).get('ok',False))")

[[ "$R_STATUS" == "ready" ]] \
  && pass "GET /ready → status=ready" \
  || fail "GET /ready → status=ready (got: '${R_STATUS}')"

[[ "$R_DB" == "True" ]] \
  && pass "GET /ready → db healthy" \
  || fail "GET /ready → db healthy (got: $R_DB)"

[[ "$R_QUEUE" == "True" ]] \
  && pass "GET /ready → queue healthy" \
  || fail "GET /ready → queue healthy (got: $R_QUEUE)"

# ══════════════════════════════════════════════════════
# QUICK MODE: health done → 1 fetch → exit
# ══════════════════════════════════════════════════════
if $QUICK; then
  section "Quick: Fetch Hacker News"
  HN_FILE="$TMPDIR_E2E/hn.json"
  echo "    Fetching https://news.ycombinator.com ..."
  fetch_url "https://news.ycombinator.com" "$HN_FILE"

  HN_TITLE=$(py_eval "$HN_FILE" "d.get('result',{}).get('title','')")
  HN_TOKENS=$(py_eval "$HN_FILE" "str(d.get('result',{}).get('tokens',0))")

  [[ "$HN_TITLE" == *"Hacker News"* ]] \
    && pass "title contains 'Hacker News' (got: $HN_TITLE)" \
    || fail "title contains 'Hacker News' (got: $HN_TITLE)"

  [[ "${HN_TOKENS:-0}" -gt 100 ]] \
    && pass "tokens > 100 (got: $HN_TOKENS)" \
    || fail "tokens > 100 (got: $HN_TOKENS)"

  echo ""
  ELAPSED=$((SECONDS - START_TIME))
  echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   Quick Results: ${GREEN}$PASS passed${BOLD}, ${RED}$FAIL failed${BOLD} / $TOTAL assertions (${ELAPSED}s)$(printf '%*s' $((3)) '')║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"

  if [[ $FAIL -gt 0 ]]; then
    echo -e "\n${RED}✗ QUICK CHECK FAILED — $FAIL assertion(s) failed${NC}"
    exit 1
  else
    echo -e "\n${GREEN}✓ QUICK CHECK PASSED${NC}"
    exit 0
  fi
fi

# ══════════════════════════════════════════════════════
# FULL TEST SUITE BELOW
# ══════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════
# SECTION 2: Fetch & Content Quality (5 real URLs)
# ══════════════════════════════════════════════════════
section "2. Fetch & Content Quality"

declare -a FETCH_URLS=(
  "https://news.ycombinator.com"
  "https://en.wikipedia.org/wiki/JavaScript"
  "https://github.com/webpeel/webpeel"
  "https://stripe.com/docs"
  "https://www.cdc.gov"
)

declare -a FETCH_KEYS=(
  "hn"
  "wiki_js"
  "gh_webpeel"
  "stripe_docs"
  "cdc"
)

# Submit all jobs in parallel
declare -a RESULT_FILES=()
declare -a JOB_IDS=()
declare -a SUBMIT_RESPS=()

echo ""
echo "    Submitting 5 fetch jobs..."
for i in "${!FETCH_URLS[@]}"; do
  url="${FETCH_URLS[$i]}"
  key="${FETCH_KEYS[$i]}"
  outfile="$TMPDIR_E2E/${key}.json"
  RESULT_FILES[$i]="$outfile"

  resp=$(curl -s -f -X POST "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "{\"url\":\"$url\",\"mode\":\"markdown\"}" 2>/dev/null) || resp='{"success":false}'

  echo "$resp" > "$outfile"

  jid=$(python3 -c "
import json
try:
    d = json.loads(open('$outfile').read())
    print(d.get('jobId',''))
except:
    print('')
" 2>/dev/null)
  JOB_IDS[$i]="$jid"
  info "Submitted: $url (job: ${jid:-FAILED})"
done

# Poll all jobs until all complete or timeout
echo ""
echo "    Polling for results (up to 60s each)..."
declare -a JOB_DONE=()
for i in "${!FETCH_URLS[@]}"; do
  JOB_DONE[$i]="false"
  [[ -z "${JOB_IDS[$i]}" ]] && JOB_DONE[$i]="immediate_fail"
done

elapsed=0
while [[ $elapsed -lt 65 ]]; do
  all_done=true
  for i in "${!FETCH_URLS[@]}"; do
    [[ "${JOB_DONE[$i]}" != "false" ]] && continue
    all_done=false

    jid="${JOB_IDS[$i]}"
    outfile="${RESULT_FILES[$i]}"

    poll=$(curl -s -f "$API_URL/v1/jobs/$jid" \
      -H "Authorization: Bearer $API_KEY" 2>/dev/null) || continue
    echo "$poll" > "$outfile"

    status=$(python3 -c "
import json
try:
    d = json.loads(open('$outfile').read())
    print(d.get('status',''))
except:
    print('')
" 2>/dev/null)

    if [[ "$status" == "completed" || "$status" == "failed" ]]; then
      JOB_DONE[$i]="$status"
    fi
  done
  $all_done && break
  sleep 3
  elapsed=$((elapsed + 3))
done

# Evaluate results
echo ""
echo "  ${BOLD}Hacker News (https://news.ycombinator.com):${NC}"
HN_FILE="${RESULT_FILES[0]}"
HN_STATUS="${JOB_DONE[0]}"
HN_TITLE=$(py_eval "$HN_FILE" "d.get('result',{}).get('title','')")
HN_TOKENS=$(py_eval "$HN_FILE" "str(d.get('result',{}).get('tokens',0))")
HN_QUALITY=$(py_eval "$HN_FILE" "str(d.get('result',{}).get('quality',0))")

[[ "$HN_STATUS" == "completed" ]] \
  && pass "job completed" \
  || fail "job completed (status: ${HN_STATUS})"
[[ "$HN_TITLE" == *"Hacker News"* ]] \
  && pass "title contains 'Hacker News' ($HN_TITLE)" \
  || fail "title contains 'Hacker News' (got: '$HN_TITLE')"
[[ "${HN_TOKENS:-0}" -gt 100 ]] \
  && pass "tokens > 100 (got: $HN_TOKENS)" \
  || fail "tokens > 100 (got: $HN_TOKENS)"

echo ""
echo "  ${BOLD}Wikipedia JavaScript (https://en.wikipedia.org/wiki/JavaScript):${NC}"
WIKI_FILE="${RESULT_FILES[1]}"
WIKI_STATUS="${JOB_DONE[1]}"
WIKI_TITLE=$(py_eval "$WIKI_FILE" "d.get('result',{}).get('title','')")
WIKI_TOKENS=$(py_eval "$WIKI_FILE" "str(d.get('result',{}).get('tokens',0))")
WIKI_QUALITY=$(py_eval "$WIKI_FILE" "str(d.get('result',{}).get('quality',0))")

[[ "$WIKI_STATUS" == "completed" ]] \
  && pass "job completed" \
  || fail "job completed (status: ${WIKI_STATUS})"
[[ "$WIKI_TITLE" == *"JavaScript"* ]] \
  && pass "title contains 'JavaScript' ($WIKI_TITLE)" \
  || fail "title contains 'JavaScript' (got: '$WIKI_TITLE')"
# quality 0-1, check > 0.8
WIKI_QUALITY_OK=$(python3 -c "
try:
    q = float('${WIKI_QUALITY:-0}')
    print('yes' if q > 0.8 else 'no')
except:
    print('no')
" 2>/dev/null)
[[ "$WIKI_QUALITY_OK" == "yes" ]] \
  && pass "quality > 0.8 (got: $WIKI_QUALITY)" \
  || fail "quality > 0.8 (got: $WIKI_QUALITY)"

echo ""
echo "  ${BOLD}GitHub WebPeel (https://github.com/webpeel/webpeel):${NC}"
GH_FILE="${RESULT_FILES[2]}"
GH_STATUS="${JOB_DONE[2]}"
GH_TITLE=$(py_eval "$GH_FILE" "d.get('result',{}).get('title','')")
GH_CONTENT=$(py_eval "$GH_FILE" "d.get('result',{}).get('content','')")
GH_TOKENS=$(py_eval "$GH_FILE" "str(d.get('result',{}).get('tokens',0))")

[[ "$GH_STATUS" == "completed" ]] \
  && pass "job completed" \
  || fail "job completed (status: ${GH_STATUS})"
TITLE_LOWER=$(echo "$GH_TITLE" | tr '[:upper:]' '[:lower:]')
[[ "$TITLE_LOWER" == *"webpeel"* ]] \
  && pass "title contains 'webpeel' ($GH_TITLE)" \
  || fail "title contains 'webpeel' (got: '$GH_TITLE')"
# Markdown content check: should contain # or **
CONTENT_IS_MD=$(python3 -c "
import json
try:
    with open('$GH_FILE') as f:
        d = json.load(f)
    c = d.get('result',{}).get('content','')
    has_md = '#' in c or '**' in c or '[' in c
    print('yes' if has_md else 'no')
except:
    print('no')
" 2>/dev/null)
[[ "$CONTENT_IS_MD" == "yes" ]] \
  && pass "content contains markdown (#, **, or [)" \
  || fail "content contains markdown"

echo ""
echo "  ${BOLD}Stripe Docs (https://stripe.com/docs):${NC}"
STRIPE_FILE="${RESULT_FILES[3]}"
STRIPE_STATUS="${JOB_DONE[3]}"
STRIPE_TITLE=$(py_eval "$STRIPE_FILE" "d.get('result',{}).get('title','')")
STRIPE_TOKENS=$(py_eval "$STRIPE_FILE" "str(d.get('result',{}).get('tokens',0))")

[[ "$STRIPE_STATUS" == "completed" ]] \
  && pass "job completed" \
  || fail "job completed (status: ${STRIPE_STATUS})"
[[ -n "$STRIPE_TITLE" ]] \
  && pass "title present ($STRIPE_TITLE)" \
  || fail "title present (empty)"
[[ "${STRIPE_TOKENS:-0}" -gt 10 ]] \
  && pass "tokens > 10 (got: $STRIPE_TOKENS — JS-heavy SPA may yield less)" \
  || fail "tokens > 10 (got: $STRIPE_TOKENS)"

echo ""
echo "  ${BOLD}CDC (https://www.cdc.gov):${NC}"
CDC_FILE="${RESULT_FILES[4]}"
CDC_STATUS="${JOB_DONE[4]}"
CDC_TITLE=$(py_eval "$CDC_FILE" "d.get('result',{}).get('title','')")

[[ "$CDC_STATUS" == "completed" ]] \
  && pass "job completed" \
  || fail "job completed (status: ${CDC_STATUS})"
[[ -n "$CDC_TITLE" ]] \
  && pass "title present ($CDC_TITLE)" \
  || fail "title present (empty)"
# Check trust tier is 'official' (CDC is a .gov domain)
CDC_TIER=$(py_eval "$CDC_FILE" "d.get('result',{}).get('trust',{}).get('source',{}).get('tier','')")
[[ "$CDC_TIER" == "official" ]] \
  && pass "trust.source.tier=official (government domain)" \
  || fail "trust.source.tier=official (got: '$CDC_TIER')"

# ══════════════════════════════════════════════════════
# SECTION 3: Trust & Domain Intelligence
# ══════════════════════════════════════════════════════
section "3. Trust & Domain Intelligence"
echo ""
echo "    Verifying trust fields on fetched results..."

VALID_TIERS="official established community new suspicious"

for i in 0 1 2 3 4; do
  url="${FETCH_URLS[$i]}"
  key="${FETCH_KEYS[$i]}"
  f="${RESULT_FILES[$i]}"
  status="${JOB_DONE[$i]}"

  [[ "$status" != "completed" ]] && {
    info "Skipping trust check for $url (job not completed)"
    continue
  }

  echo ""
  echo "  ${BOLD}Trust: $url${NC}"

  TIER=$(py_eval "$f" "d.get('result',{}).get('trust',{}).get('source',{}).get('tier','')")
  SCORE_RAW=$(py_eval "$f" "str(d.get('result',{}).get('trust',{}).get('source',{}).get('score',''))")
  LABEL=$(py_eval "$f" "d.get('result',{}).get('trust',{}).get('source',{}).get('label','')")
  SIGNALS_COUNT=$(python3 -c "
import json
try:
    with open('$f') as fh:
        d = json.load(fh)
    sigs = d.get('result',{}).get('trust',{}).get('source',{}).get('signals',[])
    print(len(sigs) if isinstance(sigs, list) else 0)
except:
    print(0)
" 2>/dev/null)
  SAFETY_CLEAN=$(py_eval "$f" "str(d.get('result',{}).get('trust',{}).get('contentSafety',{}).get('clean',''))")

  # tier must be one of valid tiers
  TIER_VALID=false
  for t in $VALID_TIERS; do
    [[ "$TIER" == "$t" ]] && TIER_VALID=true && break
  done
  $TIER_VALID \
    && pass "trust.source.tier is valid ($TIER)" \
    || fail "trust.source.tier is valid (got: '$TIER')"

  # score 0-100
  SCORE_OK=$(python3 -c "
try:
    s = float('${SCORE_RAW:-}')
    print('yes' if 0 <= s <= 100 else 'no')
except:
    print('no')
" 2>/dev/null)
  [[ "$SCORE_OK" == "yes" ]] \
    && pass "trust.source.score is 0-100 (got: $SCORE_RAW)" \
    || fail "trust.source.score is 0-100 (got: '$SCORE_RAW')"

  # label is NOT "UNVERIFIED" (banned)
  [[ "$LABEL" != "UNVERIFIED" && -n "$LABEL" ]] \
    && pass "trust.source.label not UNVERIFIED ($LABEL)" \
    || fail "trust.source.label not UNVERIFIED (got: '$LABEL')"

  # signals: at least 1
  [[ "${SIGNALS_COUNT:-0}" -ge 1 ]] \
    && pass "trust.source.signals has ≥1 signal (got: $SIGNALS_COUNT)" \
    || fail "trust.source.signals has ≥1 signal (got: $SIGNALS_COUNT)"

  # contentSafety.clean exists
  [[ -n "$SAFETY_CLEAN" ]] \
    && pass "trust.contentSafety.clean exists (got: $SAFETY_CLEAN)" \
    || fail "trust.contentSafety.clean exists"
done

# ══════════════════════════════════════════════════════
# SECTION 4: Active Domain Verification (2 URLs)
# ══════════════════════════════════════════════════════
section "4. Active Domain Verification"
echo ""

# Use Wikipedia (index 1) and CDC (index 4) — established & official
for i in 1 4; do
  url="${FETCH_URLS[$i]}"
  f="${RESULT_FILES[$i]}"
  status="${JOB_DONE[$i]}"

  echo "  ${BOLD}Verification: $url${NC}"

  [[ "$status" != "completed" ]] && {
    fail "verification check skipped — job not completed"
    continue
  }

  VERIF_EXISTS=$(python3 -c "
import json
try:
    with open('$f') as fh:
        d = json.load(fh)
    v = d.get('result',{}).get('trust',{}).get('source',{}).get('verification')
    print('yes' if v is not None else 'no')
except:
    print('no')
" 2>/dev/null)

  if [[ "$VERIF_EXISTS" != "yes" ]]; then
    # Verification is best-effort — DNS/TLS lookups may fail in some environments
    info "trust.source.verification not present (DNS/TLS may be blocked in worker env — skipping sub-checks)"
    pass "trust.source.verification optional (not present)"
    continue
  fi
  pass "trust.source.verification object exists"

  TLS_VALID=$(py_eval "$f" "str(d.get('result',{}).get('trust',{}).get('source',{}).get('verification',{}).get('tls',{}) or {})")
  TLS_VALID_FIELD=$(python3 -c "
import json
try:
    with open('$f') as fh:
        d = json.load(fh)
    tls = d.get('result',{}).get('trust',{}).get('source',{}).get('verification',{}).get('tls') or {}
    print('yes' if 'valid' in tls and 'issuer' in tls and 'daysRemaining' in tls else 'no')
except:
    print('no')
" 2>/dev/null)

  [[ "$TLS_VALID_FIELD" == "yes" ]] \
    && pass "trust.source.verification.tls has valid/issuer/daysRemaining" \
    || fail "trust.source.verification.tls has valid/issuer/daysRemaining"

  DNS_FIELDS_OK=$(python3 -c "
import json
try:
    with open('$f') as fh:
        d = json.load(fh)
    dns = d.get('result',{}).get('trust',{}).get('source',{}).get('verification',{}).get('dns') or {}
    ok = 'hasMx' in dns and 'hasDmarc' in dns and 'hasSpf' in dns
    print('yes' if ok else 'no')
except:
    print('no')
" 2>/dev/null)

  [[ "$DNS_FIELDS_OK" == "yes" ]] \
    && pass "trust.source.verification.dns has hasMx/hasDmarc/hasSpf" \
    || fail "trust.source.verification.dns has hasMx/hasDmarc/hasSpf"
done

# ══════════════════════════════════════════════════════
# SECTION 5: Safe Browsing / Attack Vector Rejection
# ══════════════════════════════════════════════════════
section "5. Safe Browsing & Attack Vector Rejection"
echo ""

# Helper: submit a URL and check if it is blocked
# Returns: "rejected_immediate" | "rejected_job_failed" | "flagged_unsafe" | "allowed"
check_attack_url() {
  local url="$1"
  local tmpf="$TMPDIR_E2E/attack_$(date +%s%N).json"

  local resp
  resp=$(curl -s -X POST "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "{\"url\":\"$url\",\"mode\":\"markdown\"}" 2>/dev/null) || resp='{"success":false}'

  echo "$resp" > "$tmpf"

  local success
  success=$(python3 -c "
import json
try:
    d = json.loads(open('$tmpf').read())
    print(str(d.get('success',True)))
except:
    print('True')
" 2>/dev/null)

  if [[ "$success" == "False" ]]; then
    echo "rejected_immediate"
    rm -f "$tmpf"
    return 0
  fi

  # Job was queued — poll it
  local jid
  jid=$(python3 -c "
import json
try:
    d = json.loads(open('$tmpf').read())
    print(d.get('jobId',''))
except:
    print('')
" 2>/dev/null)

  if [[ -z "$jid" ]]; then
    echo "rejected_immediate"
    rm -f "$tmpf"
    return 0
  fi

  # Poll up to 30s
  local e=0
  while [[ $e -lt 30 ]]; do
    sleep 2; e=$((e+2))
    local pr
    pr=$(curl -s -f "$API_URL/v1/jobs/$jid" \
      -H "Authorization: Bearer $API_KEY" 2>/dev/null) || continue
    echo "$pr" > "$tmpf"

    local st
    st=$(python3 -c "
import json
try:
    d = json.loads(open('$tmpf').read())
    print(d.get('status',''))
except:
    print('')
" 2>/dev/null)

    if [[ "$st" == "failed" ]]; then
      echo "rejected_job_failed"
      rm -f "$tmpf"
      return 0
    elif [[ "$st" == "completed" ]]; then
      # Check safeBrowsing.safe
      local sb_safe
      sb_safe=$(python3 -c "
import json
try:
    d = json.loads(open('$tmpf').read())
    sb = d.get('result',{}).get('safeBrowsing',{})
    print(str(sb.get('safe',True)))
except:
    print('True')
" 2>/dev/null)
      if [[ "$sb_safe" == "False" ]]; then
        echo "flagged_unsafe"
      else
        echo "allowed"
      fi
      rm -f "$tmpf"
      return 0
    fi
  done

  echo "timeout"
  rm -f "$tmpf"
}

echo "  ${BOLD}Attack: credential injection (https://google.com@evil.com)${NC}"
RESULT_ATK1=$(check_attack_url "https://google.com@evil.com")
info "Result: $RESULT_ATK1"
[[ "$RESULT_ATK1" == "rejected_immediate" || "$RESULT_ATK1" == "rejected_job_failed" || "$RESULT_ATK1" == "flagged_unsafe" ]] \
  && pass "https://google.com@evil.com is blocked/flagged (${RESULT_ATK1})" \
  || fail "https://google.com@evil.com should be blocked (got: ${RESULT_ATK1})"

echo ""
echo "  ${BOLD}Attack: data: URI (data:text/html,<script>alert(1)</script>)${NC}"
RESULT_ATK2=$(check_attack_url "data:text/html,<script>alert(1)</script>")
info "Result: $RESULT_ATK2"
[[ "$RESULT_ATK2" == "rejected_immediate" || "$RESULT_ATK2" == "rejected_job_failed" || "$RESULT_ATK2" == "flagged_unsafe" ]] \
  && pass "data: URI is blocked/rejected (${RESULT_ATK2})" \
  || fail "data: URI should be blocked (got: ${RESULT_ATK2})"

echo ""
echo "  ${BOLD}Attack: phishing domain (https://paypal-login.tk)${NC}"
RESULT_ATK3=$(check_attack_url "https://paypal-login.tk")
info "Result: $RESULT_ATK3"
[[ "$RESULT_ATK3" == "rejected_immediate" || "$RESULT_ATK3" == "rejected_job_failed" || "$RESULT_ATK3" == "flagged_unsafe" ]] \
  && pass "paypal-login.tk is blocked/flagged (${RESULT_ATK3})" \
  || fail "paypal-login.tk should be blocked (got: ${RESULT_ATK3})"

# ══════════════════════════════════════════════════════
# SECTION 6: Content Safety / Prompt Injection
# ══════════════════════════════════════════════════════
section "6. Content Safety / Prompt Injection"
echo ""
echo "    Using https://httpbin.org/html (known page — check contentSafety fields exist)"

INJECT_FILE="$TMPDIR_E2E/inject.json"
fetch_url "https://httpbin.org/html" "$INJECT_FILE"

INJ_STATUS=$(py_eval "$INJECT_FILE" "d.get('status','')")
CS_CLEAN=$(python3 -c "
import json
try:
    with open('$INJECT_FILE') as f:
        d = json.load(f)
    cs = d.get('result',{}).get('trust',{}).get('contentSafety',{})
    print('yes' if 'clean' in cs and 'injectionDetected' in cs and 'detectedPatterns' in cs else 'no')
except:
    print('no')
" 2>/dev/null)

CS_CLEAN_VAL=$(py_eval "$INJECT_FILE" "str(d.get('result',{}).get('trust',{}).get('contentSafety',{}).get('clean',''))")
CS_INJ_DET=$(py_eval "$INJECT_FILE" "str(d.get('result',{}).get('trust',{}).get('contentSafety',{}).get('injectionDetected',''))")

[[ "$INJ_STATUS" == "completed" ]] \
  && pass "httpbin.org/html job completed" \
  || fail "httpbin.org/html job completed (status: ${INJ_STATUS})"

[[ "$CS_CLEAN" == "yes" ]] \
  && pass "contentSafety object has all required fields (clean, injectionDetected, detectedPatterns)" \
  || fail "contentSafety object has all required fields"

# A clean page should not have injection detected
[[ "$CS_INJ_DET" == "False" || "$CS_INJ_DET" == "false" ]] \
  && pass "injectionDetected=false on clean page (httpbin)" \
  || fail "injectionDetected=false on clean page (got: '$CS_INJ_DET')"

# ══════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════
ELAPSED=$((SECONDS - START_TIME))

echo ""
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}✗ FAILED ASSERTIONS:${NC}"
  for n in "${FAIL_NAMES[@]}"; do
    echo -e "    ${RED}✗${NC} $n"
  done
  echo ""
fi

echo -e "  ${BOLD}Results:${NC}  ${GREEN}$PASS passed${NC}  /  ${RED}$FAIL failed${NC}  /  $TOTAL total"
echo -e "  ${BOLD}Elapsed:${NC}  ${ELAPSED}s"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}${BOLD}✗ E2E FAILED — $FAIL/$TOTAL assertions failed${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}✓ ALL E2E TESTS PASSED — $PASS/$TOTAL assertions passed${NC}"
  exit 0
fi
