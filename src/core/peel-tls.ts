/**
 * PeelTLS — WebPeel's TLS Fingerprint Spoofing Engine
 * BSD-licensed replacement for CycleTLS (GPL-3).
 *
 * Manages a singleton Go binary process that provides TLS fingerprint spoofing
 * via uTLS (utls library). The binary exposes a local HTTP API that this module
 * communicates with.
 */

import { existsSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { platform, arch } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { FetchResult } from './fetcher.js';

// Chrome 133 user agent (matches Go binary's default fingerprint)
const CHROME_133_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'Sec-Ch-Ua': '"Chromium";v="133", "Google Chrome";v="133"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface PeelTLSOptions {
  timeout?: number;
  proxy?: string;
  headers?: Record<string, string>;
  /** TLS fingerprint preset: 'chrome-133' | 'firefox-120' | 'safari-16' | raw JA3 string */
  fingerprint?: string;
}

export interface PeelTLSResult extends FetchResult {
  method: 'peeltls';
}

// ─── Singleton state ──────────────────────────────────────────────────────────

let binaryProcess: ChildProcess | null = null;
let binaryPort: number | null = null;
let binaryToken: string | null = null;
let startPromise: Promise<void> | null = null;

// ─── Binary discovery ─────────────────────────────────────────────────────────

/** Get the binary path for the current platform/arch. */
function getBinaryPath(): string {
  const plat = platform(); // 'darwin' | 'linux' | 'win32'
  const ar = arch(); // 'x64' | 'arm64'

  const platMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
  };

  const suffix = plat === 'win32' ? '.exe' : '';
  const name = `peeltls-${platMap[plat] ?? plat}-${archMap[ar] ?? ar}${suffix}`;

  // Resolve __dirname for both ESM and CJS
  let thisDir: string;
  try {
    thisDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    thisDir = __dirname ?? process.cwd();
  }

  const candidates = [
    // Relative to this file: src/core/ -> ../../peeltls/dist/
    pathResolve(thisDir, '..', '..', 'peeltls', 'dist', name),
    // From project root (cwd)
    pathResolve(process.cwd(), 'peeltls', 'dist', name),
    // Fallback: just 'peeltls' in dist (for development)
    pathResolve(process.cwd(), 'peeltls', 'dist', 'peeltls'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `PeelTLS binary not found for ${plat}/${ar}.\nExpected: ${candidates[0]}\nBuild it with: cd peeltls && bash build.sh`,
  );
}

/** Check if the PeelTLS binary is available on this platform. */
export function isPeelTLSAvailable(): boolean {
  try {
    getBinaryPath();
    return true;
  } catch {
    return false;
  }
}

// ─── Process management ───────────────────────────────────────────────────────

/** Start the PeelTLS Go binary (singleton — only spawned once). */
async function ensureRunning(): Promise<{ port: number; token: string }> {
  // Already running
  if (binaryPort !== null && binaryToken !== null && binaryProcess !== null && !binaryProcess.killed) {
    return { port: binaryPort, token: binaryToken };
  }

  // Another call already started it
  if (startPromise !== null) {
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
    const startupTimeout = setTimeout(() => {
      proc.kill();
      reject(new Error('PeelTLS binary failed to start within 10s'));
    }, 10_000);

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const newlineIdx = stdoutBuf.indexOf('\n');
      if (newlineIdx !== -1) {
        clearTimeout(startupTimeout);
        try {
          const info = JSON.parse(stdoutBuf.slice(0, newlineIdx)) as { port: number; token: string };
          binaryPort = info.port;
          binaryToken = token;
          binaryProcess = proc;
          resolve();
        } catch {
          proc.kill();
          reject(new Error(`PeelTLS binary output invalid JSON: ${stdoutBuf}`));
        }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      if (process.env['DEBUG']) {
        process.stderr.write(`[peeltls] ${chunk.toString().trim()}\n`);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(startupTimeout);
      reject(new Error(`PeelTLS binary failed to spawn: ${err.message}`));
    });

    proc.on('exit', (code) => {
      binaryProcess = null;
      binaryPort = null;
      binaryToken = null;
      startPromise = null;
      if (code !== 0 && code !== null) {
        clearTimeout(startupTimeout);
        // Don't reject here if already resolved — just clean state
      }
    });
  });

  await startPromise;
  startPromise = null; // Reset so it can restart if the process exits later
  return { port: binaryPort!, token: binaryToken! };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch a URL using PeelTLS TLS fingerprint spoofing. */
export async function peelTLSFetch(url: string, options?: PeelTLSOptions): Promise<PeelTLSResult> {
  const { port, token } = await ensureRunning();

  const mergedHeaders: Record<string, string> = {
    'User-Agent': CHROME_133_UA,
    ...DEFAULT_HEADERS,
    ...(options?.headers ?? {}),
  };

  const requestBody = JSON.stringify({
    url,
    method: 'GET',
    headers: mergedHeaders,
    fingerprint: options?.fingerprint ?? 'chrome-133',
    proxy: options?.proxy ?? '',
    timeout: Math.round((options?.timeout ?? 30_000) / 1000),
    followRedirects: true,
    maxRedirects: 10,
  });

  if (process.env['DEBUG']) {
    process.stderr.write(`[peeltls] fetch: ${url}\n`);
  }

  const timeoutMs = options?.timeout ?? 30_000;
  const response = await fetch(`http://127.0.0.1:${port}/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs + 5_000), // extra buffer over Go's own timeout
  });

  const result = (await response.json()) as {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    finalUrl?: string;
    error?: string;
  };

  if (result.error) {
    throw new Error(`PeelTLS fetch failed: ${result.error}`);
  }

  return {
    html: result.body ?? '',
    url: result.finalUrl ?? url,
    statusCode: result.status ?? 0,
    contentType: result.headers?.['content-type'] ?? 'text/html',
    method: 'peeltls',
  };
}

/** Gracefully shut down the PeelTLS binary process. */
export async function shutdownPeelTLS(): Promise<void> {
  if (binaryPort === null || binaryToken === null || binaryProcess === null) return;

  try {
    await fetch(`http://127.0.0.1:${binaryPort}/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${binaryToken}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Force kill if graceful shutdown fails or times out
    binaryProcess?.kill('SIGTERM');
  }

  binaryProcess = null;
  binaryPort = null;
  binaryToken = null;
}

// ─── Process exit cleanup ─────────────────────────────────────────────────────

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
