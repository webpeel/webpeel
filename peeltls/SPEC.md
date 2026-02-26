# PeelTLS Build Spec

## What This Is
PeelTLS is WebPeel's proprietary TLS fingerprint spoofing engine. It replaces CycleTLS (GPL-3) with our own Go binary using utls (BSD-3). Licensed under our terms.

## Architecture
```
Node.js (peel-tls.ts) ──HTTP──▸ Go binary (peeltls) ──uTLS──▸ Target site
                                     │
                                     ├─ Spoofs TLS Client Hello (JA3)
                                     ├─ HTTP/2 with Chrome frame ordering
                                     ├─ Proxy support (HTTP CONNECT, SOCKS5)
                                     └─ Gzip/br/deflate decompression
```

## Go Binary

### Startup
- CLI: `./peeltls --port 0 --token <random>`
- Port 0 = OS picks random available port
- On ready, prints JSON to stdout: `{"port": 12345, "token": "abc123"}`
- Listens on `127.0.0.1` ONLY (never externally)
- All requests require `Authorization: Bearer <token>` header

### Endpoints

#### POST /fetch
Request:
```json
{
  "url": "https://www.bestbuy.com/site/...",
  "method": "GET",
  "headers": {
    "User-Agent": "Mozilla/5.0 ...",
    "Accept": "text/html,application/xhtml+xml,..."
  },
  "fingerprint": "chrome-133",
  "proxy": "http://user:pass@host:port",
  "timeout": 30,
  "followRedirects": true,
  "maxRedirects": 10
}
```

Response (success):
```json
{
  "status": 200,
  "headers": {"content-type": "text/html; charset=utf-8"},
  "body": "<html>...",
  "finalUrl": "https://www.bestbuy.com/site/...",
  "timing": {"dnsMs": 12, "tlsMs": 45, "totalMs": 234}
}
```

Response (error):
```json
{
  "error": "connection refused",
  "status": 0
}
```

#### GET /health
```json
{"status": "ok", "version": "1.0.0", "uptime": 123.456, "requests": 42}
```

#### POST /shutdown
Graceful shutdown. Returns 200 then exits.

### Fingerprint Presets
Map these names to utls ClientHelloIDs:
- `chrome-133` → `tls.HelloChrome_133` (default, latest)
- `chrome-131` → `tls.HelloChrome_131`
- `chrome-120` → `tls.HelloChrome_120`
- `firefox-120` → `tls.HelloFirefox_120`
- `safari-16` → `tls.HelloSafari_16_0`
- `edge-106` → `tls.HelloEdge_106`
- `random` → `tls.HelloRandomized`

Also accept raw JA3 strings (starts with "771," typically) — parse with custom JA3→ClientHelloSpec converter.

### HTTP/2 Support
Use `golang.org/x/net/http2` for HTTP/2 connections. The utls connection provides the TLS layer; wrap it with an HTTP/2 transport.

Pattern:
```go
import (
    tls "github.com/refraction-networking/utls"
    "golang.org/x/net/http2"
)

// 1. Dial TCP
// 2. uTLS handshake with spoofed fingerprint
// 3. Check ALPN — if "h2", use http2.Transport
// 4. If "http/1.1", use regular http.Transport
```

### Proxy Support
- HTTP proxy: CONNECT tunnel, then uTLS handshake through tunnel
- SOCKS5 proxy: `golang.org/x/net/proxy` SOCKS5 dialer, then uTLS handshake
- Parse proxy URL format: `http://user:pass@host:port`, `socks5://user:pass@host:port`

### Redirect Handling
- Follow redirects manually (not via http.Client auto-redirect)
- On 3xx: extract Location header, fetch new URL
- Preserve fingerprint across redirects
- Track finalUrl
- Max 10 redirects (configurable), error on loop

### Decompression
- Handle `Content-Encoding: gzip`, `br` (brotli), `deflate`
- Always send `Accept-Encoding: gzip, deflate, br` in requests

### Error Handling
- Connection refused → `{"error": "connection refused", "status": 0}`
- Timeout → `{"error": "timeout after 30s", "status": 0}`
- TLS error → `{"error": "tls handshake failed: ...", "status": 0}`
- Invalid URL → `{"error": "invalid url: ...", "status": 0}`

### Performance
- Connection pooling per (host, fingerprint) pair
- Keep-alive connections reused for 60s
- Clean up idle connections periodically

### File Structure
```
peeltls/
├── go.mod              (already created)
├── go.sum              (already created)
├── main.go             — HTTP server, request routing, startup
├── fetch.go            — TLS connection, fingerprint selection, HTTP request
├── fingerprints.go     — Preset fingerprint map, JA3 parser
├── proxy.go            — HTTP CONNECT and SOCKS5 proxy support
├── main_test.go        — Unit tests
└── build.sh            — Cross-compilation script
```

### Build Script (build.sh)
```bash
#!/bin/bash
# Cross-compile for all target platforms
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-darwin-x64 .
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/peeltls-darwin-arm64 .
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-linux-x64 .
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/peeltls-linux-arm64 .
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-windows-x64.exe .
```
`-ldflags="-s -w"` strips debug info for smaller binaries.

---

## Node.js Wrapper

### File: `src/core/peel-tls.ts`

Drop-in replacement for `src/core/cycle-fetch.ts`. Must maintain the same `FetchResult` interface.

```typescript
import { existsSync } from 'fs';
import { resolve as pathResolve, join } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { platform, arch } from 'os';
import type { FetchResult } from './fetcher.js';

// Chrome 133 headers (matching the Go binary's default fingerprint)
const CHROME_133_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'Sec-Ch-Ua': '"Chromium";v="133", "Google Chrome";v="133"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface PeelTLSOptions {
  timeout?: number;
  proxy?: string;
  headers?: Record<string, string>;
  fingerprint?: string; // 'chrome-133' | 'firefox-120' | raw JA3 string
}

export interface PeelTLSResult extends FetchResult {
  method: 'peeltls';
}

// Singleton process manager
let binaryProcess: ChildProcess | null = null;
let binaryPort: number | null = null;
let binaryToken: string | null = null;
let startPromise: Promise<void> | null = null;

/**
 * Get the correct binary path for the current platform.
 */
function getBinaryPath(): string {
  const plat = platform(); // 'darwin', 'linux', 'win32'
  const ar = arch();       // 'x64', 'arm64'
  
  const platMap: Record<string, string> = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'windows',
  };
  const archMap: Record<string, string> = {
    'x64': 'x64',
    'arm64': 'arm64',
  };
  
  const suffix = plat === 'win32' ? '.exe' : '';
  const name = `peeltls-${platMap[plat] || plat}-${archMap[ar] || ar}${suffix}`;
  
  // Look in peeltls/dist/ relative to project root
  const candidates = [
    pathResolve(process.cwd(), 'peeltls', 'dist', name),
    pathResolve(__dirname, '..', '..', 'peeltls', 'dist', name),
    // Also check for a single binary named just 'peeltls'
    pathResolve(process.cwd(), 'peeltls', 'dist', 'peeltls'),
  ];
  
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  
  throw new Error(
    `PeelTLS binary not found for ${plat}/${ar}. Expected at: ${candidates[0]}\n` +
    'Build it with: cd peeltls && bash build.sh'
  );
}

/**
 * Check if PeelTLS binary is available for this platform.
 */
export function isPeelTLSAvailable(): boolean {
  try {
    getBinaryPath();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the PeelTLS binary (singleton — only one instance).
 */
async function ensureRunning(): Promise<{ port: number; token: string }> {
  if (binaryPort && binaryToken && binaryProcess && !binaryProcess.killed) {
    return { port: binaryPort, token: binaryToken };
  }
  
  if (startPromise) {
    await startPromise;
    return { port: binaryPort!, token: binaryToken! };
  }
  
  startPromise = new Promise<void>((resolve, reject) => {
    const binPath = getBinaryPath();
    const token = randomBytes(32).toString('hex');
    
    const proc = spawn(binPath, ['--port', '0', '--token', token], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdoutBuf = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('PeelTLS binary failed to start within 10s'));
    }, 10000);
    
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      // Binary prints {"port": N, "token": "..."} on first line
      const newlineIdx = stdoutBuf.indexOf('\n');
      if (newlineIdx !== -1) {
        clearTimeout(timeout);
        try {
          const info = JSON.parse(stdoutBuf.slice(0, newlineIdx));
          binaryPort = info.port;
          binaryToken = token;
          binaryProcess = proc;
          resolve();
        } catch (e) {
          proc.kill();
          reject(new Error(`PeelTLS binary output invalid JSON: ${stdoutBuf}`));
        }
      }
    });
    
    proc.stderr!.on('data', (chunk: Buffer) => {
      if (process.env.DEBUG) {
        console.debug('[peeltls]', chunk.toString().trim());
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`PeelTLS binary failed to spawn: ${err.message}`));
    });
    
    proc.on('exit', (code) => {
      binaryProcess = null;
      binaryPort = null;
      binaryToken = null;
      startPromise = null;
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`PeelTLS binary exited with code ${code}`));
      }
    });
  });
  
  await startPromise;
  startPromise = null; // Allow restart if it exits later
  return { port: binaryPort!, token: binaryToken! };
}

/**
 * Fetch a URL using PeelTLS with TLS fingerprint spoofing.
 */
export async function peelTLSFetch(url: string, options?: PeelTLSOptions): Promise<PeelTLSResult> {
  const { port, token } = await ensureRunning();
  
  const mergedHeaders = {
    'User-Agent': CHROME_133_UA,
    ...DEFAULT_HEADERS,
    ...(options?.headers ?? {}),
  };
  
  const body = JSON.stringify({
    url,
    method: 'GET',
    headers: mergedHeaders,
    fingerprint: options?.fingerprint ?? 'chrome-133',
    proxy: options?.proxy ?? '',
    timeout: Math.round((options?.timeout ?? 30000) / 1000),
    followRedirects: true,
    maxRedirects: 10,
  });
  
  if (process.env.DEBUG) {
    console.debug('[peeltls]', 'fetch:', url);
  }
  
  const response = await fetch(`http://127.0.0.1:${port}/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body,
    signal: AbortSignal.timeout(options?.timeout ?? 30000),
  });
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`PeelTLS fetch failed: ${result.error}`);
  }
  
  return {
    html: result.body,
    url: result.finalUrl || url,
    statusCode: result.status,
    contentType: result.headers?.['content-type'] ?? 'text/html',
    method: 'peeltls',
  };
}

/**
 * Gracefully shut down the PeelTLS binary.
 */
export async function shutdownPeelTLS(): Promise<void> {
  if (!binaryPort || !binaryToken || !binaryProcess) return;
  
  try {
    await fetch(`http://127.0.0.1:${binaryPort}/shutdown`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${binaryToken}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Force kill if graceful shutdown fails
    binaryProcess?.kill('SIGTERM');
  }
  
  binaryProcess = null;
  binaryPort = null;
  binaryToken = null;
}

// Clean up on process exit
process.on('exit', () => {
  binaryProcess?.kill('SIGTERM');
});
process.on('SIGINT', () => {
  binaryProcess?.kill('SIGTERM');
  process.exit(0);
});
process.on('SIGTERM', () => {
  binaryProcess?.kill('SIGTERM');
  process.exit(0);
});
```

---

## Integration Points to Update

### 1. `src/core/strategies.ts`
Replace all `cycle-fetch.js` imports with `peel-tls.js`:
- Line ~585: explicit `--cycle` path → change to `--tls` path using `peelTLSFetch`
- Line ~936: escalation path → change to `peelTLSFetch`
- Update method names: `'cycle'` → `'peeltls'`

### 2. `src/cli.ts`
- Line ~185: `--cycle` flag → rename to `--tls` (keep `--cycle` as hidden alias for backward compat)
- Help text: "Use PeelTLS fingerprint spoofing" instead of CycleTLS

### 3. `src/types.ts`
- Line ~231: `cycle?: boolean` → add `tls?: boolean` (keep `cycle` as deprecated alias)
- Update method union type to include `'peeltls'`

### 4. `src/core/strategy-hooks.ts`
- Update method type to include `'peeltls'`

### 5. `src/index.ts`
- Line ~116: Replace CycleTLS exports with PeelTLS exports

### 6. `package.json`
- Remove `cycletls` from dependencies/optionalDependencies

---

## Testing Requirements

### Unit Tests (Go)
- Test fingerprint name→ID mapping
- Test JA3 string parsing
- Test proxy URL parsing

### Integration Tests (after build)
Run these REAL URLs to verify bypass works:
```bash
# Test 1: Basic HTTPS (should work with any fingerprint)
curl -s http://127.0.0.1:PORT/fetch -H "Authorization: Bearer TOKEN" \
  -d '{"url":"https://httpbin.org/headers","fingerprint":"chrome-133"}'

# Test 2: TLS fingerprint check
curl -s http://127.0.0.1:PORT/fetch -H "Authorization: Bearer TOKEN" \
  -d '{"url":"https://tls.browserleaks.com/json","fingerprint":"chrome-133"}'

# Test 3: Best Buy (Akamai)
# Test 4: Amazon (should work on residential IP)
# Test 5: Walmart (PerimeterX)
```

### Build Verification
```bash
cd peeltls
go build -o dist/peeltls .
# Binary should be < 15MB
# Should start and print JSON within 1s
```
