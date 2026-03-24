#!/bin/bash
# security-scan.sh — Automated security checks for CI
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
FAIL=0
WARN=0

echo "🔒 Security Scan"
echo "═══════════════════"

# 1. Auth coverage: every POST/GET route in server/ should have auth
echo -n "[1/6] Route auth coverage... "
# Check all route files for handlers without auth middleware
ISSUES=""
for file in src/server/routes/*.ts; do
  [ -f "$file" ] || continue
  BASENAME=$(basename "$file")
  # Skip files that are inherently public
  echo "$BASENAME" | grep -qE "health|ready|openapi|demo|share" && continue

  # Count route handlers vs auth checks
  ROUTES=$(grep -cE "router\.(get|post|put|delete|patch)\(" "$file" 2>/dev/null; true)
  AUTH=$(grep -cE "req\.auth|requireScope|requireAuth|isAuthenticated" "$file" 2>/dev/null; true)
  ROUTES=${ROUTES:-0}
  AUTH=${AUTH:-0}

  if [ "${ROUTES}" -gt 0 ] && [ "${AUTH}" -eq 0 ]; then
    ISSUES="$ISSUES $BASENAME($ROUTES routes, 0 auth checks)"
  fi
done
if [ -n "$ISSUES" ]; then
  echo -e "${YELLOW}WARN${NC} — files with no auth:$ISSUES"
  WARN=$((WARN+1))
else
  echo -e "${GREEN}OK${NC}"
fi

# 2. No hardcoded secrets
echo -n "[2/6] Hardcoded secrets... "
FOUND=$(grep -rn "sk_live_\|sk_test_\|whsec_\|wp_live_[a-f0-9]\{10\}\|ghp_[a-zA-Z0-9]\{10\}" src/ --include="*.ts" | grep -v ".test." | grep -v "process.env" | grep -v "example\|placeholder\|fake\|mock\|dummy" | grep -v "\.replace\|REDACTED\|redact\|sanitize\|strip" || true)
if [ -n "$FOUND" ]; then
  echo -e "${RED}FAIL${NC}"
  echo "$FOUND" | head -5
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 3. SSRF blocklist completeness
echo -n "[3/6] SSRF blocklist... "
SSRF_FILE=$(grep -rl "127\.0\.0\.1\|169\.254" src/server/middleware/ 2>/dev/null | head -1)
if [ -n "$SSRF_FILE" ]; then
  CHECKS=0
  for pattern in "127.0.0.1" "169.254" "10." "172.16" "192.168" "localhost" "0.0.0.0" "file:" "::1"; do
    grep -q "$pattern" "$SSRF_FILE" && CHECKS=$((CHECKS+1))
  done
  if [ $CHECKS -ge 7 ]; then
    echo -e "${GREEN}OK${NC} ($CHECKS/9 patterns)"
  else
    echo -e "${YELLOW}WARN${NC} — only $CHECKS/9 SSRF patterns blocked"
    WARN=$((WARN+1))
  fi
else
  echo -e "${YELLOW}WARN${NC} — no SSRF middleware found"
  WARN=$((WARN+1))
fi

# 4. Error handler sanitization
echo -n "[4/6] Error sanitization... "
# Check that the global error handler doesn't expose stack traces
ERROR_HANDLER=$(grep -A20 "app.use.*err.*req.*res.*next" src/server/app.ts 2>/dev/null | grep -c "stack\|trace"; true)
ERROR_HANDLER=${ERROR_HANDLER:-0}
if [ "${ERROR_HANDLER}" -gt 0 ]; then
  echo -e "${YELLOW}WARN${NC} — error handler may expose stack traces"
  WARN=$((WARN+1))
else
  echo -e "${GREEN}OK${NC}"
fi

# 5. .env not in npm package
echo -n "[5/6] Package contents... "
ENV_IN_PKG=$(npm pack --dry-run 2>&1 | grep -cE "\.env|secret|\.key"; true)
ENV_IN_PKG=${ENV_IN_PKG:-0}
if [ "${ENV_IN_PKG}" -gt 0 ]; then
  echo -e "${RED}FAIL${NC} — sensitive files in npm package"
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 6. Security headers in server code
echo -n "[6/6] Security headers... "
HEADERS=0
for header in "Strict-Transport-Security" "X-Frame-Options" "X-Content-Type-Options" "Content-Security-Policy" "Referrer-Policy"; do
  grep -rq "$header" src/server/ 2>/dev/null && HEADERS=$((HEADERS+1))
done
if [ $HEADERS -ge 4 ]; then
  echo -e "${GREEN}OK${NC} ($HEADERS/5 headers)"
else
  echo -e "${YELLOW}WARN${NC} — only $HEADERS/5 security headers"
  WARN=$((WARN+1))
fi

echo ""
echo "═══════════════════"
if [ $FAIL -gt 0 ]; then
  echo -e "${RED}❌ $FAIL critical issues — BLOCKING${NC}"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "${YELLOW}⚠️ $WARN warnings (non-blocking)${NC}"
else
  echo -e "${GREEN}✅ All security checks passed${NC}"
fi
