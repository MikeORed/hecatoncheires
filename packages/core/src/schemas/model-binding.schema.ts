import { z } from 'zod';

/**
 * Pattern for model binding labels.
 * Lowercase letters, digits, and hyphens; starts with a letter; max 30 chars.
 */
export const ModelBindingLabelPattern = /^[a-z][a-z0-9-]*$/;

/**
 * Schema for per-profile alarm thresholds.
 * When present on a model binding, these override the agent-level defaults.
 */
export const ModelBindingThresholdsSchema = z.object({
  outputTokensPerHour: z.number().int().positive(),
});

/**
 * Schema for a single model binding within an agent configuration.
 *
 * Each binding associates a Bedrock model ID with a human-readable label
 * and optional per-profile alarm thresholds.
 */
export const ModelBindingSchema = z.object({
  modelId: z.string().min(1),
  label: z
    .string()
    .min(1)
    .max(30)
    .regex(
      ModelBindingLabelPattern,
      'label must start with a lowercase letter and contain only lowercase letters, digits, and hyphens',
    ),
  thresholds: ModelBindingThresholdsSchema.optional(),
});
