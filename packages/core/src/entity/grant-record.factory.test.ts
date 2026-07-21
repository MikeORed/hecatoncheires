import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createGrantRecord } from './grant-record.factory.js';
import { ValidationError } from '../errors/validation-error.js';

const PBT_CONFIG = { numRuns: 100 };
const UUIDV7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const configNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const parametersArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  fc.string({ minLength: 1, maxLength: 20 }),
);

const isoDateTimeArb = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  })
  .map((d) => d.toISOString());

const validInputArb = fc.record({
  grantId: fc.constant(undefined),
  configName: configNameArb,
  shapeName: nonEmptyStringArb,
  parameters: parametersArb,
  grantedAt: isoDateTimeArb,
  grantedBy: nonEmptyStringArb,
});

const validInputWithGrantIdArb = fc.record({
  grantId: fc.constant('018f6b2e-7c3a-7000-8000-000000000001'),
  configName: configNameArb,
  shapeName: nonEmptyStringArb,
  parameters: parametersArb,
  grantedAt: isoDateTimeArb,
  grantedBy: nonEmptyStringArb,
});

describe('GrantRecord Factory - Property Tests', () => {
  /**
   * Property 1: Factory produces frozen, equivalent output for valid input
   * **Validates: Requirements 4.8, 4.9**
   *
   * For any valid input, the factory returns a frozen object whose fields
   * match the input values (with grantId auto-generated if not provided).
   */
  it('Property 1: factory produces frozen, equivalent output for valid input', () => {
    fc.assert(
      fc.property(validInputWithGrantIdArb, (input) => {
        const result = createGrantRecord(input);

        expect(Object.isFrozen(result)).toBe(true);
        expect(result.grantId).toBe(input.grantId);
        expect(result.configName).toBe(input.configName);
        expect(result.shapeName).toBe(input.shapeName);
        expect(result.parameters).toEqual(input.parameters);
        expect(result.grantedAt).toBe(input.grantedAt);
        expect(result.grantedBy).toBe(input.grantedBy);
      }),
      PBT_CONFIG,
    );
  });

  /**
   * Property 2: Factory rejects all invalid input with ValidationError
   * **Validates: Requirements 4.8, 4.9**
   *
   * For any invalid input (wrong types, missing fields, pattern violations),
   * the factory throws a ValidationError with non-empty details.
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
      // Invalid configName (starts with digit)
      fc.record({
        configName: fc.stringMatching(/^[0-9][a-z0-9-]*[a-z0-9]$/),
        shapeName: nonEmptyStringArb,
        parameters: parametersArb,
        grantedAt: isoDateTimeArb,
        grantedBy: nonEmptyStringArb,
      }),
      // Empty shapeName
      fc.record({
        configName: configNameArb,
        shapeName: fc.constant(''),
        parameters: parametersArb,
        grantedAt: isoDateTimeArb,
        grantedBy: nonEmptyStringArb,
      }),
      // Invalid grantedAt (not ISO datetime)
      fc.record({
        configName: configNameArb,
        shapeName: nonEmptyStringArb,
        parameters: parametersArb,
        grantedAt: fc.constant('not-a-date'),
        grantedBy: nonEmptyStringArb,
      }),
      // Empty grantedBy
      fc.record({
        configName: configNameArb,
        shapeName: nonEmptyStringArb,
        parameters: parametersArb,
        grantedAt: isoDateTimeArb,
        grantedBy: fc.constant(''),
      }),
    );

    fc.assert(
      fc.property(invalidInputArb, (input) => {
        try {
          createGrantRecord(input);
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

  /**
   * Property 4: Grant Record factory auto-generates a valid UUIDv7 grantId
   * **Validates: Requirements 4.1, 10.1, 10.2**
   *
   * For any valid GrantRecord input WITHOUT grantId, the output has
   * a grantId matching the UUIDv7 regex pattern.
   */
  it('Property 4: factory auto-generates a valid UUIDv7 grantId when omitted', () => {
    const inputWithoutGrantIdArb = fc.record({
      configName: configNameArb,
      shapeName: nonEmptyStringArb,
      parameters: parametersArb,
      grantedAt: isoDateTimeArb,
      grantedBy: nonEmptyStringArb,
    });

    fc.assert(
      fc.property(inputWithoutGrantIdArb, (input) => {
        const result = createGrantRecord(input);
        expect(result.grantId).toBeDefined();
        expect(result.grantId).toMatch(UUIDV7_REGEX);
      }),
      PBT_CONFIG,
    );
  });
});
