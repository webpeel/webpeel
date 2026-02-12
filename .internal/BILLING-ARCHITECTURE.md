# Billing Architecture: How WebPeel Makes Money

## Decision: Stripe Direct (not VoltBee — yet)

### Why Stripe Direct for V1:
1. **Speed** — Stripe Checkout is live in hours, VoltBee needs more work
2. **Credibility** — "Powered by Stripe" is trusted by developers
3. **Usage-based billing** — Stripe Meters (launched 2024) handle metered pricing natively
4. **Developer trust** — same billing as Vercel, Supabase, Railway

### Dogfood VoltBee in V2:
Once WebPeel has paying customers, migrate billing to VoltBee to dogfood it.
This gives VoltBee a real customer AND proves the product.

## Billing Model: Subscription + Metered Usage

### Why Not Pure Pay-as-you-go:
- Hard to predict revenue
- Developers hate unpredictable bills
- Stripe's metered billing has minimum overhead

### Why Not Pure Subscription:
- Developers resent paying for unused capacity
- Hard to price fairly for different usage patterns

### The Hybrid (What Vercel/Supabase Do):
- **Monthly subscription** = base price + included requests
- **Overage** = per-request charge beyond included
- **Hard limits** on free tier (prevents abuse)

## Pricing Tiers

### Free (No Card Required)
- **CLI:** Unlimited, forever, no key needed
- **Hosted API:** 1,000 requests/month
- **Features:** Simple fetch + markdown conversion
- **Rate limit:** 10 req/min
- **Retention:** 0 (no cached results stored)
- **Purpose:** Adoption funnel

### Pro ($9/month)
- **Hosted API:** 25,000 requests/month
- **Overage:** $0.001/request (= $1 per 1,000 extra)
- **Features:** + JS rendering, search, metadata, 10 concurrent
- **Rate limit:** 60 req/min
- **Retention:** 24h cache
- **Purpose:** Individual developers, side projects

### Scale ($29/month)
- **Hosted API:** 100,000 requests/month
- **Overage:** $0.0005/request
- **Features:** + Residential proxies, AI extraction, batch processing
- **Rate limit:** 300 req/min
- **Retention:** 7d cache
- **Purpose:** Startups, teams, production apps

### Enterprise (Custom)
- **Hosted API:** Unlimited
- **Features:** + Dedicated infra, SLA, priority support, custom domains
- **Rate limit:** Custom
- **Purpose:** Large companies

## Stripe Implementation

### Products & Prices:
```
Product: WebPeel Pro
  - Price: $9/mo (recurring)
  - Meter: webpeel_api_requests (metered, sum)
  - Overage Price: $0.001/unit above 25,000

Product: WebPeel Scale
  - Price: $29/mo (recurring)
  - Meter: webpeel_api_requests (metered, sum)
  - Overage Price: $0.0005/unit above 100,000
```

### Checkout Flow:
1. User visits webpeel.dev/pricing
2. Click "Start Free" → creates account with API key (no card)
3. Hit limit → "Upgrade to Pro" CTA
4. Click "Upgrade" → Stripe Checkout → card on file
5. Usage tracked per API key, billed monthly

### API Key Management:
- Free keys: `wp_free_xxxx` (rate-limited, no billing)
- Pro keys: `wp_pro_xxxx` (metered, Stripe customer ID linked)
- Scale keys: `wp_scale_xxxx`
- Keys stored in Neon PostgreSQL (reuse existing VoltBee Neon instance)

### Usage Tracking:
```sql
-- Per-request logging
INSERT INTO usage_logs (api_key_id, endpoint, status, method, cached, ms, created_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW());

-- Daily rollup (cron)
INSERT INTO daily_usage (api_key_id, date, request_count, render_count, search_count)
SELECT api_key_id, DATE(created_at), COUNT(*), 
       SUM(CASE WHEN method='browser' THEN 1 ELSE 0 END),
       SUM(CASE WHEN endpoint='/v1/search' THEN 1 ELSE 0 END)
FROM usage_logs 
WHERE DATE(created_at) = CURRENT_DATE - 1
GROUP BY api_key_id, DATE(created_at);
```

### Stripe Webhook Events to Handle:
- `customer.subscription.created` → activate Pro/Scale features
- `customer.subscription.deleted` → downgrade to Free
- `invoice.payment_failed` → grace period (3 days) then downgrade
- `customer.subscription.updated` → handle plan changes

## Infrastructure for Billing:

### New Endpoints Needed:
```
POST /v1/auth/signup     — Create account + free API key
POST /v1/auth/login      — Login (magic link email)
GET  /v1/usage           — Current usage stats
GET  /v1/billing/portal  — Redirect to Stripe Customer Portal
POST /v1/billing/checkout — Create Stripe Checkout session
```

### Dashboard (webpeel.dev/dashboard):
- API key management (create, revoke, rotate)
- Usage charts (daily/weekly/monthly)
- Billing status and invoices
- Plan management (upgrade/downgrade)

## Cost Analysis:

### Per-Request Costs:
| Method | Compute | Bandwidth | Total |
|--------|---------|-----------|-------|
| Simple fetch | ~$0.00001 | ~$0.0001 | ~$0.0001 |
| Browser render | ~$0.001 | ~$0.0002 | ~$0.0012 |
| Search | ~$0.00001 | ~$0.0001 | ~$0.0001 |

### Monthly Costs at Scale:
| Users | Requests | Infra Cost | Revenue | Margin |
|-------|----------|-----------|---------|--------|
| 100 free | 100K | $7 | $0 | -$7 |
| 10 Pro | 250K | $15 | $90 | $75 |
| 5 Scale | 500K | $30 | $145 | $115 |
| Total | 850K | $52 | $235 | $183 (78%) |

## Timeline:

### V1 (Launch — Week 1):
- Free tier only (no billing)
- API keys via signup form
- Usage tracking in Neon

### V2 (Week 2-3):
- Add Stripe Checkout for Pro tier
- Customer portal for billing management
- Usage dashboard

### V3 (Month 2):
- Scale tier with metered overage
- Enterprise sales motion
- Migrate to VoltBee for billing (dogfood)
