/**
 * Tests for `webpeel skill` — optional capability management.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', '..', 'dist', 'cli.js');

describe('webpeel skill', () => {
  it('lists skills with status', () => {
    const output = execSync(`node ${CLI} skill --json`, {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    // Extract JSON from output (skip stderr debug lines)
    const lines = output.split('\n');
    const jsonStart = lines.findIndex((l) => l.trim().startsWith('['));
    const json = lines.slice(jsonStart).join('\n');
    const skills = JSON.parse(json);
    
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThanOrEqual(2);

    // Check structure
    for (const skill of skills) {
      expect(skill).toHaveProperty('name');
      expect(skill).toHaveProperty('description');
      expect(skill).toHaveProperty('features');
      expect(skill).toHaveProperty('installed');
      expect(skill).toHaveProperty('installHint');
      expect(typeof skill.installed).toBe('boolean');
    }

    // Known skills should be present
    const names = skills.map((s: any) => s.name);
    expect(names).toContain('browser');
    expect(names).toContain('yt-dlp');
  });

  it('rejects unknown skill install', () => {
    try {
      execSync(`node ${CLI} skill --install nonexistent`, {
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: 'pipe',
      });
      // Should not reach here
      expect.fail('Expected command to fail');
    } catch (e: any) {
      expect(e.stderr || e.stdout).toContain('Unknown skill');
    }
  });
});
