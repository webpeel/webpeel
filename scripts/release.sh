#!/bin/bash
# WebPeel Release Script
# Usage: ./scripts/release.sh [patch|minor|major]
# 
# This script handles the ENTIRE release process:
# 1. Bumps version in package.json
# 2. Updates version in all files that reference it
# 3. Builds and tests
# 4. Commits, tags, and pushes
# 5. Publishes to npm
# 6. Creates GitHub release with auto-generated notes
# 7. Render auto-deploys from the push
# 8. Vercel auto-deploys from the push
#
# The ONLY manual step: PyPI (triggered by GitHub Actions on tag push)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check arguments
BUMP_TYPE=${1:-patch}
if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo -e "${RED}Usage: ./scripts/release.sh [patch|minor|major]${NC}"
  exit 1
fi

# Ensure clean working directory
if [[ -n $(git status --porcelain) ]]; then
  echo -e "${RED}Error: Working directory is not clean. Commit or stash changes first.${NC}"
  git status --short
  exit 1
fi

# Ensure on main branch
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo -e "${RED}Error: Must be on main branch (currently on $BRANCH)${NC}"
  exit 1
fi

# Get current and new version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}Current version: $CURRENT_VERSION${NC}"

# Bump version
npm version $BUMP_TYPE --no-git-tag-version > /dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Step 1: Build and test
echo -e "\n${YELLOW}Step 1: Build and test...${NC}"
npm run build
npm test 2>&1 | tail -3
echo -e "${GREEN}✅ Build and tests passed${NC}"

# Step 2: Update version references
echo -e "\n${YELLOW}Step 2: Updating version references...${NC}"

# Update site references (if any hardcoded versions exist)
find site/ -name "*.html" -exec sed -i '' "s/v${CURRENT_VERSION}/v${NEW_VERSION}/g" {} + 2>/dev/null || true
find site/ -name "*.html" -exec sed -i '' "s/\"${CURRENT_VERSION}\"/\"${NEW_VERSION}\"/g" {} + 2>/dev/null || true

# Update Python SDK version
if [[ -f "python/pyproject.toml" ]]; then
  sed -i '' "s/version = \".*\"/version = \"${NEW_VERSION}\"/" python/pyproject.toml 2>/dev/null || true
fi

# Update OpenAPI spec version
if [[ -f "openapi.yaml" ]]; then
  sed -i '' "s/version: '.*'/version: '${NEW_VERSION}'/" openapi.yaml 2>/dev/null || true
fi

echo -e "${GREEN}✅ Version references updated${NC}"

# Step 3: Rebuild dist with new version
echo -e "\n${YELLOW}Step 3: Rebuilding dist...${NC}"
npm run build
echo -e "${GREEN}✅ Dist rebuilt${NC}"

# Step 4: Git commit and tag
echo -e "\n${YELLOW}Step 4: Committing and tagging...${NC}"
git add -A
git commit -m "release: v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
echo -e "${GREEN}✅ Committed and tagged${NC}"

# Step 5: Push to GitHub (triggers Render + Vercel deploys)
echo -e "\n${YELLOW}Step 5: Pushing to GitHub...${NC}"
git push origin main
git push origin "v${NEW_VERSION}"
echo -e "${GREEN}✅ Pushed to GitHub${NC}"

# Step 6: Publish to npm
echo -e "\n${YELLOW}Step 6: Publishing to npm...${NC}"
npm publish
echo -e "${GREEN}✅ Published to npm${NC}"

# Step 7: Create GitHub release
echo -e "\n${YELLOW}Step 7: Creating GitHub release...${NC}"
gh release create "v${NEW_VERSION}" \
  --title "v${NEW_VERSION}" \
  --generate-notes \
  --latest
echo -e "${GREEN}✅ GitHub release created${NC}"

# Summary
echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Release v${NEW_VERSION} complete! 🎉${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "  npm:    https://www.npmjs.com/package/webpeel"
echo "  GitHub: https://github.com/JakeLiuMe/webpeel/releases/tag/v${NEW_VERSION}"
echo "  API:    https://api.webpeel.dev/health (auto-deploying)"
echo "  Site:   https://webpeel.dev (auto-deploying)"
echo ""
echo -e "${YELLOW}PyPI will auto-publish via GitHub Actions (pypi.yml workflow)${NC}"
echo -e "${YELLOW}Render will auto-deploy in ~3 minutes${NC}"
echo -e "${YELLOW}Vercel will auto-deploy in ~30 seconds${NC}"
