#!/usr/bin/env bash
# Tests API response shapes match what the dashboard expects
set -uo pipefail

API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
API_URL="https://api.webpeel.dev"
PASS=0
FAIL=0

echo "═══════════════════════════════════════════════"
echo "  API Contract Tests (Dashboard Compatibility)"
echo "═══════════════════════════════════════════════"
echo ""

# Test 1: Search response has data.web array
echo "▶ Search response shape"
SEARCH=$(curl -s --max-time 10 "$API_URL/v1/search?q=javascript" -H "Authorization: Bearer $API_KEY")
HAS_WEB=$(echo "$SEARCH" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const ok = d.success && Array.isArray(d.data?.web) && d.data.web.length > 0;
if (ok) {
  const r = d.data.web[0];
  const hasFields = r.title && r.url && typeof r.snippet === 'string';
  console.log(hasFields ? 'PASS' : 'FAIL:missing_fields');
} else {
  console.log('FAIL:no_web_array');
}
" 2>/dev/null)
if [ "$HAS_WEB" = "PASS" ]; then
  echo "  ✅ data.web[] with title/url/snippet"
  PASS=$((PASS + 1))
else
  echo "  ❌ $HAS_WEB"
  FAIL=$((FAIL + 1))
fi

# Test 2: Search with enrich returns content field
echo "▶ Search enrichment shape"
ENRICHED=$(curl -s --max-time 15 "$API_URL/v1/search?q=javascript+programming&enrich=1" -H "Authorization: Bearer $API_KEY")
HAS_CONTENT=$(echo "$ENRICHED" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const web = d.data?.web || [];
const enriched = web.find(r => r.content);
if (enriched) {
  const ok = typeof enriched.content === 'string' && typeof enriched.wordCount === 'number' && typeof enriched.method === 'string';
  console.log(ok ? 'PASS' : 'FAIL:missing_enrich_fields');
} else {
  console.log('FAIL:no_enriched_result');
}
" 2>/dev/null)
if [ "$HAS_CONTENT" = "PASS" ]; then
  echo "  ✅ Enriched result has content/wordCount/method"
  PASS=$((PASS + 1))
else
  echo "  ❌ $HAS_CONTENT"
  FAIL=$((FAIL + 1))
fi

# Test 3: Fetch response has expected fields
echo "▶ Fetch response shape"
FETCH=$(curl -s --max-time 10 "$API_URL/v1/fetch" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}')
FETCH_OK=$(echo "$FETCH" | node -e "
const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const ok = r.content && r.title && r.method && typeof r.elapsed === 'number';
console.log(ok ? 'PASS' : 'FAIL:'+JSON.stringify({content:!!r.content,title:!!r.title,method:!!r.method,elapsed:typeof r.elapsed}));
" 2>/dev/null)
if [ "$FETCH_OK" = "PASS" ]; then
  echo "  ✅ Fetch has content/title/method/elapsed"
  PASS=$((PASS + 1))
else
  echo "  ❌ $FETCH_OK"
  FAIL=$((FAIL + 1))
fi

# Test 4: Health endpoint
echo "▶ Health endpoint shape"
HEALTH_OK=$(curl -s --max-time 5 "$API_URL/health" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log(d.status==='healthy'&&d.version&&typeof d.uptime==='number'?'PASS':'FAIL');
" 2>/dev/null)
if [ "$HEALTH_OK" = "PASS" ]; then
  echo "  ✅ Health has status/version/uptime"
  PASS=$((PASS + 1))
else
  echo "  ❌ Health endpoint broken"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "═══════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  Result: $PASS/$TOTAL passed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
