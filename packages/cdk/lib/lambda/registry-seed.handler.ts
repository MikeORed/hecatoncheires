import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb';
import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { v7 as uuidv7 } from 'uuid';

/** One inference profile bound to the agent. */
interface ProfileBinding {
  profileEntityId: string;
  profileArn: string;
  modelId: string;
  label: string;
}

interface CdkCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    configName: string;
    roleName: string;
    agentType: string;
    guardrailId: string;
    /**
     * All inference profiles bound to this agent. The AgentPolicyModulator
     * construct sends this as an array (one entry per model binding); the
     * first entry is treated as the agent's primary profile.
     */
    profiles: ProfileBinding[];
  };
  OldResourceProperties?: CdkCustomResourceEvent['ResourceProperties'];
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

/** Validate and return the profiles array, failing loudly on an empty/malformed contract. */
function getProfiles(props: CdkCustomResourceEvent['ResourceProperties']): ProfileBinding[] {
  const profiles = props.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(
      'registry-seed: ResourceProperties.profiles must be a non-empty array ' +
        `(configName: ${props.configName}).`,
    );
  }
  return profiles;
}

/**
 * Marshal the full profile list as a DynamoDB List attribute for the #META row.
 * Must match AgentRegistryAdapter.marshalRecord / mapProfiles exactly — the read
 * adapter reconstructs `profiles` from this `L` attribute, and downstream
 * use-cases (e.g. grantShape) scope the operating policy from it. Omitting this
 * makes the adapter return an empty profiles array and grants resolve to no
 * profile ARNs.
 */
function profilesListAttribute(profiles: ProfileBinding[]) {
  return {
    L: profiles.map((p) => ({
      M: {
        profileArn: { S: p.profileArn },
        profileEntityId: { S: p.profileEntityId },
        modelId: { S: p.modelId },
        label: { S: p.label },
      },
    })),
  };
}

/**
 * Build the reverse-lookup rows (one PROFILE# row per profile) that let the
 * breaker resolve an agent from any of its profiles' alarm dimensions.
 */
function profileLookupPuts(
  agentId: string,
  configName: string,
  roleName: string,
  profiles: ProfileBinding[],
): TransactWriteItem[] {
  return profiles.map((p) => ({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        pk: { S: `PROFILE#${p.profileEntityId}` },
        sk: { S: `AGENT#${agentId}` },
        agentId: { S: agentId },
        configName: { S: configName },
        roleName: { S: roleName },
        profileArn: { S: p.profileArn },
        modelId: { S: p.modelId },
        label: { S: p.label },
      },
    },
  }));
}

async function onCreate(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties;
  const profiles = getProfiles(props);
  const primary = profiles[0];
  const agentId = uuidv7();
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
          // Primary profile scalars (backward-compatible with single-profile readers)
          profileEntityId: { S: primary.profileEntityId },
          profileArn: { S: primary.profileArn },
          modelId: { S: primary.modelId },
          // Full profile list — the shape AgentRegistryAdapter reads back.
          profiles: profilesListAttribute(profiles),
          agentType: { S: props.agentType },
          guardrailId: { S: props.guardrailId },
          status: { S: 'active' },
          breakerState: { S: 'armed' },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    },
    ...profileLookupPuts(agentId, props.configName, props.roleName, profiles),
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

  await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

  return {
    PhysicalResourceId: agentId,
    Data: { agentId },
  };
}

async function onUpdate(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties;
  const profiles = getProfiles(props);
  const primary = profiles[0];
  const agentId = event.PhysicalResourceId!;

  // Read existing metadata to preserve createdAt/status/breakerState.
  const existing = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
    }),
  );

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
          profileEntityId: { S: primary.profileEntityId },
          profileArn: { S: primary.profileArn },
          modelId: { S: primary.modelId },
          profiles: profilesListAttribute(profiles),
          agentType: { S: props.agentType },
          guardrailId: { S: props.guardrailId },
          status: { S: existing.Item?.['status']?.S ?? 'active' },
          breakerState: { S: existing.Item?.['breakerState']?.S ?? 'armed' },
          createdAt: { S: createdAt },
          updatedAt: { S: now },
        },
      },
    },
    ...profileLookupPuts(agentId, props.configName, props.roleName, profiles),
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

  // Delete any PROFILE# reverse-lookup rows for profiles this agent no longer has.
  const newEntityIds = new Set(profiles.map((p) => p.profileEntityId));
  const oldProfiles = await queryAgentProfiles(agentId);
  for (const oldEntityId of oldProfiles) {
    if (!newEntityIds.has(oldEntityId)) {
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: {
            pk: { S: `PROFILE#${oldEntityId}` },
            sk: { S: `AGENT#${agentId}` },
          },
        },
      });
    }
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

  // Resolve the full set of profile entity IDs from the table rather than the
  // event, so a drifted properties payload can't leave orphaned lookup rows.
  const profileEntityIds = await queryAgentProfiles(agentId);

  const transactItems: TransactWriteItem[] = [
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
          pk: { S: `CONFIG#${props.configName}` },
          sk: { S: `AGENT#${agentId}` },
        },
      },
    },
    ...profileEntityIds.map(
      (entityId): TransactWriteItem => ({
        Delete: {
          TableName: TABLE_NAME,
          Key: {
            pk: { S: `PROFILE#${entityId}` },
            sk: { S: `AGENT#${agentId}` },
          },
        },
      }),
    ),
  ];

  await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

  return { PhysicalResourceId: agentId };
}

/**
 * Return the profile entity IDs currently linked to an agent, read from the
 * agent's #META row.
 *
 * LIMITATION: the PROFILE# reverse-lookup rows are keyed by profile, not by
 * agent, so there is no way to enumerate all of an agent's profiles without a
 * GSI on agentId. This returns only the primary profile recorded in #META.
 * For the single-profile agents this stack deploys today that is exact. If
 * multi-profile agents are introduced, add an agentId GSI (or store the full
 * profile list on #META) and enumerate from that here, otherwise stale
 * PROFILE# rows for removed non-primary profiles will not be cleaned up.
 */
async function queryAgentProfiles(agentId: string): Promise<string[]> {
  const meta = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: `AGENT#${agentId}` }, sk: { S: '#META' } },
    }),
  );
  const primary = meta.Item?.['profileEntityId']?.S;
  return primary ? [primary] : [];
}
