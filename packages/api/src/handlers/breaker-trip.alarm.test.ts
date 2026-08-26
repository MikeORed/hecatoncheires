import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handler } from './breaker-trip.alarm.js';
import type { CloudWatchAlarmEvent } from './breaker-trip.alarm.js';

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
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
    snsNotifier: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const MOCK_AGENT_RECORD = {
  agentId: 'agent-uuid-123',
  configName: 'test-agent',
  roleName: 'test-role',
  profileEntityId: 'profile-entity-abc',
  profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test',
  agentType: 'AgentCore Managed',
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  guardrailId: 'guardrail-123',
  status: 'active',
  breakerState: 'armed',
};

function makeAlarmEvent(
  stateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA',
  dimensions?: Record<string, string>,
): CloudWatchAlarmEvent {
  return {
    source: 'aws.cloudwatch',
    detail: {
      alarmName: 'hecaton-test-agent-token-alarm',
      state: {
        value: stateValue,
        reason: 'Threshold crossed: token usage exceeded limit',
      },
      configuration: {
        metrics: [
          {
            metricStat: {
              metric: {
                dimensions: dimensions ?? { InferenceProfileId: 'profile-entity-abc' },
              },
            },
          },
        ],
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

      await handler(makeAlarmEvent('OK'));
      expect(mockDeps.agentRegistry.getByProfileEntityId).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });

    it('no-ops for INSUFFICIENT_DATA state', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('INSUFFICIENT_DATA'));
      expect(mockDeps.agentRegistry.getByProfileEntityId).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });
  });

  describe('profileEntityId extraction failures', () => {
    it('logs and returns when InferenceProfileId dimension is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM', { SomeOtherDimension: 'value' }));
      expect(mockDeps.agentRegistry.getByProfileEntityId).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Cannot extract profileEntityId from alarm event',
        expect.any(String),
      );
      consoleSpy.mockRestore();
    });

    it('logs and returns when dimensions are empty', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM', {}));
      expect(mockDeps.agentRegistry.getByProfileEntityId).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('logs and returns when configuration.metrics is missing entirely', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      const event: CloudWatchAlarmEvent = {
        source: 'aws.cloudwatch',
        detail: {
          alarmName: 'test-alarm',
          state: { value: 'ALARM', reason: 'threshold crossed' },
        },
      };
      await handler(event);
      expect(mockDeps.agentRegistry.getByProfileEntityId).not.toHaveBeenCalled();
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('registry resolution', () => {
    it('logs and returns when registry lookup returns null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByProfileEntityId.mockResolvedValue(null);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM'));
      expect(mockDeps.agentRegistry.getByProfileEntityId).toHaveBeenCalledWith(
        'profile-entity-abc',
      );
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cannot resolve profileEntityId to agent', {
        profileEntityId: 'profile-entity-abc',
      });
      consoleSpy.mockRestore();
    });
  });

  describe('happy path', () => {
    it('resolves agent via registry and invokes trip-breaker use-case', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByProfileEntityId.mockResolvedValue(MOCK_AGENT_RECORD);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM'));

      expect(mockDeps.agentRegistry.getByProfileEntityId).toHaveBeenCalledWith(
        'profile-entity-abc',
      );
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
        'Breaker tripped: test-agent',
        expect.stringContaining('test-agent'),
      );
    });

    it('passes alarmName and reason to the use-case', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByProfileEntityId.mockResolvedValue(MOCK_AGENT_RECORD);
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      const event = makeAlarmEvent('ALARM');
      await handler(event);

      // The use-case emits an event containing the alarm details
      expect(mockDeps.busEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          detailType: 'BreakerTripped',
        }),
      );
    });
  });

  describe('error propagation', () => {
    it('propagates IAM write failure for Lambda retry', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByProfileEntityId.mockResolvedValue(MOCK_AGENT_RECORD);
      mockDeps.operatingPolicy.writePolicy.mockRejectedValue(new Error('IAM write failed'));
      vi.mocked(getBreakerDependencies).mockReturnValue(mockDeps);

      await expect(handler(makeAlarmEvent('ALARM'))).rejects.toThrow('IAM write failed');
    });
  });
});
