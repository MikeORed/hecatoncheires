import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InternalError } from '@hecaton/core';

import { AgentRegistryAdapter } from './agent-registry.adapter.js';

describe('AgentRegistryAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: AgentRegistryAdapter;

  const testAgentItem = {
    agentId: { S: 'agent-001' },
    configName: { S: 'test-agent' },
    roleName: { S: 'hecaton-dev-test-agent-agent-role' },
    profileEntityId: { S: 'profile-entity-123' },
    profileArn: { S: 'arn:aws:bedrock:us-east-1:123:inference-profile/test' },
    agentType: { S: 'AgentCore Managed' },
    modelId: { S: 'anthropic.claude-3-sonnet' },
    guardrailId: { S: 'guardrail-abc' },
    status: { S: 'active' },
    breakerState: { S: 'armed' },
  };

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new AgentRegistryAdapter(mockClient as unknown as DynamoDBClient, 'test-table');
  });

  describe('getByAgentId', () => {
    it('returns record when item found', async () => {
      mockClient.send.mockResolvedValue({ Item: testAgentItem });

      const result = await adapter.getByAgentId('agent-001');

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.TableName).toBe('test-table');
      expect(command.input.Key).toEqual({
        pk: { S: 'AGENT#agent-001' },
        sk: { S: '#META' },
      });
      expect(result).toEqual({
        agentId: 'agent-001',
        configName: 'test-agent',
        roleName: 'hecaton-dev-test-agent-agent-role',
        profileEntityId: 'profile-entity-123',
        profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/test',
        agentType: 'AgentCore Managed',
        modelId: 'anthropic.claude-3-sonnet',
        guardrailId: 'guardrail-abc',
        status: 'active',
        breakerState: 'armed',
      });
    });

    it('returns null when item not found', async () => {
      mockClient.send.mockResolvedValue({ Item: undefined });

      const result = await adapter.getByAgentId('nonexistent');
      expect(result).toBeNull();
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('DynamoDB timeout'));
      await expect(adapter.getByAgentId('agent-001')).rejects.toThrow(InternalError);
    });
  });

  describe('getByProfileEntityId', () => {
    it('performs two-step lookup: QueryCommand then GetItemCommand', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [{ agentId: { S: 'agent-001' } }],
        })
        .mockResolvedValueOnce({ Item: testAgentItem });

      const result = await adapter.getByProfileEntityId('profile-entity-123');

      expect(mockClient.send).toHaveBeenCalledTimes(2);

      // First call: QueryCommand with PROFILE# prefix
      const queryCommand = mockClient.send.mock.calls[0][0];
      expect(queryCommand.input.TableName).toBe('test-table');
      expect(queryCommand.input.KeyConditionExpression).toBe('pk = :pk');
      expect(queryCommand.input.ExpressionAttributeValues).toEqual({
        ':pk': { S: 'PROFILE#profile-entity-123' },
      });
      expect(queryCommand.input.Limit).toBe(1);

      // Second call: GetItemCommand with resolved agentId
      const getCommand = mockClient.send.mock.calls[1][0];
      expect(getCommand.input.TableName).toBe('test-table');
      expect(getCommand.input.Key).toEqual({
        pk: { S: 'AGENT#agent-001' },
        sk: { S: '#META' },
      });

      expect(result).toEqual({
        agentId: 'agent-001',
        configName: 'test-agent',
        roleName: 'hecaton-dev-test-agent-agent-role',
        profileEntityId: 'profile-entity-123',
        profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/test',
        agentType: 'AgentCore Managed',
        modelId: 'anthropic.claude-3-sonnet',
        guardrailId: 'guardrail-abc',
        status: 'active',
        breakerState: 'armed',
      });
    });

    it('returns null when query returns empty', async () => {
      mockClient.send.mockResolvedValue({ Items: [] });

      const result = await adapter.getByProfileEntityId('unknown-profile');
      expect(result).toBeNull();
      expect(mockClient.send).toHaveBeenCalledOnce();
    });

    it('returns null when query result has no agentId field', async () => {
      mockClient.send.mockResolvedValue({
        Items: [{ someOtherField: { S: 'value' } }],
      });

      const result = await adapter.getByProfileEntityId('profile-entity-123');
      expect(result).toBeNull();
      expect(mockClient.send).toHaveBeenCalledOnce();
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Throttled'));
      await expect(adapter.getByProfileEntityId('profile-entity-123')).rejects.toThrow(
        InternalError,
      );
    });
  });

  describe('getByConfigName', () => {
    it('performs two-step lookup: QueryCommand then GetItemCommand', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [{ agentId: { S: 'agent-001' } }],
        })
        .mockResolvedValueOnce({ Item: testAgentItem });

      const result = await adapter.getByConfigName('test-agent');

      expect(mockClient.send).toHaveBeenCalledTimes(2);

      // First call: QueryCommand with CONFIG# prefix
      const queryCommand = mockClient.send.mock.calls[0][0];
      expect(queryCommand.input.TableName).toBe('test-table');
      expect(queryCommand.input.KeyConditionExpression).toBe('pk = :pk');
      expect(queryCommand.input.ExpressionAttributeValues).toEqual({
        ':pk': { S: 'CONFIG#test-agent' },
      });
      expect(queryCommand.input.Limit).toBe(1);

      // Second call: GetItemCommand with resolved agentId
      const getCommand = mockClient.send.mock.calls[1][0];
      expect(getCommand.input.Key).toEqual({
        pk: { S: 'AGENT#agent-001' },
        sk: { S: '#META' },
      });

      expect(result?.configName).toBe('test-agent');
    });

    it('returns null when query returns empty', async () => {
      mockClient.send.mockResolvedValue({ Items: undefined });

      const result = await adapter.getByConfigName('unknown-config');
      expect(result).toBeNull();
      expect(mockClient.send).toHaveBeenCalledOnce();
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Access denied'));
      await expect(adapter.getByConfigName('test-agent')).rejects.toThrow(InternalError);
    });
  });

  describe('updateBreakerState', () => {
    it('sends UpdateItemCommand with correct key, expression, and attribute values', async () => {
      mockClient.send.mockResolvedValue({});

      await adapter.updateBreakerState('agent-001', 'tripped', 'breaker-tripped');

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      expect(command.input.TableName).toBe('test-table');
      expect(command.input.Key).toEqual({
        pk: { S: 'AGENT#agent-001' },
        sk: { S: '#META' },
      });
      expect(command.input.UpdateExpression).toBe(
        'SET breakerState = :bs, #st = :s, updatedAt = :u',
      );
      expect(command.input.ExpressionAttributeNames).toEqual({ '#st': 'status' });
      expect(command.input.ExpressionAttributeValues[':bs']).toEqual({ S: 'tripped' });
      expect(command.input.ExpressionAttributeValues[':s']).toEqual({ S: 'breaker-tripped' });
      expect(command.input.ExpressionAttributeValues[':u'].S).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Service unavailable'));
      await expect(
        adapter.updateBreakerState('agent-001', 'tripped', 'breaker-tripped'),
      ).rejects.toThrow(InternalError);
    });
  });
});
