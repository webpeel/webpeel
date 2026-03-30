/**
 * Tests for `webpeel doctor` — capability matrix & health check.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDoctor, type DoctorReport, type CheckResult } from '../cli/commands/doctor.js';

describe('webpeel doctor', () => {
  // Capture the report once for inspection
  let report: DoctorReport;

  beforeEach(async () => {
    report = await runDoctor();
  });

  it('returns a valid report structure', () => {
    expect(report).toBeDefined();
    expect(report.version).toBeTruthy();
    expect(report.nodeVersion).toMatch(/^v\d+/);
    expect(report.platform).toBeTruthy();
    expect(report.configDir).toBeTruthy();
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('includes required checks', () => {
    const names = report.checks.map((c) => c.name);
    expect(names).toContain('WebPeel CLI');
    expect(names).toContain('Node.js');
    expect(names).toContain('Config file');
    expect(names).toContain('API key');
    expect(names).toContain('Browser (Chromium)');
    expect(names).toContain('LLM extraction');
    expect(names).toContain('Search providers');
    expect(names).toContain('Domain extractors');
    expect(names).toContain('MCP server');
    expect(names).toContain('Response cache');
  });

  it('each check has valid status', () => {
    for (const check of report.checks) {
      expect(['ok', 'warn', 'error', 'skip']).toContain(check.status);
    }
  });

  it('each check has valid category', () => {
    const validCategories = ['core', 'browser', 'api', 'llm', 'search', 'extras'];
    for (const check of report.checks) {
      expect(validCategories).toContain(check.category);
    }
  });

  it('summary counts match checks', () => {
    const counts = { ok: 0, warn: 0, error: 0, skip: 0 };
    for (const check of report.checks) counts[check.status]++;
    expect(report.summary).toEqual(counts);
  });

  it('Node.js check is ok for current environment', () => {
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js');
    expect(nodeCheck).toBeDefined();
    // We're running on Node 18+ in CI/dev, so should be ok
    const major = parseInt(process.version.slice(1), 10);
    if (major >= 18) {
      expect(nodeCheck!.status).toBe('ok');
    }
  });

  it('domain extractors shows 55+', () => {
    const extractorCheck = report.checks.find((c) => c.name === 'Domain extractors');
    expect(extractorCheck).toBeDefined();
    expect(extractorCheck!.status).toBe('ok');
    expect(extractorCheck!.detail).toContain('55+');
  });

  it('MCP server shows as built-in', () => {
    const mcpCheck = report.checks.find((c) => c.name === 'MCP server');
    expect(mcpCheck).toBeDefined();
    expect(mcpCheck!.status).toBe('ok');
    expect(mcpCheck!.detail).toContain('Built-in');
  });

  it('search providers always has DuckDuckGo', () => {
    const searchCheck = report.checks.find((c) => c.name === 'Search providers');
    expect(searchCheck).toBeDefined();
    expect(searchCheck!.status).toBe('ok');
    expect(searchCheck!.detail).toContain('DuckDuckGo');
  });
});

describe('doctor --json output shape', () => {
  it('produces valid JSON-serializable report', async () => {
    const report = await runDoctor();
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(report.version);
    expect(parsed.checks.length).toBe(report.checks.length);
    expect(parsed.summary).toEqual(report.summary);
  });
});
