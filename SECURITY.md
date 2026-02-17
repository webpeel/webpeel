# Security

WebPeel takes security seriously. This document outlines security considerations and best practices.

## Reporting Vulnerabilities

If you discover a security vulnerability, please email **security@webpeel.dev** (or report via GitHub Security Advisories). Do not open public issues for security vulnerabilities.

We aim to respond within 48 hours and will work with you to address the issue promptly.

---

## Security Features

### 1. SSRF Protection

WebPeel includes comprehensive Server-Side Request Forgery (SSRF) protection:

- ✅ Blocks localhost, loopback, and private IP ranges
- ✅ Validates IPv4 in all formats (dotted, hex, octal, decimal)
- ✅ Blocks IPv6 loopback and unique local addresses
- ✅ Prevents IPv6-mapped IPv4 attacks (`::ffff:127.0.0.1`)
- ✅ Manual redirect handling with URL re-validation
- ✅ Maximum 10 redirects with loop detection
- ✅ Only allows HTTP and HTTPS protocols

**Blocked IP Ranges:**
- Loopback: `127.0.0.0/8`, `::1`
- Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local: `169.254.0.0/16`, `fe80::/10`
- Unique local: `fc00::/7`
- IPv6-mapped IPv4: `::ffff:0:0/96`

### 2. Resource Limits

Protection against resource exhaustion attacks:

- ✅ **Response size limit:** 10MB maximum (enforced during download)
- ✅ **Streaming downloads:** Aborts if size exceeds limit
- ✅ **Request timeout:** 30 seconds default
- ✅ **Max redirects:** 10 redirects maximum
- ✅ **Concurrent browsers:** Limited to 5 simultaneous pages
- ✅ **Queue timeout:** 30 second max wait for browser availability
- ✅ **URL length limit:** 2048 characters maximum
- ✅ **User agent length:** 500 characters maximum

### 3. API Authentication

**Important:** The in-memory auth store is for development/self-hosted use only.

**Production deployments should:**
- Use a PostgreSQL-backed auth store
- Generate cryptographically strong API keys (minimum 32 characters)
- Rotate keys regularly
- Implement key revocation

**Timing Attack Protection:**
- API key validation uses constant-time comparison (`crypto.timingSafeEqual`)
- Prevents timing-based key enumeration

### 4. Rate Limiting

- Sliding window rate limiting (default: 60 requests/minute)
- Configurable per API key tier
- Rate limit headers included in responses

### 5. Input Validation

All inputs are validated and sanitized:
- ✅ URL format and protocol validation
- ✅ Control character filtering
- ✅ Parameter type and range validation
- ✅ Content-type verification
- ✅ MCP input size limits

---

## Best Practices for Self-Hosting

### 1. Environment Configuration

```bash
# Production mode
NODE_ENV=production

# CORS whitelist (comma-separated)
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Demo key (development only)
DEMO_KEY=your-development-key-here
```

**Never expose demo keys in production!**

### 2. Reverse Proxy Setup

Deploy behind a reverse proxy (nginx, Cloudflare, AWS ALB):

```nginx
# Example nginx config
location /v1/ {
    proxy_pass http://localhost:3000;
    
    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";
    
    # Rate limiting
    limit_req zone=api burst=20 nodelay;
    
    # Timeout
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
}
```

### 3. Firewall Rules

- **Inbound:** Only allow HTTP(S) traffic on API port
- **Outbound:** Consider blocking internal IP ranges at network level for defense-in-depth

### 4. Monitoring

Monitor for suspicious activity:
- Unusual rate limit hits
- Repeated SSRF validation failures
- Large response sizes
- High browser page count

Example logging:
```javascript
// Log SSRF attempts
if (error.message.includes('private IP') || error.message.includes('localhost')) {
  console.warn('SSRF attempt detected:', { url, ip: req.ip });
}
```

### 5. API Key Management

**Generate strong keys:**
```javascript
import crypto from 'crypto';

const apiKey = crypto.randomBytes(32).toString('base64url');
// Example: "xK8j2mL9pQw3vN5rT7yU1zH4dF6gS0aC8bE2mK9pL7w"
```

**Store securely:**
- Hash keys before storing (like passwords)
- Use environment variables, never hardcode
- Rotate keys quarterly

---

## Security Considerations for API Consumers

### 1. Output Sanitization

**When using `format=html`:**

```typescript
import DOMPurify from 'isomorphic-dompurify';

const result = await fetch('http://api/v1/fetch?url=...&format=html');
const data = await result.json();

// ALWAYS sanitize before rendering
const clean = DOMPurify.sanitize(data.content);
document.getElementById('output').innerHTML = clean;
```

**Markdown output is safer but still sanitize:**
```typescript
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false, // Disable raw HTML in markdown
  linkify: true,
  typographer: true,
});

const result = await fetch('http://api/v1/fetch?url=...&format=markdown');
const data = await result.json();
const html = md.render(data.content);
```

### 2. URL Validation

**Validate URLs before passing to WebPeel:**
```typescript
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// User input
const userUrl = req.query.url;
if (!isValidUrl(userUrl)) {
  return res.status(400).json({ error: 'Invalid URL' });
}

// Safe to pass to WebPeel
const result = await fetch(`http://api/v1/fetch?url=${encodeURIComponent(userUrl)}`);
```

### 3. CLI Usage

**Avoid shell interpolation:**

```bash
# ❌ DANGEROUS - Shell interpolation
url="http://example.com/$(malicious_command)"
webpeel "$url"

# ✅ SAFE - No interpolation
webpeel 'http://example.com/path'

# ✅ SAFE - Programmatic usage
node -e "const { peel } = require('webpeel'); peel(process.argv[1])" "$url"
```

---

## Known Limitations

### 1. DNS Rebinding

While WebPeel includes DNS pre-resolution checks, determined attackers with control over DNS can potentially exploit time-of-check/time-of-use (TOCTOU) gaps.

**Mitigation:**
- Use a trusted DNS resolver with DNSSEC
- Deploy in isolated network environment
- Monitor for suspicious DNS patterns

### 2. Open Redirectors

If a **trusted** external site has an open redirect vulnerability, attackers could potentially redirect to blocked IPs.

**Mitigation:**
- WebPeel re-validates each redirect
- Maximum 10 redirects
- Monitor redirect chains in logs

### 3. Resource Consumption

Browsers consume significant memory. Under sustained load:
- 5 concurrent browsers × ~100MB each = ~500MB
- Plus Node.js overhead and response caching

**Mitigation:**
- Use container memory limits
- Scale horizontally
- Monitor resource usage

---

## Security Audit

A comprehensive security audit was conducted on 2026-02-12. All critical and high-severity vulnerabilities were resolved.

See `.internal/SECURITY-AUDIT.md` for full details.

---

## License

This security documentation is part of WebPeel and covered under the same AGPL-3.0 license.

**Last Updated:** 2026-02-12
