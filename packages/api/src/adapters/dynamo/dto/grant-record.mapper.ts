import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { GrantRecord } from '@hecaton/core';
import { ValidationError } from '@hecaton/core';

/** Converts domain GrantRecord to DynamoDB item (all values as AttributeValue) */
export function toPersistence(grant: GrantRecord): Record<string, AttributeValue> {
  const item: Record<string, AttributeValue> = {
    configName: { S: grant.configName },
    shapeName: { S: grant.shapeName },
    parameters: { S: JSON.stringify(grant.parameters) },
    grantedAt: { S: grant.grantedAt },
    grantedBy: { S: grant.grantedBy },
  };

  if (grant.grantId !== undefined) {
    item['grantId'] = { S: grant.grantId };
  }

  if (grant.expiresAt !== undefined) {
    item['expiresAt'] = { S: grant.expiresAt };
  }

  return item;
}

/** Converts DynamoDB item to domain GrantRecord. Throws ValidationError on missing fields. */
export function fromPersistence(item: Record<string, AttributeValue>): GrantRecord {
  const configName = item['configName']?.S;
  const grantId = item['grantId']?.S;
  const shapeName = item['shapeName']?.S;
  const parametersJson = item['parameters']?.S;
  const grantedAt = item['grantedAt']?.S;
  const grantedBy = item['grantedBy']?.S;
  const expiresAt = item['expiresAt']?.S;

  if (!configName || !shapeName || !parametersJson || !grantedAt || !grantedBy) {
    const missing: string[] = [];
    if (!configName) missing.push('configName');
    if (!shapeName) missing.push('shapeName');
    if (!parametersJson) missing.push('parameters');
    if (!grantedAt) missing.push('grantedAt');
    if (!grantedBy) missing.push('grantedBy');
    throw new ValidationError(`Missing required fields in DynamoDB item: ${missing.join(', ')}`, {
      missingFields: missing,
    });
  }

  const record: GrantRecord = {
    configName,
    shapeName,
    parameters: JSON.parse(parametersJson) as Record<string, string>,
    grantedAt,
    grantedBy,
  };

  if (grantId) {
    record.grantId = grantId;
  }

  if (expiresAt) {
    record.expiresAt = expiresAt;
  }

  return record;
}
