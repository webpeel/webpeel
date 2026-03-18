#!/usr/bin/env bash
# release.sh — One-command WebPeel release
# Usage: ./scripts/release.sh [patch|minor|major] [--dry-run] [--skip-tests]
#
# What it does:
#   1. Runs build + tests
#   2. Bumps version (npm version patch/minor/major)
#   3. Publishes to npm
#   4. Commits + pushes (triggers GHCR build + K3s deploy via CI)
#   5. Waits for CI to pass
#   6. Verifies live API version matches
#   7. Reports success/failure

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Args ─────────────────────────────────────────────────────────────────────
BUMP="patch"
DRY_RUN=false
SKIP_TESTS=false

for arg in "$@"; do
  case "$arg" in
    patch|minor|major) BUMP="$arg" ;;
    --dry-run)         DRY_RUN=true ;;
    --skip-tests)      SKIP_TESTS=true ;;
    *)
      echo -e "${RED}Unknown argument: $arg${RESET}"
      echo "Usage: $0 [patch|minor|major] [--dry-run] [--skip-tests]"
      exit 1
      ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RELEASE_START=$(date +%s)

elapsed() {
  local start=$1
  local end
  end=$(date +%s)
  local diff=$(( end - start ))
  if (( diff >= 60 )); then
    printf "%dm %ds" $(( diff / 60 )) $(( diff % 60 ))
  else
    printf "%.1fs" "$diff"
  fi
}

step_start() {
  printf "%-42s" "$1"
  STEP_START=$(date +%s)
}

step_ok() {
  local extra="${1:-}"
  local t
  t=$(elapsed "$STEP_START")
  if [[ -n "$extra" ]]; then
    echo -e "${GREEN}✓${RESET} ${DIM}(${t})${RESET}  ${extra}"
  else
    echo -e "${GREEN}✓${RESET} ${DIM}(${t})${RESET}"
  fi
}

step_fail() {
  local msg="${1:-}"
  echo -e "${RED}✗${RESET}"
  echo -e "${RED}${BOLD}Error:${RESET} ${msg}"
  echo -e "${RED}Release aborted.${RESET}"
  exit 1
}

divider() {
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

run_or_dry() {
  if $DRY_RUN; then
    echo -e "  ${DIM}[dry-run] would run: $*${RESET}"
    return 0
  fi
  "$@"
}

# ─── Pre-flight ────────────────────────────────────────────────────────────────
OLD_VER=$(node -e "console.log(require('./package.json').version)")

echo ""
echo -e "${BOLD}${CYAN}🚀 WebPeel Release — ${BUMP}${RESET}"
if $DRY_RUN;    then echo -e "   ${YELLOW}[DRY RUN — no changes will be made]${RESET}"; fi
if $SKIP_TESTS; then echo -e "   ${YELLOW}[--skip-tests: skipping test suite]${RESET}"; fi
divider

# ─── Step 1: Build ────────────────────────────────────────────────────────────
step_start "[1/7] Building..."
if $DRY_RUN; then
  echo -e "${YELLOW}(dry-run)${RESET}"
else
  npm run build > /tmp/wp-release-build.log 2>&1 || step_fail "Build failed. See /tmp/wp-release-build.log"
  step_ok
fi

# ─── Step 2: Tests ────────────────────────────────────────────────────────────
if $SKIP_TESTS; then
  step_start "[2/7] Running tests..."
  echo -e "${YELLOW}skipped (--skip-tests)${RESET}"
else
  step_start "[2/7] Running tests..."
  if $DRY_RUN; then
    echo -e "${YELLOW}(dry-run)${RESET}"
  else
    npx vitest run --reporter=verbose > /tmp/wp-release-tests.log 2>&1 || step_fail "Tests failed. See /tmp/wp-release-tests.log"
    step_ok
  fi
fi

# ─── Step 3: Bump version ─────────────────────────────────────────────────────
step_start "[3/7] Bumping version..."
if $DRY_RUN; then
  # Compute what the next version would be without changing anything
  NEW_VER=$(node -e "
    const [maj, min, pat] = '${OLD_VER}'.split('.').map(Number);
    if ('${BUMP}' === 'major') console.log((maj+1) + '.0.0');
    else if ('${BUMP}' === 'minor') console.log(maj + '.' + (min+1) + '.0');
    else console.log(maj + '.' + min + '.' + (pat+1));
  ")
  echo -e "${YELLOW}(dry-run)${RESET} ${OLD_VER} → ${NEW_VER}"
else
  npm version "$BUMP" --no-git-tag-version > /dev/null 2>&1 || step_fail "npm version bump failed"
  NEW_VER=$(node -e "console.log(require('./package.json').version)")
  # Rebuild with new version baked in
  npm run build > /tmp/wp-release-build2.log 2>&1 || step_fail "Re-build after version bump failed"
  step_ok "${OLD_VER} → ${BOLD}${NEW_VER}${RESET}"
fi

# ─── Step 4: Publish to npm ───────────────────────────────────────────────────
step_start "[4/7] Publishing to npm..."
if $DRY_RUN; then
  echo -e "${YELLOW}(dry-run)${RESET} would publish ${NEW_VER} to npm"
else
  npm publish --ignore-scripts > /tmp/wp-release-npm.log 2>&1 || step_fail "npm publish failed. See /tmp/wp-release-npm.log"
  step_ok
fi

# ─── Step 5: Commit + push ────────────────────────────────────────────────────
step_start "[5/7] Pushing to GitHub..."
if $DRY_RUN; then
  echo -e "${YELLOW}(dry-run)${RESET} would git add -A && git commit -m \"v${NEW_VER}: Release\" && git push"
else
  git add -A
  git commit -m "v${NEW_VER}: Release" > /dev/null 2>&1 || step_fail "git commit failed"
  git push origin main > /tmp/wp-release-push.log 2>&1 || step_fail "git push failed. See /tmp/wp-release-push.log"
  step_ok
fi

# ─── Step 6: Wait for CI ──────────────────────────────────────────────────────
step_start "[6/7] Waiting for CI..."
if $DRY_RUN; then
  echo -e "${YELLOW}(dry-run)${RESET} would poll gh run list every 10s (timeout 10m)"
else
  CI_TIMEOUT=600   # 10 minutes
  CI_POLL=10       # seconds between polls
  CI_START=$(date +%s)
  CI_STATUS=""
  CI_RUN_ID=""

  # Give GitHub a few seconds to register the new run
  sleep 5

  while true; do
    NOW=$(date +%s)
    ELAPSED=$(( NOW - CI_START ))
    if (( ELAPSED >= CI_TIMEOUT )); then
      step_fail "CI timed out after 10 minutes."
    fi

    # Get latest run for this commit
    CI_JSON=$(gh run list --branch main --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")
    CI_STATUS=$(echo "$CI_JSON" | node -e "
      try {
        const runs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        if (runs.length) console.log(runs[0].status + ':' + (runs[0].conclusion||''));
        else console.log('pending:');
      } catch { console.log('pending:'); }
    ")
    CI_RUN_ID=$(echo "$CI_JSON" | node -e "
      try {
        const runs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        if (runs.length) console.log(runs[0].databaseId);
        else console.log('');
      } catch { console.log(''); }
    ")

    STATUS_PART="${CI_STATUS%%:*}"
    CONCLUSION_PART="${CI_STATUS##*:}"

    if [[ "$STATUS_PART" == "completed" ]]; then
      if [[ "$CONCLUSION_PART" == "success" ]]; then
        step_ok
        break
      else
        step_fail "CI completed with status: ${CONCLUSION_PART}. Check: gh run view ${CI_RUN_ID}"
      fi
    fi

    sleep $CI_POLL
  done
fi

# ─── Step 7: Verify live deploy ───────────────────────────────────────────────
step_start "[7/7] Verifying live deploy..."
if $DRY_RUN; then
  echo -e "${YELLOW}(dry-run)${RESET} would poll https://api.webpeel.dev/health until version=${NEW_VER} (timeout 3m)"
else
  VER_TIMEOUT=180  # 3 minutes
  VER_POLL=10
  VER_START=$(date +%s)
  LIVE_VER=""

  while true; do
    NOW=$(date +%s)
    ELAPSED=$(( NOW - VER_START ))
    if (( ELAPSED >= VER_TIMEOUT )); then
      step_fail "Live version check timed out. Last seen: ${LIVE_VER:-unknown}. Expected: ${NEW_VER}"
    fi

    HEALTH_JSON=$(curl -sf "https://api.webpeel.dev/health?v=$(date +%s)" 2>/dev/null || echo "{}")
    LIVE_VER=$(echo "$HEALTH_JSON" | node -e "
      try { console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version || ''); }
      catch { console.log(''); }
    ")

    if [[ "$LIVE_VER" == "$NEW_VER" ]]; then
      step_ok "v${NEW_VER}"
      break
    fi

    sleep $VER_POLL
  done
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
divider
TOTAL=$(elapsed "$RELEASE_START")
if $DRY_RUN; then
  echo -e "${YELLOW}${BOLD}🔍 Dry run complete — v${NEW_VER} would be released in ~${TOTAL}${RESET}"
else
  echo -e "${GREEN}${BOLD}✅ Released v${NEW_VER} in ${TOTAL}${RESET}"
fi
echo -e "   npm: ${CYAN}https://npmjs.com/package/webpeel${RESET}"
echo -e "   API: ${CYAN}https://api.webpeel.dev/health${RESET}"
echo ""
