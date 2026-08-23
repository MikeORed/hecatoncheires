import { describe, it, expect, vi } from 'vitest';

import { tripBreaker } from './trip-breaker.js';
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

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 7: Best-effort emission independence (trip-breaker)', () => {
    it('if emit throws, trip-breaker use-case still completes successfully', async () => {
      const deps = createMockDeps({
        busEmitter: {
          emit: vi.fn().mockRejectedValue(new Error('EventBridge failure')),
        },
      });

      const result = await tripBreaker(
        { configName: 'test-agent', roleName: 'test-role', reason: 'cost threshold exceeded' },
        deps,
      );

      expect(result.configName).toBe('test-agent');
      expect(result.roleName).toBe('test-role');
      expect(result.operation).toBe('breaker-tripped');
      expect(result.trippedAt).toBeDefined();
    });
  });

  describe('trip-breaker happy path', () => {
    it('writes deny-all policy and emits breaker-tripped event', async () => {
      const deps = createMockDeps();

      const result = await tripBreaker(
        { configName: 'test-agent', roleName: 'test-role', reason: 'cost alarm' },
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
      expect(result.operation).toBe('breaker-tripped');
    });

    it('does not query the grant ledger', async () => {
      const deps = createMockDeps();

      await tripBreaker(
        { configName: 'test-agent', roleName: 'test-role', reason: 'alarm' },
        deps,
      );

      expect(deps.grantLedger.queryGrantsByConfig).not.toHaveBeenCalled();
      expect(deps.grantLedger.scanAllConfigs).not.toHaveBeenCalled();
    });
  });
});
