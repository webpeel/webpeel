# Self-Hosting WebPeel

This guide shows you how to run your own instance of the WebPeel API server using Docker.

## Prerequisites

- **Docker** (v20.10+): [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose** (v2.0+): Usually included with Docker Desktop
- **Git**: To clone the repository

Verify your setup:
```bash
docker --version
docker compose version
```

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/JakeLiuMe/webpeel.git
cd webpeel
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Required: Change this to a secure random string!
JWT_SECRET=your-secure-random-secret-here

# Optional: Add custom CORS origins
CORS_ORIGINS=https://your-domain.com,https://app.your-domain.com

# Optional: Stripe integration (for paid tiers)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Optional: Sentry error tracking
SENTRY_DSN=https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**⚠️ Security:** Generate a strong `JWT_SECRET` using:
```bash
openssl rand -base64 32
```

### 3. Start the Server

```bash
docker compose up -d
```

That's it! Your WebPeel instance is now running at `http://localhost:3000`.

---

## Verify It's Working

Check the health endpoint:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-...",
  "uptime": 123
}
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `production` | Runtime environment |
| `DATABASE_URL` | Yes* | Auto-configured | PostgreSQL connection string |
| `JWT_SECRET` | **YES** | - | Secret for JWT tokens (⚠️ change in production!) |
| `CORS_ORIGINS` | No | See below | Comma-separated list of allowed origins |
| `STRIPE_SECRET_KEY` | No | - | Stripe API key (for paid features) |
| `STRIPE_WEBHOOK_SECRET` | No | - | Stripe webhook signing secret |
| `SENTRY_DSN` | No | - | Enable Sentry error reporting for API/server exceptions |
| `SENTRY_ENVIRONMENT` | No | `NODE_ENV` | Sentry environment label (`production`, `staging`, etc.) |
| `SENTRY_RELEASE` | No | - | Release tag shown in Sentry issues (e.g. `webpeel@0.7.0`) |
| `SENTRY_TRACES_SAMPLE_RATE` | No | unset | APM traces sample rate from `0.0` to `1.0` |

**Default CORS Origins:**
- `https://app.webpeel.dev`
- `https://webpeel.dev`
- `http://localhost:3000`
- `http://localhost:3001`

**\*Note:** `DATABASE_URL` is automatically set by `docker-compose.yaml`. Only change it if you're using an external database.

---

## Usage

### Register a User

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "you@example.com",
    "password": "your-secure-password"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_...",
    "email": "you@example.com",
    "tier": "free"
  }
}
```

Save the `token` — you'll need it for API requests.

### Fetch a Page

```bash
curl "http://localhost:3000/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Search the Web

```bash
curl "http://localhost:3000/v1/search?q=docker+containers" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Custom Configuration

### Use External PostgreSQL

Edit `docker-compose.yaml` and remove the `db` service:

```yaml
services:
  webpeel:
    environment:
      - DATABASE_URL=postgresql://user:pass@your-db-host:5432/webpeel
    # Remove the depends_on section
```

### Change Port

Edit `docker-compose.yaml`:

```yaml
services:
  webpeel:
    ports:
      - "8080:3000"  # Host:Container
```

### Increase Rate Limits

The server uses in-memory rate limiting. To customize, you'll need to modify `src/server/app.ts` and rebuild.

---

## Updating

Pull the latest changes and rebuild:

```bash
cd webpeel
git pull origin main
docker compose down
docker compose up -d --build
```

**Note:** Your database data persists in the `pgdata` Docker volume.

---

## Troubleshooting

### Server won't start

**Check logs:**
```bash
docker compose logs webpeel
```

**Common issues:**
- `JWT_SECRET` not set → Edit `.env` and add a secret
- Database connection failed → Wait 30s for Postgres to initialize
- Port 3000 already in use → Change the port mapping in `docker-compose.yaml`

### Health check fails

The server needs ~30-40 seconds to start (Playwright browser installation). Check:

```bash
docker compose ps
```

If `webpeel` shows as `unhealthy`, wait a bit longer or check logs.

### Playwright browser crashes

**Increase shared memory:**

Edit `docker-compose.yaml`:
```yaml
services:
  webpeel:
    shm_size: '2gb'  # Add this line
```

### Reset everything

Stop containers and delete all data:
```bash
docker compose down -v
```

**⚠️ Warning:** This deletes your database!

---

## Production Deployment

### Security Checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Change default database password in `docker-compose.yaml`
- [ ] Use HTTPS (put WebPeel behind a reverse proxy like Nginx/Caddy)
- [ ] Set `NODE_ENV=production`
- [ ] Restrict CORS origins to your domains only
- [ ] Enable firewall rules (only expose necessary ports)
- [ ] Set up automated backups for PostgreSQL data

### Reverse Proxy Example (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Backup PostgreSQL

```bash
# Backup
docker compose exec db pg_dump -U webpeel webpeel > backup.sql

# Restore
docker compose exec -T db psql -U webpeel webpeel < backup.sql
```

---

## Getting Help

- **Issues:** [GitHub Issues](https://github.com/JakeLiuMe/webpeel/issues)
- **Documentation:** [webpeel.dev](https://webpeel.dev)
- **Support:** Open an issue on [GitHub Issues](https://github.com/JakeLiuMe/webpeel/issues)

---

## License

MIT — see [LICENSE](LICENSE) for details.
