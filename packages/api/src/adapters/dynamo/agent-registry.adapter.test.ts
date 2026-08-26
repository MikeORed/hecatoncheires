import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InternalError, ProfileExclusivityError } from '@hecaton/core';

import { AgentRegistryAdapter } from './agent-registry.adapter.js';

describe('AgentRegistryAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: AgentRegistryAdapter;

  const testProfiles = {
    L: [
      {
        M: {
          profileArn: { S: 'arn:aws:bedrock:us-east-1:123:inference-profile/test-primary' },
          profileEntityId: { S: 'profile-entity-123' },
          modelId: { S: 'anthropic.claude-3-sonnet' },
          label: { S: 'primary' },
        },
      },
      {
        M: {
          profileArn: { S: 'arn:aws:bedrock:us-east-1:123:inference-profile/test-secondary' },
          profileEntityId: { S: 'profile-entity-456' },
          modelId: { S: 'anthropic.claude-3-haiku' },
          label: { S: 'secondary' },
        },
      },
    ],
  };

  const testAgentItem = {
    agentId: { S: 'agent-001' },
    configName: { S: 'test-agent' },
    roleName: { S: 'hecaton-dev-test-agent-agent-role' },
    profiles: testProfiles,
    agentType: { S: 'AgentCore Managed' },
    guardrailId: { S: 'guardrail-abc' },
    status: { S: 'active' },
    breakerState: { S: 'armed' },
  };

  const expectedRecord = {
    agentId: 'agent-001',
    configName: 'test-agent',
    roleName: 'hecaton-dev-test-agent-agent-role',
    profiles: [
      {
        profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/test-primary',
        profileEntityId: 'profile-entity-123',
        modelId: 'anthropic.claude-3-sonnet',
        label: 'primary',
      },
      {
        profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/test-secondary',
        profileEntityId: 'profile-entity-456',
        modelId: 'anthropic.claude-3-haiku',
        label: 'secondary',
      },
    ],
    agentType: 'AgentCore Managed',
    guardrailId: 'guardrail-abc',
    status: 'active',
    breakerState: 'armed',
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
      expect(result).toEqual(expectedRecord);
    });

    it('returns empty profiles array when profiles attribute is missing', async () => {
      const itemWithoutProfiles = {
        agentId: { S: 'agent-002' },
        configName: { S: 'legacy-agent' },
        roleName: { S: 'hecaton-dev-legacy-agent-role' },
        agentType: { S: 'OpenClaw' },
        guardrailId: { S: 'gid-x' },
        status: { S: 'active' },
        breakerState: { S: 'armed' },
      };
      mockClient.send.mockResolvedValue({ Item: itemWithoutProfiles });

      const result = await adapter.getByAgentId('agent-002');

      expect(result?.profiles).toEqual([]);
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

  describe('getByProfileArn', () => {
    it('performs two-step lookup: GSI query then GetItemCommand', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [{ agentId: { S: 'agent-001' } }],
        })
        .mockResolvedValueOnce({ Item: testAgentItem });

      const result = await adapter.getByProfileArn(
        'arn:aws:bedrock:us-east-1:123:inference-profile/test-primary',
      );

      expect(mockClient.send).toHaveBeenCalledTimes(2);

      // First call: QueryCommand against profileArn-index
      const queryCommand = mockClient.send.mock.calls[0][0];
      expect(queryCommand.input.TableName).toBe('test-table');
      expect(queryCommand.input.IndexName).toBe('profileArn-index');
      expect(queryCommand.input.KeyConditionExpression).toBe('profileArn = :arn');
      expect(queryCommand.input.ExpressionAttributeValues).toEqual({
        ':arn': { S: 'arn:aws:bedrock:us-east-1:123:inference-profile/test-primary' },
      });
      expect(queryCommand.input.Limit).toBe(1);

      // Second call: GetItemCommand with resolved agentId
      const getCommand = mockClient.send.mock.calls[1][0];
      expect(getCommand.input.TableName).toBe('test-table');
      expect(getCommand.input.Key).toEqual({
        pk: { S: 'AGENT#agent-001' },
        sk: { S: '#META' },
      });

      expect(result).toEqual(expectedRecord);
    });

    it('returns null when GSI query returns empty', async () => {
      mockClient.send.mockResolvedValue({ Items: [] });

      const result = await adapter.getByProfileArn('arn:nonexistent');
      expect(result).toBeNull();
      expect(mockClient.send).toHaveBeenCalledOnce();
    });

    it('returns null when GSI query result has no agentId field', async () => {
      mockClient.send.mockResolvedValue({
        Items: [{ someOtherField: { S: 'value' } }],
      });

      const result = await adapter.getByProfileArn('arn:some-profile');
      expect(result).toBeNull();
      expect(mockClient.send).toHaveBeenCalledOnce();
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Throttled'));
      await expect(adapter.getByProfileArn('arn:test')).rejects.toThrow(InternalError);
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

      expect(result).toEqual(expectedRecord);
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

  describe('listAll', () => {
    it('returns all agent records from GSI', async () => {
      mockClient.send.mockResolvedValue({
        Items: [testAgentItem],
        LastEvaluatedKey: undefined,
      });

      const result = await adapter.listAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedRecord);
    });

    it('paginates through multiple pages', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [testAgentItem],
          LastEvaluatedKey: { pk: { S: 'next' }, sk: { S: '#META' } },
        })
        .mockResolvedValueOnce({
          Items: [
            {
              ...testAgentItem,
              agentId: { S: 'agent-002' },
              configName: { S: 'another-agent' },
            },
          ],
          LastEvaluatedKey: undefined,
        });

      const result = await adapter.listAll();

      expect(result).toHaveLength(2);
      expect(mockClient.send).toHaveBeenCalledTimes(2);
    });

    it('wraps SDK errors in InternalError', async () => {
      mockClient.send.mockRejectedValue(new Error('Service unavailable'));
      await expect(adapter.listAll()).rejects.toThrow(InternalError);
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

  describe('profile ordering', () => {
    it('preserves order of profiles from DynamoDB list attribute', async () => {
      const orderedProfiles = {
        L: [
          {
            M: {
              profileArn: { S: 'arn:first' },
              profileEntityId: { S: 'entity-1' },
              modelId: { S: 'model-a' },
              label: { S: 'alpha' },
            },
          },
          {
            M: {
              profileArn: { S: 'arn:second' },
              profileEntityId: { S: 'entity-2' },
              modelId: { S: 'model-b' },
              label: { S: 'beta' },
            },
          },
          {
            M: {
              profileArn: { S: 'arn:third' },
              profileEntityId: { S: 'entity-3' },
              modelId: { S: 'model-c' },
              label: { S: 'gamma' },
            },
          },
        ],
      };

      mockClient.send.mockResolvedValue({
        Item: { ...testAgentItem, profiles: orderedProfiles },
      });

      const result = await adapter.getByAgentId('agent-001');

      expect(result?.profiles).toHaveLength(3);
      expect(result?.profiles[0].label).toBe('alpha');
      expect(result?.profiles[1].label).toBe('beta');
      expect(result?.profiles[2].label).toBe('gamma');
    });
  });

  describe('registerAgent', () => {
    const testRecord = {
      agentId: 'agent-new',
      configName: 'new-agent',
      roleName: 'hecaton-dev-new-agent-agent-role',
      agentType: 'agentcore-managed',
      guardrailId: 'guardrail-xyz',
      status: 'active',
      breakerState: 'armed',
      profiles: [
        {
          profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/new-primary',
          profileEntityId: 'profile-entity-new-1',
          modelId: 'anthropic.claude-3-sonnet',
          label: 'primary',
        },
        {
          profileArn: 'arn:aws:bedrock:us-east-1:123:inference-profile/new-secondary',
          profileEntityId: 'profile-entity-new-2',
          modelId: 'anthropic.claude-3-haiku',
          label: 'secondary',
        },
      ],
    };

    it('sends TransactWriteItemsCommand with lock items per profile and agent record', async () => {
      mockClient.send.mockResolvedValue({});

      await adapter.registerAgent(testRecord);

      expect(mockClient.send).toHaveBeenCalledOnce();
      const command = mockClient.send.mock.calls[0][0];
      const transactItems = command.input.TransactItems;

      // 2 profile locks + 1 agent record = 3 items
      expect(transactItems).toHaveLength(3);

      // First profile lock
      expect(transactItems[0].Put.TableName).toBe('test-table');
      expect(transactItems[0].Put.Item.pk).toEqual({
        S: `PROFILE_ARN#${testRecord.profiles[0].profileArn}`,
      });
      expect(transactItems[0].Put.Item.sk).toEqual({ S: '#LOCK' });
      expect(transactItems[0].Put.Item.agentId).toEqual({ S: 'agent-new' });
      expect(transactItems[0].Put.ConditionExpression).toBe(
        'attribute_not_exists(pk) OR agentId = :aid',
      );
      expect(transactItems[0].Put.ExpressionAttributeValues[':aid']).toEqual({ S: 'agent-new' });

      // Second profile lock
      expect(transactItems[1].Put.Item.pk).toEqual({
        S: `PROFILE_ARN#${testRecord.profiles[1].profileArn}`,
      });

      // Agent record (last item)
      const agentPut = transactItems[2].Put;
      expect(agentPut.Item.pk).toEqual({ S: 'AGENT#agent-new' });
      expect(agentPut.Item.sk).toEqual({ S: '#META' });
      expect(agentPut.Item.agentId).toEqual({ S: 'agent-new' });
      expect(agentPut.Item.configName).toEqual({ S: 'new-agent' });
      expect(agentPut.Item.profiles.L).toHaveLength(2);
    });

    it('throws ProfileExclusivityError when transaction cancelled with condition failure', async () => {
      const transactionError = Object.assign(
        new Error('Transaction cancelled'),
        {
          name: 'TransactionCanceledException',
          CancellationReasons: [
            { Code: 'ConditionalCheckFailed' },
            { Code: 'None' },
            { Code: 'None' },
          ],
        },
      );

      // First call: TransactWriteItems fails
      // Second call: GetItem to find conflicting profile lock
      mockClient.send
        .mockRejectedValueOnce(transactionError)
        .mockResolvedValueOnce({
          Item: {
            pk: { S: `PROFILE_ARN#${testRecord.profiles[0].profileArn}` },
            sk: { S: '#LOCK' },
            agentId: { S: 'agent-existing' },
            profileArn: { S: testRecord.profiles[0].profileArn },
          },
        });

      await expect(adapter.registerAgent(testRecord)).rejects.toThrow(ProfileExclusivityError);

      try {
        await adapter.registerAgent(testRecord);
      } catch (err) {
        // Reset mock to re-test
      }

      // Verify the error properties
      mockClient.send
        .mockRejectedValueOnce(transactionError)
        .mockResolvedValueOnce({
          Item: {
            pk: { S: `PROFILE_ARN#${testRecord.profiles[0].profileArn}` },
            sk: { S: '#LOCK' },
            agentId: { S: 'agent-existing' },
            profileArn: { S: testRecord.profiles[0].profileArn },
          },
        });

      try {
        await adapter.registerAgent(testRecord);
      } catch (err) {
        expect(err).toBeInstanceOf(ProfileExclusivityError);
        expect((err as ProfileExclusivityError).conflictingAgent).toBe('agent-existing');
        expect((err as ProfileExclusivityError).conflictingProfileArn).toBe(
          testRecord.profiles[0].profileArn,
        );
      }
    });

    it('throws InternalError for non-transaction errors', async () => {
      mockClient.send.mockRejectedValue(new Error('Network timeout'));

      await expect(adapter.registerAgent(testRecord)).rejects.toThrow(InternalError);
    });

    it('marshals profiles in correct order in the agent record', async () => {
      mockClient.send.mockResolvedValue({});

      await adapter.registerAgent(testRecord);

      const command = mockClient.send.mock.calls[0][0];
      const agentItem = command.input.TransactItems[2].Put.Item;
      const profiles = agentItem.profiles.L;

      expect(profiles[0].M.label.S).toBe('primary');
      expect(profiles[0].M.modelId.S).toBe('anthropic.claude-3-sonnet');
      expect(profiles[1].M.label.S).toBe('secondary');
      expect(profiles[1].M.modelId.S).toBe('anthropic.claude-3-haiku');
    });

    it('allows re-registration of the same agent (idempotent)', async () => {
      mockClient.send.mockResolvedValue({});

      // The condition 'attribute_not_exists(pk) OR agentId = :aid' allows the same agent
      // to re-register its own profiles
      await adapter.registerAgent(testRecord);

      const command = mockClient.send.mock.calls[0][0];
      const firstLock = command.input.TransactItems[0].Put;
      expect(firstLock.ConditionExpression).toBe('attribute_not_exists(pk) OR agentId = :aid');
      expect(firstLock.ExpressionAttributeValues[':aid']).toEqual({ S: testRecord.agentId });
    });
  });
});
