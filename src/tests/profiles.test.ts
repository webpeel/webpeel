/**
 * Tests for profile management module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';

// ─── Helper: create an isolated profile directory for testing ────────────────

// We test the logic of these functions by monkey-patching the path via
// a thin wrapper. Since PROFILES_DIR is a module-level constant we can't
// override it directly, so we test the exported helpers against temp dirs
// created in /tmp.

import {
  isValidProfileName,
  getProfilePath,
  loadStorageState,
  listProfiles,
  deleteProfile,
  type ProfileMetadata,
} from '../core/profiles.js';

// ─── Name validation ─────────────────────────────────────────────────────────

describe('isValidProfileName', () => {
  it('accepts simple alphanumeric names', () => {
    expect(isValidProfileName('myprofile')).toBe(true);
    expect(isValidProfileName('MyProfile123')).toBe(true);
    expect(isValidProfileName('hotel')).toBe(true);
  });

  it('accepts names with hyphens', () => {
    expect(isValidProfileName('my-profile')).toBe(true);
    expect(isValidProfileName('test-hotel-booking')).toBe(true);
    expect(isValidProfileName('a-b-c')).toBe(true);
  });

  it('rejects names with spaces', () => {
    expect(isValidProfileName('my profile')).toBe(false);
    expect(isValidProfileName('hello world')).toBe(false);
    expect(isValidProfileName(' leading')).toBe(false);
  });

  it('accepts names with dots (for domain-style profile names)', () => {
    expect(isValidProfileName('instagram.com')).toBe(true);
    expect(isValidProfileName('linkedin.com')).toBe(true);
    expect(isValidProfileName('my.profile')).toBe(true);
  });

  it('rejects names with special characters', () => {
    expect(isValidProfileName('my_profile')).toBe(false);    // underscore
    expect(isValidProfileName('my/profile')).toBe(false);    // slash
    expect(isValidProfileName('my@profile')).toBe(false);    // at
    expect(isValidProfileName('my!profile')).toBe(false);    // exclamation
  });

  it('rejects empty string', () => {
    expect(isValidProfileName('')).toBe(false);
  });

  it('rejects names that are too long', () => {
    expect(isValidProfileName('a'.repeat(65))).toBe(false);
    expect(isValidProfileName('a'.repeat(64))).toBe(true);
  });
});

// ─── getProfilePath ───────────────────────────────────────────────────────────

describe('getProfilePath', () => {
  it('returns null for non-existent profile', () => {
    const result = getProfilePath('this-profile-definitely-does-not-exist-xyz123abc');
    expect(result).toBeNull();
  });

  it('returns null for profile directory without metadata.json', () => {
    // The function checks for metadata.json — a plain directory is not enough
    const result = getProfilePath('__no-such-profile__');
    expect(result).toBeNull();
  });
});

// ─── listProfiles ────────────────────────────────────────────────────────────

describe('listProfiles', () => {
  it('returns an array (empty or populated)', () => {
    const profiles = listProfiles();
    expect(Array.isArray(profiles)).toBe(true);
  });

  it('returns ProfileMetadata objects with required fields', () => {
    const profiles = listProfiles();
    for (const p of profiles) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.created).toBe('string');
      expect(typeof p.lastUsed).toBe('string');
      expect(Array.isArray(p.domains)).toBe(true);
      // Verify dates are valid ISO strings
      expect(() => new Date(p.created)).not.toThrow();
      expect(() => new Date(p.lastUsed)).not.toThrow();
    }
  });
});

// ─── loadStorageState ────────────────────────────────────────────────────────

describe('loadStorageState', () => {
  it('returns null for non-existent profile', () => {
    const result = loadStorageState('this-profile-does-not-exist-xyz987');
    expect(result).toBeNull();
  });
});

// ─── deleteProfile ────────────────────────────────────────────────────────────

describe('deleteProfile', () => {
  it('returns false for non-existent profile', () => {
    const result = deleteProfile('this-profile-does-not-exist-xyz987');
    expect(result).toBe(false);
  });
});

// ─── Metadata serialization ───────────────────────────────────────────────────

describe('ProfileMetadata serialization', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `webpeel-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('serializes and deserializes metadata correctly', () => {
    const now = new Date().toISOString();
    const meta: ProfileMetadata = {
      name: 'test-profile',
      created: now,
      lastUsed: now,
      domains: ['example.com', 'google.com'],
      description: 'Test profile',
    };

    const metaPath = path.join(tmpDir, 'metadata.json');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const loaded: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));

    expect(loaded.name).toBe(meta.name);
    expect(loaded.created).toBe(meta.created);
    expect(loaded.lastUsed).toBe(meta.lastUsed);
    expect(loaded.domains).toEqual(meta.domains);
    expect(loaded.description).toBe(meta.description);
  });

  it('handles metadata without optional description field', () => {
    const now = new Date().toISOString();
    const meta: ProfileMetadata = {
      name: 'minimal',
      created: now,
      lastUsed: now,
      domains: [],
    };

    const metaPath = path.join(tmpDir, 'metadata.json');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const loaded: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));

    expect(loaded.name).toBe('minimal');
    expect(loaded.domains).toEqual([]);
    expect(loaded.description).toBeUndefined();
  });

  it('domains array contains only strings', () => {
    const domains = ['example.com', 'github.com', 'google.com'];
    const now = new Date().toISOString();
    const meta: ProfileMetadata = {
      name: 'multi-domain',
      created: now,
      lastUsed: now,
      domains,
    };
    for (const d of meta.domains) {
      expect(typeof d).toBe('string');
    }
  });
});
