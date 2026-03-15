#!/usr/bin/env bash
# Usage: ./scripts/release.sh [patch|minor|major]
# Default: patch
set -e

BUMP=${1:-patch}

echo "🚀 WebPeel Release Pipeline (${BUMP})"
echo "=================================="

# Step 1: Build
echo "▶ Building..."
npm run build

# Step 2: Run tests
echo "▶ Running tests..."
npx vitest run --reporter=verbose 2>&1 | tail -5

# Step 3: Version bump (triggers postversion.sh which updates Dockerfile)
echo "▶ Bumping version..."
npm version $BUMP --no-git-tag-version
NEW_VER=$(node -e "console.log(require('./package.json').version)")
echo "  New version: $NEW_VER"

# Step 4: Rebuild with new version
echo "▶ Rebuilding with new version..."
npm run build

# Step 5: Git commit + push
echo "▶ Committing and pushing..."
git add -A
git commit -m "v${NEW_VER}: Release"
git push origin main

# Step 6: Publish to npm
echo "▶ Publishing to npm..."
npm publish --ignore-scripts

# Step 7: Deploy to Render
echo "▶ Deploying to Render..."
RENDER_KEY=$(grep 'key:' ~/.render/cli.yaml | head -1 | awk '{print $2}')
DEPLOY_ID=$(curl -s -X POST "https://api.render.com/v1/services/srv-d673vsogjchc73ahgj6g/deploys" \
  -H "Authorization: Bearer $RENDER_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.id)")
echo "  Deploy: $DEPLOY_ID"

# Step 8: Wait for deploy + verify
echo "▶ Waiting for deploy..."
for i in $(seq 1 20); do
  sleep 15
  VER=$(curl -s "https://api.webpeel.dev/health?v=$(date +%s)" 2>/dev/null | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version)}catch{console.log('waiting')}" 2>/dev/null)
  if [ "$VER" = "$NEW_VER" ]; then
    echo "  ✅ v${NEW_VER} is live!"
    break
  fi
  echo "  [$i] Current: $VER (waiting for $NEW_VER...)"
done

# Step 9: Run verification
echo "▶ Running deploy verification..."
bash scripts/verify-deploy.sh

echo ""
echo "🎉 Release v${NEW_VER} complete!"
