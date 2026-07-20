import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateId } from './id-generator.js';

// Feature: core-foundation, Property 17: ID generator produces valid UUIDv7 format
// Feature: core-foundation, Property 18: ID generator produces time-sortable identifiers

const PBT_CONFIG = { numRuns: 100 };
const UUIDV7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ID Generator - Property Tests', () => {
  /**
   * Property 17: ID generator produces valid UUIDv7 format
   * **Validates: Requirements 10.1, 10.2**
   *
   * For any invocation of generateId(), the returned string SHALL match
   * the UUIDv7 regex with version nibble 7 and variant bits 10xx.
   */
  it('Property 17: every generated ID matches UUIDv7 format', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id = generateId();
        expect(id).toMatch(UUIDV7_REGEX);
      }),
      PBT_CONFIG,
    );
  });

  /**
   * Property 18: ID generator produces time-sortable identifiers
   * **Validates: Requirements 10.3, 10.4**
   *
   * For any batch of sequentially generated identifiers, each identifier
   * SHALL sort lexicographically before the next. The uuid package guarantees
   * monotonic ordering via an internal counter even within the same millisecond.
   */
  it('Property 18: sequentially generated IDs are lexicographically ordered', () => {
    fc.assert(
      fc.property(
        // Generate a batch size between 2 and 20
        fc.integer({ min: 2, max: 20 }),
        (batchSize) => {
          const ids: string[] = [];
          for (let i = 0; i < batchSize; i++) {
            ids.push(generateId());
          }

          // Each ID must sort before the next
          for (let i = 0; i < ids.length - 1; i++) {
            expect(ids[i] < ids[i + 1]).toBe(true);
          }
        },
      ),
      PBT_CONFIG,
    );
  });
});
