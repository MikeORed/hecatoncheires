import fc from 'fast-check';

/**
 * Arbitrary for valid RuntimeTunables conforming to RuntimeTunablesSchema.
 * Thresholds are positive integers; feature flags are booleans.
 */
export const arbRuntimeTunables = fc.record({
  thresholds: fc.record({
    outputTokensPerHour: fc.integer({ min: 1, max: 1_000_000 }),
    guardrailBlocksPer10Min: fc.integer({ min: 1, max: 10_000 }),
    guardrailObservationsPerHour: fc.integer({ min: 1, max: 100_000 }),
  }),
  featureFlags: fc.record({
    pipelineSpeedBreaker: fc.boolean(),
    timeBoxedGrants: fc.boolean(),
  }),
});

/**
 * Arbitrary producing invalid RuntimeTunables (zero or negative thresholds).
 */
export const arbInvalidRuntimeTunables = fc.record({
  thresholds: fc.record({
    outputTokensPerHour: fc.integer({ min: -1000, max: 0 }),
    guardrailBlocksPer10Min: fc.integer({ min: -1000, max: 0 }),
    guardrailObservationsPerHour: fc.integer({ min: -1000, max: 0 }),
  }),
  featureFlags: fc.record({
    pipelineSpeedBreaker: fc.boolean(),
    timeBoxedGrants: fc.boolean(),
  }),
});
