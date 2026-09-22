import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture every command sent to DynamoDB so we can inspect the marshalled input.
const sendMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => {
  class TransactWriteItemsCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetItemCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class DynamoDBClient {
    send = sendMock;
  }
  return { DynamoDBClient, TransactWriteItemsCommand, GetItemCommand };
});

process.env.AGENT_REGISTRY_TABLE_NAME = 'hecaton-test-agent-registry';

// Import after the mock + env are in place.
const { handler } = await import('../../lib/lambda/registry-seed.handler.js');

/**
 * The exact ResourceProperties shape the AgentPolicyModulator construct sends:
 * profile data lives in a `profiles` array, NOT flat scalar fields. This is the
 * contract that drifted and broke a live deploy — the handler read flat
 * `profileEntityId`/`profileArn`/`modelId`, got undefined, and DynamoDB threw
 * "Cannot read properties of undefined (reading '0')" while marshalling.
 */
function constructProps(overrides: Record<string, unknown> = {}) {
  return {
    configName: 'test-managed',
    roleName: 'hecaton-dev-test-managed-agent-role',
    agentType: 'agentcore-managed',
    guardrailId: 'gr-abc123',
    profiles: [
      {
        profileEntityId: 'profile-entity-1',
        profileArn:
          'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/profile-entity-1',
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        label: 'default',
      },
    ],
    ...overrides,
  };
}

/** Recursively find any DynamoDB AttributeValue whose `S` is undefined. */
function findUndefinedStringAttrs(node: unknown, path = ''): string[] {
  const bad: string[] = [];
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (key === 'S' && value === undefined) {
        bad.push(here);
      } else {
        bad.push(...findUndefinedStringAttrs(value, here));
      }
    }
  }
  return bad;
}

/** Collect every Put/Delete Item/Key across all captured TransactWriteItems calls. */
function allTransactItems() {
  const items: unknown[] = [];
  for (const call of sendMock.mock.calls) {
    const input = (call[0] as { input?: { TransactItems?: unknown[] } }).input;
    if (input?.TransactItems) items.push(...input.TransactItems);
  }
  return items;
}

describe('registry-seed handler — construct/handler contract', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('onCreate marshals no undefined string attributes from the construct payload', async () => {
    await handler({
      RequestType: 'Create',
      ResourceProperties: constructProps(),
    } as never);

    const items = allTransactItems();
    expect(items.length).toBeGreaterThan(0);
    const bad = findUndefinedStringAttrs(items);
    expect(bad, `undefined string attributes at: ${bad.join(', ')}`).toEqual([]);
  });

  it('onCreate writes the primary profile onto the #META record', async () => {
    await handler({
      RequestType: 'Create',
      ResourceProperties: constructProps(),
    } as never);

    const meta = allTransactItems().find(
      (i) => (i as { Put?: { Item?: { sk?: { S?: string } } } }).Put?.Item?.sk?.S === '#META',
    ) as { Put: { Item: Record<string, { S?: string }> } } | undefined;

    expect(meta).toBeDefined();
    expect(meta!.Put.Item.profileEntityId.S).toBe('profile-entity-1');
    expect(meta!.Put.Item.profileArn.S).toBe(
      'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/profile-entity-1',
    );
    expect(meta!.Put.Item.modelId.S).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0');
  });

  it('onCreate writes a profiles List attribute on #META (shape AgentRegistryAdapter reads)', async () => {
    await handler({
      RequestType: 'Create',
      ResourceProperties: constructProps(),
    } as never);

    const meta = allTransactItems().find(
      (i) => (i as { Put?: { Item?: { sk?: { S?: string } } } }).Put?.Item?.sk?.S === '#META',
    ) as { Put: { Item: Record<string, unknown> } } | undefined;

    expect(meta).toBeDefined();
    // Must be a DynamoDB List of Maps matching mapProfiles: profileArn,
    // profileEntityId, modelId, label. An empty/missing list makes grantShape
    // scope the operating policy to no profile ARNs.
    const profilesAttr = meta!.Put.Item.profiles as { L?: Array<{ M: Record<string, { S: string }> }> };
    expect(profilesAttr.L).toBeDefined();
    expect(profilesAttr.L!.length).toBe(1);
    const entry = profilesAttr.L![0].M;
    expect(entry.profileArn.S).toBe(
      'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/profile-entity-1',
    );
    expect(entry.profileEntityId.S).toBe('profile-entity-1');
    expect(entry.modelId.S).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0');
    expect(entry.label.S).toBe('default');
  });

  it('onCreate writes one PROFILE# reverse-lookup row per profile', async () => {
    await handler({
      RequestType: 'Create',
      ResourceProperties: constructProps({
        profiles: [
          {
            profileEntityId: 'entity-a',
            profileArn: 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/entity-a',
            modelId: 'model-a',
            label: 'primary',
          },
          {
            profileEntityId: 'entity-b',
            profileArn: 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/entity-b',
            modelId: 'model-b',
            label: 'secondary',
          },
        ],
      }),
    } as never);

    const profileRows = allTransactItems().filter((i) =>
      (i as { Put?: { Item?: { pk?: { S?: string } } } }).Put?.Item?.pk?.S?.startsWith('PROFILE#'),
    );
    const pks = profileRows.map(
      (i) => (i as { Put: { Item: { pk: { S: string } } } }).Put.Item.pk.S,
    );
    expect(pks).toContain('PROFILE#entity-a');
    expect(pks).toContain('PROFILE#entity-b');
    expect(findUndefinedStringAttrs(profileRows)).toEqual([]);
  });

  it('rejects a legacy flat payload (no profiles array) instead of marshalling undefined', async () => {
    await expect(
      handler({
        RequestType: 'Create',
        ResourceProperties: {
          configName: 'test-managed',
          roleName: 'hecaton-dev-test-managed-agent-role',
          agentType: 'agentcore-managed',
          guardrailId: 'gr-abc123',
          // profiles intentionally absent — the drifted contract
          profileEntityId: 'profile-entity-1',
          profileArn: 'arn:...',
          modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        },
      } as never),
    ).rejects.toThrow(/profiles must be a non-empty array/);

    expect(sendMock).not.toHaveBeenCalled();
  });
});
