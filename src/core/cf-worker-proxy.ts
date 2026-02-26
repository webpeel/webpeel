/**
 * Cloudflare Worker fetch proxy client.
 *
 * When PeelTLS fails due to IP blocking, this routes the request through
 * a Cloudflare Worker running on Cloudflare's edge network. The Worker
 * has clean IPs that aren't flagged by most anti-bot systems.
 *
 * Setup:
 *   1. Deploy the worker: cd worker && npx wrangler deploy
 *   2. Set WEBPEEL_CF_WORKER_URL env var to the worker URL
 *   3. Optionally set WEBPEEL_CF_WORKER_TOKEN for auth
 *
 * Free tier: 100,000 requests/day
 */

import type { FetchResult } from './fetcher.js';

const CHROME_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Sec-Ch-Ua': '"Chromium";v="133", "Google Chrome";v="133"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface CfWorkerProxyOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export interface CfWorkerProxyResult extends FetchResult {
  method: 'cf-worker';
  edge?: string; // Cloudflare edge location (e.g. 'EWR', 'LAX')
}

/**
 * Check if a CF Worker proxy is configured.
 */
export function isCfWorkerAvailable(): boolean {
  return !!getWorkerUrl();
}

function getWorkerUrl(): string | undefined {
  return process.env.WEBPEEL_CF_WORKER_URL;
}

function getWorkerToken(): string | undefined {
  return process.env.WEBPEEL_CF_WORKER_TOKEN;
}

/**
 * Fetch a URL through the Cloudflare Worker proxy.
 * The Worker makes the request from Cloudflare's edge — clean IPs.
 */
export async function cfWorkerFetch(
  url: string,
  options?: CfWorkerProxyOptions,
): Promise<CfWorkerProxyResult> {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    throw new Error(
      'Cloudflare Worker proxy not configured. Set WEBPEEL_CF_WORKER_URL env var.\n' +
        'Deploy: cd worker && npx wrangler deploy',
    );
  }

  const mergedHeaders = {
    ...CHROME_HEADERS,
    ...(options?.headers ?? {}),
  };

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getWorkerToken();
  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    url,
    headers: mergedHeaders,
    method: 'GET',
    timeout: Math.round((options?.timeout ?? 30000) / 1000),
    followRedirects: true,
  });

  if (process.env.DEBUG) {
    console.debug('[webpeel]', 'CF Worker proxy fetch:', url);
  }

  const response = await fetch(`${workerUrl}/fetch`, {
    method: 'POST',
    headers: fetchHeaders,
    body,
    signal: AbortSignal.timeout(options?.timeout ?? 30000),
  });

  const result = await response.json() as any;

  if (result.error) {
    throw new Error(`CF Worker proxy failed: ${result.error}`);
  }

  return {
    html: result.body,
    url: result.finalUrl || url,
    statusCode: result.status,
    contentType: result.headers?.['content-type'] ?? 'text/html',
    method: 'cf-worker',
    edge: result.edge,
  };
}
