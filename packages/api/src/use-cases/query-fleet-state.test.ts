import { describe, it, expect, vi } from 'vitest';
import type { GrantRecord } from '@hecaton/core';

import { queryFleetState } from './query-fleet-state.js';
import type { Dependencies } from '../shared/dependencies.js';
import type { AgentRegistryRecord } from '../ports/agent-registry.port.js';

function createMockDeps(overrides?: Partial<Dependencies>): Dependencies {
  return {
    grantLedger: {
      putGrant: vi.fn().mockResolvedValue(undefined),
      deleteGrant: vi.fn().mockResolvedValue(undefined),
      queryGrantsByConfig: vi.fn().mockResolvedValue([]),
      scanAllConfigs: vi.fn().mockResolvedValue([]),
    },
    operatingPolicy: {
      writePolicy: vi.fn().mockResolvedValue(undefined),
      deletePolicy: vi.fn().mockResolvedValue(undefined),
      getDefaultPolicyName: vi.fn().mockReturnValue('hecaton-operating-policy'),
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    agentRegistry: {
      getByAgentId: vi.fn().mockResolvedValue(null),
      getByProfileArn: vi.fn().mockResolvedValue(null),
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    agentId: '01912345-6789-7abc-8def-0123456789aa',
    configName: 'agent-a',
    roleName: 'hecaton-dev-agent-a-agent-role',
    profiles: [
      {
        profileArn: 'arn:profile-a',
        profileEntityId: 'profile-entity-a',
        modelId: 'anthropic.claude-3',
        label: 'primary',
      },
    ],
    agentType: 'AgentCore Managed',
    guardrailId: 'gid-a',
    status: 'active',
    breakerState: 'armed',
    ...overrides,
  };
}

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: '01912345-6789-7abc-8def-0123456789ab',
    configName: 'agent-a',
    shapeName: 'core-invocation',
    parameters: { inferenceProfileArn: 'arn:test' },
    grantedAt: '2026-07-20T12:00:00.000Z',
    grantedBy: 'admin',
    ...overrides,
  };
}

describe('queryFleetState', () => {
  it('returns empty array when no agents exist', async () => {
    const deps = createMockDeps();
    const result = await queryFleetState(deps);
    expect(result).toEqual([]);
  });

  it('returns agents with their grants matched by configName', async () => {
    const agentA = makeAgent({ agentId: 'id-a', configName: 'agent-a' });
    const agentB = makeAgent({
      agentId: 'id-b',
      configName: 'agent-b',
      agentType: 'OpenClaw',
      profiles: [
        {
          profileArn: 'arn:profile-b',
          profileEntityId: 'profile-entity-b',
          modelId: 'anthropic.claude-3-haiku',
          label: 'primary',
        },
      ],
    });

    const grantA = makeGrant({ configName: 'agent-a', grantId: 'grant-1' });
    const grantB = makeGrant({
      configName: 'agent-b',
      grantId: 'grant-2',
      shapeName: 's3-prefix-read',
    });

    const deps = createMockDeps({
      agentRegistry: {
        getByAgentId: vi.fn().mockResolvedValue(null),
        getByProfileArn: vi.fn().mockResolvedValue(null),
        getByProfileEntityId: vi.fn().mockResolvedValue(null),
        getByConfigName: vi.fn().mockResolvedValue(null),
        updateBreakerState: vi.fn().mockResolvedValue(undefined),
        listAll: vi.fn().mockResolvedValue([agentA, agentB]),
      },
      grantLedger: {
        putGrant: vi.fn().mockResolvedValue(undefined),
        deleteGrant: vi.fn().mockResolvedValue(undefined),
        queryGrantsByConfig: vi.fn().mockResolvedValue([]),
        scanAllConfigs: vi.fn().mockResolvedValue([grantA, grantB]),
      },
    });

    const result = await queryFleetState(deps);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      agentId: 'id-a',
      configName: 'agent-a',
      agentType: 'AgentCore Managed',
      modelIds: ['anthropic.claude-3'],
      status: 'active',
      breakerState: 'armed',
      grants: [grantA],
    });
    expect(result[1]).toEqual({
      agentId: 'id-b',
      configName: 'agent-b',
      agentType: 'OpenClaw',
      modelIds: ['anthropic.claude-3-haiku'],
      status: 'active',
      breakerState: 'armed',
      grants: [grantB],
    });
  });

  it('returns agents with empty grants when ledger has no matching grants', async () => {
    const agent = makeAgent({ configName: 'agent-a' });

    const deps = createMockDeps({
      agentRegistry: {
        getByAgentId: vi.fn().mockResolvedValue(null),
        getByProfileArn: vi.fn().mockResolvedValue(null),
        getByProfileEntityId: vi.fn().mockResolvedValue(null),
        getByConfigName: vi.fn().mockResolvedValue(null),
        updateBreakerState: vi.fn().mockResolvedValue(undefined),
        listAll: vi.fn().mockResolvedValue([agent]),
      },
    });

    const result = await queryFleetState(deps);

    expect(result).toHaveLength(1);
    expect(result[0].grants).toEqual([]);
  });

  it('assigns multiple grants to the same agent', async () => {
    const agent = makeAgent({ configName: 'agent-a' });
    const grant1 = makeGrant({ configName: 'agent-a', grantId: 'g1' });
    const grant2 = makeGrant({ configName: 'agent-a', grantId: 'g2', shapeName: 's3-prefix-read' });

    const deps = createMockDeps({
      agentRegistry: {
        getByAgentId: vi.fn().mockResolvedValue(null),
        getByProfileArn: vi.fn().mockResolvedValue(null),
        getByProfileEntityId: vi.fn().mockResolvedValue(null),
        getByConfigName: vi.fn().mockResolvedValue(null),
        updateBreakerState: vi.fn().mockResolvedValue(undefined),
        listAll: vi.fn().mockResolvedValue([agent]),
      },
      grantLedger: {
        putGrant: vi.fn().mockResolvedValue(undefined),
        deleteGrant: vi.fn().mockResolvedValue(undefined),
        queryGrantsByConfig: vi.fn().mockResolvedValue([]),
        scanAllConfigs: vi.fn().mockResolvedValue([grant1, grant2]),
      },
    });

    const result = await queryFleetState(deps);

    expect(result[0].grants).toHaveLength(2);
    expect(result[0].grants).toEqual([grant1, grant2]);
  });

  it('ignores grants for configNames without a matching agent', async () => {
    const agent = makeAgent({ configName: 'agent-a' });
    const orphanGrant = makeGrant({ configName: 'unknown-agent', grantId: 'g-orphan' });

    const deps = createMockDeps({
      agentRegistry: {
        getByAgentId: vi.fn().mockResolvedValue(null),
        getByProfileArn: vi.fn().mockResolvedValue(null),
        getByProfileEntityId: vi.fn().mockResolvedValue(null),
        getByConfigName: vi.fn().mockResolvedValue(null),
        updateBreakerState: vi.fn().mockResolvedValue(undefined),
        listAll: vi.fn().mockResolvedValue([agent]),
      },
      grantLedger: {
        putGrant: vi.fn().mockResolvedValue(undefined),
        deleteGrant: vi.fn().mockResolvedValue(undefined),
        queryGrantsByConfig: vi.fn().mockResolvedValue([]),
        scanAllConfigs: vi.fn().mockResolvedValue([orphanGrant]),
      },
    });

    const result = await queryFleetState(deps);

    expect(result).toHaveLength(1);
    expect(result[0].grants).toEqual([]);
  });
});
