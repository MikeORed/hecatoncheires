import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InternalError } from '@hecaton/core';

import { GrantLedgerAdapter } from './grant-ledger.adapter.js';
import type { GrantRecord } from '@hecaton/core';

describe('GrantLedgerAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: GrantLedgerAdapter;

  const testGrant: GrantRecord = {
    grantId: '01912345-6789-7abc-8def-0123456789ab',
    configName: 'test-agent',
    shapeName: 'core-invocation',
    parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
    grantedAt: '2026-07-20T12:00:00.000Z',
    grantedBy: 'admin@company.com',
  };

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new GrantLedgerAdapter(mockClient as unknown as DynamoDBClient, 'test-table');
  });

  describe('putGrant', () => {
    it('sends PutItemCommand with correct table and item', async () => {
      mockClient.send.mockResolvedValue({});
      await adapter.putGrant(testGrant);

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.TableName).toBe('test-table');
      expect(command.input.Item?.configName).toEqual({ S: 'test-agent' });
      expect(command.input.Item?.grantId).toEqual({ S: '01912345-6789-7abc-8def-0123456789ab' });
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('DynamoDB timeout'));
      await expect(adapter.putGrant(testGrant)).rejects.toThrow(InternalError);
    });
  });

  describe('deleteGrant', () => {
    it('sends DeleteItemCommand with correct keys', async () => {
      mockClient.send.mockResolvedValue({});
      await adapter.deleteGrant('test-agent', 'grant-123');

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.TableName).toBe('test-table');
      expect(command.input.Key).toEqual({
        configName: { S: 'test-agent' },
        grantId: { S: 'grant-123' },
      });
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Access denied'));
      await expect(adapter.deleteGrant('test-agent', 'grant-123')).rejects.toThrow(InternalError);
    });
  });

  describe('queryGrantsByConfig', () => {
    it('sends QueryCommand and maps items to domain objects', async () => {
      mockClient.send.mockResolvedValue({
        Items: [
          {
            configName: { S: 'test-agent' },
            grantId: { S: '01912345-6789-7abc-8def-0123456789ab' },
            shapeName: { S: 'core-invocation' },
            parameters: { S: '{"inferenceProfileArn":"arn:aws:bedrock:us-east-1:123:profile/test"}' },
            grantedAt: { S: '2026-07-20T12:00:00.000Z' },
            grantedBy: { S: 'admin@company.com' },
          },
        ],
      });

      const results = await adapter.queryGrantsByConfig('test-agent');
      expect(results).toHaveLength(1);
      expect(results[0].configName).toBe('test-agent');
      expect(results[0].shapeName).toBe('core-invocation');
    });

    it('returns empty array when no items', async () => {
      mockClient.send.mockResolvedValue({ Items: undefined });
      const results = await adapter.queryGrantsByConfig('empty-config');
      expect(results).toEqual([]);
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Throttled'));
      await expect(adapter.queryGrantsByConfig('test-agent')).rejects.toThrow(InternalError);
    });
  });

  describe('scanAllConfigs', () => {
    it('sends ScanCommand and maps items', async () => {
      mockClient.send.mockResolvedValue({
        Items: [
          {
            configName: { S: 'agent-a' },
            grantId: { S: '01912345-6789-7abc-8def-0123456789ab' },
            shapeName: { S: 's3-prefix-read' },
            parameters: { S: '{"bucketArn":"arn:aws:s3:::bucket","prefix":"data/"}' },
            grantedAt: { S: '2026-07-20T12:00:00.000Z' },
            grantedBy: { S: 'admin@company.com' },
          },
        ],
      });

      const results = await adapter.scanAllConfigs();
      expect(results).toHaveLength(1);
      expect(results[0].configName).toBe('agent-a');
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Service unavailable'));
      await expect(adapter.scanAllConfigs()).rejects.toThrow(InternalError);
    });
  });
});
