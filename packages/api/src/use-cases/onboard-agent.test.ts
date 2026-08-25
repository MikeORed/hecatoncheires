import { describe, it, expect, vi } from 'vitest';
import { InternalError } from '@hecaton/core';

import { onboardAgent } from './onboard-agent.js';
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

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 10: Onboard-agent critical emission failure propagation', () => {
    it('if emit throws during onboard-agent, the error propagates to caller', async () => {
      const emitError = new InternalError('EventBridge failure', {});
      const deps = createMockDeps({
        busEmitter: {
          emit: vi.fn().mockRejectedValue(emitError),
        },
      });

      await expect(
        onboardAgent({ configName: 'test-agent', roleName: 'test-role' }, deps),
      ).rejects.toThrow(emitError);
    });
  });

  describe('onboard-agent happy path', () => {
    it('writes deny-all policy and emits capability-changed event', async () => {
      const deps = createMockDeps();

      const result = await onboardAgent(
        { configName: 'test-agent', roleName: 'test-role' },
        deps,
      );

      expect(deps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        'hecaton-operating-policy',
        {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
        },
      );
      expect(deps.busEmitter.emit).toHaveBeenCalled();
      expect(result).toEqual({ configName: 'test-agent' });
    });

    it('returns confirmation only after both policy write and emission succeed', async () => {
      const deps = createMockDeps();

      const result = await onboardAgent(
        { configName: 'test-agent', roleName: 'test-role' },
        deps,
      );

      expect(result.configName).toBe('test-agent');
    });
  });
});
