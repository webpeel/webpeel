#!/usr/bin/env bash
# hetzner-cleanup.sh — Clean Docker images, build cache, and containerd images on Hetzner
# Meant to be installed as a daily cron on the Hetzner VPS (K3s uses containerd)
#
# Install via: ./scripts/setup-hetzner-cron.sh
# Log output:  /var/log/webpeel-cleanup.log

set -euo pipefail

LOG="/var/log/webpeel-cleanup.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

log "=== WebPeel Cleanup started ==="

# ─── 1. Docker: prune dangling images and build cache ─────────────────────────
if command -v docker &>/dev/null; then
  log "Docker: pruning images older than 48h..."
  docker image prune -af --filter "until=48h" >> "$LOG" 2>&1 || log "WARN: docker image prune failed"

  log "Docker: pruning build cache older than 48h..."
  docker builder prune -af --filter "until=48h" >> "$LOG" 2>&1 || log "WARN: docker builder prune failed"
else
  log "Docker: not found, skipping"
fi

# ─── 2. K3s containerd: remove images not in use by running pods ──────────────
if command -v kubectl &>/dev/null && command -v k3s &>/dev/null; then
  log "K3s: scanning for unused containerd images..."

  # Get images currently referenced by all pods (all namespaces)
  USED_IMAGES=$(kubectl get pods -A \
    -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{range .spec.initContainers[*]}{.image}{"\n"}{end}{end}' \
    2>/dev/null | sort -u) || USED_IMAGES=""

  # Get all images known to containerd
  ALL_IMAGES=$(k3s ctr images list -q 2>/dev/null | sort -u) || ALL_IMAGES=""

  REMOVED=0
  SKIPPED=0
  for img in $ALL_IMAGES; do
    # Skip pause/sandbox images — K3s internals
    if echo "$img" | grep -qE "rancher/mirrored-pause|docker.io/rancher|pause:"; then
      SKIPPED=$(( SKIPPED + 1 ))
      continue
    fi

    if ! echo "$USED_IMAGES" | grep -qF "$img"; then
      log "Removing unused: $img"
      k3s ctr images rm "$img" >> "$LOG" 2>&1 || log "WARN: failed to remove $img (in use?)"
      REMOVED=$(( REMOVED + 1 ))
    else
      SKIPPED=$(( SKIPPED + 1 ))
    fi
  done

  log "K3s: removed=${REMOVED} kept=${SKIPPED}"
else
  log "K3s/kubectl: not found, skipping containerd cleanup"
fi

# ─── 3. Journal / log rotation (optional — comment out if unwanted) ───────────
if command -v journalctl &>/dev/null; then
  log "Journal: vacuuming logs older than 7 days..."
  journalctl --vacuum-time=7d >> "$LOG" 2>&1 || true
fi

# ─── 4. Disk usage report ─────────────────────────────────────────────────────
DISK_ROOT=$(df -h / | tail -1 | awk '{print "used=" $3 " avail=" $4 " pct=" $5}')
DISK_VAR=""
if mountpoint -q /var 2>/dev/null; then
  DISK_VAR=$(df -h /var | tail -1 | awk '{print "used=" $3 " avail=" $4 " pct=" $5}')
  log "Disk /var:  $DISK_VAR"
fi
log "Disk /:     $DISK_ROOT"
log "=== WebPeel Cleanup done ==="
