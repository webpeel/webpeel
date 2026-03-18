/**
 * Active domain verification — runtime TLS, HTTP header, and DNS signals.
 *
 * Runs during the fetch pipeline for sites that are NOT already in the known
 * official/established lists.  All network operations have a hard 3-second
 * timeout and fail-open (any error → null for that section).
 *
 * Scoring adds bonus points (0–80) on top of the static source-credibility score.
 */

import tls from 'tls';
import dns from 'dns/promises';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface DomainVerification {
  tls: {
    valid: boolean;
    issuer: string;       // "Let's Encrypt", "DigiCert", "Google Trust Services", etc.
    daysRemaining: number; // days until cert expires
    ev: boolean;           // Extended Validation cert?
  } | null;
  headers: {
    hsts: boolean;         // Strict-Transport-Security present?
    csp: boolean;          // Content-Security-Policy present?
    xFrameOptions: boolean;
    server: string;        // "cloudflare", "nginx", "vercel", etc.
    poweredBy: string | null;
  };
  dns: {
    hasMx: boolean;        // Has mail exchange records (real business)
    hasDmarc: boolean;     // Has DMARC record (email auth)
    hasSpf: boolean;       // Has SPF record (email auth)
    nameservers: string[]; // ["cloudflare", "aws", etc.]
  } | null;
  signals: string[];         // Human-readable positive signals
  warnings: string[];        // Human-readable warnings
  verificationScore: number; // 0–100 bonus points from active verification
}

// ---------------------------------------------------------------------------
// Known CA issuers → normalised label
// ---------------------------------------------------------------------------
const CA_LABELS: [string, string][] = [
  ["Let's Encrypt", "Let's Encrypt"],
  ['ISRG', "Let's Encrypt"],
  ['DigiCert', 'DigiCert'],
  ['Comodo', 'Comodo'],
  ['Sectigo', 'Sectigo'],
  ['GlobalSign', 'GlobalSign'],
  ['GeoTrust', 'GeoTrust'],
  ['Thawte', 'Thawte'],
  ['Entrust', 'Entrust'],
  ['Amazon', 'Amazon Trust Services'],
  ['Google Trust Services', 'Google Trust Services'],
  ['Google', 'Google Trust Services'],
  ['Microsoft', 'Microsoft RSA TLS CA'],
  ['Cloudflare', 'Cloudflare'],
  ['ZeroSSL', 'ZeroSSL'],
  ['Buypass', 'Buypass'],
  ['SSL.com', 'SSL.com'],
];

// Known CDN / cloud providers detected from Server header
const CDN_LABELS: [RegExp, string][] = [
  [/cloudflare/i, 'Cloudflare'],
  [/vercel/i, 'Vercel'],
  [/netlify/i, 'Netlify'],
  [/awselb|amazon/i, 'AWS'],
  [/nginx/i, 'nginx'],
  [/apache/i, 'Apache'],
  [/gws|google/i, 'Google'],
  [/microsoft/i, 'Microsoft'],
  [/fastly/i, 'Fastly'],
  [/akamai/i, 'Akamai'],
  [/litespeed/i, 'LiteSpeed'],
  [/openresty/i, 'OpenResty'],
  [/caddy/i, 'Caddy'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function normaliseCaIssuer(raw: string): string {
  for (const [pattern, label] of CA_LABELS) {
    if (raw.includes(pattern)) return label;
  }
  return raw || 'Unknown CA';
}

function detectServer(raw: string): string {
  for (const [regex, label] of CDN_LABELS) {
    if (regex.test(raw)) return label;
  }
  return raw.trim() || 'unknown';
}

// ---------------------------------------------------------------------------
// TLS check — connect to port 443, inspect peer cert
// ---------------------------------------------------------------------------
async function checkTls(host: string): Promise<DomainVerification['tls']> {
  return withTimeout(
    new Promise<DomainVerification['tls']>((resolve) => {
      let settled = false;
      const settle = (v: DomainVerification['tls']) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };

      try {
        const socket = tls.connect({
          host,
          port: 443,
          servername: host,
          rejectUnauthorized: false, // we check validity manually
          timeout: 3000,
        });

        socket.on('secureConnect', () => {
          try {
            const cert = socket.getPeerCertificate(true);
            socket.destroy();

            if (!cert || !cert.valid_to) {
              settle(null);
              return;
            }

            const validTo = new Date(cert.valid_to);
            const now = new Date();
            const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const valid = socket.authorized !== false || daysRemaining > 0;

            // Issuer from either issuer.O or issuer.CN
            const issuerRaw: string = (cert.issuer as any)?.O || (cert.issuer as any)?.CN || '';
            const issuer = normaliseCaIssuer(issuerRaw);

            // Extended Validation: subject.O is typically set for EV certs
            const subjectO: string = (cert.subject as any)?.O || '';
            const ev = Boolean(subjectO && subjectO.length > 0 && !subjectO.toLowerCase().includes('unknown'));

            settle({ valid, issuer, daysRemaining, ev });
          } catch {
            socket.destroy();
            settle(null);
          }
        });

        socket.on('error', () => settle(null));
        socket.on('timeout', () => {
          socket.destroy();
          settle(null);
        });
      } catch {
        settle(null);
      }
    }),
    3000,
    null,
  );
}

// ---------------------------------------------------------------------------
// Header check — HEAD request to collect response headers
// ---------------------------------------------------------------------------
async function checkHeaders(url: string): Promise<DomainVerification['headers']> {
  const fallback: DomainVerification['headers'] = {
    hsts: false,
    csp: false,
    xFrameOptions: false,
    server: 'unknown',
    poweredBy: null,
  };

  return withTimeout(
    new Promise<DomainVerification['headers']>((resolve) => {
      let settled = false;
      const settle = (v: DomainVerification['headers']) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };

      try {
        const parsedUrl = new URL(url);
        const requester = parsedUrl.protocol === 'https:' ? https : http;

        const req = requester.request(
          {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; WebPeel/1.0; +https://webpeel.dev)',
              Accept: 'text/html,*/*',
            },
            timeout: 3000,
            rejectUnauthorized: false,
          },
          (res) => {
            const h = res.headers;
            const serverRaw = (h['server'] || '') as string;
            const poweredBy = (h['x-powered-by'] || null) as string | null;

            settle({
              hsts: Boolean(h['strict-transport-security']),
              csp: Boolean(h['content-security-policy']),
              xFrameOptions: Boolean(h['x-frame-options']),
              server: detectServer(serverRaw),
              poweredBy,
            });
          },
        );

        req.on('error', () => settle(fallback));
        req.on('timeout', () => {
          req.destroy();
          settle(fallback);
        });
        req.end();
      } catch {
        settle(fallback);
      }
    }),
    3000,
    fallback,
  );
}

// ---------------------------------------------------------------------------
// DNS check — MX, TXT (SPF/DMARC), NS
// ---------------------------------------------------------------------------
async function checkDns(domain: string): Promise<DomainVerification['dns']> {
  return withTimeout(
    Promise.all([
      dns.resolveMx(domain).catch(() => []),
      dns.resolveTxt(domain).catch(() => [] as string[][]),
      dns.resolveTxt(`_dmarc.${domain}`).catch(() => [] as string[][]),
      dns.resolveNs(domain).catch(() => []),
    ]).then(([mx, txt, dmarcTxt, ns]) => {
      const txtFlat = (txt as string[][]).flat().map((s) => s.toLowerCase());
      const dmarcFlat = (dmarcTxt as string[][]).flat().map((s) => s.toLowerCase());

      const hasSpf = txtFlat.some((s) => s.startsWith('v=spf1'));
      const hasDmarc = dmarcFlat.some((s) => s.startsWith('v=dmarc1'));

      // Normalise nameserver labels
      const nameservers = (ns as string[]).map((n) => {
        const lower = n.toLowerCase();
        if (lower.includes('cloudflare')) return 'Cloudflare';
        if (lower.includes('amazonaws') || lower.includes('awsdns')) return 'AWS';
        if (lower.includes('googledomains') || lower.includes('google')) return 'Google';
        if (lower.includes('azure') || lower.includes('microsoft')) return 'Azure';
        if (lower.includes('namecheap')) return 'Namecheap';
        if (lower.includes('godaddy')) return 'GoDaddy';
        if (lower.includes('digitalocean')) return 'DigitalOcean';
        if (lower.includes('vercel')) return 'Vercel';
        if (lower.includes('netlify')) return 'Netlify';
        return n;
      });

      return {
        hasMx: (mx as unknown[]).length > 0,
        hasDmarc,
        hasSpf,
        nameservers: [...new Set(nameservers)],
      } satisfies DomainVerification['dns'] & {};
    }),
    3000,
    null,
  );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function computeScore(
  tlsResult: DomainVerification['tls'],
  headersResult: DomainVerification['headers'],
  dnsResult: DomainVerification['dns'],
  signals: string[],
  warnings: string[],
): number {
  let score = 0;

  // TLS
  if (tlsResult) {
    if (tlsResult.valid) {
      score += 15;
      signals.push(`Valid TLS cert (${tlsResult.issuer}, ${tlsResult.daysRemaining} days remaining)`);

      const knownCas = ['DigiCert', 'Comodo', 'GlobalSign', 'GeoTrust', 'Entrust', 'Sectigo', 'Google Trust Services', 'Amazon Trust Services'];
      if (knownCas.includes(tlsResult.issuer)) {
        score += 5;
        signals.push(`Trusted CA (${tlsResult.issuer})`);
      }

      if (tlsResult.ev) {
        score += 10;
        signals.push('Extended Validation (EV) certificate');
      }
    } else {
      warnings.push('Invalid or expired TLS certificate');
    }

    if (tlsResult.daysRemaining < 14) {
      warnings.push(`TLS certificate expires soon (${tlsResult.daysRemaining} days)`);
    }
  } else {
    warnings.push('TLS check unavailable or failed');
  }

  // Headers
  if (headersResult.hsts) {
    score += 10;
    signals.push('HSTS (HTTP Strict Transport Security) enabled');
  } else {
    warnings.push('No HSTS header');
  }

  if (headersResult.csp) {
    score += 5;
    signals.push('Content-Security-Policy header present');
  }

  const knownCdns = ['Cloudflare', 'Vercel', 'Netlify', 'AWS', 'Fastly', 'Akamai'];
  if (knownCdns.includes(headersResult.server)) {
    score += 10;
    signals.push(`HTTPS via ${headersResult.server}`);
  }

  // DNS
  if (dnsResult) {
    if (dnsResult.hasMx) {
      score += 10;
      signals.push('Mail exchange (MX) records present — real organisation');
    } else {
      warnings.push('No MX records — may not be a real organisation');
    }

    if (dnsResult.hasDmarc) {
      score += 10;
      signals.push('DMARC policy configured (email authentication)');
    } else {
      warnings.push('No DMARC policy');
    }

    if (dnsResult.hasSpf) {
      score += 5;
      signals.push('SPF record present (email authentication)');
    }

    if (dnsResult.nameservers.length > 0) {
      const knownNs = ['Cloudflare', 'AWS', 'Google', 'Azure', 'Vercel', 'Netlify'];
      const knownFound = dnsResult.nameservers.filter((ns) => knownNs.includes(ns));
      if (knownFound.length > 0) {
        signals.push(`Hosted on ${knownFound.join(', ')} nameservers`);
      }
    }
  } else {
    warnings.push('DNS check failed');
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Perform active domain verification (TLS + HTTP headers + DNS).
 *
 * @param url   Full URL to verify (e.g. "https://stripe.com")
 * @param existingHeaders Optional pre-fetched HTTP response headers (avoids a HEAD request)
 */
export async function verifyDomain(
  url: string,
  existingHeaders?: Record<string, string>,
): Promise<DomainVerification> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      tls: null,
      headers: { hsts: false, csp: false, xFrameOptions: false, server: 'unknown', poweredBy: null },
      dns: null,
      signals: [],
      warnings: ['Invalid URL — cannot verify'],
      verificationScore: 0,
    };
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const isHttps = parsedUrl.protocol === 'https:';

  // Run all three checks in parallel
  const [tlsResult, headersResult, dnsResult] = await Promise.all([
    isHttps ? checkTls(parsedUrl.hostname) : Promise.resolve(null),
    existingHeaders
      ? Promise.resolve(buildHeadersFromExisting(existingHeaders))
      : checkHeaders(url),
    checkDns(hostname),
  ]);

  const signals: string[] = [];
  const warnings: string[] = [];

  if (!isHttps) {
    warnings.push('Site does not use HTTPS');
  }

  const verificationScore = computeScore(tlsResult, headersResult, dnsResult, signals, warnings);

  return {
    tls: tlsResult,
    headers: headersResult,
    dns: dnsResult,
    signals,
    warnings,
    verificationScore,
  };
}

/**
 * Build a DomainVerification['headers'] object from existing response headers
 * (e.g. from the pipeline's fetchResult).
 */
function buildHeadersFromExisting(headers: Record<string, string>): DomainVerification['headers'] {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

  return {
    hsts: Boolean(lower['strict-transport-security']),
    csp: Boolean(lower['content-security-policy']),
    xFrameOptions: Boolean(lower['x-frame-options']),
    server: detectServer(lower['server'] || ''),
    poweredBy: lower['x-powered-by'] || null,
  };
}
