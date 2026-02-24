#!/bin/bash
# Deploy to Render using API key from ~/.render/cli.yaml
# Usage: ./scripts/render-deploy.sh [clear-cache]
set -e

SERVICE_ID="srv-d673vsogjchc73ahgj6g"

# Read API key from render CLI config (never print it)
API_KEY=$(grep 'key:' ~/.render/cli.yaml 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || true)
if [ -z "$API_KEY" ]; then
  echo "❌ No Render API key found in ~/.render/cli.yaml"
  echo "   Run: render login"
  exit 1
fi

CLEAR="do_not_clear"
if [ "$1" = "clear-cache" ]; then
  CLEAR="clear"
fi

echo "🚀 Deploying to Render (cache: $CLEAR)..."
RESULT=$(curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"clearCache\":\"$CLEAR\"}")

STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null)
DEPLOY_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null)

if [[ "$STATUS" == *"in_progress"* || "$STATUS" == *"created"* ]]; then
  echo "✅ Deploy started: $DEPLOY_ID"
  echo "   Monitor: https://dashboard.render.com/web/$SERVICE_ID/deploys/$DEPLOY_ID"
else
  echo "❌ Deploy failed: $STATUS"
  echo "$RESULT"
  exit 1
fi
