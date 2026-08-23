import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { GrantRecord } from '@hecaton/core';

import { queryFleetState } from './query-fleet-state.js';
import type { Dependencies } from '../shared/dependencies.js';

function createMockDeps(overrides?: Partial<Dependencies>): Dependencies {
  return {
    grantLedger: {
      putGrant: vi.fn().mockResolvedValue(undefined),
      deleteGrant: vi.fn().mockResolvedValue(undefined),
      queryGrantsByConfig: vi.fn().mockResolvedValue([]),
      scanAllConfigs: vi.fn().mockResolvedValue([]),
    },
    operatingPolicy: {
      writePolicy: vi.fn().mockResolvedValue(undefined),
      deletePolicy: vi.fn().mockResolvedValue(undefined),
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

const arbConfigName = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
      minLength: 0,
      maxLength: 10,
    }),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([f, m, l]) => `${f}${m}${l}`);

const arbIsoDatetime = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString());

const arbGrantRecord: fc.Arbitrary<GrantRecord> = fc
  .tuple(
    arbConfigName,
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      { minKeys: 0, maxKeys: 3 },
    ),
    arbIsoDatetime,
    fc.string({ minLength: 1, maxLength: 40 }),
  )
  .map(([configName, shapeName, parameters, grantedAt, grantedBy]) => ({
    grantId: `00000000-0000-7000-8000-${Math.random().toString(16).slice(2, 14)}`,
    configName,
    shapeName,
    parameters,
    grantedAt,
    grantedBy,
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 8: Fleet-state grouping correctness', () => {
    it('result keys match all configNames, values contain exactly their grants, union equals input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbGrantRecord, { minLength: 0, maxLength: 20 }),
          async (grants) => {
            const deps = createMockDeps({
              grantLedger: {
                putGrant: vi.fn().mockResolvedValue(undefined),
                deleteGrant: vi.fn().mockResolvedValue(undefined),
                queryGrantsByConfig: vi.fn().mockResolvedValue([]),
                scanAllConfigs: vi.fn().mockResolvedValue(grants),
              },
            });

            const result = await queryFleetState(deps);

            // Keys match all unique configNames from input
            const expectedKeys = [...new Set(grants.map((g) => g.configName))];
            expect(Object.keys(result).sort()).toEqual(expectedKeys.sort());

            // Each value contains exactly grants for that configName
            for (const key of expectedKeys) {
              const expected = grants.filter((g) => g.configName === key);
              expect(result[key]).toEqual(expected);
            }

            // Union of all values equals input
            const allValues = Object.values(result).flat();
            expect(allValues).toHaveLength(grants.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('query-fleet-state edge cases', () => {
    it('returns empty record when ledger is empty', async () => {
      const deps = createMockDeps();
      const result = await queryFleetState(deps);
      expect(result).toEqual({});
    });
  });
});
