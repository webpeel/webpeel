#!/bin/bash
# Test all domain extractors with real URLs
# Run after any extractor changes to verify quality

WP="dist/cli.js"
PASS=0
FAIL=0

test_url() {
  local label="$1"
  local url="$2"
  local min_words="$3"
  
  result=$(node $WP "$url" --silent --json 2>/dev/null)
  words=$(echo "$result" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('content','').split()))" 2>/dev/null)
  tokens=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tokens','?'))" 2>/dev/null)
  method=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('method','?'))" 2>/dev/null)
  
  if [ "$words" -ge "$min_words" ] 2>/dev/null; then
    echo "✅ $label: $words words | $tokens tokens | $method"
    PASS=$((PASS+1))
  else
    echo "❌ $label: $words words (expected >=$min_words) | $method"
    # Show first 200 chars of content for debugging
    echo "$result" | python3 -c "import sys,json; print('   Content:', json.load(sys.stdin).get('content','')[:200])" 2>/dev/null
    FAIL=$((FAIL+1))
  fi
}

echo "========================================"
echo "WebPeel Extractor Quality Test"
echo "========================================"
echo ""

test_url "YouTube (Jake's video)" "https://www.youtube.com/watch?v=NTfXwQ85suw" 50
test_url "YouTube (rickroll)" "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 50
test_url "Hacker News" "https://news.ycombinator.com" 200
test_url "Wikipedia" "https://en.wikipedia.org/wiki/Artificial_intelligence" 1000
test_url "GitHub" "https://github.com/anthropics/anthropic-cookbook" 200
test_url "Reddit" "https://www.reddit.com/r/programming/top/?t=day" 100
test_url "Stack Overflow" "https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git" 500
test_url "ArXiv" "https://arxiv.org/abs/2501.12948" 100
test_url "npm" "https://www.npmjs.com/package/webpeel" 200
test_url "TechCrunch" "https://techcrunch.com" 200
test_url "Example.com" "https://example.com" 5

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================================"
