import { describe, it, expect, vi } from 'vitest';

import { revokeShape } from './revoke-shape.js';
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
      getDefaultPolicyName: vi.fn().mockReturnValue('hecaton-operating-policy'),
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
  describe('Property 7: Best-effort emission independence (revoke-shape)', () => {
    it('if emit throws, revoke-shape use-case still completes successfully', async () => {
      const deps = createMockDeps({
        busEmitter: {
          emit: vi.fn().mockRejectedValue(new Error('EventBridge failure')),
        },
      });

      const result = await revokeShape(
        { configName: 'test-agent', roleName: 'test-role', grantId: 'grant-123' },
        deps,
      );
      expect(result).toEqual({
        configName: 'test-agent',
        grantId: 'grant-123',
        operation: 'revoked',
      });
    });
  });

  describe('revoke-shape happy path', () => {
    it('deletes grant, reassembles policy, writes policy, and returns confirmation', async () => {
      const deps = createMockDeps();

      const result = await revokeShape(
        { configName: 'test-agent', roleName: 'test-role', grantId: 'grant-123' },
        deps,
      );

      expect(deps.grantLedger.deleteGrant).toHaveBeenCalledWith('test-agent', 'grant-123');
      expect(deps.grantLedger.queryGrantsByConfig).toHaveBeenCalledWith('test-agent');
      expect(deps.operatingPolicy.writePolicy).toHaveBeenCalled();
      expect(result.operation).toBe('revoked');
    });
  });
});
