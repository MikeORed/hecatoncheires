// Feature: multi-profile-identity, Property 3: Profile exclusivity enforcement
// Feature: multi-profile-identity, Property 6: Registry profile ordering is preserved

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ProfileExclusivityError } from '@hecaton/core';

import { AgentRegistryAdapter } from './agent-registry.adapter.js';

/**
 * Arbitrary for valid model binding labels matching /^[a-z][a-z0-9-]*$/, 1–30 chars.
 */
const arbLabel = fc
  .stringMatching(/^[a-z][a-z0-9-]*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/**
 * Arbitrary for valid Bedrock inference profile ARNs.
 */
const arbProfileArn = fc
  .tuple(
    fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
    fc.stringMatching(/^[0-9]{12}$/),
    fc.stringMatching(/^[a-z][a-z0-9-]*$/).filter((s) => s.length >= 3 && s.length <= 30),
  )
  .map(
    ([region, account, name]) =>
      `arn:aws:bedrock:${region}:${account}:inference-profile/${name}`,
  );

/**
 * Arbitrary for profile entity IDs.
 */
const arbProfileEntityId = fc
  .stringMatching(/^[a-z0-9-]+$/)
  .filter((s) => s.length >= 5 && s.length <= 40);

/**
 * Arbitrary for non-empty model IDs.
 */
const arbModelId = fc.string({ minLength: 1, maxLength: 80 });

/**
 * Arbitrary for a single registry profile record.
 */
const arbProfileRecord = fc.record({
  profileArn: arbProfileArn,
  profileEntityId: arbProfileEntityId,
  modelId: arbModelId,
  label: arbLabel,
});

/**
 * Arbitrary for an ordered array of 1–5 profile records with unique labels.
 */
const arbProfileRecords = fc
  .array(arbProfileRecord, { minLength: 1, maxLength: 5 })
  .filter((records) => {
    const labels = records.map((r) => r.label);
    return new Set(labels).size === labels.length;
  });

const PBT_CONFIG = { numRuns: 200 };

describe('AgentRegistryAdapter property tests', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: AgentRegistryAdapter;

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new AgentRegistryAdapter(mockClient as unknown as DynamoDBClient, 'test-table');
  });

  /**
   * **Validates: Requirements 7.1, 7.4**
   *
   * Property 6: Registry profile ordering is preserved
   *
   * For any ordered modelBindings array, when the registry record is constructed
   * from that array, the resulting profiles array SHALL have entries in the same
   * positional order — profiles[i].label === modelBindings[i].label and
   * profiles[i].modelId === modelBindings[i].modelId for all valid indices.
   */
  describe('Property 6: Registry profile ordering is preserved', () => {
    it('mapToRecord preserves positional ordering of profiles from DynamoDB list attribute', async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileRecords, async (profiles) => {
          mockClient.send.mockReset();

          // Construct a DynamoDB item with profiles in the given order
          const dynamoItem = {
            agentId: { S: 'agent-test' },
            configName: { S: 'test-config' },
            roleName: { S: 'hecaton-dev-test-config-agent-role' },
            agentType: { S: 'agentcore-managed' },
            guardrailId: { S: 'guardrail-abc' },
            status: { S: 'active' },
            breakerState: { S: 'armed' },
            profiles: {
              L: profiles.map((p) => ({
                M: {
                  profileArn: { S: p.profileArn },
                  profileEntityId: { S: p.profileEntityId },
                  modelId: { S: p.modelId },
                  label: { S: p.label },
                },
              })),
            },
          };

          mockClient.send.mockResolvedValueOnce({ Item: dynamoItem });

          const result = await adapter.getByAgentId('agent-test');

          expect(result).not.toBeNull();
          expect(result!.profiles).toHaveLength(profiles.length);

          for (let i = 0; i < profiles.length; i++) {
            expect(result!.profiles[i].label).toBe(profiles[i].label);
            expect(result!.profiles[i].modelId).toBe(profiles[i].modelId);
            expect(result!.profiles[i].profileArn).toBe(profiles[i].profileArn);
            expect(result!.profiles[i].profileEntityId).toBe(profiles[i].profileEntityId);
          }
        }),
        PBT_CONFIG,
      );
    });

    it('marshalRecord preserves positional ordering when writing profiles', async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileRecords, async (profiles) => {
          mockClient.send.mockReset();
          mockClient.send.mockResolvedValueOnce({});

          const record = {
            agentId: 'agent-write-test',
            configName: 'write-test-config',
            roleName: 'hecaton-dev-write-test-agent-role',
            agentType: 'agentcore-managed',
            guardrailId: 'guardrail-xyz',
            status: 'active',
            breakerState: 'armed',
            profiles,
          };

          await adapter.registerAgent(record);

          const command = mockClient.send.mock.calls[0][0];
          const transactItems = command.input.TransactItems;

          // Agent record is the last item in the transaction (after profile lock items)
          const agentPut = transactItems[profiles.length].Put;
          const marshaledProfiles = agentPut.Item.profiles.L;

          expect(marshaledProfiles).toHaveLength(profiles.length);

          for (let i = 0; i < profiles.length; i++) {
            expect(marshaledProfiles[i].M.label.S).toBe(profiles[i].label);
            expect(marshaledProfiles[i].M.modelId.S).toBe(profiles[i].modelId);
            expect(marshaledProfiles[i].M.profileArn.S).toBe(profiles[i].profileArn);
            expect(marshaledProfiles[i].M.profileEntityId.S).toBe(profiles[i].profileEntityId);
          }
        }),
        PBT_CONFIG,
      );
    });

    it('round-trip: marshal then unmarshal preserves profile order', async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileRecords, async (profiles) => {
          mockClient.send.mockReset();

          // Write the record
          mockClient.send.mockResolvedValueOnce({});

          const record = {
            agentId: 'agent-roundtrip',
            configName: 'roundtrip-config',
            roleName: 'hecaton-dev-roundtrip-agent-role',
            agentType: 'agentcore-managed',
            guardrailId: 'guardrail-rt',
            status: 'active',
            breakerState: 'armed',
            profiles,
          };

          await adapter.registerAgent(record);

          // Extract the marshaled agent item from the transaction
          const writeCommand = mockClient.send.mock.calls[0][0];
          const transactItems = writeCommand.input.TransactItems;
          const marshaledItem = transactItems[profiles.length].Put.Item;

          // Read it back by mocking getByAgentId to return the marshaled item
          mockClient.send.mockResolvedValueOnce({ Item: marshaledItem });

          const result = await adapter.getByAgentId('agent-roundtrip');

          expect(result).not.toBeNull();
          expect(result!.profiles).toHaveLength(profiles.length);

          for (let i = 0; i < profiles.length; i++) {
            expect(result!.profiles[i].label).toBe(profiles[i].label);
            expect(result!.profiles[i].modelId).toBe(profiles[i].modelId);
            expect(result!.profiles[i].profileArn).toBe(profiles[i].profileArn);
            expect(result!.profiles[i].profileEntityId).toBe(profiles[i].profileEntityId);
          }
        }),
        PBT_CONFIG,
      );
    });
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * Property 3: Profile exclusivity enforcement
   *
   * For any set of existing agent registry records and a new agent record whose
   * profiles array contains at least one profileArn already present in another
   * agent's records, the registry write operation SHALL reject the write and return
   * a ProfileExclusivityError identifying the conflicting agent and the colliding
   * profile ARN.
   */
  describe('Property 3: Profile exclusivity enforcement', () => {
    it('rejects registration with ProfileExclusivityError when any profile ARN collides with another agent', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbProfileRecords,
          fc.stringMatching(/^[a-z][a-z0-9-]*$/).filter((s) => s.length >= 3 && s.length <= 40),
          async (profiles, newAgentId) => {
            mockClient.send.mockReset();

            const existingAgentId = `existing-${newAgentId}`;
            fc.pre(existingAgentId !== newAgentId);

            // Always collide on the first profile — the adapter's findConflictingProfile
            // iterates profiles sequentially and returns the first conflict found.
            const collidingProfileArn = profiles[0].profileArn;

            const record = {
              agentId: newAgentId,
              configName: `config-${newAgentId}`,
              roleName: `hecaton-dev-${newAgentId}-agent-role`,
              agentType: 'agentcore-managed',
              guardrailId: 'guardrail-test',
              status: 'active',
              breakerState: 'armed',
              profiles,
            };

            // Build cancellation reasons: ConditionalCheckFailed at index 0
            const cancellationReasons = profiles.map((_, i) =>
              i === 0 ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' },
            );
            // One more 'None' for the agent record put item
            cancellationReasons.push({ Code: 'None' });

            const transactionError = Object.assign(new Error('Transaction cancelled'), {
              name: 'TransactionCanceledException',
              CancellationReasons: cancellationReasons,
            });

            // First call: TransactWriteItems fails with condition check
            // Second call: GetItem — findConflictingProfile checks profiles[0] first
            //   and finds it owned by existingAgentId
            mockClient.send
              .mockRejectedValueOnce(transactionError)
              .mockResolvedValueOnce({
                Item: {
                  pk: { S: `PROFILE_ARN#${collidingProfileArn}` },
                  sk: { S: '#LOCK' },
                  agentId: { S: existingAgentId },
                  profileArn: { S: collidingProfileArn },
                },
              });

            await expect(adapter.registerAgent(record)).rejects.toThrow(ProfileExclusivityError);
          },
        ),
        PBT_CONFIG,
      );
    });

    it('ProfileExclusivityError identifies the conflicting agent and the colliding profile ARN', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbProfileRecords,
          fc.stringMatching(/^[a-z][a-z0-9-]*$/).filter((s) => s.length >= 3 && s.length <= 40),
          fc.stringMatching(/^[a-z][a-z0-9-]*$/).filter((s) => s.length >= 3 && s.length <= 40),
          async (profiles, newAgentId, existingAgentId) => {
            mockClient.send.mockReset();
            fc.pre(existingAgentId !== newAgentId);

            // Collide on profiles[0] — adapter iterates sequentially
            const collidingProfileArn = profiles[0].profileArn;

            const record = {
              agentId: newAgentId,
              configName: `config-${newAgentId}`,
              roleName: `hecaton-dev-${newAgentId}-agent-role`,
              agentType: 'agentcore-managed',
              guardrailId: 'guardrail-test',
              status: 'active',
              breakerState: 'armed',
              profiles,
            };

            const cancellationReasons = profiles.map((_, i) =>
              i === 0 ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' },
            );
            cancellationReasons.push({ Code: 'None' });

            const transactionError = Object.assign(new Error('Transaction cancelled'), {
              name: 'TransactionCanceledException',
              CancellationReasons: cancellationReasons,
            });

            mockClient.send
              .mockRejectedValueOnce(transactionError)
              .mockResolvedValueOnce({
                Item: {
                  pk: { S: `PROFILE_ARN#${collidingProfileArn}` },
                  sk: { S: '#LOCK' },
                  agentId: { S: existingAgentId },
                  profileArn: { S: collidingProfileArn },
                },
              });

            try {
              await adapter.registerAgent(record);
              expect.fail('Expected ProfileExclusivityError but registration succeeded');
            } catch (err: unknown) {
              expect(err).toBeInstanceOf(ProfileExclusivityError);
              const exclusivityErr = err as ProfileExclusivityError;
              expect(exclusivityErr.conflictingAgent).toBe(existingAgentId);
              expect(exclusivityErr.conflictingProfileArn).toBe(collidingProfileArn);
            }
          },
        ),
        PBT_CONFIG,
      );
    });

    it('successful registration passes when no profile ARN collision exists', async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileRecords, async (profiles) => {
          mockClient.send.mockReset();
          mockClient.send.mockResolvedValueOnce({});

          const record = {
            agentId: 'agent-no-conflict',
            configName: 'config-no-conflict',
            roleName: 'hecaton-dev-no-conflict-agent-role',
            agentType: 'agentcore-managed',
            guardrailId: 'guardrail-ok',
            status: 'active',
            breakerState: 'armed',
            profiles,
          };

          // Should NOT throw — transaction succeeds
          await adapter.registerAgent(record);

          // Verify correct number of transaction items: N profile locks + 1 agent record
          const command = mockClient.send.mock.calls[0][0];
          const transactItems = command.input.TransactItems;
          expect(transactItems).toHaveLength(profiles.length + 1);

          // Each profile lock item uses the exclusivity condition
          for (let i = 0; i < profiles.length; i++) {
            const lockPut = transactItems[i].Put;
            expect(lockPut.ConditionExpression).toBe(
              'attribute_not_exists(pk) OR agentId = :aid',
            );
            expect(lockPut.ExpressionAttributeValues[':aid']).toEqual({
              S: record.agentId,
            });
            expect(lockPut.Item.pk).toEqual({
              S: `PROFILE_ARN#${profiles[i].profileArn}`,
            });
          }
        }),
        PBT_CONFIG,
      );
    });

    it('idempotent re-registration: condition allows same agent to re-register its own profiles', async () => {
      await fc.assert(
        fc.asyncProperty(arbProfileRecords, async (profiles) => {
          mockClient.send.mockReset();
          mockClient.send.mockResolvedValueOnce({});

          const agentId = 'agent-reregister';
          const record = {
            agentId,
            configName: 'config-reregister',
            roleName: 'hecaton-dev-reregister-agent-role',
            agentType: 'agentcore-managed',
            guardrailId: 'guardrail-re',
            status: 'active',
            breakerState: 'armed',
            profiles,
          };

          await adapter.registerAgent(record);

          // The condition 'attribute_not_exists(pk) OR agentId = :aid' means
          // the lock either doesn't exist (new profile) or belongs to this agent
          const command = mockClient.send.mock.calls[0][0];
          const transactItems = command.input.TransactItems;

          for (let i = 0; i < profiles.length; i++) {
            const lockPut = transactItems[i].Put;
            expect(lockPut.ExpressionAttributeValues[':aid'].S).toBe(agentId);
          }
        }),
        PBT_CONFIG,
      );
    });
  });
});
