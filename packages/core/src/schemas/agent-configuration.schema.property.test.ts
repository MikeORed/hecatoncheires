// Feature: multi-profile-identity, Property 2: Duplicate labels are rejected
// **Validates: Requirements 1.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AgentConfigurationSchema } from './agent-configuration.schema.js';
import {
  arbModelBinding,
  arbModelBindingLabel,
  arbConfigName,
} from '../test-generators/agent-configuration.arb.js';

describe('AgentConfigurationSchema — Property Tests', () => {
  /**
   * Property 2: Duplicate labels are rejected
   *
   * For any modelBindings array containing two or more entries with the same
   * label value, the AgentConfigurationSchema SHALL reject the input with a
   * validation error referencing the duplicate label.
   *
   * **Validates: Requirements 1.5**
   */
  describe('Property 2: Duplicate labels are rejected', () => {
    it('rejects any modelBindings array with two or more entries sharing the same label', () => {
      fc.assert(
        fc.property(
          arbConfigName,
          arbModelBindingLabel,
          arbModelBinding,
          arbModelBinding,
          fc.constantFrom(
            'agentcore-managed' as const,
            'openclaw' as const,
            'agentcore-runtime' as const,
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (configName, duplicateLabel, bindingA, bindingB, agentType, guardrailId, owner) => {
            // Force both bindings to share the same label
            const binding1 = { ...bindingA, label: duplicateLabel };
            const binding2 = { ...bindingB, label: duplicateLabel };

            const input = {
              configName,
              agentType,
              modelBindings: [binding1, binding2],
              guardrailId,
              owner,
            };

            const result = AgentConfigurationSchema.safeParse(input);
            expect(result.success).toBe(false);

            if (!result.success) {
              const errorMessages = result.error.issues.map((issue) => issue.message);
              const hasDuplicateError = errorMessages.some((msg) =>
                msg.includes(duplicateLabel),
              );
              expect(hasDuplicateError).toBe(true);
            }
          },
        ),
      );
    });

    it('rejects when duplicate labels appear among otherwise-unique entries', () => {
      fc.assert(
        fc.property(
          arbConfigName,
          arbModelBindingLabel,
          // Generate 1–3 additional bindings with unique labels
          fc.array(arbModelBinding, { minLength: 1, maxLength: 3 }),
          arbModelBinding,
          fc.constantFrom(
            'agentcore-managed' as const,
            'openclaw' as const,
            'agentcore-runtime' as const,
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (configName, duplicateLabel, otherBindings, extraBinding, agentType, guardrailId, owner) => {
            // Ensure the duplicate label doesn't collide with "other" bindings
            const usedLabels = new Set(otherBindings.map((b) => b.label));
            fc.pre(!usedLabels.has(duplicateLabel));

            // Create two bindings with the same label
            const dup1 = { ...extraBinding, label: duplicateLabel };
            const dup2 = { ...extraBinding, label: duplicateLabel, modelId: 'another-model' };

            // Total must be <= 5 bindings
            const modelBindings = [...otherBindings, dup1, dup2];
            fc.pre(modelBindings.length <= 5);

            const input = {
              configName,
              agentType,
              modelBindings,
              guardrailId,
              owner,
            };

            const result = AgentConfigurationSchema.safeParse(input);
            expect(result.success).toBe(false);

            if (!result.success) {
              const errorMessages = result.error.issues.map((issue) => issue.message);
              const hasDuplicateError = errorMessages.some((msg) =>
                msg.includes(duplicateLabel),
              );
              expect(hasDuplicateError).toBe(true);
            }
          },
        ),
      );
    });
  });
});
