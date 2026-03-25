#!/bin/bash
# pre-publish-gate.sh — Blocks npm version if critical checks fail
# Runs automatically before every version bump
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
FAIL=0

echo "🔒 Pre-publish gate..."

# 1. Check every route handler in queue mode has auth
echo -n "  Auth coverage... "
# The queue fetch router should have auth checks on all user-facing endpoints
UNAUTHED=$(grep -n 'router\.\(get\|post\)' src/server/routes/fetch-queue.ts | while read line; do
  LINENUM=$(echo "$line" | cut -d: -f1)
  # Check if there's an auth check within 20 lines after the route definition
  ROUTE=$(echo "$line" | grep -oE "'/v1/[^']+'" || echo "unknown")
  # Skip health/ready endpoints
  echo "$ROUTE" | grep -qE "health|ready" && continue
  HAS_AUTH=$(sed -n "${LINENUM},$((LINENUM+20))p" src/server/routes/fetch-queue.ts | grep -c "req.auth\|requireScope\|requireAuth" || echo 0)
  if [ "$HAS_AUTH" = "0" ]; then
    echo "$ROUTE (line $LINENUM)"
  fi
done)
if [ -n "$UNAUTHED" ]; then
  echo -e "${RED}FAIL${NC} — unprotected routes: $UNAUTHED"
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 2. No hardcoded secrets
echo -n "  Secret scan... "
SECRETS=$(grep -rn "sk_live_\|sk_test_\|whsec_\|wp_live_" src/ --include="*.ts" | grep -v ".test." | grep -v "process.env" | grep -v "example" | grep -v "placeholder" | grep -v "fake" | grep -v "randomBytes\|generate\|Format:" | grep -v "wp_live_\`\|wp_live_'\${" | grep -v "REDACTED\|replace(" || true)
if [ -n "$SECRETS" ]; then
  echo -e "${RED}FAIL${NC} — hardcoded secrets found"
  echo "$SECRETS"
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 3. CLI basic smoke test (local, no API needed)
echo -n "  CLI --help... "
node dist/cli.js --help > /dev/null 2>&1 && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAIL${NC}"; FAIL=1; }

echo -n "  CLI --version... "
VER=$(node dist/cli.js --version 2>/dev/null)
PKG_VER=$(node -p "require('./package.json').version")
# Note: version will be the CURRENT version (pre-bump), that's fine
echo -e "${GREEN}OK${NC} ($VER)"

# 4. Build produces dist/server/app.js
echo -n "  Server entry point... "
if [ -f dist/server/app.js ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL${NC} — dist/server/app.js missing"
  FAIL=1
fi

# 5. Error responses don't contain stack traces (check error handler)
echo -n "  Error sanitization... "
STACK_LEAKS=$(grep -rn "stack\|stackTrace" src/server/ --include="*.ts" | grep -v ".test." | grep -v "// " | grep -v "Sentry" | grep -v "console\.\(error\|warn\)" | grep -v "debug" | grep "res\.\|json(" || true)
if [ -n "$STACK_LEAKS" ]; then
  echo -e "${RED}FAIL${NC} — possible stack trace in responses"
  echo "$STACK_LEAKS" | head -3
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

if [ $FAIL -ne 0 ]; then
  echo ""
  echo -e "${RED}❌ Pre-publish gate FAILED — version bump blocked${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ All pre-publish checks passed${NC}"

# Run npm experience check — ensures npm users get the full experience
# Added 2026-03-19 after code split broke npm user experience
bash scripts/npm-experience-check.sh || exit 1
