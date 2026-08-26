import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { AgentConfigurationSchema } from './agent-configuration.schema.js';
import { ModelBindingSchema } from './model-binding.schema.js';
import {
  arbModelBinding,
  arbAgentConfiguration,
} from '../test-generators/agent-configuration.arb.js';


const PBT_CONFIG = { numRuns: 200 };

describe('Model Bindings Validation Property Tests', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 8.1, 8.2**
   *
   * Property 1: Valid model bindings are accepted, invalid are rejected
   *
   * For any object with a modelBindings array where every entry has a non-empty modelId,
   * a label matching /^[a-z][a-z0-9-]*$/ (1–30 chars), optional thresholds with a positive
   * integer outputTokensPerHour, and the array length is between 1 and 5 inclusive, the
   * AgentConfigurationSchema SHALL successfully parse and return a valid AgentConfiguration.
   * Conversely, for any entry where modelId is empty, label violates the pattern,
   * thresholds.outputTokensPerHour is not a positive integer, or the array length is 0 or
   * exceeds 5, the schema SHALL reject the input.
   */
  describe('Property 1: Valid model bindings are accepted, invalid are rejected', () => {
    it('valid AgentConfiguration with valid modelBindings is accepted', () => {
      fc.assert(
        fc.property(arbAgentConfiguration, (config) => {
          const result = AgentConfigurationSchema.safeParse(config);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.modelBindings.length).toBeGreaterThanOrEqual(1);
            expect(result.data.modelBindings.length).toBeLessThanOrEqual(5);
            for (const binding of result.data.modelBindings) {
              expect(binding.modelId.length).toBeGreaterThan(0);
              expect(binding.label).toMatch(/^[a-z][a-z0-9-]*$/);
              expect(binding.label.length).toBeLessThanOrEqual(30);
            }
          }
        }),
        PBT_CONFIG,
      );
    });

    it('valid individual ModelBinding is accepted', () => {
      fc.assert(
        fc.property(arbModelBinding, (binding) => {
          const result = ModelBindingSchema.safeParse(binding);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.modelId.length).toBeGreaterThan(0);
            expect(result.data.label).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(result.data.label.length).toBeLessThanOrEqual(30);
            if (result.data.thresholds) {
              expect(Number.isInteger(result.data.thresholds.outputTokensPerHour)).toBe(true);
              expect(result.data.thresholds.outputTokensPerHour).toBeGreaterThan(0);
            }
          }
        }),
        PBT_CONFIG,
      );
    });

    it('empty modelBindings array is rejected', () => {
      fc.assert(
        fc.property(arbAgentConfiguration, (config) => {
          const input = { ...config, modelBindings: [] };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('modelBindings array with more than 5 entries is rejected', () => {
      // Generate 6–10 bindings with deterministically unique labels
      const arbCount = fc.integer({ min: 6, max: 10 });

      fc.assert(
        fc.property(arbAgentConfiguration, arbCount, (config, count) => {
          const bindings = Array.from({ length: count }, (_, i) => ({
            modelId: `model-${i}`,
            label: `binding-${String.fromCharCode(97 + i)}`,
          }));
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('empty modelId in a binding is rejected', () => {
      fc.assert(
        fc.property(arbAgentConfiguration, (config) => {
          // Replace the first binding's modelId with an empty string
          const bindings = config.modelBindings.map((b, i) =>
            i === 0 ? { ...b, modelId: '' } : b,
          );
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('label starting with a digit is rejected', () => {
      const arbDigitStartLabel = fc
        .tuple(
          fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
          fc.stringMatching(/^[a-z0-9-]*$/).filter((s) => s.length <= 29),
        )
        .map(([digit, rest]) => digit + rest)
        .filter((s) => s.length >= 1 && s.length <= 30);

      fc.assert(
        fc.property(arbAgentConfiguration, arbDigitStartLabel, (config, badLabel) => {
          const bindings = [{ modelId: 'some-model', label: badLabel }];
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('label with uppercase letters is rejected', () => {
      const arbUppercaseLabel = fc
        .tuple(
          fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
          fc.constantFrom('A', 'B', 'C', 'Z', 'M'),
          fc.stringMatching(/^[a-z0-9-]{0,10}$/),
        )
        .map(([pre, upper, post]) => pre + upper + post)
        .filter((s) => s.length >= 1 && s.length <= 30);

      fc.assert(
        fc.property(arbAgentConfiguration, arbUppercaseLabel, (config, badLabel) => {
          const bindings = [{ modelId: 'some-model', label: badLabel }];
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('label longer than 30 characters is rejected', () => {
      // Build labels that are valid in pattern but exceed 30 chars
      const arbTooLongLabel = fc
        .integer({ min: 31, max: 50 })
        .map((len) => 'a' + 'b'.repeat(len - 1));

      fc.assert(
        fc.property(arbAgentConfiguration, arbTooLongLabel, (config, badLabel) => {
          const bindings = [{ modelId: 'some-model', label: badLabel }];
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('non-positive outputTokensPerHour is rejected', () => {
      const arbNonPositiveThreshold = fc.oneof(
        fc.constant(0),
        fc.integer({ min: -1_000_000, max: -1 }),
      );

      fc.assert(
        fc.property(arbAgentConfiguration, arbNonPositiveThreshold, (config, badThreshold) => {
          const bindings = [
            { modelId: 'some-model', label: 'primary', thresholds: { outputTokensPerHour: badThreshold } },
          ];
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });

    it('non-integer outputTokensPerHour is rejected', () => {
      const arbNonIntegerThreshold = fc
        .double({ min: 0.01, max: 1_000_000, noNaN: true })
        .filter((n) => !Number.isInteger(n));

      fc.assert(
        fc.property(arbAgentConfiguration, arbNonIntegerThreshold, (config, badThreshold) => {
          const bindings = [
            { modelId: 'some-model', label: 'primary', thresholds: { outputTokensPerHour: badThreshold } },
          ];
          const input = { ...config, modelBindings: bindings };
          const result = AgentConfigurationSchema.safeParse(input);
          expect(result.success).toBe(false);
        }),
        PBT_CONFIG,
      );
    });
  });
});
