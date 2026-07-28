import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IAMClient } from '@aws-sdk/client-iam';
import { InternalError } from '@hecaton/core';
import type { IamPolicyDocument } from '@hecaton/core';

import { OperatingPolicyAdapter } from './operating-policy.adapter.js';

describe('OperatingPolicyAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: OperatingPolicyAdapter;

  const testPolicy: IamPolicyDocument = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
  };

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new OperatingPolicyAdapter(mockClient as unknown as IAMClient, 'hecaton-operating-policy');
  });

  describe('writePolicy', () => {
    it('sends PutRolePolicyCommand with correct parameters', async () => {
      mockClient.send.mockResolvedValue({});
      await adapter.writePolicy('test-role', 'test-policy', testPolicy);

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.RoleName).toBe('test-role');
      expect(command.input.PolicyName).toBe('test-policy');
      expect(command.input.PolicyDocument).toBe(JSON.stringify(testPolicy));
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('NoSuchEntity'));
      await expect(adapter.writePolicy('bad-role', 'policy', testPolicy)).rejects.toThrow(
        InternalError,
      );
    });
  });

  describe('deletePolicy', () => {
    it('sends DeleteRolePolicyCommand with correct parameters', async () => {
      mockClient.send.mockResolvedValue({});
      await adapter.deletePolicy('test-role', 'test-policy');

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.RoleName).toBe('test-role');
      expect(command.input.PolicyName).toBe('test-policy');
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Access denied'));
      await expect(adapter.deletePolicy('test-role', 'test-policy')).rejects.toThrow(
        InternalError,
      );
    });
  });

  describe('getDefaultPolicyName', () => {
    it('returns the configured default policy name', () => {
      expect(adapter.getDefaultPolicyName()).toBe('hecaton-operating-policy');
    });
  });
});
