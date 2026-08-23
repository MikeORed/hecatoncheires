import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  SHAPE_CATALOG,
  ValidationError,
  ShapeNotFoundError,
  InvalidShapeParametersError,
} from '@hecaton/core';
import type { GrantRecord } from '@hecaton/core';

import { grantShape } from './grant-shape.js';
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

// Arbitrary for a grant with an invalid shape name (not in catalog)
const arbInvalidShapeGrant: fc.Arbitrary<GrantRecord> = fc
  .tuple(
    fc
      .tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
          minLength: 0,
          maxLength: 15,
        }),
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      )
      .map(([f, m, l]) => `${f}${m}${l}`),
    fc.string({ minLength: 1, maxLength: 40 }).filter(
      (s) => !SHAPE_CATALOG.some((t) => t.shapeName === s),
    ),
    fc
      .date({ min: new Date('2024-01-01'), max: new Date('2030-12-31') })
      .map((d) => d.toISOString()),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.hexaString({ minLength: 8, maxLength: 8 }).map(
      (p1) => `${p1}-0000-7000-8000-000000000000`,
    ),
  )
  .map(([configName, shapeName, grantedAt, grantedBy, grantId]) => ({
    grantId,
    configName,
    shapeName,
    parameters: {},
    grantedAt,
    grantedBy,
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 6: Invalid grant rejection without ledger write', () => {
    it('for any GrantRecord failing validateGrant, use-case returns error and putGrant is never called', async () => {
      await fc.assert(
        fc.asyncProperty(arbInvalidShapeGrant, async (grant) => {
          const deps = createMockDeps();
          await expect(grantShape(grant, deps)).rejects.toThrow(ShapeNotFoundError);
          expect(deps.grantLedger.putGrant).not.toHaveBeenCalled();
        }),
        { numRuns: 50 },
      );
    });

    it('rejects grant with missing required parameters without ledger write', async () => {
      const grant: GrantRecord = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: {}, // missing inferenceProfileArn
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };
      const deps = createMockDeps();
      await expect(grantShape(grant, deps)).rejects.toThrow(InvalidShapeParametersError);
      expect(deps.grantLedger.putGrant).not.toHaveBeenCalled();
    });

    it('rejects grant with expiresAt <= grantedAt without ledger write', async () => {
      const grant: GrantRecord = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
        expiresAt: '2026-07-19T12:00:00.000Z', // before grantedAt
      };
      const deps = createMockDeps();
      await expect(grantShape(grant, deps)).rejects.toThrow(ValidationError);
      expect(deps.grantLedger.putGrant).not.toHaveBeenCalled();
    });
  });

  describe('Property 7: Best-effort emission independence (grant-shape)', () => {
    it('if emit throws, grant-shape use-case still completes successfully', async () => {
      const grant: GrantRecord = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };
      const deps = createMockDeps({
        grantLedger: {
          putGrant: vi.fn().mockResolvedValue(undefined),
          deleteGrant: vi.fn().mockResolvedValue(undefined),
          queryGrantsByConfig: vi.fn().mockResolvedValue([grant]),
          scanAllConfigs: vi.fn().mockResolvedValue([]),
        },
        busEmitter: {
          emit: vi.fn().mockRejectedValue(new Error('EventBridge failure')),
        },
      });

      const result = await grantShape(grant, deps);
      expect(result).toEqual(grant);
    });
  });

  describe('grant-shape happy path', () => {
    it('writes grant, assembles policy, writes policy, and returns grant', async () => {
      const grant: GrantRecord = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };
      const deps = createMockDeps({
        grantLedger: {
          putGrant: vi.fn().mockResolvedValue(undefined),
          deleteGrant: vi.fn().mockResolvedValue(undefined),
          queryGrantsByConfig: vi.fn().mockResolvedValue([grant]),
          scanAllConfigs: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await grantShape(grant, deps);
      expect(result).toEqual(grant);
      expect(deps.grantLedger.putGrant).toHaveBeenCalledWith(grant);
      expect(deps.operatingPolicy.writePolicy).toHaveBeenCalled();
      expect(deps.busEmitter.emit).toHaveBeenCalled();
    });
  });
});
