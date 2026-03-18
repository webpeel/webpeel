#!/bin/bash
# k8s-health-check.sh — Comprehensive K8s health check for heartbeat integration
# Returns JSON with all cluster health metrics
# Usage: ./scripts/k8s-health-check.sh [hetzner-host]

set -euo pipefail

HOST="${1:-178.156.229.86}"
TIMEOUT=10

# Run all checks via single SSH session for efficiency
RESULT=$(ssh -o ConnectTimeout=${TIMEOUT} -o StrictHostKeyChecking=no root@${HOST} bash -s 2>/dev/null <<'ENDSSH'
#!/bin/bash
set -euo pipefail

# Disk usage
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
DISK_TOTAL=$(df -h / | tail -1 | awk '{print $2}')
DISK_USED=$(df -h / | tail -1 | awk '{print $3}')
DISK_AVAIL=$(df -h / | tail -1 | awk '{print $4}')

# Pod status
API_READY=$(kubectl get pods -n webpeel -l app=api --no-headers 2>/dev/null | grep -c "Running" || echo 0)
API_TOTAL=$(kubectl get pods -n webpeel -l app=api --no-headers 2>/dev/null | wc -l | tr -d ' ')
WORKER_READY=$(kubectl get pods -n webpeel -l app=worker --no-headers 2>/dev/null | grep -c "Running" || echo 0)
WORKER_TOTAL=$(kubectl get pods -n webpeel -l app=worker --no-headers 2>/dev/null | wc -l | tr -d ' ')
REDIS_READY=$(kubectl get pods -n webpeel -l app=redis --no-headers 2>/dev/null | grep -c "Running" || echo 0)

# Crash loops
CRASH_PODS=$(kubectl get pods -n webpeel --no-headers 2>/dev/null | awk '$4 > 3 {print $1 "(" $4 "x)"}' | tr '\n' ',' | sed 's/,$//')

# Evicted/failed pods
BAD_PODS=$(kubectl get pods -n webpeel --no-headers 2>/dev/null | grep -cE "Evicted|Error|CrashLoop|ImagePull" || echo 0)

# Node conditions
NODE_DISK_PRESSURE=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="DiskPressure")].status}' 2>/dev/null || echo "Unknown")
NODE_MEMORY_PRESSURE=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="MemoryPressure")].status}' 2>/dev/null || echo "Unknown")
NODE_READY=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")

# API health (from inside the cluster)
API_VERSION=$(curl -sf --max-time 5 https://api.webpeel.dev/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "unreachable")

# Load average
LOAD=$(cat /proc/loadavg | awk '{print $1}')

# Memory
MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_FREE=$(free -m | awk '/Mem:/{print $4+$6+$7}')

# Docker image count (for cleanup tracking)
DOCKER_IMAGES=$(docker images --format '{{.Repository}}' 2>/dev/null | wc -l | tr -d ' ' || echo 0)
CONTAINERD_IMAGES=$(k3s ctr images list -q 2>/dev/null | wc -l | tr -d ' ' || echo 0)

cat <<JSON
{
  "disk": {"pct": ${DISK_PCT}, "total": "${DISK_TOTAL}", "used": "${DISK_USED}", "avail": "${DISK_AVAIL}"},
  "pods": {"api": "${API_READY}/${API_TOTAL}", "worker": "${WORKER_READY}/${WORKER_TOTAL}", "redis": "${REDIS_READY}/1"},
  "crashes": "${CRASH_PODS:-none}",
  "badPods": ${BAD_PODS},
  "node": {"diskPressure": "${NODE_DISK_PRESSURE}", "memPressure": "${NODE_MEMORY_PRESSURE}", "ready": "${NODE_READY}"},
  "api": {"version": "${API_VERSION}"},
  "system": {"load": ${LOAD}, "memTotal": ${MEM_TOTAL}, "memUsed": ${MEM_USED}, "memFree": ${MEM_FREE}},
  "images": {"docker": ${DOCKER_IMAGES}, "containerd": ${CONTAINERD_IMAGES}},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
ENDSSH
) || {
  echo '{"error":"SSH connection failed","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
  exit 1
}

echo "$RESULT"
