import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handler } from './breaker-trip.alarm.js';
import type { CloudWatchAlarmEvent } from './breaker-trip.alarm.js';

vi.mock('../shared/dependencies.js', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDependencies } from '../shared/dependencies.js';

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
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeAlarmEvent(
  stateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA',
  dimensions?: Record<string, string>,
): CloudWatchAlarmEvent {
  return {
    source: 'aws.cloudwatch',
    detail: {
      alarmName: 'hecaton-test-agent-cost-alarm',
      state: {
        value: stateValue,
        reason: 'Threshold crossed: cost exceeded $50',
      },
      configuration: {
        metrics: [
          {
            metricStat: {
              metric: {
                dimensions: dimensions ?? { configName: 'test-agent', roleName: 'test-role' },
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
    vi.mocked(getDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('non-ALARM state transitions', () => {
    it('no-ops for OK state', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('OK'));
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });

    it('no-ops for INSUFFICIENT_DATA state', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('INSUFFICIENT_DATA'));
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
    });
  });

  describe('parse failures', () => {
    it('returns silently when configName is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM', { roleName: 'test-role' }));
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns silently when roleName is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM', { configName: 'test-agent' }));
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns silently when dimensions are missing entirely', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const event: CloudWatchAlarmEvent = {
        source: 'aws.cloudwatch',
        detail: {
          alarmName: 'test-alarm',
          state: { value: 'ALARM', reason: 'threshold crossed' },
        },
      };
      await handler(event);
      expect(mockDeps.operatingPolicy.writePolicy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('happy path', () => {
    it('invokes trip-breaker use-case for ALARM state with valid dimensions', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(makeAlarmEvent('ALARM'));
      expect(mockDeps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        'hecaton-operating-policy',
        {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
        },
      );
      expect(mockDeps.busEmitter.emit).toHaveBeenCalled();
    });
  });
});
