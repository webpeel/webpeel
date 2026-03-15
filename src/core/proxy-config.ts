/**
 * Shared Webshare residential proxy configuration.
 *
 * WebPeel uses Webshare residential proxies (configured via env vars) to route
 * requests through US residential IPs, bypassing datacenter IP blocks from
 * DuckDuckGo, Amazon, BestBuy, CarGurus, and other sites with anti-bot detection.
 *
 * Proxy credentials are loaded from environment variables:
 *   WEBSHARE_PROXY_HOST  — proxy hostname (e.g. p.webshare.io)
 *   WEBSHARE_PROXY_PORT  — base port number (e.g. 10000)
 *   WEBSHARE_PROXY_USER  — proxy username (without slot suffix)
 *   WEBSHARE_PROXY_PASS  — proxy password
 *   WEBSHARE_PROXY_SLOTS — number of available US residential slots
 *
 * With the Webshare backbone plan each US slot has its own port:
 *   slot N → port (WEBSHARE_PROXY_PORT + N - 1), username: USER-US-N
 */

export interface ProxyConfig {
  /** Proxy server URL in the format "http://host:port" */
  server: string;
  /** Proxy username (includes slot suffix, e.g. "user-US-42") */
  username: string;
  /** Proxy password */
  password: string;
}

/**
 * Get a random Webshare residential proxy config.
 * Returns null if the proxy is not configured (env vars missing or slots = 0).
 *
 * Uses random slot selection across all available US slots for even load
 * distribution — same approach as youtube.ts proxyRequestSlotted().
 */
export function getWebshareProxy(): ProxyConfig | null {
  const host = process.env.WEBSHARE_PROXY_HOST;
  const user = process.env.WEBSHARE_PROXY_USER;
  const pass = process.env.WEBSHARE_PROXY_PASS;
  const basePort = parseInt(process.env.WEBSHARE_PROXY_PORT || '10000', 10);
  const slots = parseInt(process.env.WEBSHARE_PROXY_SLOTS || '0', 10);

  if (!host || !user || !pass || slots <= 0) return null;

  // Webshare backbone proxy: slot routing via username suffix, fixed base port.
  // Format: user-SLOT:pass@host:basePort (e.g. argtnlhz-1:pass@p.webshare.io:10000)
  const slot = Math.floor(Math.random() * slots) + 1;

  return {
    server: `http://${host}:${basePort}`,
    username: `${user}-${slot}`,
    password: pass,
  };
}

/**
 * Check if Webshare proxies are configured (env vars are present and non-empty).
 * Does NOT guarantee the proxy is reachable — just that credentials are set.
 */
export function hasWebshareProxy(): boolean {
  return !!(
    process.env.WEBSHARE_PROXY_HOST &&
    process.env.WEBSHARE_PROXY_USER &&
    process.env.WEBSHARE_PROXY_PASS
  );
}

/**
 * Convert a ProxyConfig to a Playwright-compatible proxy object.
 * Useful for passing directly to browser.newContext({ proxy: ... }).
 */
export function toPlaywrightProxy(config: ProxyConfig): {
  server: string;
  username: string;
  password: string;
} {
  return {
    server: config.server,
    username: config.username,
    password: config.password,
  };
}

/**
 * Get a random Webshare proxy as a fully-qualified URL string with embedded
 * credentials. The format is: `http://username:password@host:port`
 *
 * Useful for passing to strategies.ts proxy option (which expects a URL string).
 * Returns null if proxies are not configured.
 */
export function getWebshareProxyUrl(): string | null {
  const config = getWebshareProxy();
  if (!config) return null;
  try {
    const url = new URL(config.server);
    return `http://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${url.host}`;
  } catch {
    return null;
  }
}
