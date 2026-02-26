# WebPeel CF Worker Proxy

A Cloudflare Worker that proxies fetch requests from Cloudflare's edge network.

## Why

When PeelTLS fails due to IP-level blocking (the requester's IP is in a blocklist),
this Worker re-routes the request through Cloudflare's edge network. Cloudflare
has millions of IPs worldwide that many anti-bot systems don't flag — unlike the
small pool of datacenter IPs from Render or other server hosts.

**Free tier:** 100,000 requests/day — zero cost for most use cases.

## Escalation Chain

```
peel("https://bestbuy.com/...") 
  → PeelTLS (Chrome TLS fingerprint)        [85% success]
    → CF Worker proxy (Cloudflare edge IPs)  [+5% success]  ← this
      → search-fallback (snippets)           [last resort]
```

## Setup (5 minutes)

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login  # Opens browser for Cloudflare auth
```

### 2. Deploy

```bash
cd worker
npx wrangler deploy
```

Output will give you a URL like `https://webpeel-proxy.<your-subdomain>.workers.dev`

### 3. Set a Secret Auth Token (recommended)

```bash
npx wrangler secret put WORKER_AUTH_TOKEN
# Enter a random 32+ char string when prompted
# e.g.: openssl rand -hex 16
```

### 4. Configure WebPeel

Set environment variables:

```bash
# Required
export WEBPEEL_CF_WORKER_URL=https://webpeel-proxy.<your-subdomain>.workers.dev

# Optional but recommended
export WEBPEEL_CF_WORKER_TOKEN=<the token you set in step 3>
```

For Render.com deployment:
- Dashboard → Service → Environment → Add Environment Variables
- Add `WEBPEEL_CF_WORKER_URL` and `WEBPEEL_CF_WORKER_TOKEN`

### 5. Verify

```bash
# Health check
curl https://webpeel-proxy.<your-subdomain>.workers.dev/health
# → {"status":"ok","edge":"EWR"}

# Test a fetch
curl -X POST https://webpeel-proxy.<your-subdomain>.workers.dev/fetch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"url":"https://httpbin.org/ip"}' | jq .
```

## How It Works

The Worker receives a POST request from the WebPeel API server:

```json
{
  "url": "https://www.bestbuy.com/...",
  "headers": { "User-Agent": "Mozilla/5.0..." },
  "method": "GET",
  "timeout": 30,
  "followRedirects": true
}
```

It fetches the URL from Cloudflare's edge, and returns:

```json
{
  "status": 200,
  "body": "<html>...",
  "finalUrl": "https://...",
  "headers": {},
  "timing": { "totalMs": 847 },
  "edge": "LAX"
}
```

The `edge` field shows which Cloudflare datacenter handled it (useful for debugging).

## Limits

- Free tier: 100,000 requests/day, 10ms CPU time per request
- Paid ($5/mo): 10M requests/month, unlimited CPU
- Max response body: 128MB (more than enough for HTML)
- No persistent storage (stateless proxy only)

## Limitations

Some anti-bot systems (Akamai strict mode, PerimeterX) also track Cloudflare
datacenter IPs. For those sites, residential proxies are still needed.
This Worker is most effective against IP-range-based blocking (e.g., blocking
all AWS/Render/Digital Ocean IPs) where Cloudflare's residential-adjacent
CDN IPs aren't yet flagged.
