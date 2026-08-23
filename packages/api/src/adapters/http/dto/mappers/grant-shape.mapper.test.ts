import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GrantRecordSchema } from '@hecaton/core';

import { toDomain } from './grant-shape.mapper.js';
import type { GrantShapeRequest } from '../requests/grant-shape.request.js';

const UuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IsoDatetimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

const arbConfigName = fc
  .tuple(
    fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
      minLength: 0,
      maxLength: 20,
    }),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([first, middle, last]) => `${first}${middle}${last}`);

const arbGrantShapeRequest: fc.Arbitrary<GrantShapeRequest> = fc
  .tuple(
    arbConfigName,
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      { minKeys: 0, maxKeys: 5 },
    ),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.option(
      fc
        .date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') })
        .map((d) => d.toISOString()),
      { nil: undefined },
    ),
  )
  .map(([configName, roleName, shapeName, parameters, grantedBy, expiresAt]) => ({
    configName,
    roleName,
    shapeName,
    parameters,
    grantedBy,
    ...(expiresAt !== undefined && { expiresAt }),
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 2: HTTP-to-domain mapper correctness', () => {
    it('for any valid GrantShapeRequest, toDomain produces a GrantRecord passing schema validation', () => {
      fc.assert(
        fc.property(arbGrantShapeRequest, (dto) => {
          const result = toDomain(dto);

          // Valid UUIDv7 grantId
          expect(result.grantId).toMatch(UuidV7Pattern);

          // Valid ISO 8601 grantedAt
          expect(result.grantedAt).toMatch(IsoDatetimePattern);

          // Preserves all input fields
          expect(result.configName).toBe(dto.configName);
          expect(result.shapeName).toBe(dto.shapeName);
          expect(result.parameters).toEqual(dto.parameters);
          expect(result.grantedBy).toBe(dto.grantedBy);
          if (dto.expiresAt !== undefined) {
            expect(result.expiresAt).toBe(dto.expiresAt);
          } else {
            expect(result.expiresAt).toBeUndefined();
          }

          // Passes GrantRecordSchema validation
          const parseResult = GrantRecordSchema.safeParse(result);
          expect(parseResult.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
