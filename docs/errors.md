# Error Codes & Troubleshooting

All errors follow a consistent JSON format:

```json
{
  "error": "error_code",
  "message": "Human-readable description of the error",
  "details": {}
}
```

---

## HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — check your parameters |
| `401` | Unauthorized — invalid or missing API key |
| `403` | Forbidden — your plan doesn't support this feature |
| `404` | Not found — invalid endpoint or resource |
| `422` | Unprocessable — valid request, but the target failed (e.g., page blocked) |
| `429` | Rate limit exceeded — slow down or upgrade |
| `500` | Internal server error — retry with backoff |
| `503` | Service unavailable — temporary, retry in a few seconds |

---

## Error Reference

### `unauthorized`
```json
{ "error": "unauthorized", "message": "Invalid or missing API key." }
```
**Fix:** Make sure `Authorization: Bearer wp_your_key_here` is in your request header.
Check your key at [app.webpeel.dev/settings/api-keys](https://app.webpeel.dev/settings/api-keys).

---

### `rate_limit_exceeded`
```json
{
  "error": "rate_limit_exceeded",
  "message": "Weekly request limit reached. Resets Monday at 00:00 UTC.",
  "resetsAt": "2026-03-02T00:00:00Z",
  "upgradeUrl": "https://app.webpeel.dev/settings/billing"
}
```
**Fix:** Wait for reset, or [upgrade your plan](https://app.webpeel.dev/settings/billing).

---

### `invalid_url`
```json
{ "error": "invalid_url", "message": "The URL 'htp://example' is not valid." }
```
**Fix:** Ensure the URL includes the scheme (`https://`) and is well-formed.

---

### `fetch_failed`
```json
{
  "error": "fetch_failed",
  "message": "Unable to fetch the requested URL.",
  "details": { "httpStatus": 403, "url": "https://example.com" }
}
```
**Fix:** The target website returned an error. Try:
- Check that the URL is publicly accessible
- Upgrade to Pro or Max for enhanced access to protected sites
- Some sites actively block all automated access — check `details.httpStatus`

---

### `timeout`
```json
{ "error": "timeout", "message": "Request timed out after 30000ms." }
```
**Fix:** The page took too long to load. Options:
- Try again — timeouts are often transient
- Increase `timeout` parameter (max: 60000ms)
- Use `format=html` which is faster than markdown rendering

---

### `schema_invalid`
```json
{
  "error": "schema_invalid",
  "message": "Provided JSON Schema is invalid.",
  "details": { "path": "$.plans.items.price", "issue": "type must be a string" }
}
```
**Fix:** Validate your JSON Schema at [jsonschema.dev](https://jsonschema.dev).

---

### `crawl_not_found`
```json
{ "error": "crawl_not_found", "message": "Crawl job 'crawl_abc123' not found or expired." }
```
**Fix:** Crawl job IDs expire after 24 hours. Start a new crawl.

---

### `plan_required`
```json
{
  "error": "plan_required",
  "message": "This feature requires a Pro plan or higher.",
  "feature": "stealth_mode",
  "upgradeUrl": "https://app.webpeel.dev/settings/billing"
}
```
**Fix:** [Upgrade your plan](https://app.webpeel.dev/settings/billing).

---

### `internal_error`
```json
{ "error": "internal_error", "message": "An unexpected error occurred. Please try again." }
```
**Fix:** Retry with exponential backoff. If the error persists, check [status.webpeel.dev](https://status.webpeel.dev) or contact [support@webpeel.dev](mailto:support@webpeel.dev).

---

## Retry Strategy

For `500`, `503`, and `timeout` errors, use exponential backoff:

```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await wp.fetch(url);
    } catch (err: any) {
      const retryable = ['timeout', 'internal_error', 'service_unavailable'];
      if (!retryable.includes(err.code) || attempt === maxRetries - 1) {
        throw err;
      }

      // Wait 2^attempt seconds: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

```python
import time
from webpeel import WebPeel, WebPeelError

def fetch_with_retry(url: str, max_retries: int = 3):
    wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])
    retryable = {"timeout", "internal_error", "service_unavailable"}

    for attempt in range(max_retries):
        try:
            return wp.fetch(url)
        except WebPeelError as e:
            if e.code not in retryable or attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

---

## Getting Help

- 📖 [Documentation](https://webpeel.dev/docs)
- 💬 [Discord](https://discord.gg/webpeel)
- 📧 [support@webpeel.dev](mailto:support@webpeel.dev)
- 🔍 [Status page](https://status.webpeel.dev)
