import { z } from 'zod';

import { ModelBindingSchema } from './model-binding.schema.js';

/**
 * Regex pattern for valid configName values.
 *
 * Rules:
 *   - Starts with a lowercase letter
 *   - Contains only lowercase letters, digits, and hyphens
 *   - Ends with a lowercase letter or digit
 *   - Minimum 2 characters (implied by start + end constraints)
 *
 * Exported for reuse in GrantRecordSchema.
 */
export const ConfigNamePattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;

const MAX_MODEL_BINDINGS = 5;

/**
 * Schema for the Agent Configuration domain object.
 *
 * Validates all fields required to define an agent's identity, model bindings,
 * guardrail binding, and ownership within the Hecatoncheires platform.
 */
export const AgentConfigurationSchema = z
  .object({
    configName: z
      .string()
      .min(1)
      .max(40)
      .regex(
        ConfigNamePattern,
        'configName must start with a lowercase letter, end with a lowercase letter or digit, and contain only lowercase letters, digits, and hyphens',
      ),
    agentType: z.enum(['agentcore-managed', 'openclaw', 'agentcore-runtime']),
    modelBindings: z
      .array(ModelBindingSchema)
      .min(1, 'At least one model binding is required')
      .max(MAX_MODEL_BINDINGS, `Maximum ${MAX_MODEL_BINDINGS} model bindings allowed`),
    guardrailId: z.string().min(1),
    guardrailVersion: z.string().min(1).default('DRAFT'),
    owner: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const labels = data.modelBindings.map((b) => b.label);
    const seen = new Set<string>();
    for (let i = 0; i < labels.length; i++) {
      if (seen.has(labels[i])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelBindings', i, 'label'],
          message: `Duplicate label "${labels[i]}" in modelBindings`,
        });
      }
      seen.add(labels[i]);
    }
  });
