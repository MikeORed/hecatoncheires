import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createAgentConfiguration } from './agent-configuration.factory.js';
import { ValidationError } from '../errors/validation-error.js';
import {
  arbConfigName,
  arbModelBindings,
} from '../test-generators/agent-configuration.arb.js';

const PBT_CONFIG = { numRuns: 100 };

const agentTypeArb = fc.constantFrom(
  'agentcore-managed',
  'openclaw',
  'agentcore-runtime',
);

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const validInputArb = fc.record({
  configName: arbConfigName,
  agentType: agentTypeArb,
  modelBindings: arbModelBindings,
  guardrailId: nonEmptyStringArb,
  guardrailVersion: nonEmptyStringArb,
  owner: nonEmptyStringArb,
});

describe('AgentConfiguration Factory - Property Tests', () => {
  /**
   * Property 1: Factory produces frozen, equivalent output for valid input
   * **Validates: Requirements 1.7, 1.8**
   *
   * For any valid input, the factory returns a frozen object whose fields
   * match the input values (with defaults applied where appropriate).
   */
  it('Property 1: factory produces frozen, equivalent output for valid input', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = createAgentConfiguration(input);

        expect(Object.isFrozen(result)).toBe(true);
        expect(result.configName).toBe(input.configName);
        expect(result.agentType).toBe(input.agentType);
        expect(result.modelBindings).toHaveLength(input.modelBindings.length);
        for (let i = 0; i < input.modelBindings.length; i++) {
          expect(result.modelBindings[i].modelId).toBe(input.modelBindings[i].modelId);
          expect(result.modelBindings[i].label).toBe(input.modelBindings[i].label);
        }
        expect(result.guardrailId).toBe(input.guardrailId);
        expect(result.guardrailVersion).toBe(input.guardrailVersion);
        expect(result.owner).toBe(input.owner);
      }),
      PBT_CONFIG,
    );
  });

  /**
   * Property 2: Factory rejects all invalid input with ValidationError
   * **Validates: Requirements 1.7, 1.8**
   *
   * For any invalid input (wrong types, missing fields, pattern violations),
   * the factory throws a ValidationError with a non-empty details record.
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
      // configName starting with a digit
      fc.record({
        configName: fc.stringMatching(/^[0-9][a-z0-9-]*[a-z0-9]$/),
        agentType: agentTypeArb,
        modelBindings: arbModelBindings,
        guardrailId: nonEmptyStringArb,
        guardrailVersion: nonEmptyStringArb,
        owner: nonEmptyStringArb,
      }),
      // configName with uppercase
      fc.record({
        configName: fc.stringMatching(/^[a-z][A-Z][a-z0-9]$/),
        agentType: agentTypeArb,
        modelBindings: arbModelBindings,
        guardrailId: nonEmptyStringArb,
        guardrailVersion: nonEmptyStringArb,
        owner: nonEmptyStringArb,
      }),
      // Wrong type for configName
      fc.record({
        configName: fc.integer(),
        agentType: agentTypeArb,
        modelBindings: arbModelBindings,
        guardrailId: nonEmptyStringArb,
        guardrailVersion: nonEmptyStringArb,
        owner: nonEmptyStringArb,
      }),
      // Invalid agentType
      fc.record({
        configName: arbConfigName,
        agentType: fc.constant('invalid-type'),
        modelBindings: arbModelBindings,
        guardrailId: nonEmptyStringArb,
        guardrailVersion: nonEmptyStringArb,
        owner: nonEmptyStringArb,
      }),
      // Empty modelBindings array
      fc.record({
        configName: arbConfigName,
        agentType: agentTypeArb,
        modelBindings: fc.constant([]),
        guardrailId: nonEmptyStringArb,
        guardrailVersion: nonEmptyStringArb,
        owner: nonEmptyStringArb,
      }),
    );

    fc.assert(
      fc.property(invalidInputArb, (input) => {
        try {
          createAgentConfiguration(input);
          // Should not reach here
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
   * Property 3: GuardrailVersion defaults to DRAFT when omitted
   * **Validates: Requirements 1.5**
   *
   * For any valid AgentConfiguration input WITHOUT guardrailVersion,
   * the output has guardrailVersion === 'DRAFT'.
   */
  it('Property 3: guardrailVersion defaults to DRAFT when omitted', () => {
    const inputWithoutGuardrailVersionArb = fc.record({
      configName: arbConfigName,
      agentType: agentTypeArb,
      modelBindings: arbModelBindings,
      guardrailId: nonEmptyStringArb,
      owner: nonEmptyStringArb,
    });

    fc.assert(
      fc.property(inputWithoutGuardrailVersionArb, (input) => {
        const result = createAgentConfiguration(input);
        expect(result.guardrailVersion).toBe('DRAFT');
      }),
      PBT_CONFIG,
    );
  });
});
