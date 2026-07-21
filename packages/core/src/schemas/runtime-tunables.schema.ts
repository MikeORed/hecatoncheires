import { z } from 'zod';

/**
 * Schema for runtime tunables — threshold values and feature flags that
 * control platform behavior at runtime without redeployment.
 *
 * Thresholds must be positive integers. Feature flags are booleans.
 */
export const RuntimeTunablesSchema = z.object({
  thresholds: z.object({
    outputTokensPerHour: z.number().int().positive(),
    guardrailBlocksPer10Min: z.number().int().positive(),
    guardrailObservationsPerHour: z.number().int().positive(),
  }),
  featureFlags: z.object({
    pipelineSpeedBreaker: z.boolean(),
    timeBoxedGrants: z.boolean(),
  }),
});
