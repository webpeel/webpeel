#!/bin/bash
# Pre-cache popular smart search queries
# Run hourly via cron: 0 * * * * /path/to/cache-warm-smart.sh
API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
API="https://api.webpeel.dev"

# Popular queries to pre-cache (these generate affiliate revenue)
QUERIES=(
  "best pizza in manhattan"
  "best ramen in brooklyn"
  "cheapest gas near times square"
  "used tesla under 30000"
  "best sony headphones"
  "cheap flights nyc to miami"
  "hotel in boston under 150"
  "best korean bbq manhattan"
  "rent a forklift near manhattan"
  "buy 1000 pencils bulk wholesale"
  "best restaurants in queens"
  "cheapest car in long island"
  "best thai food near times square"
  "best sushi in manhattan"
  "cheap flights to london"
)

echo "🔥 Cache warming $(date)"
WARMED=0
FAILED=0

for q in "${QUERIES[@]}"; do
  RESULT=$(curl -s --max-time 45 "${API}/v1/search/smart" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"q\":\"$q\"}" 2>/dev/null)
  
  TYPE=$(echo "$RESULT" | node -e "
const chunks=[]; process.stdin.on('data',c=>chunks.push(c)); process.stdin.on('end',()=>{
  try{const s=Buffer.concat(chunks).toString('utf8');const m=s.match(/\"type\":\"([^\"]+)\"/);console.log(m?m[1]:'?');}catch(e){console.log('err');}
})" 2>/dev/null)
  
  if [ "$TYPE" != "err" ] && [ "$TYPE" != "?" ]; then
    WARMED=$((WARMED + 1))
    echo "  ✅ [$TYPE] $q"
  else
    FAILED=$((FAILED + 1))
    echo "  ❌ $q"
  fi
  
  # Rate limit: 2 second delay between queries
  sleep 2
done

echo ""
echo "Done: $WARMED warmed, $FAILED failed"
