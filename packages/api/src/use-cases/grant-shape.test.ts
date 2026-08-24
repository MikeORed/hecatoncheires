import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  SHAPE_CATALOG,
  ValidationError,
  ShapeNotFoundError,
  InvalidShapeParametersError,
  PolicySizeExceededError,
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
    agentRegistry: {
      getByAgentId: vi.fn().mockResolvedValue(null),
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
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
          await expect(grantShape(grant, 'test-role', deps)).rejects.toThrow(ShapeNotFoundError);
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
      await expect(grantShape(grant, 'test-role', deps)).rejects.toThrow(InvalidShapeParametersError);
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
      await expect(grantShape(grant, 'test-role', deps)).rejects.toThrow(ValidationError);
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

      const result = await grantShape(grant, 'test-role', deps);
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

      const result = await grantShape(grant, 'test-role', deps);
      expect(result).toEqual(grant);
      expect(deps.grantLedger.putGrant).toHaveBeenCalledWith(grant);
      expect(deps.operatingPolicy.writePolicy).toHaveBeenCalled();
      expect(deps.busEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('Policy size rollback (Requirement 2.7)', () => {
    it('deletes the newly written grant and throws PolicySizeExceededError when assembled policy exceeds 10,240 bytes', async () => {
      // Create a grant with long ARN values that, when accumulated, exceed 10KB
      const longArn = 'arn:aws:s3:::' + 'a'.repeat(200);
      const longPrefix = 'x'.repeat(200) + '/';

      // The new grant being added
      const newGrant: GrantRecord = {
        grantId: '01912345-aaaa-7abc-8def-000000000001',
        configName: 'test-agent',
        shapeName: 's3-prefix-read',
        parameters: { bucketArn: longArn, prefix: longPrefix },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };

      // Generate enough existing grants to push the assembled policy over 10,240 bytes
      // Each s3-prefix-read grant produces ~400+ bytes of policy statements with long ARNs
      const existingGrants: GrantRecord[] = Array.from({ length: 30 }, (_, i) => ({
        grantId: `01912345-bbbb-7abc-8def-${String(i).padStart(12, '0')}`,
        configName: 'test-agent',
        shapeName: 's3-prefix-read',
        parameters: {
          bucketArn: `arn:aws:s3:::bucket-${'z'.repeat(200)}-${i}`,
          prefix: `prefix-${'y'.repeat(200)}-${i}/`,
        },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      }));

      const allGrants = [...existingGrants, newGrant];

      const deps = createMockDeps({
        grantLedger: {
          putGrant: vi.fn().mockResolvedValue(undefined),
          deleteGrant: vi.fn().mockResolvedValue(undefined),
          queryGrantsByConfig: vi.fn().mockResolvedValue(allGrants),
          scanAllConfigs: vi.fn().mockResolvedValue([]),
        },
      });

      await expect(grantShape(newGrant, 'test-role', deps)).rejects.toThrow(PolicySizeExceededError);

      // Grant was initially written to ledger
      expect(deps.grantLedger.putGrant).toHaveBeenCalledWith(newGrant);
      // Grant was rolled back (deleted) after policy size exceeded
      expect(deps.grantLedger.deleteGrant).toHaveBeenCalledWith(
        newGrant.configName,
        newGrant.grantId,
      );
      // Policy was never written to IAM
      expect(deps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      // Event was never emitted
      expect(deps.busEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not roll back the grant when assembled policy is within size limit', async () => {
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

      const result = await grantShape(grant, 'test-role', deps);
      expect(result).toEqual(grant);
      expect(deps.grantLedger.deleteGrant).not.toHaveBeenCalled();
    });
  });

  describe('Unknown shapeName abort (Requirement 2.9)', () => {
    it('aborts the operation when a grant in the ledger references an unknown shapeName during policy assembly', async () => {
      // The incoming grant is valid (core-invocation)
      const validGrant: GrantRecord = {
        grantId: '01912345-6789-7abc-8def-0123456789ab',
        configName: 'test-agent',
        shapeName: 'core-invocation',
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
        grantedAt: '2026-07-20T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };

      // An existing grant in the ledger has an unknown shapeName
      const corruptGrant: GrantRecord = {
        grantId: '01912345-cccc-7abc-8def-000000000099',
        configName: 'test-agent',
        shapeName: 'nonexistent-shape-xyz',
        parameters: {},
        grantedAt: '2026-07-19T12:00:00.000Z',
        grantedBy: 'admin@company.com',
      };

      const deps = createMockDeps({
        grantLedger: {
          putGrant: vi.fn().mockResolvedValue(undefined),
          deleteGrant: vi.fn().mockResolvedValue(undefined),
          queryGrantsByConfig: vi.fn().mockResolvedValue([corruptGrant, validGrant]),
          scanAllConfigs: vi.fn().mockResolvedValue([]),
        },
      });

      await expect(grantShape(validGrant, 'test-role', deps)).rejects.toThrow(ShapeNotFoundError);

      // Grant was written before assembly was attempted
      expect(deps.grantLedger.putGrant).toHaveBeenCalledWith(validGrant);
      // Policy was never written to IAM
      expect(deps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });
  });
});
