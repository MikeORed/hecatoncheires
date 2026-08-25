import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SNSClient } from '@aws-sdk/client-sns';
import { InternalError } from '@hecaton/core';

import { SnsNotifierAdapter } from './sns-notifier.adapter.js';

describe('SnsNotifierAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: SnsNotifierAdapter;

  const testTopicArn = 'arn:aws:sns:us-east-1:123456789012:hecaton-dev-alerts';

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new SnsNotifierAdapter(mockClient as unknown as SNSClient, testTopicArn);
  });

  describe('publish', () => {
    it('sends PublishCommand with correct TopicArn, Subject, and Message', async () => {
      mockClient.send.mockResolvedValue({});
      await adapter.publish('Breaker Tripped', 'Agent test-agent exceeded token threshold');

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.TopicArn).toBe(testTopicArn);
      expect(command.input.Subject).toBe('Breaker Tripped');
      expect(command.input.Message).toBe('Agent test-agent exceeded token threshold');
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('SNS service unavailable'));
      await expect(adapter.publish('Test', 'message')).rejects.toThrow(InternalError);
    });
  });
});
