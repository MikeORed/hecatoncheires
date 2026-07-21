import { describe, it, expect } from 'vitest';
import { IdSchema } from './id.schema.js';
import { generateId } from '../utilities/id-generator.js';

describe('IdSchema', () => {
  it('accepts a valid UUIDv7 string', () => {
    const id = generateId();
    const result = IdSchema.safeParse(id);
    expect(result.success).toBe(true);
  });

  it('accepts a known valid UUIDv7 string', () => {
    // A manually crafted UUIDv7: version nibble 7, variant 10xx
    const result = IdSchema.safeParse('01912345-6789-7abc-89de-f01234567890');
    expect(result.success).toBe(true);
  });

  it('rejects a UUIDv4 string (version nibble 4)', () => {
    const result = IdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID string', () => {
    const result = IdSchema.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = IdSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects uppercase UUIDv7', () => {
    const result = IdSchema.safeParse('01912345-6789-7ABC-89DE-F01234567890');
    expect(result.success).toBe(false);
  });

  it('rejects a UUID with incorrect variant bits', () => {
    // Variant nibble is 'c' (not in [89ab])
    const result = IdSchema.safeParse('01912345-6789-7abc-c9de-f01234567890');
    expect(result.success).toBe(false);
  });
});
