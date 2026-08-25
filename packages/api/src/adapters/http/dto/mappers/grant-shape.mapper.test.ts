import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GrantRecordSchema } from '@hecaton/core';

import { toDomain, toResponse } from './grant-shape.mapper.js';
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
    fc.uuid(), // agentId
    fc.string({ minLength: 1, maxLength: 40 }), // shapeName
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      { minKeys: 0, maxKeys: 5 },
    ), // parameters
    fc.string({ minLength: 1, maxLength: 40 }), // grantedBy
    fc.option(
      fc
        .date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') })
        .map((d) => d.toISOString()),
      { nil: undefined },
    ), // expiresAt
  )
  .map(([agentId, shapeName, parameters, grantedBy, expiresAt]) => ({
    agentId,
    shapeName,
    parameters,
    grantedBy,
    ...(expiresAt !== undefined && { expiresAt }),
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 2: HTTP-to-domain mapper correctness', () => {
    it('for any valid GrantShapeRequest + configName, toDomain produces a GrantRecord passing schema validation', () => {
      fc.assert(
        fc.property(arbGrantShapeRequest, arbConfigName, (dto, configName) => {
          const result = toDomain(dto, configName);

          // Valid UUIDv7 grantId
          expect(result.grantId).toMatch(UuidV7Pattern);

          // Valid ISO 8601 grantedAt
          expect(result.grantedAt).toMatch(IsoDatetimePattern);

          // Uses resolved configName, not from request
          expect(result.configName).toBe(configName);

          // Preserves other input fields
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

  describe('toResponse includes agentId', () => {
    it('includes agentId in response along with all grant fields', () => {
      const grant = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };
      const agentId = 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

      const response = toResponse(grant, agentId);

      expect(response.agentId).toBe(agentId);
      expect(response.grantId).toBe(grant.grantId);
      expect(response.configName).toBe(grant.configName);
      expect(response.shapeName).toBe(grant.shapeName);
      expect(response.parameters).toEqual(grant.parameters);
      expect(response.grantedAt).toBe(grant.grantedAt);
      expect(response.grantedBy).toBe(grant.grantedBy);
    });

    it('includes expiresAt in response when present', () => {
      const grant = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: {},
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
        expiresAt: '2027-01-01T00:00:00.000Z',
      };

      const response = toResponse(grant, 'agent-id');
      expect(response.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    });
  });
});
