# Rate Limits & Pricing

WebPeel uses a weekly request allowance. Limits reset every Monday at 00:00 UTC.

---

## Plans

| Plan | Price | Weekly Requests | Features |
|------|-------|-----------------|----------|
| **Free** | $0/mo | 500 | All core features |
| **Pro** | $9/mo | 1,250 | All features + protected site access |
| **Max** | $29/mo | 6,250 | All features + priority queue |
| **Enterprise** | Custom | Unlimited | SLA, dedicated infra, custom domains |

[Upgrade your plan →](https://app.webpeel.dev/settings/billing)

---

## What Counts as a Request?

Each API call to a billable endpoint counts as one request:

| Action | Requests Used |
|--------|---------------|
| `GET /v1/fetch` | 1 |
| `GET /v1/search` | 1 (regardless of `limit`) |
| `POST /v1/extract` | 1 |
| `GET /v1/screenshot` | 1 |
| `GET /v1/youtube` | 1 |
| `GET /v1/pdf` | 1 |
| `POST /v1/batch` | 1 per URL in the batch |
| `POST /v1/crawl` | 1 per page crawled |
| MCP tool call | Same as the underlying endpoint |

Free endpoints (don't count against your limit):
- `GET /v1/health`
- `GET /v1/me` (account info)
- `GET /v1/monitor` (list only, not triggering)

---

## HTTP Rate Limit Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 347
X-RateLimit-Reset: 1740355200
X-RateLimit-Window: weekly
```

When you hit the limit, you'll receive:

```
HTTP 429 Too Many Requests

{
  "error": "rate_limit_exceeded",
  "message": "Weekly request limit reached. Resets Monday at 00:00 UTC.",
  "limit": 500,
  "used": 500,
  "resetsAt": "2026-03-02T00:00:00Z",
  "upgradeUrl": "https://app.webpeel.dev/settings/billing"
}
```

---

## Checking Your Usage

**Dashboard:** [app.webpeel.dev/usage](https://app.webpeel.dev/usage)

**API:**
```bash
curl "https://api.webpeel.dev/v1/me" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  | jq '.usage'
```

```json
{
  "plan": "free",
  "requestsUsed": 153,
  "requestsLimit": 500,
  "requestsRemaining": 347,
  "resetsAt": "2026-03-02T00:00:00Z"
}
```

---

## Concurrent Request Limits

To ensure fair service across all users:

| Plan | Max Concurrent Requests |
|------|------------------------|
| Free | 3 |
| Pro | 10 |
| Max | 25 |
| Enterprise | Custom |

If you exceed the concurrency limit, requests are queued (not rejected). Max and Enterprise plans have priority queue access.

---

## Enterprise & High-Volume

Need more than 6,250 requests/week? Options:

- **Enterprise plan** — unlimited requests, dedicated infra, SLA
- **Custom volume pricing** — pay per request at scale
- **Self-hosted deployment** — run WebPeel on your own infrastructure

Contact [sales@webpeel.dev](mailto:sales@webpeel.dev) or [book a call](https://webpeel.dev/enterprise).
