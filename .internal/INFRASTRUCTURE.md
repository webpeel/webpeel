# WebPeel Infrastructure Map

## Production
| Service | URL | Platform | Plan |
|---------|-----|----------|------|
| **API** | `api.webpeel.dev` | Render (Docker) | Pro $25/mo |
| **Site** | `webpeel.dev` | Vercel (VoltBee team) | Pro |
| **Dashboard** | `app.webpeel.dev` | Vercel (VoltBee team) | Pro |
| **Database** | (internal) | Render PostgreSQL | Pro |

## Staging
| Service | URL | Platform | Plan |
|---------|-----|----------|------|
| **API** | `webpeel-api-staging.onrender.com` | Render (Docker) | Starter $7/mo |
| **Database** | (internal) | Render PostgreSQL | Free (expires Mar 30) |

## Git Branches
- `main` → auto-deploys to **production** (Render + Vercel)
- `staging` → auto-deploys to **staging** (Render)

## Render Service IDs
- Production API: `srv-d673vsogjchc73ahgj6g`
- Staging API: (check Render dashboard)
- Staging DB: `webpeel-db-staging`

## Vercel Projects (VoltBee team ONLY)
- Site: `prj_4uXgj2S07kYHQWSoljJg7mfJ4Thm` → webpeel.dev
- Dashboard: `prj_aDU02eHfyeoUxIAiLRZXLnLAgTG4` → app.webpeel.dev

## npm
- Package: `webpeel` on npmjs.com
- Current version: check `npm view webpeel version`

*Last updated: 2026-02-28*
