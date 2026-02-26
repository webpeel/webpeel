import { describe, it, expect } from 'vitest';
import {
  SCHEMA_TEMPLATES,
  getSchemaTemplate,
  listSchemaTemplates,
} from '../core/schema-templates.js';

describe('schema-templates', () => {
  it('getSchemaTemplate returns template for known name', () => {
    const template = getSchemaTemplate('product');
    expect(template).not.toBeNull();
    expect(template?.name).toBe('Product');
    expect(typeof template?.fields).toBe('object');
  });

  it('getSchemaTemplate is case-insensitive', () => {
    const upper = getSchemaTemplate('PRODUCT');
    const mixed = getSchemaTemplate('Product');
    const lower = getSchemaTemplate('product');

    expect(upper).not.toBeNull();
    expect(mixed).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper?.fields).toEqual(lower?.fields);
    expect(mixed?.fields).toEqual(lower?.fields);
  });

  it('getSchemaTemplate returns null for unknown name', () => {
    const result = getSchemaTemplate('nonexistent-template-xyz');
    expect(result).toBeNull();
  });

  it('getSchemaTemplate returns null for JSON string', () => {
    const result = getSchemaTemplate('{"foo":"bar"}');
    expect(result).toBeNull();
  });

  it('getSchemaTemplate returns null for JSON array string', () => {
    const result = getSchemaTemplate('[{"foo":"bar"}]');
    expect(result).toBeNull();
  });

  it('listSchemaTemplates returns all template names', () => {
    const names = listSchemaTemplates();
    expect(Array.isArray(names)).toBe(true);
    expect(names).toContain('product');
    expect(names).toContain('article');
    expect(names).toContain('listing');
    expect(names).toContain('contact');
    expect(names).toContain('event');
    expect(names).toContain('recipe');
    expect(names).toContain('job');
    expect(names).toContain('review');
    expect(names.length).toBe(Object.keys(SCHEMA_TEMPLATES).length);
  });

  it('all templates have non-empty fields', () => {
    for (const [key, template] of Object.entries(SCHEMA_TEMPLATES)) {
      expect(template.fields, `Template "${key}" should have fields`).toBeDefined();
      const fieldKeys = Object.keys(template.fields);
      expect(fieldKeys.length, `Template "${key}" should have at least one field`).toBeGreaterThan(0);
      for (const [fieldKey, fieldDesc] of Object.entries(template.fields)) {
        expect(typeof fieldDesc, `Field "${fieldKey}" in "${key}" should be a string`).toBe('string');
        expect(fieldDesc.length, `Field "${fieldKey}" in "${key}" should have non-empty description`).toBeGreaterThan(0);
      }
    }
  });

  it('product template has expected fields', () => {
    const template = getSchemaTemplate('product');
    expect(template?.fields).toHaveProperty('name');
    expect(template?.fields).toHaveProperty('price');
    expect(template?.fields).toHaveProperty('description');
    expect(template?.fields).toHaveProperty('brand');
    expect(template?.fields).toHaveProperty('rating');
    expect(template?.fields).toHaveProperty('availability');
  });

  it('article template has expected fields', () => {
    const template = getSchemaTemplate('article');
    expect(template?.fields).toHaveProperty('title');
    expect(template?.fields).toHaveProperty('author');
    expect(template?.fields).toHaveProperty('date');
    expect(template?.fields).toHaveProperty('summary');
    expect(template?.fields).toHaveProperty('body');
  });

  it('getSchemaTemplate works with article template for BM25 extraction', () => {
    const template = getSchemaTemplate('article');
    expect(template).not.toBeNull();
    expect(template!.fields.title).toBeDefined();
    expect(template!.fields.author).toBeDefined();
    expect(template!.fields.date).toBeDefined();
  });
});
