/**
 * URL validation middleware to prevent SSRF attacks
 * Validates URLs BEFORE any network request is made
 */

/**
 * Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, link-local addresses, and non-HTTP(S) protocols
 */
export function validateUrlForSSRF(urlString: string): void {
  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow HTTP(S)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  const hostname = url.hostname.toLowerCase();

  // Block localhost patterns
  const localhostPatterns = ['localhost', '0.0.0.0'];
  if (localhostPatterns.some(pattern => hostname === pattern || hostname.endsWith('.' + pattern))) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // SECURITY: Block well-known cloud metadata service hostnames.
  // These hostnames resolve to link-local IPs (169.254.x.x) which are blocked
  // by IP, but hostname-level blocking provides defense-in-depth against DNS
  // rebinding attacks where a domain transiently resolves to a valid IP during
  // validation, then resolves to a private IP for the actual fetch.
  const metadataHostnames = [
    'metadata.google.internal',     // GCP: resolves to 169.254.169.254
    'metadata.goog',                 // GCP alternate
    'metadata.internal',             // Generic internal
    'instance-data.ec2.internal',    // AWS alternate
    'computeMetadata',               // Partial GCP hostname
  ];
  if (metadataHostnames.some(m => hostname === m || hostname.endsWith('.' + m))) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Parse and validate IP addresses
  const ipv4Info = parseIPv4(hostname);
  if (ipv4Info) {
    validateIPv4ForSSRF(ipv4Info);
  }

  // Validate IPv6
  if (hostname.includes(':')) {
    validateIPv6ForSSRF(hostname);
  }
}

/**
 * SSRF Error class
 */
export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

/**
 * Parse IPv4 address in any format (dotted, hex, octal, decimal)
 */
function parseIPv4(hostname: string): number[] | null {
  const cleaned = hostname.replace(/^\[|\]$/g, '');

  // Standard dotted notation: 192.168.1.1
  const dottedRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const dottedMatch = cleaned.match(dottedRegex);
  if (dottedMatch) {
    const octets = dottedMatch.slice(1).map(Number);
    if (octets.every(o => o >= 0 && o <= 255)) {
      return octets;
    }
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Hex notation: 0x7f000001
  if (/^0x[0-9a-fA-F]+$/.test(cleaned)) {
    const num = parseInt(cleaned, 16);
    return [
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff,
    ];
  }

  // Octal notation
  if (/^0[0-7]/.test(cleaned)) {
    if (/^0[0-7]+$/.test(cleaned)) {
      const num = parseInt(cleaned, 8);
      if (num <= 0xffffffff) {
        return [
          (num >>> 24) & 0xff,
          (num >>> 16) & 0xff,
          (num >>> 8) & 0xff,
          num & 0xff,
        ];
      }
    }
    const parts = cleaned.split('.');
    if (parts.length === 4) {
      const octets = parts.map(p => parseInt(p, /^0[0-7]/.test(p) ? 8 : 10));
      if (octets.every(o => o >= 0 && o <= 255)) {
        return octets;
      }
    }
  }

  // Decimal notation: 2130706433
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    if (num <= 0xffffffff) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ];
    }
  }

  return null;
}

/**
 * Validate IPv4 address against private/reserved ranges
 */
function validateIPv4ForSSRF(octets: number[]): void {
  const [a, b, c, d] = octets;

  // Loopback: 127.0.0.0/8
  if (a === 127) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Private: 10.0.0.0/8
  if (a === 10) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Private: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Private: 192.168.0.0/16
  if (a === 192 && b === 168) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Link-local: 169.254.0.0/16 (includes AWS metadata endpoint)
  if (a === 169 && b === 254) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Broadcast: 255.255.255.255
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // This network: 0.0.0.0/8
  if (a === 0) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }
}

/**
 * Validate IPv6 address against private/reserved ranges
 */
function validateIPv6ForSSRF(hostname: string): void {
  const addr = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // Loopback: ::1
  if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // IPv6 mapped IPv4: ::ffff:192.168.1.1
  if (addr.startsWith('::ffff:')) {
    const ipv4Part = addr.substring(7);
    
    if (ipv4Part.includes('.')) {
      const parts = ipv4Part.split('.');
      if (parts.length === 4) {
        const octets = parts.map(p => parseInt(p, 10));
        if (octets.every(o => !isNaN(o) && o >= 0 && o <= 255)) {
          validateIPv4ForSSRF(octets);
        }
      }
    } else {
      const hexStr = ipv4Part.replace(/:/g, '');
      if (/^[0-9a-f]{1,8}$/.test(hexStr)) {
        const num = parseInt(hexStr, 16);
        const octets = [
          (num >>> 24) & 0xff,
          (num >>> 16) & 0xff,
          (num >>> 8) & 0xff,
          num & 0xff,
        ];
        validateIPv4ForSSRF(octets);
      }
    }
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Unique local addresses: fc00::/7
  if (addr.startsWith('fc') || addr.startsWith('fd')) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }

  // Link-local: fe80::/10
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || 
      addr.startsWith('fea') || addr.startsWith('feb')) {
    throw new SSRFError('Cannot fetch localhost, private networks, or non-HTTP URLs');
  }
}
