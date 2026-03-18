#!/usr/bin/env bash
# setup-hetzner-cron.sh — Copy cleanup script to Hetzner and install as daily cron
# Usage: ./scripts/setup-hetzner-cron.sh [host]
#
# Default host: 178.156.229.86
# Installs:     /opt/webpeel-cleanup.sh
# Cron:         0 4 * * * (4am UTC daily)

set -euo pipefail

HETZNER_HOST="${1:-178.156.229.86}"
REMOTE_SCRIPT="/opt/webpeel-cleanup.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 Setting up Hetzner cleanup cron on ${HETZNER_HOST}"

# ─── 1. Copy cleanup script ───────────────────────────────────────────────────
echo "  → Copying scripts/hetzner-cleanup.sh → root@${HETZNER_HOST}:${REMOTE_SCRIPT}"
scp "${SCRIPT_DIR}/hetzner-cleanup.sh" "root@${HETZNER_HOST}:${REMOTE_SCRIPT}"

# ─── 2. Make executable ───────────────────────────────────────────────────────
ssh "root@${HETZNER_HOST}" "chmod +x ${REMOTE_SCRIPT}"
echo "  → chmod +x ✓"

# ─── 3. Ensure log file exists with correct permissions ───────────────────────
ssh "root@${HETZNER_HOST}" '
  touch /var/log/webpeel-cleanup.log
  chmod 644 /var/log/webpeel-cleanup.log
'
echo "  → Log file /var/log/webpeel-cleanup.log ✓"

# ─── 4. Install cron (idempotent — replaces any existing entry) ───────────────
ssh "root@${HETZNER_HOST}" "
  CRON=\"0 4 * * * ${REMOTE_SCRIPT} >> /var/log/webpeel-cleanup.log 2>&1\"
  (crontab -l 2>/dev/null | grep -v 'webpeel-cleanup'; echo \"\$CRON\") | crontab -
"
echo "  → Cron installed ✓"

# ─── 5. Confirm ───────────────────────────────────────────────────────────────
echo ""
echo "✅ Installed on ${HETZNER_HOST}:"
ssh "root@${HETZNER_HOST}" "crontab -l | grep webpeel"
echo ""
echo "To run manually:  ssh root@${HETZNER_HOST} ${REMOTE_SCRIPT}"
echo "To view logs:     ssh root@${HETZNER_HOST} tail -f /var/log/webpeel-cleanup.log"
