import { describe, it, expect } from 'vitest';
import { RuntimeTunablesSchema } from './runtime-tunables.schema.js';

describe('RuntimeTunablesSchema', () => {
  const validInput = {
    thresholds: {
      outputTokensPerHour: 1000,
      guardrailBlocksPer10Min: 5,
      guardrailObservationsPerHour: 50,
    },
    featureFlags: {
      pipelineSpeedBreaker: true,
      timeBoxedGrants: false,
    },
  };

  it('accepts valid runtime tunables', () => {
    const result = RuntimeTunablesSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validInput);
    }
  });

  describe('thresholds', () => {
    it('rejects zero for outputTokensPerHour', () => {
      const input = {
        ...validInput,
        thresholds: { ...validInput.thresholds, outputTokensPerHour: 0 },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects negative values for guardrailBlocksPer10Min', () => {
      const input = {
        ...validInput,
        thresholds: { ...validInput.thresholds, guardrailBlocksPer10Min: -1 },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer for guardrailObservationsPerHour', () => {
      const input = {
        ...validInput,
        thresholds: {
          ...validInput.thresholds,
          guardrailObservationsPerHour: 3.5,
        },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-number types for thresholds', () => {
      const input = {
        ...validInput,
        thresholds: {
          ...validInput.thresholds,
          outputTokensPerHour: '100',
        },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('featureFlags', () => {
    it('rejects non-boolean for pipelineSpeedBreaker', () => {
      const input = {
        ...validInput,
        featureFlags: { ...validInput.featureFlags, pipelineSpeedBreaker: 1 },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean for timeBoxedGrants', () => {
      const input = {
        ...validInput,
        featureFlags: {
          ...validInput.featureFlags,
          timeBoxedGrants: 'true',
        },
      };
      const result = RuntimeTunablesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  it('rejects missing thresholds object', () => {
    const input = { featureFlags: validInput.featureFlags };
    const result = RuntimeTunablesSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects missing featureFlags object', () => {
    const input = { thresholds: validInput.thresholds };
    const result = RuntimeTunablesSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
