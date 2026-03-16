#!/bin/bash
# deploy.sh — One-command SearXNG deployment to Hetzner
# Usage: HCLOUD_TOKEN=xxx bash infra/searxng/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_NAME="webpeel-searxng"
SERVER_TYPE="cx22"        # 2 vCPU, 4GB RAM, €4.35/mo
IMAGE="ubuntu-24.04"
LOCATION="ash"            # Ashburn, VA (closest to Render US)
SSH_KEY_NAME="webpeel"

echo "=== Deploying SearXNG to Hetzner ==="

# Check token
if [ -z "${HCLOUD_TOKEN:-}" ]; then
  echo "❌ Set HCLOUD_TOKEN first"
  exit 1
fi

export HCLOUD_TOKEN

# Check if server already exists
EXISTING=$(hcloud server list -o noheader -o columns=name | grep "^${SERVER_NAME}$" || true)
if [ -n "$EXISTING" ]; then
  echo "Server '$SERVER_NAME' already exists. Getting IP..."
  IP=$(hcloud server ip "$SERVER_NAME")
  echo "IP: $IP"
  echo "Test: curl http://$IP:8888/search?q=test&format=json"
  exit 0
fi

# Upload SSH key if not exists
if ! hcloud ssh-key list -o noheader | grep -q "$SSH_KEY_NAME"; then
  echo "Uploading SSH key..."
  hcloud ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file ~/.ssh/id_ed25519.pub 2>/dev/null || \
  hcloud ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file ~/.ssh/id_rsa.pub 2>/dev/null || \
  echo "⚠️  No SSH key found — server will use root password (check email)"
fi

# Create server with cloud-init
echo "Creating server: $SERVER_NAME ($SERVER_TYPE in $LOCATION)..."
hcloud server create \
  --name "$SERVER_NAME" \
  --type "$SERVER_TYPE" \
  --image "$IMAGE" \
  --location "$LOCATION" \
  --ssh-key "$SSH_KEY_NAME" \
  --user-data-from-file "$SCRIPT_DIR/cloud-init.sh" \
  --label "project=webpeel" \
  --label "service=searxng"

IP=$(hcloud server ip "$SERVER_NAME")
echo ""
echo "✅ Server created!"
echo "   Name: $SERVER_NAME"
echo "   IP:   $IP"
echo "   Type: $SERVER_TYPE ($LOCATION)"
echo ""
echo "SearXNG will be ready in ~2-3 minutes (Docker pull + start)"
echo ""
echo "Next steps:"
echo "  1. Wait 2-3 min for cloud-init to finish"
echo "  2. Test: curl http://$IP:8888/search?q=test&format=json"
echo "  3. Add Cloudflare DNS: search.webpeel.dev → A $IP (proxied)"
echo "  4. Update Render: SEARXNG_URL=https://search.webpeel.dev"
echo "  5. Redeploy WebPeel"
