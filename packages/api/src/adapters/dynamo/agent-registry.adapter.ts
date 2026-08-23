import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { InternalError } from '@hecaton/core';

import type { AgentRegistryPort, AgentRegistryRecord } from '../../ports/agent-registry.port.js';

export class AgentRegistryAdapter implements AgentRegistryPort {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async getByAgentId(agentId: string): Promise<AgentRegistryRecord | null> {
    try {
      const result = await this.client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
        }),
      );
      if (!result.Item) return null;
      return this.mapToRecord(result.Item);
    } catch (err) {
      throw new InternalError('Failed to get agent by agentId', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getByProfileEntityId(profileEntityId: string): Promise<AgentRegistryRecord | null> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: `PROFILE#${profileEntityId}` } },
          Limit: 1,
        }),
      );
      if (!result.Items || result.Items.length === 0) return null;
      const agentId = result.Items[0]['agentId']?.S;
      if (!agentId) return null;
      return this.getByAgentId(agentId);
    } catch (err) {
      if (err instanceof InternalError) throw err;
      throw new InternalError('Failed to get agent by profileEntityId', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getByConfigName(configName: string): Promise<AgentRegistryRecord | null> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: `CONFIG#${configName}` } },
          Limit: 1,
        }),
      );
      if (!result.Items || result.Items.length === 0) return null;
      const agentId = result.Items[0]['agentId']?.S;
      if (!agentId) return null;
      return this.getByAgentId(agentId);
    } catch (err) {
      if (err instanceof InternalError) throw err;
      throw new InternalError('Failed to get agent by configName', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async updateBreakerState(agentId: string, breakerState: string, status: string): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
          UpdateExpression: 'SET breakerState = :bs, #st = :s, updatedAt = :u',
          ExpressionAttributeNames: { '#st': 'status' },
          ExpressionAttributeValues: {
            ':bs': { S: breakerState },
            ':s': { S: status },
            ':u': { S: now },
          },
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to update breaker state', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private mapToRecord(item: Record<string, AttributeValue>): AgentRegistryRecord {
    return {
      agentId: item['agentId']?.S ?? '',
      configName: item['configName']?.S ?? '',
      roleName: item['roleName']?.S ?? '',
      profileEntityId: item['profileEntityId']?.S ?? '',
      profileArn: item['profileArn']?.S ?? '',
      agentType: item['agentType']?.S ?? '',
      modelId: item['modelId']?.S ?? '',
      guardrailId: item['guardrailId']?.S ?? '',
      status: item['status']?.S ?? '',
      breakerState: item['breakerState']?.S ?? '',
    };
  }
}
