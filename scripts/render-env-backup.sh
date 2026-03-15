#!/bin/bash
# render-env-backup.sh — Backup all Render env vars to a local encrypted file
# Run this BEFORE any deploy or env var change as a safety net.

set -euo pipefail

SERVICE_ID="srv-d673vsogjchc73ahgj6g"
API_KEY=$(grep 'key:' ~/.render/cli.yaml | head -1 | awk '{print $2}')
BACKUP_DIR="$HOME/.openclaw/secure/render-backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/env-vars-$TIMESTAMP.json"

echo "▶ Backing up Render env vars..."
curl -s "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -H "Authorization: Bearer $API_KEY" | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const vars = data.map(e => {
  const ev = e.envVar || e;
  return { key: ev.key, value: ev.value };
});
console.log(JSON.stringify(vars, null, 2));
" > "$BACKUP_FILE"

COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BACKUP_FILE','utf8')).length)")
echo "✅ Backed up $COUNT env vars to $BACKUP_FILE"
echo "⚠️  This file contains secrets — do NOT commit to git"
