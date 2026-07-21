// Feature: core-foundation, Property 7: Shape resolution rejects unknown shape names
// Feature: core-foundation, Property 8: Policy assembly preserves all resolved statements without deduplication
// Feature: core-foundation, Property 9: Policy assembly always produces a valid IAM policy structure

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assemblePolicy } from './assemble-policy.js';
import { resolveShape } from './resolve-shape.js';
import { ShapeNotFoundError } from '../../errors/index.js';
import { IamPolicyDocumentSchema } from '../../schemas/index.js';
import type { GrantRecord } from '../../types/index.js';
import { SHAPE_CATALOG } from '../../config/index.js';

// --- Arbitrary Generators ---

const KNOWN_SHAPE_NAMES = SHAPE_CATALOG.map((t) => t.shapeName);

/**
 * Generates ARN-like strings: arn:aws:service:region:account:resource
 */
const arbArn = fc
  .tuple(
    fc.constantFrom('bedrock', 's3', 'logs', 'iam'),
    fc.constantFrom('us-east-1', 'eu-west-1', 'ap-southeast-1'),
    fc.stringMatching(/^[0-9]{12}$/).filter((s) => s.length === 12),
    fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  )
  .map(([service, region, account, resource]) => `arn:aws:${service}:${region}:${account}:${resource}`);

/**
 * Generates a valid path-like prefix string (e.g., "data/uploads/").
 */
const arbPrefix = fc
  .array(fc.stringMatching(/^[a-z0-9]+$/), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('/') + '/');

/**
 * Generates a valid GrantRecord referencing a shape from SHAPE_CATALOG with proper parameters.
 */
const arbValidGrant: fc.Arbitrary<GrantRecord> = fc
  .oneof(
    // core-invocation
    arbArn.map((arn) => ({
      shapeName: 'core-invocation',
      parameters: { inferenceProfileArn: arn },
    })),
    // s3-prefix-read
    fc.tuple(arbArn, arbPrefix).map(([bucketArn, prefix]) => ({
      shapeName: 's3-prefix-read',
      parameters: { bucketArn, prefix },
    })),
    // s3-prefix-write
    fc.tuple(arbArn, arbPrefix).map(([bucketArn, prefix]) => ({
      shapeName: 's3-prefix-write',
      parameters: { bucketArn, prefix },
    })),
    // cloudwatch-logs-read
    arbArn.map((arn) => ({
      shapeName: 'cloudwatch-logs-read',
      parameters: { logGroupArn: arn },
    })),
  )
  .map((partial) => ({
    configName: 'test-agent',
    shapeName: partial.shapeName,
    parameters: partial.parameters,
    grantedAt: '2024-01-01T00:00:00Z',
    grantedBy: 'system',
  }));

/**
 * Generates a shapeName that is NOT in the catalog.
 */
const arbUnknownShapeName = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !KNOWN_SHAPE_NAMES.includes(s) && s.trim().length > 0);

describe('assemblePolicy property tests', () => {
  // **Validates: Requirements 5.2, 5.3, 5.4, 3.7**

  describe('Property 7: Shape resolution rejects unknown shape names', () => {
    it('throws ShapeNotFoundError for any unknown shape name', () => {
      fc.assert(
        fc.property(arbUnknownShapeName, (unknownShape) => {
          const grant: GrantRecord = {
            configName: 'test-agent',
            shapeName: unknownShape,
            parameters: {},
            grantedAt: '2024-01-01T00:00:00Z',
            grantedBy: 'system',
          };

          expect(() => assemblePolicy([grant], SHAPE_CATALOG)).toThrow(ShapeNotFoundError);

          try {
            assemblePolicy([grant], SHAPE_CATALOG);
          } catch (err) {
            expect((err as Error).message).toContain(unknownShape);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 8: Policy assembly preserves all resolved statements without deduplication', () => {
    it('assembled policy Statement count equals sum of individually resolved statement counts', () => {
      fc.assert(
        fc.property(
          fc.array(arbValidGrant, { minLength: 1, maxLength: 5 }),
          (grants) => {
            const policy = assemblePolicy(grants, SHAPE_CATALOG);

            // Manually resolve each grant and count the total statements
            const expectedCount = grants.reduce((sum, grant) => {
              const template = SHAPE_CATALOG.find((t) => t.shapeName === grant.shapeName)!;
              const resolved = resolveShape(template, grant.parameters);
              return sum + resolved.length;
            }, 0);

            expect(policy.Statement).toHaveLength(expectedCount);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 9: Policy assembly always produces a valid IAM policy structure', () => {
    it('empty grants produce a valid policy document', () => {
      const policy = assemblePolicy([], SHAPE_CATALOG);
      const result = IamPolicyDocumentSchema.safeParse(policy);
      expect(result.success).toBe(true);
    });

    it('any set of valid grants produces a valid IAM policy document', () => {
      fc.assert(
        fc.property(
          fc.array(arbValidGrant, { minLength: 0, maxLength: 5 }),
          (grants) => {
            const policy = assemblePolicy(grants, SHAPE_CATALOG);
            const result = IamPolicyDocumentSchema.safeParse(policy);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
