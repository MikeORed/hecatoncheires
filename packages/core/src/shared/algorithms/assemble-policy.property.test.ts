// Feature: core-foundation, Property 7: Shape resolution rejects unknown shape names
// Feature: core-foundation, Property 8: Policy assembly preserves all resolved statements without deduplication
// Feature: core-foundation, Property 9: Policy assembly always produces a valid IAM policy structure
// Feature: multi-profile-identity, Property 4: Policy assembly resolves core-invocation from profile context

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assemblePolicy } from './assemble-policy.js';
import type { PolicyAssemblyContext } from './assemble-policy.js';
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
  .map(
    ([service, region, account, resource]) =>
      `arn:aws:${service}:${region}:${account}:${resource}`,
  );

/**
 * Generates a valid path-like prefix string (e.g., "data/uploads/").
 */
const arbPrefix = fc
  .array(fc.stringMatching(/^[a-z0-9]+$/), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('/') + '/');

/**
 * Generates a valid GrantRecord referencing a shape from SHAPE_CATALOG with proper parameters.
 * Note: core-invocation no longer needs parameters — profile ARNs come from context.
 */
const arbValidGrant: fc.Arbitrary<GrantRecord> = fc
  .oneof(
    // core-invocation (no parameters needed)
    fc.constant({
      shapeName: 'core-invocation',
      parameters: {},
    }),
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

/**
 * A default PolicyAssemblyContext with at least one profile ARN for tests.
 */
const defaultContext: PolicyAssemblyContext = {
  profileArns: ['arn:aws:bedrock:us-east-1:123456789012:inference-profile/test-profile'],
};

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

          expect(() => assemblePolicy([grant], SHAPE_CATALOG, defaultContext)).toThrow(
            ShapeNotFoundError,
          );

          try {
            assemblePolicy([grant], SHAPE_CATALOG, defaultContext);
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
            const policy = assemblePolicy(grants, SHAPE_CATALOG, defaultContext);

            // Manually resolve each grant and count the total statements
            const expectedCount = grants.reduce((sum, grant) => {
              const template = SHAPE_CATALOG.find((t) => t.shapeName === grant.shapeName)!;
              if (grant.shapeName === 'core-invocation') {
                // core-invocation produces one statement per template statement
                // when context has profile ARNs
                return sum + template.statements.length;
              }
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
      const policy = assemblePolicy([], SHAPE_CATALOG, defaultContext);
      const result = IamPolicyDocumentSchema.safeParse(policy);
      expect(result.success).toBe(true);
    });

    it('any set of valid grants produces a valid IAM policy document', () => {
      fc.assert(
        fc.property(
          fc.array(arbValidGrant, { minLength: 0, maxLength: 5 }),
          (grants) => {
            const policy = assemblePolicy(grants, SHAPE_CATALOG, defaultContext);
            const result = IamPolicyDocumentSchema.safeParse(policy);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 6.2, 6.3, 6.4**
   *
   * Property 4: Policy assembly resolves core-invocation from profile context
   *
   * For any non-empty profileArns array in the PolicyAssemblyContext and any core-invocation
   * grant record, assemblePolicy SHALL produce IAM statements whose Resource field contains
   * exactly the profile ARNs from the context. The resulting Resource SHALL be a string when
   * one profile ARN is provided and an array when multiple are provided. For any empty
   * profileArns array, assemblePolicy SHALL produce a deny-all statement.
   */
  describe('Property 4: Policy assembly resolves core-invocation from profile context', () => {
    /**
     * Generates a valid Bedrock inference profile ARN.
     */
    const arbProfileArn = fc
      .tuple(
        fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
        fc.stringMatching(/^[0-9]{12}$/).filter((s) => s.length === 12),
        fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/).filter((s) => s.length >= 2),
      )
      .map(
        ([region, account, profileName]) =>
          `arn:aws:bedrock:${region}:${account}:inference-profile/${profileName}`,
      );

    /**
     * Generates a core-invocation GrantRecord (no parameters needed).
     */
    const arbCoreInvocationGrant: fc.Arbitrary<GrantRecord> = fc
      .record({
        configName: fc.constantFrom('agent-alpha', 'agent-beta', 'test-agent'),
        grantedAt: fc.constant('2024-01-01T00:00:00Z'),
        grantedBy: fc.constantFrom('system', 'admin', 'operator'),
      })
      .map((partial) => ({
        configName: partial.configName,
        shapeName: 'core-invocation',
        parameters: {},
        grantedAt: partial.grantedAt,
        grantedBy: partial.grantedBy,
      }));

    it('single profileArn produces Resource as a string matching that ARN', () => {
      fc.assert(
        fc.property(arbCoreInvocationGrant, arbProfileArn, (grant, profileArn) => {
          const context: PolicyAssemblyContext = { profileArns: [profileArn] };
          const policy = assemblePolicy([grant], SHAPE_CATALOG, context);

          // Should have exactly one Allow statement (core-invocation template has one statement)
          const allowStatements = policy.Statement.filter((s) => s.Effect === 'Allow');
          expect(allowStatements.length).toBe(1);

          // Resource should be a string (not an array) matching the single profileArn
          const resource = allowStatements[0].Resource;
          expect(typeof resource).toBe('string');
          expect(resource).toBe(profileArn);
        }),
        { numRuns: 200 },
      );
    });

    it('multiple profileArns produce Resource as an array containing exactly those ARNs', () => {
      fc.assert(
        fc.property(
          arbCoreInvocationGrant,
          fc.uniqueArray(arbProfileArn, { minLength: 2, maxLength: 5 }),
          (grant, profileArns) => {
            const context: PolicyAssemblyContext = { profileArns };
            const policy = assemblePolicy([grant], SHAPE_CATALOG, context);

            const allowStatements = policy.Statement.filter((s) => s.Effect === 'Allow');
            expect(allowStatements.length).toBe(1);

            // Resource should be an array matching profileArns exactly
            const resource = allowStatements[0].Resource;
            expect(Array.isArray(resource)).toBe(true);
            expect(resource).toEqual(profileArns);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('non-empty profileArns produce Resource containing exactly the context ARNs', () => {
      fc.assert(
        fc.property(
          arbCoreInvocationGrant,
          fc.uniqueArray(arbProfileArn, { minLength: 1, maxLength: 5 }),
          (grant, profileArns) => {
            const context: PolicyAssemblyContext = { profileArns };
            const policy = assemblePolicy([grant], SHAPE_CATALOG, context);

            const allowStatements = policy.Statement.filter((s) => s.Effect === 'Allow');
            expect(allowStatements.length).toBe(1);

            const resource = allowStatements[0].Resource;

            // Normalize to array for comparison regardless of single/multi
            const resourceArray = Array.isArray(resource) ? resource : [resource];
            expect(resourceArray).toEqual(profileArns);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('empty profileArns produce a deny-all statement', () => {
      fc.assert(
        fc.property(arbCoreInvocationGrant, (grant) => {
          const context: PolicyAssemblyContext = { profileArns: [] };
          const policy = assemblePolicy([grant], SHAPE_CATALOG, context);

          // Should produce exactly one deny-all statement
          expect(policy.Statement).toHaveLength(1);
          expect(policy.Statement[0]).toEqual({
            Effect: 'Deny',
            Action: '*',
            Resource: '*',
          });
        }),
        { numRuns: 200 },
      );
    });
  });
});
