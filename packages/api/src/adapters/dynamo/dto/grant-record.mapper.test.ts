import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { toPersistence, fromPersistence } from './grant-record.mapper.js';
import type { GrantRecord } from '@hecaton/core';

const arbUuidV7 = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-7${p3}-${variant}${p4}-${p5}`);

const arbIsoDatetime = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

const arbConfigName = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
      minLength: 0,
      maxLength: 20,
    }),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([first, middle, last]) => `${first}${middle}${last}`);

const arbGrantRecord: fc.Arbitrary<GrantRecord> = fc
  .tuple(
    arbConfigName,
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      { minKeys: 0, maxKeys: 5 },
    ),
    arbIsoDatetime,
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.option(arbIsoDatetime, { nil: undefined }),
    fc.option(arbUuidV7, { nil: undefined }),
  )
  .map(([configName, shapeName, parameters, grantedAt, grantedBy, expiresAt, grantId]) => ({
    ...(grantId !== undefined ? { grantId } : {}),
    configName,
    shapeName,
    parameters,
    grantedAt,
    grantedBy,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 1: Persistence mapper round-trip', () => {
    it('for any valid GrantRecord, toPersistence then fromPersistence produces an equivalent object', () => {
      fc.assert(
        fc.property(arbGrantRecord, (grant) => {
          const persisted = toPersistence(grant);
          const restored = fromPersistence(persisted);
          expect(restored).toEqual(grant);
        }),
        { numRuns: 100 },
      );
    });
  });
});
