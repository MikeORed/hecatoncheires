import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handler } from './breaker-trip.alarm.js';
import type { CloudWatchAlarmActionEvent } from './breaker-trip.alarm.js';

vi.mock('../shared/dependencies.js', () => ({
  getBreakerDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getBreakerDependencies } from '../shared/dependencies.js';

function createMockDeps() {
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
  };
}

const MOCK_AGENT_RECORD = {
  agentId: 'agent-uuid-123',
  configName: 'test-managed',
  roleName: 'test-role',
  profiles: [
    {
      profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test',
      profileEntityId: 'profile-entity-abc',
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      label: 'primary',
    },
  ],
  agentType: 'AgentCore Managed',
  guardrailId: 'guardrail-123',
  status: 'active',
  breakerState: 'armed',
};

/**
 * Direct Lambda alarm-action payload (composite alarm → Lambda) — the real
 * shape CloudWatch delivers, with alarm details nested under `alarmData`.
 */
function makeActionEvent(
  stateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA',
  alarmName = 'hecaton-dev-test-managed-composite',
): CloudWatchAlarmActionEvent {
  return {
    source: 'aws.cloudwatch',
    alarmArn: `arn:aws:cloudwatch:us-east-1:123456789012:alarm:${alarmName}`,
    alarmData: {
      alarmName,
      state: {
        value: stateValue,
        reason: 'Threshold crossed: token usage exceeded limit',
      },
    },
  };
}

describe('breaker-trip.alarm handler', () => {
  beforeEach(() => {
    vi.mocked(getBreakerDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('non-ALARM state transitions', () => {
    it('no-ops for OK state', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeActionEvent('OK'));
      expect(mockDeps.agentRegistry.getByConfigName).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });

    it('no-ops for INSUFFICIENT_DATA state', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeActionEvent('INSUFFICIENT_DATA'));
      expect(mockDeps.agentRegistry.getByConfigName).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });
  });

  describe('configName extraction failures', () => {
    it('logs and returns when the alarm name is not a composite alarm name', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeActionEvent('ALARM', 'some-unrelated-alarm'));
      expect(mockDeps.agentRegistry.getByConfigName).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Cannot extract configName from alarm name',
        expect.any(String),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('registry resolution', () => {
    it('logs and returns when registry lookup returns null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByConfigName.mockResolvedValue(null);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeActionEvent('ALARM'));
      expect(mockDeps.agentRegistry.getByConfigName).toHaveBeenCalledWith('test-managed');
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cannot resolve configName to agent', {
        configName: 'test-managed',
      });
      consoleSpy.mockRestore();
    });
  });

  describe('happy path', () => {
    it('resolves agent via registry (by configName) and invokes trip-breaker', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByConfigName.mockResolvedValue(MOCK_AGENT_RECORD);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeActionEvent('ALARM'));

      expect(mockDeps.agentRegistry.getByConfigName).toHaveBeenCalledWith('test-managed');
      expect(mockDeps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        'hecaton-operating-policy',
        {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
        },
      );
      expect(mockDeps.agentRegistry.updateBreakerState).toHaveBeenCalledWith(
        'agent-uuid-123',
        'tripped',
        'breaker-tripped',
      );
      expect(mockDeps.busEmitter.emit).toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).toHaveBeenCalledWith(
        'Breaker tripped: test-managed',
        expect.stringContaining('test-managed'),
      );
    });

    it('accepts the EventBridge envelope shape as a fallback', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByConfigName.mockResolvedValue(MOCK_AGENT_RECORD);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      const event: CloudWatchAlarmActionEvent = {
        source: 'aws.cloudwatch',
        detail: {
          alarmName: 'hecaton-dev-test-managed-composite',
          state: { value: 'ALARM', reason: 'threshold crossed' },
        },
      };
      await handler(event);

      expect(mockDeps.agentRegistry.getByConfigName).toHaveBeenCalledWith('test-managed');
      expect(mockDeps.operatingPolicy.writePolicy).toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates IAM write failure for Lambda retry', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByConfigName.mockResolvedValue(MOCK_AGENT_RECORD);
      mockDeps.operatingPolicy.writePolicy.mockRejectedValue(new Error('IAM write failed'));
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await expect(handler(makeActionEvent('ALARM'))).rejects.toThrow('IAM write failed');
    });
  });
});
