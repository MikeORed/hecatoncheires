import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handler, isKnownPrincipal } from './drift-detect.event.js';
import type { DriftDetectEvent } from './drift-detect.event.js';

vi.mock('../shared/dependencies.js', () => ({
  getDriftDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDriftDependencies } from '../shared/dependencies.js';

function createMockDeps() {
  return {
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    snsNotifier: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeDriftEvent(overrides?: Partial<DriftDetectEvent['detail']>): DriftDetectEvent {
  return {
    detail: {
      eventName: 'PutRolePolicy',
      eventTime: '2024-03-15T10:30:00Z',
      userIdentity: {
        arn: 'arn:aws:iam::123456789012:role/unknown-external-role',
        type: 'AssumedRole',
      },
      requestParameters: {
        roleName: 'hecaton-dev-sre-ops-agent-role',
        policyName: 'sneaky-policy',
      },
      ...overrides,
    },
  };
}

describe('drift-detect.event handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(getDriftDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('known principal — no alert', () => {
    it('takes no action when modifier is a known platform principal (role ARN)', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = JSON.stringify([
        'arn:aws:iam::123456789012:role/hecaton-dev-breaker-role',
      ]);

      const event = makeDriftEvent({
        userIdentity: {
          arn: 'arn:aws:iam::123456789012:role/hecaton-dev-breaker-role',
          type: 'AssumedRole',
        },
      });

      await handler(event);

      expect(mockDeps.busEmitter.emit).not.toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).not.toHaveBeenCalled();
    });

    it('takes no action when modifier matches via assumed-role ARN', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = JSON.stringify([
        'arn:aws:iam::123456789012:role/hecaton-dev-grant-role',
      ]);

      const event = makeDriftEvent({
        userIdentity: {
          arn: 'arn:aws:sts::123456789012:assumed-role/hecaton-dev-grant-role/some-session-id',
          type: 'AssumedRole',
        },
      });

      await handler(event);

      expect(mockDeps.busEmitter.emit).not.toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).not.toHaveBeenCalled();
    });

    it('takes no action when known principals use assumed-role format and modifier uses role format', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = JSON.stringify([
        'arn:aws:sts::123456789012:assumed-role/hecaton-dev-revoke-role/session-abc',
      ]);

      const event = makeDriftEvent({
        userIdentity: {
          arn: 'arn:aws:iam::123456789012:role/hecaton-dev-revoke-role',
          type: 'AssumedRole',
        },
      });

      await handler(event);

      expect(mockDeps.busEmitter.emit).not.toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).not.toHaveBeenCalled();
    });
  });

  describe('unknown principal — emits alert', () => {
    it('emits drift.detected event and publishes SNS alert for unknown principal', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = JSON.stringify([
        'arn:aws:iam::123456789012:role/hecaton-dev-breaker-role',
      ]);

      const event = makeDriftEvent();
      await handler(event);

      expect(mockDeps.busEmitter.emit).toHaveBeenCalledWith({
        source: 'hecatoncheires.drift',
        detailType: 'drift.detected',
        detail: {
          roleName: 'hecaton-dev-sre-ops-agent-role',
          modifyingPrincipalArn: 'arn:aws:iam::123456789012:role/unknown-external-role',
          apiAction: 'PutRolePolicy',
          timestamp: '2024-03-15T10:30:00Z',
          policyName: 'sneaky-policy',
        },
      });

      expect(mockDeps.snsNotifier.publish).toHaveBeenCalledWith(
        'Hecatoncheires Drift Alert: hecaton-dev-sre-ops-agent-role',
        'Unauthorized IAM modification detected.\nRole: hecaton-dev-sre-ops-agent-role\nAction: PutRolePolicy\nPrincipal: arn:aws:iam::123456789012:role/unknown-external-role\nTime: 2024-03-15T10:30:00Z',
      );
    });

    it('includes policyArn in drift event when present', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = '[]';

      const event = makeDriftEvent({
        eventName: 'AttachRolePolicy',
        requestParameters: {
          roleName: 'hecaton-dev-sre-ops-agent-role',
          policyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
        },
      });

      await handler(event);

      expect(mockDeps.busEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            policyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
          }),
        }),
      );
    });

    it('omits policyName and policyArn from detail when not present', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = '[]';

      const event = makeDriftEvent({
        requestParameters: {
          roleName: 'hecaton-dev-sre-ops-agent-role',
        },
      });

      await handler(event);

      const emitCall = mockDeps.busEmitter.emit.mock.calls[0][0];
      expect(emitCall.detail).not.toHaveProperty('policyName');
      expect(emitCall.detail).not.toHaveProperty('policyArn');
    });
  });

  describe('missing userIdentity.arn — skips gracefully', () => {
    it('skips event when userIdentity.arn is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);

      const event = {
        detail: {
          eventName: 'PutRolePolicy',
          eventTime: '2024-03-15T10:30:00Z',
          userIdentity: {
            type: 'AWSService',
          },
          requestParameters: {
            roleName: 'hecaton-dev-sre-ops-agent-role',
          },
        },
      } as unknown as DriftDetectEvent;

      await handler(event);

      expect(mockDeps.busEmitter.emit).not.toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('KNOWN_PRINCIPALS env var handling', () => {
    it('treats missing KNOWN_PRINCIPALS as empty list — alerts on everything', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      delete process.env['KNOWN_PRINCIPALS'];

      await handler(makeDriftEvent());

      expect(mockDeps.busEmitter.emit).toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).toHaveBeenCalled();
    });

    it('treats invalid JSON KNOWN_PRINCIPALS as empty list — alerts on everything', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = 'not-valid-json';

      await handler(makeDriftEvent());

      expect(mockDeps.busEmitter.emit).toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('treats non-array JSON KNOWN_PRINCIPALS as empty list', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockDeps = createMockDeps();
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = '{"not": "an-array"}';

      await handler(makeDriftEvent());

      expect(mockDeps.busEmitter.emit).toHaveBeenCalled();
      expect(mockDeps.snsNotifier.publish).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('error propagation', () => {
    it('propagates bus emitter failure for Lambda retry', async () => {
      const mockDeps = createMockDeps();
      mockDeps.busEmitter.emit.mockRejectedValue(new Error('EventBridge failure'));
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = '[]';

      await expect(handler(makeDriftEvent())).rejects.toThrow('EventBridge failure');
    });

    it('propagates SNS publish failure for Lambda retry', async () => {
      const mockDeps = createMockDeps();
      mockDeps.snsNotifier.publish.mockRejectedValue(new Error('SNS failure'));
      vi.mocked(getDriftDependencies).mockReturnValue(mockDeps);
      process.env['KNOWN_PRINCIPALS'] = '[]';

      await expect(handler(makeDriftEvent())).rejects.toThrow('SNS failure');
    });
  });
});

describe('isKnownPrincipal', () => {
  it('returns true for exact role ARN match', () => {
    const result = isKnownPrincipal('arn:aws:iam::123456789012:role/my-role', [
      'arn:aws:iam::123456789012:role/my-role',
    ]);
    expect(result).toBe(true);
  });

  it('returns true when modifier uses assumed-role format', () => {
    const result = isKnownPrincipal(
      'arn:aws:sts::123456789012:assumed-role/my-role/session-123',
      ['arn:aws:iam::123456789012:role/my-role'],
    );
    expect(result).toBe(true);
  });

  it('returns true when known principal uses assumed-role format', () => {
    const result = isKnownPrincipal('arn:aws:iam::123456789012:role/my-role', [
      'arn:aws:sts::123456789012:assumed-role/my-role/session-xyz',
    ]);
    expect(result).toBe(true);
  });

  it('returns false when role names do not match', () => {
    const result = isKnownPrincipal('arn:aws:iam::123456789012:role/unknown-role', [
      'arn:aws:iam::123456789012:role/known-role',
    ]);
    expect(result).toBe(false);
  });

  it('returns false for empty known principals list', () => {
    const result = isKnownPrincipal('arn:aws:iam::123456789012:role/some-role', []);
    expect(result).toBe(false);
  });

  it('returns false when modifier ARN format is unrecognized', () => {
    const result = isKnownPrincipal('arn:aws:lambda::123456789012:function/my-func', [
      'arn:aws:iam::123456789012:role/my-role',
    ]);
    expect(result).toBe(false);
  });

  it('handles role names with path prefixes', () => {
    const result = isKnownPrincipal('arn:aws:iam::123456789012:role/service-role/my-role', [
      'arn:aws:iam::123456789012:role/service-role/my-role',
    ]);
    expect(result).toBe(true);
  });
});
