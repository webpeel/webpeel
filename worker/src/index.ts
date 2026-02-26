/**
 * WebPeel Cloudflare Worker Proxy
 * 
 * Fetches URLs from Cloudflare's edge network — clean IPs that aren't
 * flagged by anti-bot systems. 100K requests/day on free tier.
 * 
 * Used as an escalation step when PeelTLS fails due to IP blocking.
 * 
 * Security: requires auth token to prevent abuse.
 */

interface Env {
  WORKER_AUTH_TOKEN: string;
}

interface FetchRequest {
  url: string;
  headers?: Record<string, string>;
  method?: string;
  timeout?: number;
  followRedirects?: boolean;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', edge: request.cf?.colo || 'unknown' });
    }

    // Auth check
    const authHeader = request.headers.get('Authorization');
    if (env.WORKER_AUTH_TOKEN && authHeader !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Only accept POST /fetch
    if (url.pathname !== '/fetch' || request.method !== 'POST') {
      return Response.json({ error: 'POST /fetch only' }, { status: 404 });
    }

    let body: FetchRequest;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    if (!body.url) {
      return Response.json({ error: 'url required' }, { status: 400 });
    }

    // Default Chrome headers
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Chromium";v="133", "Google Chrome";v="133"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      ...(body.headers || {}),
    };

    try {
      const startMs = Date.now();
      const resp = await fetch(body.url, {
        method: body.method || 'GET',
        headers: fetchHeaders,
        redirect: body.followRedirects !== false ? 'follow' : 'manual',
        signal: AbortSignal.timeout((body.timeout || 30) * 1000),
      });

      const html = await resp.text();
      const elapsedMs = Date.now() - startMs;

      // Collect response headers
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });

      return Response.json({
        status: resp.status,
        headers: respHeaders,
        body: html,
        finalUrl: resp.url,
        timing: { totalMs: elapsedMs },
        edge: request.cf?.colo || 'unknown',
      });
    } catch (e: any) {
      return Response.json({
        error: e.message || 'fetch failed',
        status: 0,
      });
    }
  },
};
