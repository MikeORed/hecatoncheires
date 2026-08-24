import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb';
import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { v7 as uuidv7 } from 'uuid';

interface CdkCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    configName: string;
    roleName: string;
    profileEntityId: string;
    profileArn: string;
    agentType: string;
    modelId: string;
    guardrailId: string;
  };
  OldResourceProperties?: Record<string, string>;
  PhysicalResourceId?: string;
}

interface CdkCustomResourceResponse {
  PhysicalResourceId: string;
  Data?: Record<string, string>;
}

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.AGENT_REGISTRY_TABLE_NAME!;

export async function handler(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  switch (event.RequestType) {
    case 'Create':
      return onCreate(event);
    case 'Update':
      return onUpdate(event);
    case 'Delete':
      return onDelete(event);
  }
}

async function onCreate(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties;
  const agentId = uuidv7();
  const now = new Date().toISOString();

  await client.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: { S: `AGENT#${agentId}` },
              sk: { S: '#META' },
              agentId: { S: agentId },
              configName: { S: props.configName },
              roleName: { S: props.roleName },
              profileEntityId: { S: props.profileEntityId },
              profileArn: { S: props.profileArn },
              agentType: { S: props.agentType },
              modelId: { S: props.modelId },
              guardrailId: { S: props.guardrailId },
              status: { S: 'active' },
              breakerState: { S: 'armed' },
              createdAt: { S: now },
              updatedAt: { S: now },
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: { S: `PROFILE#${props.profileEntityId}` },
              sk: { S: `AGENT#${agentId}` },
              agentId: { S: agentId },
              configName: { S: props.configName },
              roleName: { S: props.roleName },
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: { S: `CONFIG#${props.configName}` },
              sk: { S: `AGENT#${agentId}` },
              agentId: { S: agentId },
            },
          },
        },
      ],
    }),
  );

  return {
    PhysicalResourceId: agentId,
    Data: { agentId },
  };
}

async function onUpdate(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties;
  const agentId = event.PhysicalResourceId!;

  // Read existing metadata to check if profileEntityId changed and preserve createdAt
  const existing = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
    }),
  );

  const oldProfileEntityId = existing.Item?.['profileEntityId']?.S;
  const createdAt = existing.Item?.['createdAt']?.S ?? new Date().toISOString();
  const now = new Date().toISOString();

  const transactItems: TransactWriteItem[] = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: `AGENT#${agentId}` },
          sk: { S: '#META' },
          agentId: { S: agentId },
          configName: { S: props.configName },
          roleName: { S: props.roleName },
          profileEntityId: { S: props.profileEntityId },
          profileArn: { S: props.profileArn },
          agentType: { S: props.agentType },
          modelId: { S: props.modelId },
          guardrailId: { S: props.guardrailId },
          status: { S: existing.Item?.['status']?.S ?? 'active' },
          breakerState: { S: existing.Item?.['breakerState']?.S ?? 'armed' },
          createdAt: { S: createdAt },
          updatedAt: { S: now },
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: `PROFILE#${props.profileEntityId}` },
          sk: { S: `AGENT#${agentId}` },
          agentId: { S: agentId },
          configName: { S: props.configName },
          roleName: { S: props.roleName },
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: `CONFIG#${props.configName}` },
          sk: { S: `AGENT#${agentId}` },
          agentId: { S: agentId },
        },
      },
    },
  ];

  // Clean up stale profile reverse-lookup if profileEntityId changed
  if (oldProfileEntityId && oldProfileEntityId !== props.profileEntityId) {
    transactItems.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: {
          pk: { S: `PROFILE#${oldProfileEntityId}` },
          sk: { S: `AGENT#${agentId}` },
        },
      },
    });
  }

  await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

  return {
    PhysicalResourceId: agentId,
    Data: { agentId },
  };
}

async function onDelete(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties;
  const agentId = event.PhysicalResourceId!;

  await client.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: {
              pk: { S: `PROFILE#${props.profileEntityId}` },
              sk: { S: `AGENT#${agentId}` },
            },
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: {
              pk: { S: `CONFIG#${props.configName}` },
              sk: { S: `AGENT#${agentId}` },
            },
          },
        },
      ],
    }),
  );

  return { PhysicalResourceId: agentId };
}
