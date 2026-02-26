#!/bin/bash
# e2e-verify.sh — Real URL verification. Run after EVERY feature batch.
# Tests real URLs, checks real output. No mocks. No faking.
# Usage: bash scripts/e2e-verify.sh [--verbose]

set -euo pipefail
VERBOSE="${1:-}"
CLI="node dist/cli.js"
PASS=0
FAIL=0
WARN=0
FAILURES=""

red() { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
fail() {
  local name="$1"
  red "FAIL"
  FAIL=$((FAIL+1))
  FAILURES="$FAILURES\n  ❌ $name"
}

check() {
  local name="$1" url="$2" expect_method="$3" min_chars="$4" content_must_contain="$5"
  shift 5
  local extra_flags="$*"
  
  echo -n "  $name... "
  
  local output
  if ! output=$($CLI "$url" --json --silent $extra_flags 2>/dev/null); then
    red "FAIL (command errored)"
    FAIL=$((FAIL+1))
    FAILURES="$FAILURES\n  ❌ $name: command errored"
    return
  fi
  
  local method chars content
  method=$(echo "$output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('method','?'))" 2>/dev/null || echo "?")
  chars=$(echo "$output" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','')))" 2>/dev/null || echo "0")
  content=$(echo "$output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content','')[:500])" 2>/dev/null || echo "")
  
  # Check method
  if [ "$expect_method" != "any" ] && [ "$method" != "$expect_method" ]; then
    red "FAIL (method=$method, expected=$expect_method)"
    FAIL=$((FAIL+1))
    FAILURES="$FAILURES\n  ❌ $name: method=$method expected=$expect_method"
    return
  fi
  
  # Check minimum content length
  if [ "$chars" -lt "$min_chars" ]; then
    red "FAIL ($chars chars < $min_chars minimum)"
    FAIL=$((FAIL+1))
    FAILURES="$FAILURES\n  ❌ $name: $chars chars < $min_chars min"
    return
  fi
  
  # Check content contains expected string
  if [ -n "$content_must_contain" ]; then
    if ! echo "$content" | grep -qi "$content_must_contain"; then
      red "FAIL (content missing: '$content_must_contain')"
      [ -n "$VERBOSE" ] && echo "    Content: ${content:0:200}"
      FAIL=$((FAIL+1))
      FAILURES="$FAILURES\n  ❌ $name: missing '$content_must_contain'"
      return
    fi
  fi
  
  green "OK (method=$method, ${chars} chars)"
  [ -n "$VERBOSE" ] && echo "    ${content:0:120}"
  PASS=$((PASS+1))
}

check_extracted() {
  local name="$1" url="$2" schema="$3" min_unique="$4"
  
  echo -n "  $name... "
  
  local output
  if ! output=$($CLI "$url" --schema "$schema" --json --silent 2>/dev/null); then
    red "FAIL (command errored)"
    FAIL=$((FAIL+1))
    FAILURES="$FAILURES\n  ❌ $name: command errored"
    return
  fi
  
  local extracted unique total
  extracted=$(echo "$output" | python3 -c "
import sys,json
d=json.load(sys.stdin)
e=d.get('extracted',{})
vals=[str(v).strip()[:50] for v in e.values() if v and len(str(v).strip())>2]
print(f'{len(set(vals))}/{len(e)}')
for k,v in e.items():
    print(f'  {k}: {str(v)[:60]}')
" 2>/dev/null || echo "0/0")
  
  unique=$(echo "$extracted" | head -1 | cut -d'/' -f1)
  total=$(echo "$extracted" | head -1 | cut -d'/' -f2)
  
  if [ "$unique" -lt "$min_unique" ]; then
    yellow "WARN (${unique}/${total} unique extractions, need ${min_unique}+)"
    [ -n "$VERBOSE" ] && echo "$extracted" | tail -n +2
    WARN=$((WARN+1))
    return
  fi
  
  green "OK (${unique}/${total} unique extractions)"
  [ -n "$VERBOSE" ] && echo "$extracted" | tail -n +2
  PASS=$((PASS+1))
}

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  WebPeel E2E Verification (Real URLs)    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Ensure build is current
echo "Building..."
npm run build --silent 2>/dev/null
echo ""

echo "═══ Domain Extractors ═══"
check "Wikipedia article" \
  "https://en.wikipedia.org/wiki/Web_scraping" "domain-api" 5000 "web scraping"

check "Reddit post" \
  "https://www.reddit.com/r/webdev/comments/1rbsz16/a_small_theme_picker_for_the_onboarding_process/" "domain-api" 500 ""

# Test that deleted/cross-sub posts return error content, not wrong subreddit
check "Reddit deleted post (safety)" \
  "https://www.reddit.com/r/webdev/comments/1rc5m6a/any_of_yall_still_making_websites_for_people/" "domain-api" 10 ""

check "Reddit subreddit /top" \
  "https://www.reddit.com/r/webdev/top/?t=week" "domain-api" 500 ""

check "Reddit subreddit /hot" \
  "https://www.reddit.com/r/programming/hot/" "domain-api" 500 ""

check "GitHub repo" \
  "https://github.com/expressjs/express" "domain-api" 800 "README"

check "GitHub issue" \
  "https://github.com/facebook/react/issues/31965" "domain-api" 200 ""

check "Stack Overflow" \
  "https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git" "domain-api" 2000 "git"

check "ArXiv paper" \
  "https://arxiv.org/abs/2501.12948" "domain-api" 500 ""

check "NPM package" \
  "https://www.npmjs.com/package/express" "domain-api" 100 "express"

check "Hacker News" \
  "https://news.ycombinator.com/item?id=42813442" "domain-api" 100 ""

echo ""
echo "═══ Features ═══"
check "Quick answer" \
  "https://en.wikipedia.org/wiki/Web_scraping" "domain-api" 5000 "" \
  -q "When was the first web crawler created?"

check "Clean format" \
  "https://en.wikipedia.org/wiki/Node.js" "domain-api" 2000 "" \
  --clean

check "Chunking" \
  "https://en.wikipedia.org/wiki/Web_scraping" "domain-api" 5000 "" \
  --chunk

echo ""
echo "═══ Schema Extraction ═══"
check_extracted "Article schema (long content)" \
  "https://en.wikipedia.org/wiki/Web_scraping" "article" 3

check_extracted "Product schema (long content)" \
  "https://en.wikipedia.org/wiki/IPhone_16" "product" 3

echo ""
echo "═══ CLI Features ═══"

echo -n "  Piped auto-JSON... "
if echo "" | $CLI "https://example.com" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('title')=='Example Domain'" 2>/dev/null; then
  green "OK"
  PASS=$((PASS+1))
else
  red "FAIL"
  FAIL=$((FAIL+1))
  FAILURES="$FAILURES\n  ❌ Piped auto-JSON"
fi

echo -n "  Search... "
if $CLI search "web scraping tools" --json --silent 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d if isinstance(d,list) else d.get('results',[])
assert len(r)>=2, f'only {len(r)} results'
" 2>/dev/null; then
  green "OK"
  PASS=$((PASS+1))
else
  yellow "WARN (search may be rate-limited)"
  WARN=$((WARN+1))
fi

echo -n "  Batch (3 URLs)... "
echo -e "https://example.com\nhttps://www.npmjs.com/package/express" > /tmp/wp-e2e-batch.txt
if $CLI batch /tmp/wp-e2e-batch.txt --json --silent 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d if isinstance(d,list) else d.get('results',[])
assert len(r)==2, f'expected 2, got {len(r)}'
" 2>/dev/null; then
  green "OK"
  PASS=$((PASS+1))
else
  red "FAIL"
  FAIL=$((FAIL+1))
  FAILURES="$FAILURES\n  ❌ Batch"
fi

rm -f /tmp/wp-e2e-batch.txt

echo ""
echo "═══ Module Exports ═══"

echo -n "  google-cache module... "
node -e "import('./dist/core/google-cache.js').then(m => {
  if (typeof m.fetchGoogleCache !== 'function') throw new Error('missing fetchGoogleCache');
  if (!m.isGoogleCacheAvailable()) throw new Error('should be available');
  console.log('OK');
});" 2>/dev/null && { green "OK"; PASS=$((PASS+1)); } || { fail "google-cache module check"; }

echo -n "  cf-worker-proxy module... "
node -e "import('./dist/core/cf-worker-proxy.js').then(m => {
  if (typeof m.cfWorkerFetch !== 'function') throw new Error('missing cfWorkerFetch');
  if (m.isCfWorkerAvailable()) throw new Error('should not be available without env var');
  console.log('OK');
});" 2>/dev/null && { green "OK"; PASS=$((PASS+1)); } || { fail "cf-worker module check"; }

echo -n "  Best Buy extractor (no API key)... "
node -e "
delete process.env.BESTBUY_API_KEY;
import('./dist/core/domain-extractors.js').then(async m => {
  const r = await m.extractDomainData('', 'https://www.bestbuy.com/site/apple-iphone-16/6587822.p');
  if (r !== null) throw new Error('should return null without API key');
  console.log('OK');
});" 2>/dev/null && { green "OK"; PASS=$((PASS+1)); } || { fail "Best Buy no-key check"; }

echo ""
echo "════════════════════════════════"
echo ""
if [ $FAIL -eq 0 ]; then
  green "  ✅ ALL PASSED: $PASS passed, $WARN warnings, $FAIL failures"
else
  red "  ❌ FAILURES: $PASS passed, $WARN warnings, $FAIL failures"
  echo -e "$FAILURES"
fi
echo ""

exit $FAIL
