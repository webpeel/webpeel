# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in WebPeel, please report it by:

1. **Email**: Contact the maintainer directly (see package.json for contact info)
2. **GitHub Security Advisories**: Use the [Security tab](https://github.com/JakeLiuMe/webpeel/security) to report privately

Please do NOT open public issues for security vulnerabilities.

### What to include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## Security Considerations

WebPeel executes browser automation and fetches arbitrary URLs. Users should:

- **Validate URLs** before passing them to WebPeel
- **Sanitize output** when using content in production systems
- **Be aware** that browser mode downloads and executes remote JavaScript
- **Use timeouts** to prevent hanging on malicious sites
- **Run in isolated environments** when fetching untrusted URLs

## Dependencies

This project uses Playwright for browser automation. Security updates are monitored via:

- GitHub Dependabot
- npm audit (run regularly)
- CI pipeline checks

Keep your dependencies up to date with `npm update`.
