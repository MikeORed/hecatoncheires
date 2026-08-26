import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InternalError } from '@hecaton/core';

import { handler } from './query-fleet-state.http.js';

vi.mock('../shared/dependencies.js', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDependencies } from '../shared/dependencies.js';

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/fleet-state',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  };
}

function createMockDeps() {
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
      registerAgent: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('query-fleet-state.http handler', () => {
  beforeEach(() => {
    vi.mocked(getDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('returns 200 with empty array when no agents exist', async () => {
      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual([]);
    });

    it('returns 200 with agents and their grants', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.listAll.mockResolvedValue([
        {
          agentId: '01912345-6789-7abc-8def-0123456789aa',
          configName: 'agent-a',
          roleName: 'hecaton-dev-agent-a-agent-role',
          profiles: [
            {
              profileArn: 'arn:profile-a',
              profileEntityId: 'profile-a',
              modelId: 'anthropic.claude-3',
              label: 'primary',
            },
          ],
          agentType: 'AgentCore Managed',
          guardrailId: 'gid-a',
          status: 'active',
          breakerState: 'armed',
        },
        {
          agentId: '01912345-6789-7abc-8def-0123456789bb',
          configName: 'agent-b',
          roleName: 'hecaton-dev-agent-b-agent-role',
          profiles: [
            {
              profileArn: 'arn:profile-b',
              profileEntityId: 'profile-b',
              modelId: 'anthropic.claude-3',
              label: 'primary',
            },
          ],
          agentType: 'OpenClaw',
          guardrailId: 'gid-b',
          status: 'active',
          breakerState: 'armed',
        },
      ]);
      mockDeps.grantLedger.scanAllConfigs.mockResolvedValue([
        {
          grantId: '01912345-6789-7abc-8def-0123456789ab',
          configName: 'agent-a',
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:test' },
          grantedAt: '2026-07-20T12:00:00.000Z',
          grantedBy: 'admin',
        },
        {
          grantId: '01912345-6789-7abc-8def-0123456789cd',
          configName: 'agent-b',
          shapeName: 's3-prefix-read',
          parameters: { bucketArn: 'arn:s3', prefix: 'data/' },
          grantedAt: '2026-07-20T12:00:00.000Z',
          grantedBy: 'admin',
        },
      ]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].agentId).toBe('01912345-6789-7abc-8def-0123456789aa');
      expect(parsed.data[0].configName).toBe('agent-a');
      expect(parsed.data[0].agentType).toBe('AgentCore Managed');
      expect(parsed.data[0].modelIds).toEqual(['anthropic.claude-3']);
      expect(parsed.data[0].status).toBe('active');
      expect(parsed.data[0].breakerState).toBe('armed');
      expect(parsed.data[0].grants).toHaveLength(1);
      expect(parsed.data[1].agentId).toBe('01912345-6789-7abc-8def-0123456789bb');
      expect(parsed.data[1].configName).toBe('agent-b');
      expect(parsed.data[1].modelIds).toEqual(['anthropic.claude-3']);
      expect(parsed.data[1].grants).toHaveLength(1);
    });

    it('returns agents with empty grants when no grants exist', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.listAll.mockResolvedValue([
        {
          agentId: '01912345-6789-7abc-8def-0123456789aa',
          configName: 'agent-a',
          roleName: 'hecaton-dev-agent-a-agent-role',
          profiles: [
            {
              profileArn: 'arn:profile-a',
              profileEntityId: 'profile-a',
              modelId: 'anthropic.claude-3',
              label: 'primary',
            },
          ],
          agentType: 'AgentCore Managed',
          guardrailId: 'gid-a',
          status: 'active',
          breakerState: 'armed',
        },
      ]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.data[0].grants).toEqual([]);
    });
  });

  describe('error mapping', () => {
    it('maps domain errors to correct HTTP status', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.scanAllConfigs.mockRejectedValue(
        new InternalError('DynamoDB timeout', {}),
      );
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 for non-domain errors', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.scanAllConfigs.mockRejectedValue(new Error('random'));
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
