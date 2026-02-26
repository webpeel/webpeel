# Authentication

WebPeel uses API keys to authenticate requests. All API calls must include your key.

---

## Getting Your API Key

1. Sign up at [app.webpeel.dev/signup](https://app.webpeel.dev/signup)
2. Navigate to **Settings → API Keys**
3. Click **Create new key**
4. Give it a name (e.g., "Production", "Development")
5. Copy the key — it's only shown once

API keys start with `wp_` followed by a 32-character string.

---

## Using Your API Key

### HTTP Header (Recommended)

```bash
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_your_key_here"
```

### Query Parameter (Less Secure)

```bash
# Avoid this in production — key appears in logs and browser history
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com&key=wp_your_key_here"
```

### SDK (Key via Environment Variable)

```bash
export WEBPEEL_API_KEY=wp_your_key_here
```

```typescript
const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });
```

```python
wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])
```

---

## Best Practices

**Store keys securely:**
```bash
# ✅ Environment variable
export WEBPEEL_API_KEY=wp_...

# ✅ .env file (never commit to git)
echo "WEBPEEL_API_KEY=wp_..." >> .env
echo ".env" >> .gitignore

# ❌ Hardcoded in source
const wp = new WebPeel({ apiKey: "wp_..." }); // Never do this
```

**Use separate keys per environment:**
- `Production` — your live app
- `Development` — local dev and testing
- `CI/CD` — automated tests

This way you can rotate keys independently and revoke compromised keys without downtime.

**Rotate keys regularly:**
- Go to **Settings → API Keys**
- Click **Rotate** next to an existing key
- Update your environment variables within 24 hours
- The old key remains valid for 24 hours after rotation

---

## Key Scopes

By default, API keys have access to all endpoints. Future versions will support scoped keys.

---

## Revoking a Key

If a key is compromised:
1. Go to **Settings → API Keys** in the [dashboard](https://app.webpeel.dev)
2. Click **Revoke** next to the key
3. The key is invalidated immediately
4. Create a new key and update your application

---

## IP Allowlisting (Enterprise)

Enterprise plans can restrict which IP addresses can use an API key.

Contact [support@webpeel.dev](mailto:support@webpeel.dev) or see [Enterprise pricing](https://webpeel.dev/pricing).
