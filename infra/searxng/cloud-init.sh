#!/bin/bash
# cloud-init.sh — Bootstrap SearXNG on a fresh Hetzner VPS
# Run as root on first boot via cloud-init user-data
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== WebPeel SearXNG Setup ==="

# 1. System updates
apt-get update -qq
apt-get upgrade -y -qq

# 2. Install Docker
curl -fsSL https://get.docker.com | sh

# 3. Create app directory
mkdir -p /opt/searxng
cd /opt/searxng

# 4. Write docker-compose.yml
cat > docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    ports:
      - "8888:8080"
    volumes:
      - ./settings.yml:/etc/searxng/settings.yml:ro
    environment:
      - SEARXNG_BASE_URL=https://search.webpeel.dev
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETGID
      - SETUID
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
COMPOSE

# 5. Write SearXNG settings
SECRET=$(openssl rand -hex 32)
cat > settings.yml << SETTINGS
use_default_settings: true

general:
  debug: false
  instance_name: "WebPeel Search"

server:
  port: 8080
  bind_address: "0.0.0.0"
  secret_key: "$SECRET"
  limiter: false
  public_instance: false
  image_proxy: false

search:
  safe_search: 0
  autocomplete: ""
  default_lang: "en"
  formats:
    - html
    - json

ui:
  static_use_hash: true

outgoing:
  request_timeout: 6
  max_request_timeout: 12
  useragent_suffix: ""
  pool_connections: 100
  pool_maxsize: 20

engines:
  - name: google
    engine: google
    shortcut: g
    disabled: false
  - name: bing
    engine: bing
    shortcut: b
    disabled: false
  - name: brave
    engine: brave
    shortcut: br
    disabled: false
  - name: duckduckgo
    engine: duckduckgo
    shortcut: ddg
    disabled: false
  - name: startpage
    engine: startpage
    shortcut: sp
    disabled: false
  - name: mojeek
    engine: mojeek
    shortcut: mj
    disabled: false
  - name: qwant
    engine: qwant
    shortcut: qw
    disabled: false
SETTINGS

# 6. Set up firewall (allow SSH + SearXNG)
ufw allow 22/tcp
ufw allow 8888/tcp
ufw --force enable

# 7. Start SearXNG
docker compose up -d

# 8. Wait and verify
sleep 10
curl -s "http://localhost:8888/search?q=test&format=json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('SearXNG ready:', len(d.get('results',[])), 'results')
" || echo "SearXNG starting up..."

echo "=== Setup complete ==="
echo "SearXNG running on port 8888"
echo "Test: curl http://$(hostname -I | awk '{print $1}'):8888/search?q=test&format=json"
