# WebPeel Infrastructure Map

> **Single source of truth for all deployment infrastructure.**
> Updated: 2026-02-27. If you change infra, update this file.

## ⚠️ Vercel Team: VoltBee (Pro)

**ALL deploys go to the `volt-bee` team. NEVER deploy to `jakeliumes-projects` (Hobby).**
- Hobby = free tier, limited builds, no team features
- VoltBee = Pro ($20/mo), production-grade
- **CLI default team is set to `volt-bee`** — so `vercel --prod` goes to the right place
- If it ever gets reset, run: `vercel teams switch volt-bee`

## Vercel Projects (2 total — no more, no less)

| Project | ID | Domain | Root Dir | Framework | Git Connected |
|---------|-----|--------|----------|-----------|--------------|
| **site** | `prj_4uXgj2S07kYHQWSoljJg7mfJ4Thm` | `webpeel.dev` | `site/` | Static (Other) | ✅ `webpeel/webpeel` main |
| **dashboard** | `prj_aDU02eHfyeoUxIAiLRZXLnLAgTG4` | `app.webpeel.dev` | `dashboard/` | Next.js | ❌ Needs connection |

### CLI Deploy Commands (emergency manual fallback ONLY)
```bash
# Site — from repo root
cd site && vercel --prod --scope volt-bee

# Dashboard — from repo root
cd dashboard && vercel --prod --scope volt-bee
```

### ⚠️ Rules
- **Never create new Vercel projects.** We have exactly 2. If you think you need a 3rd, you're wrong.
- **Always deploy to `volt-bee` scope.** Never `jakeliumes-projects`.
- **Always deploy from the correct subdirectory** (`site/` or `dashboard/`), never from repo root.
- **Git connection = auto-deploy.** Manual `vercel --prod` is emergency fallback only.

## Also Under VoltBee Team

| Project | Domain |
|---------|--------|
| **voltbee-marketing** | `voltbee.dev` |
| **voltbee-dashboard** | `app.voltbee.dev` |

## Render (API Server)

| Service | ID | Domain |
|---------|-----|--------|
| **webpeel-api** | `srv-d673vsogjchc73ahgj6g` | `api.webpeel.dev` |

- **Plan:** Render Pro ($25/mo) — 4GB RAM, no cold starts, persistent disk
- **Deploy script:** `./scripts/render-deploy.sh` (reads key from `~/.render/cli.yaml`)
- **Health:** `https://api.webpeel.dev/health`

## Git Remotes

```
origin     https://github.com/webpeel/webpeel.git      (org repo — canonical)
jake-fork  https://github.com/JakeLiuMe/webpeel.git    (resolves to same repo)
```

## Domain DNS

| Domain | Points To | Type |
|--------|-----------|------|
| `webpeel.dev` | `76.76.21.21` | A (Vercel) |
| `app.webpeel.dev` | `cname.vercel-dns.com` | CNAME (Vercel) |
| `api.webpeel.dev` | Render | CNAME |
| `status.webpeel.dev` | ❌ Connection refused | Needs fix or removal |

## npm

- Package: `webpeel` on npm
- Current published version: `0.17.1`
