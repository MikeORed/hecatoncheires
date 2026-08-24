import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { validateGrant, type ValidationResult } from './grant.validator.js';
import { validateGrantSet } from './grant-set.validator.js';
import { validatePolicySize } from './policy-size.validator.js';
import { SHAPE_CATALOG } from '../config/shape-catalog.js';
import {
  ShapeNotFoundError,
  InvalidShapeParametersError,
  ValidationError,
  GrantConflictError,
  PolicySizeExceededError,
} from '../errors/index.js';
import { AWS_INLINE_POLICY_SIZE_LIMIT } from '../constants/limits.js';
import type { GrantRecord, IamPolicyDocument } from '../types/index.js';

const PBT_CONFIG = { numRuns: 100 };

// --- Arbitraries ---

/** Generates a valid configName matching ^[a-z][a-z0-9-]*[a-z0-9]$ with length 2-40 */
const arbConfigName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/** Generates a shapeName that is NOT in the catalog */
const catalogShapeNames = SHAPE_CATALOG.map((s) => s.shapeName);
const arbUnknownShapeName = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !catalogShapeNames.includes(s));

/** Generates a valid ISO datetime string */
const arbDatetime = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  })
  .map((d) => d.toISOString());

/** Picks a random shape from the catalog */
const arbCatalogShape = fc.constantFrom(...SHAPE_CATALOG);

describe('Validators Property Tests', () => {
  // Feature: core-foundation, Property 12: Grant validator rejects references to unknown shapes
  describe('Property 12: Grant validator rejects references to unknown shapes', () => {
    /**
     * **Validates: Requirements 8.1**
     *
     * For any grant record whose shapeName is NOT present in the provided catalog,
     * validateGrant SHALL return { valid: false } with a ShapeNotFoundError.
     */
    it('Property 12: validates that unknown shapes produce ShapeNotFoundError', () => {
      fc.assert(
        fc.property(arbConfigName, arbUnknownShapeName, arbDatetime, (configName, shapeName, grantedAt) => {
          const grant: GrantRecord = {
            configName,
            shapeName,
            parameters: {},
            grantedAt,
            grantedBy: 'test-user',
          };

          const result: ValidationResult = validateGrant(grant, SHAPE_CATALOG);

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(ShapeNotFoundError);
            expect(result.error.code).toBe('SHAPE_NOT_FOUND');
            expect(result.error.details?.shapeName).toBe(shapeName);
          }
        }),
        PBT_CONFIG,
      );
    });
  });

  // Feature: core-foundation, Property 13: Grant validator rejects incomplete parameter sets
  describe('Property 13: Grant validator rejects incomplete parameter sets', () => {
    /**
     * **Validates: Requirements 8.2**
     *
     * For any grant whose parameters map is missing one or more required parameters
     * of its referenced shape, validateGrant SHALL return { valid: false } with
     * InvalidShapeParametersError.
     */
    it('Property 13: validates that missing parameters produce InvalidShapeParametersError', () => {
      // Only test shapes that have required parameters
      const shapesWithParams = SHAPE_CATALOG.filter((s) => s.requiredParameters.length > 0);
      const arbShapeWithParams = fc.constantFrom(...shapesWithParams);

      fc.assert(
        fc.property(
          arbConfigName,
          arbShapeWithParams,
          arbDatetime,
          (configName, shape, grantedAt) => {
            // Generate a parameters map that is missing at least one required param
            // Strategy: include a random subset (0 to n-1 params) — always missing at least one
            const allParams = shape.requiredParameters;
            const numToInclude = Math.floor(Math.random() * allParams.length); // 0..n-1
            const includedParams = allParams.slice(0, numToInclude);
            const parameters: Record<string, string> = {};
            for (const p of includedParams) {
              parameters[p] = 'some-value';
            }

            const grant: GrantRecord = {
              configName,
              shapeName: shape.shapeName,
              parameters,
              grantedAt,
              grantedBy: 'test-user',
            };

            const result: ValidationResult = validateGrant(grant, SHAPE_CATALOG);

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.error).toBeInstanceOf(InvalidShapeParametersError);
              expect(result.error.code).toBe('INVALID_SHAPE_PARAMETERS');
              // Verify the missing params are reported
              const missing = result.error.details?.missingParameters as string[];
              expect(missing.length).toBeGreaterThan(0);
              // Each reported missing param should be one of the required params not provided
              for (const m of missing) {
                expect(allParams).toContain(m);
                expect(parameters).not.toHaveProperty(m);
              }
            }
          },
        ),
        PBT_CONFIG,
      );
    });
  });

  // Feature: core-foundation, Property 14: Grant validator rejects invalid expiry timestamps
  describe('Property 14: Grant validator rejects invalid expiry timestamps', () => {
    /**
     * **Validates: Requirements 4.7, 8.3**
     *
     * For any grant where expiresAt is present and <= grantedAt,
     * validateGrant SHALL return { valid: false } with ValidationError.
     */
    it('Property 14: validates that expiresAt <= grantedAt produces ValidationError', () => {
      // Use core-invocation shape (single required param) to ensure shape/param checks pass
      const shape = SHAPE_CATALOG.find((s) => s.shapeName === 'core-invocation')!;

      fc.assert(
        fc.property(
          arbConfigName,
          fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z') }),
          fc.boolean(),
          (configName, baseDate, isEqual) => {
            // Generate grantedAt and expiresAt where expiresAt <= grantedAt
            const grantedAt = baseDate.toISOString();
            let expiresAt: string;
            if (isEqual) {
              expiresAt = grantedAt;
            } else {
              // expiresAt is earlier than grantedAt
              const earlier = new Date(baseDate.getTime() - Math.floor(Math.random() * 86400000) - 1);
              expiresAt = earlier.toISOString();
            }

            const grant: GrantRecord = {
              configName,
              shapeName: shape.shapeName,
              parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123456789012:profile/test' },
              grantedAt,
              grantedBy: 'test-user',
              expiresAt,
            };

            const result: ValidationResult = validateGrant(grant, SHAPE_CATALOG);

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.error).toBeInstanceOf(ValidationError);
              expect(result.error.code).toBe('VALIDATION_ERROR');
              expect(result.error.details?.grantedAt).toBe(grantedAt);
              expect(result.error.details?.expiresAt).toBe(expiresAt);
            }
          },
        ),
        PBT_CONFIG,
      );
    });
  });

  // Feature: core-foundation, Property 15: Grant set validator detects duplicate grants
  describe('Property 15: Grant set validator detects duplicate grants', () => {
    /**
     * **Validates: Requirements 8.4**
     *
     * For any set of grants containing two or more entries with the same configName,
     * shapeName, and parameters, validateGrantSet SHALL return a GrantConflictError.
     */
    it('Property 15: validates that duplicate grants produce GrantConflictError', () => {
      fc.assert(
        fc.property(
          arbConfigName,
          arbCatalogShape,
          arbDatetime,
          arbDatetime,
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.string({ minLength: 1, maxLength: 30 }),
          (configName, shape, grantedAt1, grantedAt2, grantedBy1, grantedBy2) => {
            // Build valid parameters for the chosen shape
            const parameters: Record<string, string> = {};
            for (const p of shape.requiredParameters) {
              parameters[p] = 'arn:aws:service:us-east-1:123456789012:resource/test-value';
            }

            const grant1: GrantRecord = {
              grantId: '0190d4a1-7e00-7000-8000-000000000001',
              configName,
              shapeName: shape.shapeName,
              parameters,
              grantedAt: grantedAt1,
              grantedBy: grantedBy1,
            };

            const grant2: GrantRecord = {
              grantId: '0190d4a1-7e00-7000-8000-000000000002',
              configName,
              shapeName: shape.shapeName,
              parameters, // Same parameters — makes it a duplicate
              grantedAt: grantedAt2,
              grantedBy: grantedBy2,
            };

            const result: ValidationResult = validateGrantSet([grant1, grant2]);

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.error).toBeInstanceOf(GrantConflictError);
              expect(result.error.code).toBe('GRANT_CONFLICT');
              expect(result.error.details?.configName).toBe(configName);
              expect(result.error.details?.shapeName).toBe(shape.shapeName);
            }
          },
        ),
        PBT_CONFIG,
      );
    });
  });

  // Feature: core-foundation, Property 16: Policy size validator rejects oversized policies
  describe('Property 16: Policy size validator rejects oversized policies', () => {
    /**
     * **Validates: Requirements 8.5**
     *
     * For any IAM policy document whose JSON serialization exceeds 10,240 bytes,
     * the Policy_Size_Validator SHALL return a validation failure reporting the
     * actual size and the limit.
     */
    it('Property 16: validates that oversized policies produce validation failure', () => {
      // Generate policies that always exceed the limit by using many statements with long ARNs
      const arbOversizedPolicy: fc.Arbitrary<IamPolicyDocument> = fc
        .tuple(
          fc.integer({ min: 20, max: 50 }), // number of statements
          fc.integer({ min: 200, max: 600 }), // ARN suffix length
        )
        .map(([numStatements, arnLength]) => {
          const longArn = 'arn:aws:s3:::' + 'a'.repeat(arnLength);
          const statements = Array.from({ length: numStatements }, () => ({
            Effect: 'Allow' as const,
            Action: 's3:GetObject',
            Resource: longArn,
          }));
          return {
            Version: '2012-10-17' as const,
            Statement: statements,
          };
        })
        .filter((policy) => {
          const size = Buffer.byteLength(JSON.stringify(policy), 'utf8');
          return size > AWS_INLINE_POLICY_SIZE_LIMIT;
        });

      fc.assert(
        fc.property(arbOversizedPolicy, (policy) => {
          const result: ValidationResult = validatePolicySize(policy);
          const actualSize = Buffer.byteLength(JSON.stringify(policy), 'utf8');

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeInstanceOf(PolicySizeExceededError);
            expect(result.error.code).toBe('POLICY_SIZE_EXCEEDED');
            expect(result.error.details?.actualSize).toBe(actualSize);
            expect(result.error.details?.limit).toBe(AWS_INLINE_POLICY_SIZE_LIMIT);
          }
        }),
        PBT_CONFIG,
      );
    });
  });
});
