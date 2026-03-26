#!/bin/bash
# validate-db-schema.sh — Verify DB schema matches what the code expects
# Run after any DB migration or fresh setup
# Usage: DATABASE_URL=... bash scripts/validate-db-schema.sh

set -uo pipefail
ERRORS=0

check_column() {
  local table=$1 col=$2
  local result=$(psql "$DATABASE_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='$table' AND column_name='$col';" 2>/dev/null | tr -d ' ')
  if [ -z "$result" ]; then
    echo "  ❌ $table.$col — MISSING"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✅ $table.$col"
  fi
}

echo "🔍 Validating database schema..."
echo ""

echo "== users =="
for col in id email password_hash tier weekly_limit burst_limit rate_limit name avatar_url stripe_customer_id; do
  check_column users "$col"
done

echo "== api_keys =="
for col in id user_id key_hash key_prefix name is_active scope; do
  check_column api_keys "$col"
done

echo "== weekly_usage =="
for col in id user_id api_key_id week basic_count stealth_count captcha_count search_count total_count rollover_credits; do
  check_column weekly_usage "$col"
done

echo "== burst_usage =="
for col in id api_key_id hour_bucket count; do
  check_column burst_usage "$col"
done

echo "== usage_logs =="
for col in id user_id api_key_id endpoint url method status_code processing_time_ms tokens_used fetch_method ip_address; do
  check_column usage_logs "$col"
done

echo "== oauth_accounts =="
for col in id user_id provider provider_id email name avatar_url; do
  check_column oauth_accounts "$col"
done

echo "== refresh_tokens =="
for col in id user_id expires_at; do
  check_column refresh_tokens "$col"
done

echo "== jobs =="
for col in id type payload status result error created_at expires_at owner priority; do
  check_column jobs "$col"
done

echo ""
if [ $ERRORS -gt 0 ]; then
  echo "❌ $ERRORS missing columns found! Run migrations to fix."
  exit 1
else
  echo "✅ All columns present — schema is valid"
fi
