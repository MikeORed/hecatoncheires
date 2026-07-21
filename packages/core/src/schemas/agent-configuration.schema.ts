import { z } from 'zod';

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

/**
 * Schema for the Agent Configuration domain object.
 *
 * Validates all fields required to define an agent's identity, model binding,
 * guardrail binding, and ownership within the Hecatoncheires platform.
 */
export const AgentConfigurationSchema = z.object({
  configName: z
    .string()
    .min(1)
    .max(40)
    .regex(
      ConfigNamePattern,
      'configName must start with a lowercase letter, end with a lowercase letter or digit, and contain only lowercase letters, digits, and hyphens',
    ),
  agentType: z.enum(['agentcore-managed', 'openclaw', 'agentcore-runtime']),
  modelId: z.string().min(1),
  guardrailId: z.string().min(1),
  guardrailVersion: z.string().min(1).default('DRAFT'),
  owner: z.string().min(1),
});
