#!/usr/bin/env bash
# deploy.sh — Deploy WebPeel Research Worker to Hetzner VPS
# Usage: cd infra/research-worker && bash deploy.sh
set -euo pipefail

HETZNER="root@178.156.229.86"
REMOTE_DIR="/opt/research-worker"
OLLAMA_SECRET="c996233de4addb47e4cdec8bc5ff8776397f813ca7bd444e7258e0e2ed251963"

echo "🚀 Deploying WebPeel Research Worker to Hetzner..."

# ── 1. Create remote directory ───────────────────────────────────────────────
echo "📁 Creating $REMOTE_DIR..."
ssh "$HETZNER" "mkdir -p $REMOTE_DIR"

# ── 2. Copy files ────────────────────────────────────────────────────────────
echo "📦 Copying files..."
scp package.json server.js "$HETZNER:$REMOTE_DIR/"

# ── 3. npm install --production ──────────────────────────────────────────────
echo "📥 Installing dependencies..."
ssh "$HETZNER" "cd $REMOTE_DIR && npm install --production --omit=dev"

# ── 4. Install nginx config (port 3002, bearer auth, proxy to :3001) ─────────
echo "🌐 Installing nginx config..."
ssh "$HETZNER" "cat > /etc/nginx/sites-available/webpeel-research << 'NGINX_EOF'
server {
    listen 3002;

    # Bearer token auth — reuse OLLAMA_SECRET
    set \$expected \"Bearer $OLLAMA_SECRET\";
    if (\$http_authorization != \$expected) {
        return 401 '{\"error\":\"unauthorized\"}';
    }

    # Add content-type header to 401 responses
    add_header Content-Type application/json always;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_read_timeout 60s;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
    }
}
NGINX_EOF"

# Enable the site
ssh "$HETZNER" "
  ln -sf /etc/nginx/sites-available/webpeel-research /etc/nginx/sites-enabled/webpeel-research
  nginx -t && systemctl reload nginx
  echo '✅ Nginx reloaded'
"

# ── 5. Install and start systemd service ─────────────────────────────────────
echo "⚙️  Installing systemd service..."
scp webpeel-research.service "$HETZNER:/etc/systemd/system/webpeel-research.service"

ssh "$HETZNER" "
  systemctl daemon-reload
  systemctl enable webpeel-research
  systemctl restart webpeel-research
  sleep 2
  systemctl status webpeel-research --no-pager -l
"

# ── 6. Smoke test ────────────────────────────────────────────────────────────
echo ""
echo "🧪 Smoke-testing health endpoint..."
ssh "$HETZNER" "curl -sf http://127.0.0.1:3001/health | python3 -m json.tool || echo 'Health check failed — check logs: journalctl -u webpeel-research -n 50'"

echo ""
echo "✅ Deploy complete!"
echo ""
echo "Next steps:"
echo "  1. Test from Render: set RESEARCH_WORKER_URL=http://178.156.229.86:3002 in Render env vars"
echo "  2. Test the research endpoint:"
echo "     curl -s http://178.156.229.86:3002/research \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -H 'Authorization: Bearer $OLLAMA_SECRET' \\"
echo "       -d '{\"query\":\"iPhone 16 Pro price\",\"maxSources\":2}' | python3 -m json.tool"
echo ""
echo "  3. Monitor logs: ssh $HETZNER 'journalctl -u webpeel-research -f'"
