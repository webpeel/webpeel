# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in WebPeel, please report it responsibly.

**Email:** security@webpeel.dev

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

**Do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Share vulnerability details publicly before a fix is released

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Assessment:** Within 1 week
- **Fix:** As soon as possible, typically within 2 weeks for critical issues

## Scope

**In scope:**
- WebPeel core library (`src/core/`)
- MCP server (`src/mcp/`)
- API server (`src/server/`)
- Authentication and authorization
- SSRF, injection, or data exfiltration vulnerabilities
- Dashboard (app.webpeel.dev)

**Out of scope:**
- Third-party dependencies (report to the upstream project)
- Social engineering
- Denial of service via normal API usage
- Issues in the static marketing site (webpeel.dev) that don't expose data

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.8.x   | ✅ Yes    |
| < 0.8   | ❌ No     |

## Hall of Fame

We appreciate security researchers who help keep WebPeel safe. With your permission, we'll acknowledge your contribution here.
