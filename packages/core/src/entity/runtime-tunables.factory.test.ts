import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRuntimeTunables } from './runtime-tunables.factory.js';
import { ValidationError } from '../errors/validation-error.js';

const PBT_CONFIG = { numRuns: 100 };

const positiveIntArb = fc.integer({ min: 1, max: 10000 });

const validInputArb = fc.record({
  thresholds: fc.record({
    outputTokensPerHour: positiveIntArb,
    guardrailBlocksPer10Min: positiveIntArb,
    guardrailObservationsPerHour: positiveIntArb,
  }),
  featureFlags: fc.record({
    pipelineSpeedBreaker: fc.boolean(),
    timeBoxedGrants: fc.boolean(),
  }),
});

describe('RuntimeTunables Factory - Property Tests', () => {
  /**
   * Property 1: Factory produces frozen, equivalent output for valid input
   * **Validates: Requirements 2.6, 2.7**
   *
   * For any valid input, the factory returns a frozen object whose fields
   * match the input values.
   */
  it('Property 1: factory produces frozen, equivalent output for valid input', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = createRuntimeTunables(input);

        expect(Object.isFrozen(result)).toBe(true);
        expect(result.thresholds.outputTokensPerHour).toBe(
          input.thresholds.outputTokensPerHour,
        );
        expect(result.thresholds.guardrailBlocksPer10Min).toBe(
          input.thresholds.guardrailBlocksPer10Min,
        );
        expect(result.thresholds.guardrailObservationsPerHour).toBe(
          input.thresholds.guardrailObservationsPerHour,
        );
        expect(result.featureFlags.pipelineSpeedBreaker).toBe(
          input.featureFlags.pipelineSpeedBreaker,
        );
        expect(result.featureFlags.timeBoxedGrants).toBe(
          input.featureFlags.timeBoxedGrants,
        );
      }),
      PBT_CONFIG,
    );
  });

  /**
   * Property 2: Factory rejects all invalid input with ValidationError
   * **Validates: Requirements 2.6, 2.7**
   *
   * For any invalid input (wrong types, missing fields, negative numbers,
   * non-integers), the factory throws a ValidationError with non-empty details.
   */
  it('Property 2: factory rejects all invalid input with ValidationError', () => {
    const invalidInputArb = fc.oneof(
      // Empty object
      fc.constant({}),
      // Null/undefined/primitives
      fc.constant(null),
      fc.constant(undefined),
      fc.string(),
      fc.integer(),
      // Negative threshold values
      fc.record({
        thresholds: fc.record({
          outputTokensPerHour: fc.integer({ min: -10000, max: 0 }),
          guardrailBlocksPer10Min: positiveIntArb,
          guardrailObservationsPerHour: positiveIntArb,
        }),
        featureFlags: fc.record({
          pipelineSpeedBreaker: fc.boolean(),
          timeBoxedGrants: fc.boolean(),
        }),
      }),
      // Non-integer threshold values
      fc.record({
        thresholds: fc.record({
          outputTokensPerHour: fc.double({ min: 0.1, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
          guardrailBlocksPer10Min: positiveIntArb,
          guardrailObservationsPerHour: positiveIntArb,
        }),
        featureFlags: fc.record({
          pipelineSpeedBreaker: fc.boolean(),
          timeBoxedGrants: fc.boolean(),
        }),
      }),
      // Missing nested fields (only thresholds, no featureFlags)
      fc.record({
        thresholds: fc.record({
          outputTokensPerHour: positiveIntArb,
          guardrailBlocksPer10Min: positiveIntArb,
          guardrailObservationsPerHour: positiveIntArb,
        }),
      }),
      // Wrong type for flags (number instead of boolean)
      fc.record({
        thresholds: fc.record({
          outputTokensPerHour: positiveIntArb,
          guardrailBlocksPer10Min: positiveIntArb,
          guardrailObservationsPerHour: positiveIntArb,
        }),
        featureFlags: fc.record({
          pipelineSpeedBreaker: fc.integer(),
          timeBoxedGrants: fc.boolean(),
        }),
      }),
    );

    fc.assert(
      fc.property(invalidInputArb, (input) => {
        try {
          createRuntimeTunables(input);
          expect.fail('Expected ValidationError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          expect((err as ValidationError).details).toBeDefined();
          expect(
            Object.keys((err as ValidationError).details!).length,
          ).toBeGreaterThan(0);
        }
      }),
      PBT_CONFIG,
    );
  });
});
