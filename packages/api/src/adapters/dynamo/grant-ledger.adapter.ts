import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import type { GrantRecord } from '@hecaton/core';
import { InternalError } from '@hecaton/core';

import type { GrantLedgerPort } from '../../ports/grant-ledger.port.js';
import { toPersistence, fromPersistence } from './dto/grant-record.mapper.js';

export class GrantLedgerAdapter implements GrantLedgerPort {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async putGrant(grant: GrantRecord): Promise<void> {
    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: toPersistence(grant),
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to put grant record', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async deleteGrant(configName: string, grantId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: {
            configName: { S: configName },
            grantId: { S: grantId },
          },
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to delete grant record', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async queryGrantsByConfig(configName: string): Promise<GrantRecord[]> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'configName = :pk',
          ExpressionAttributeValues: {
            ':pk': { S: configName },
          },
        }),
      );
      return (result.Items ?? []).map(fromPersistence);
    } catch (err) {
      throw new InternalError('Failed to query grants by config', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async scanAllConfigs(): Promise<GrantRecord[]> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
        }),
      );
      return (result.Items ?? []).map(fromPersistence);
    } catch (err) {
      throw new InternalError('Failed to scan all configs', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
