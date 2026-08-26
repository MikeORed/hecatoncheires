import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue, TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { InternalError, ProfileExclusivityError } from '@hecaton/core';

import type {
  AgentRegistryPort,
  AgentRegistryRecord,
  RegistryProfileRecord,
} from '../../ports/agent-registry.port.js';

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

  async getByProfileArn(profileArn: string): Promise<AgentRegistryRecord | null> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'profileArn-index',
          KeyConditionExpression: 'profileArn = :arn',
          ExpressionAttributeValues: { ':arn': { S: profileArn } },
          Limit: 1,
        }),
      );
      if (!result.Items || result.Items.length === 0) return null;
      const agentId = result.Items[0]['agentId']?.S;
      if (!agentId) return null;
      return this.getByAgentId(agentId);
    } catch (err) {
      if (err instanceof InternalError) throw err;
      throw new InternalError('Failed to get agent by profileArn', {
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

  async listAll(): Promise<AgentRegistryRecord[]> {
    try {
      const records: AgentRegistryRecord[] = [];
      let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'gsi1',
            KeyConditionExpression: 'sk = :sk',
            ExpressionAttributeValues: { ':sk': { S: '#META' } },
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );

        if (result.Items) {
          for (const item of result.Items) {
            records.push(this.mapToRecord(item));
          }
        }

        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return records;
    } catch (err) {
      throw new InternalError('Failed to list all agents', {
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

  async registerAgent(record: AgentRegistryRecord): Promise<void> {
    const transactItems: TransactWriteItem[] = [];

    // Profile ARN lock items — one per profile for exclusivity enforcement
    for (const profile of record.profiles) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk: { S: `PROFILE_ARN#${profile.profileArn}` },
            sk: { S: '#LOCK' },
            agentId: { S: record.agentId },
            profileArn: { S: profile.profileArn },
          },
          ConditionExpression: 'attribute_not_exists(pk) OR agentId = :aid',
          ExpressionAttributeValues: { ':aid': { S: record.agentId } },
        },
      });
    }

    // Agent record
    transactItems.push({
      Put: {
        TableName: this.tableName,
        Item: this.marshalRecord(record),
      },
    });

    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));
    } catch (err) {
      if (this.isTransactionCancelledWithConditionFail(err)) {
        const conflicting = await this.findConflictingProfile(record.profiles, record.agentId);
        throw new ProfileExclusivityError(
          conflicting?.ownerAgentId ?? 'unknown',
          conflicting?.profileArn ?? record.profiles[0]?.profileArn ?? 'unknown',
        );
      }
      throw new InternalError('Failed to register agent', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private marshalRecord(record: AgentRegistryRecord): Record<string, AttributeValue> {
    const now = new Date().toISOString();
    return {
      pk: { S: `AGENT#${record.agentId}` },
      sk: { S: '#META' },
      agentId: { S: record.agentId },
      configName: { S: record.configName },
      roleName: { S: record.roleName },
      agentType: { S: record.agentType },
      guardrailId: { S: record.guardrailId },
      status: { S: record.status },
      breakerState: { S: record.breakerState },
      profiles: {
        L: record.profiles.map((p) => ({
          M: {
            profileArn: { S: p.profileArn },
            profileEntityId: { S: p.profileEntityId },
            modelId: { S: p.modelId },
            label: { S: p.label },
          },
        })),
      },
      createdAt: { S: now },
      updatedAt: { S: now },
    };
  }

  private isTransactionCancelledWithConditionFail(err: unknown): boolean {
    if (
      err !== null &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name: string }).name === 'TransactionCanceledException'
    ) {
      const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> })
        .CancellationReasons;
      if (reasons) {
        return reasons.some((r) => r.Code === 'ConditionalCheckFailed');
      }
      return true;
    }
    return false;
  }

  private async findConflictingProfile(
    profiles: RegistryProfileRecord[],
    currentAgentId: string,
  ): Promise<{ ownerAgentId: string; profileArn: string } | null> {
    for (const profile of profiles) {
      try {
        const result = await this.client.send(
          new GetItemCommand({
            TableName: this.tableName,
            Key: {
              pk: { S: `PROFILE_ARN#${profile.profileArn}` },
              sk: { S: '#LOCK' },
            },
          }),
        );
        if (result.Item) {
          const ownerAgentId = result.Item['agentId']?.S ?? 'unknown';
          if (ownerAgentId !== currentAgentId) {
            return { ownerAgentId, profileArn: profile.profileArn };
          }
        }
      } catch {
        // Best effort — if we can't determine the conflict, continue
      }
    }
    return null;
  }

  private mapToRecord(item: Record<string, AttributeValue>): AgentRegistryRecord {
    return {
      agentId: item['agentId']?.S ?? '',
      configName: item['configName']?.S ?? '',
      roleName: item['roleName']?.S ?? '',
      profiles: this.mapProfiles(item['profiles']),
      agentType: item['agentType']?.S ?? '',
      guardrailId: item['guardrailId']?.S ?? '',
      status: item['status']?.S ?? '',
      breakerState: item['breakerState']?.S ?? '',
    };
  }

  private mapProfiles(attr: AttributeValue | undefined): RegistryProfileRecord[] {
    if (!attr?.L) return [];
    return attr.L.map((entry) => ({
      profileArn: entry.M?.['profileArn']?.S ?? '',
      profileEntityId: entry.M?.['profileEntityId']?.S ?? '',
      modelId: entry.M?.['modelId']?.S ?? '',
      label: entry.M?.['label']?.S ?? '',
    }));
  }
}
