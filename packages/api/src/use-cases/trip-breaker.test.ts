import { describe, it, expect, vi } from 'vitest';
import { EVENT_SOURCE, EVENT_DETAIL_TYPE } from '@hecaton/core';

import { tripBreaker } from './trip-breaker.js';
import type { BreakerDependencies } from '../shared/dependencies.js';

function createMockDeps(overrides?: Partial<BreakerDependencies>): BreakerDependencies {
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
      getDefaultPolicyName: vi.fn().mockReturnValue('hecaton-operating-policy'),
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    agentRegistry: {
      getByAgentId: vi.fn().mockResolvedValue(null),
      getByProfileArn: vi.fn().mockResolvedValue(null),
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
    snsNotifier: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

const DEFAULT_INPUT = {
  configName: 'test-agent',
  roleName: 'test-role',
  agentId: 'agent-123',
  reason: 'cost threshold exceeded',
  alarmName: 'hecaton-dev-test-agent-token-alarm',
};

describe('trip-breaker use-case', () => {
  describe('happy path', () => {
    it('writes deny-all policy with correct document shape', async () => {
      const deps = createMockDeps();

      await tripBreaker(DEFAULT_INPUT, deps);

      expect(deps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        'hecaton-operating-policy',
        {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
        },
      );
    });

    it('updates registry breaker state with correct arguments', async () => {
      const deps = createMockDeps();

      await tripBreaker(DEFAULT_INPUT, deps);

      expect(deps.agentRegistry.updateBreakerState).toHaveBeenCalledWith(
        'agent-123',
        'tripped',
        'breaker-tripped',
      );
    });

    it('emits BreakerTripped event with correct detail', async () => {
      const deps = createMockDeps();

      await tripBreaker(DEFAULT_INPUT, deps);

      expect(deps.busEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          source: EVENT_SOURCE.API,
          detailType: EVENT_DETAIL_TYPE.BREAKER_TRIPPED,
          detail: expect.objectContaining({
            configName: 'test-agent',
            roleName: 'test-role',
            alarmName: 'hecaton-dev-test-agent-token-alarm',
            reason: 'cost threshold exceeded',
          }),
        }),
      );
    });

    it('publishes SNS notification with configName and alarm context', async () => {
      const deps = createMockDeps();

      await tripBreaker(DEFAULT_INPUT, deps);

      expect(deps.snsNotifier.publish).toHaveBeenCalledWith(
        'Breaker tripped: test-agent',
        'Agent test-agent breaker tripped by alarm hecaton-dev-test-agent-token-alarm. Reason: cost threshold exceeded',
      );
    });

    it('returns result with configName, roleName, operation, and trippedAt timestamp', async () => {
      const deps = createMockDeps();

      const result = await tripBreaker(DEFAULT_INPUT, deps);

      expect(result).toEqual({
        configName: 'test-agent',
        roleName: 'test-role',
        operation: 'breaker-tripped',
        trippedAt: expect.any(String),
      });
      expect(new Date(result.trippedAt).toISOString()).toBe(result.trippedAt);
    });

    it('does not query the grant ledger', async () => {
      const deps = createMockDeps();

      await tripBreaker(DEFAULT_INPUT, deps);

      expect(deps.grantLedger.queryGrantsByConfig).not.toHaveBeenCalled();
      expect(deps.grantLedger.scanAllConfigs).not.toHaveBeenCalled();
    });
  });

  describe('best-effort emission independence', () => {
    it('completes successfully when event emit throws', async () => {
      const deps = createMockDeps({
        busEmitter: {
          emit: vi.fn().mockRejectedValue(new Error('EventBridge failure')),
        },
      });

      const result = await tripBreaker(DEFAULT_INPUT, deps);

      expect(result.configName).toBe('test-agent');
      expect(result.roleName).toBe('test-role');
      expect(result.operation).toBe('breaker-tripped');
      expect(result.trippedAt).toBeDefined();
    });

    it('completes successfully when registry update throws', async () => {
      const deps = createMockDeps({
        agentRegistry: {
          getByAgentId: vi.fn().mockResolvedValue(null),
          getByProfileArn: vi.fn().mockResolvedValue(null),
          getByProfileEntityId: vi.fn().mockResolvedValue(null),
          getByConfigName: vi.fn().mockResolvedValue(null),
          updateBreakerState: vi.fn().mockRejectedValue(new Error('DynamoDB failure')),
          registerAgent: vi.fn().mockResolvedValue(undefined),
          listAll: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await tripBreaker(DEFAULT_INPUT, deps);

      expect(result.operation).toBe('breaker-tripped');
    });

    it('completes successfully when SNS publish throws', async () => {
      const deps = createMockDeps({
        snsNotifier: {
          publish: vi.fn().mockRejectedValue(new Error('SNS failure')),
        },
      });

      const result = await tripBreaker(DEFAULT_INPUT, deps);

      expect(result.operation).toBe('breaker-tripped');
    });
  });

  describe('IAM write failure propagation', () => {
    it('propagates error when policy write fails', async () => {
      const deps = createMockDeps({
        operatingPolicy: {
          writePolicy: vi.fn().mockRejectedValue(new Error('IAM write failed')),
          deletePolicy: vi.fn().mockResolvedValue(undefined),
          getDefaultPolicyName: vi.fn().mockReturnValue('hecaton-operating-policy'),
        },
      });

      await expect(tripBreaker(DEFAULT_INPUT, deps)).rejects.toThrow('IAM write failed');
    });
  });
});
