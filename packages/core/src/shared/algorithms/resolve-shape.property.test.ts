// Feature: core-foundation, Property 5: Shape resolution substitutes all placeholders
// Feature: core-foundation, Property 6: Shape resolution rejects incomplete parameter sets

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveShape } from './resolve-shape.js';
import { InvalidShapeParametersError } from '../../errors/index.js';
import type { ShapeTemplate } from '../../types/index.js';

/**
 * Generates a valid parameter name (alphanumeric, no special chars, non-empty).
 */
const arbParamName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/)
  .filter((s) => s.length >= 2 && s.length <= 20);

/**
 * Generates a non-empty set of unique parameter names (at least 1).
 */
const arbParamNames = fc
  .uniqueArray(arbParamName, { minLength: 1, maxLength: 5 })
  .filter((arr) => arr.length >= 1);

/**
 * Generates a non-empty parameter value (no `${` sequences to avoid false negatives).
 */
const arbParamValue = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !s.includes('${') && s.trim().length > 0);

/**
 * Generates a Resource string containing placeholders for the given parameter names.
 * Each param appears at least once as `${paramName}` embedded in a surrounding string.
 */
function arbResourceWithPlaceholders(paramNames: string[]): fc.Arbitrary<string> {
  return fc.tuple(fc.string({ minLength: 0, maxLength: 10 })).map(([prefix]) => {
    const parts = paramNames.map((p) => `\${${p}}`);
    return `arn:${prefix}:${parts.join('/')}`;
  });
}

/**
 * Generates a ShapeTemplate with random requiredParameters and statements
 * containing `${param}` placeholders in Resource fields.
 */
function arbShapeTemplate(): fc.Arbitrary<ShapeTemplate> {
  return arbParamNames.chain((paramNames) => {
    const arbResource: fc.Arbitrary<string | string[]> = fc.oneof(
      arbResourceWithPlaceholders(paramNames),
      fc.tuple(
        arbResourceWithPlaceholders(paramNames),
        arbResourceWithPlaceholders(paramNames),
      ).map(([a, b]) => [a, b]),
    );

    const arbStatement = fc.record({
      Effect: fc.constantFrom('Allow' as const, 'Deny' as const),
      Action: fc.oneof(
        fc.constant('s3:GetObject'),
        fc.constant(['s3:GetObject', 's3:PutObject']),
      ),
      Resource: arbResource,
    });

    return fc
      .record({
        shapeName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        riskTier: fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const),
        statements: fc.array(arbStatement, { minLength: 1, maxLength: 4 }),
      })
      .map((t) => ({
        ...t,
        requiredParameters: paramNames,
      }));
  });
}

/**
 * Generates a complete parameters record that supplies ALL required parameters
 * with non-empty string values (no `${` sequences).
 */
function arbCompleteParams(template: ShapeTemplate): fc.Arbitrary<Record<string, string>> {
  if (template.requiredParameters.length === 0) {
    return fc.constant({});
  }

  return fc
    .tuple(...template.requiredParameters.map(() => arbParamValue))
    .map((values) => {
      const params: Record<string, string> = {};
      template.requiredParameters.forEach((name, idx) => {
        params[name] = values[idx];
      });
      return params;
    });
}

/**
 * Generates a parameters record that is MISSING at least one required parameter.
 * Randomly selects a non-empty subset of parameters to omit.
 */
function arbIncompleteParams(
  template: ShapeTemplate,
): fc.Arbitrary<{ params: Record<string, string>; missing: string[] }> {
  const allParams = template.requiredParameters;

  return fc
    .subarray(allParams, { minLength: 1, maxLength: allParams.length })
    .chain((missingParams) => {
      const presentParams = allParams.filter((p) => !missingParams.includes(p));

      if (presentParams.length === 0) {
        return fc.constant({ params: {} as Record<string, string>, missing: missingParams });
      }

      return fc
        .tuple(...presentParams.map(() => arbParamValue))
        .map((values) => {
          const params: Record<string, string> = {};
          presentParams.forEach((name, idx) => {
            params[name] = values[idx];
          });
          return { params, missing: missingParams };
        });
    });
}

/**
 * Checks whether a string contains any unresolved `${...}` placeholder patterns.
 */
function containsPlaceholder(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

describe('resolveShape property tests', () => {
  // **Validates: Requirements 3.5, 3.6, 3.7**

  describe('Property 5: Shape resolution substitutes all placeholders', () => {
    it('resolved statements contain no ${...} placeholder patterns in Resource fields', () => {
      fc.assert(
        fc.property(arbShapeTemplate(), (template) => {
          return fc.assert(
            fc.property(arbCompleteParams(template), (params) => {
              const result = resolveShape(template, params);

              for (const stmt of result) {
                if (typeof stmt.Resource === 'string') {
                  expect(containsPlaceholder(stmt.Resource)).toBe(false);
                } else {
                  for (const r of stmt.Resource) {
                    expect(containsPlaceholder(r)).toBe(false);
                  }
                }
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: 100 },
      );
    });

    it('each placeholder is replaced by the corresponding parameter value', () => {
      fc.assert(
        fc.property(arbShapeTemplate(), (template) => {
          return fc.assert(
            fc.property(arbCompleteParams(template), (params) => {
              const result = resolveShape(template, params);

              for (const stmt of result) {
                const resources = Array.isArray(stmt.Resource)
                  ? stmt.Resource
                  : [stmt.Resource];

                // For each param that appeared in template resources, its value should appear in output
                for (const templateStmt of template.statements) {
                  const templateResources = Array.isArray(templateStmt.Resource)
                    ? templateStmt.Resource
                    : [templateStmt.Resource];

                  for (const paramName of template.requiredParameters) {
                    const placeholder = `\${${paramName}}`;
                    const appearsInTemplate = templateResources.some((r) =>
                      r.includes(placeholder),
                    );

                    if (appearsInTemplate) {
                      const paramValue = params[paramName];
                      const appearsInResult = resources.some((r) => r.includes(paramValue));
                      expect(appearsInResult).toBe(true);
                    }
                  }
                }
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 6: Shape resolution rejects incomplete parameter sets', () => {
    it('throws InvalidShapeParametersError for incomplete parameters', () => {
      fc.assert(
        fc.property(arbShapeTemplate(), (template) => {
          return fc.assert(
            fc.property(arbIncompleteParams(template), ({ params }) => {
              expect(() => resolveShape(template, params)).toThrow(
                InvalidShapeParametersError,
              );
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: 100 },
      );
    });

    it('error details list exactly the missing parameter names', () => {
      fc.assert(
        fc.property(arbShapeTemplate(), (template) => {
          return fc.assert(
            fc.property(arbIncompleteParams(template), ({ params, missing }) => {
              try {
                resolveShape(template, params);
                expect.fail('Should have thrown InvalidShapeParametersError');
              } catch (err) {
                expect(err).toBeInstanceOf(InvalidShapeParametersError);
                const error = err as InstanceType<typeof InvalidShapeParametersError>;
                const reportedMissing = error.details?.missingParameters as string[];
                expect(reportedMissing.sort()).toEqual([...missing].sort());
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: 100 },
      );
    });
  });
});
