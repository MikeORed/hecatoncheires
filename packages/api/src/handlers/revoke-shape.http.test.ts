import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InternalError } from '@hecaton/core';

import { handler } from './revoke-shape.http.js';

vi.mock('../shared/dependencies.js', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDependencies } from '../shared/dependencies.js';

const VALID_AGENT_ID = '01912345-6789-7abc-8def-0123456789ab';

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'DELETE',
    isBase64Encoded: false,
    path: '/grants',
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
      getByAgentId: vi.fn().mockResolvedValue({
        agentId: VALID_AGENT_ID,
        configName: 'test-agent',
        roleName: 'test-role',
        profileEntityId: 'profile-123',
        profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/profile-123',
        agentType: 'AgentCore Managed',
        modelId: 'anthropic.claude-3-sonnet',
        guardrailId: 'guard-1',
        status: 'active',
        breakerState: 'armed',
      }),
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('revoke-shape.http handler', () => {
  beforeEach(() => {
    vi.mocked(getDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validation', () => {
    it('returns 400 VALIDATION_ERROR for missing required fields', async () => {
      const result = await handler(makeEvent({}));
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid agentId format', async () => {
      const result = await handler(
        makeEvent({
          agentId: 'not-a-uuid',
          grantId: 'some-grant',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty grantId', async () => {
      const result = await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: '',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('agent resolution', () => {
    it('returns 404 AGENT_NOT_FOUND when registry lookup returns null', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByAgentId.mockResolvedValue(null);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(result.statusCode).toBe(404);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('AGENT_NOT_FOUND');
      expect(parsed.error.message).toContain(VALID_AGENT_ID);
    });

    it('calls agentRegistry.getByAgentId with the provided agentId', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(mockDeps.agentRegistry.getByAgentId).toHaveBeenCalledWith(VALID_AGENT_ID);
    });
  });

  describe('happy path', () => {
    it('returns 200 with revocation confirmation including agentId', async () => {
      const result = await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.operation).toBe('revoked');
      expect(parsed.data.agentId).toBe(VALID_AGENT_ID);
      expect(parsed.data.configName).toBe('test-agent');
      expect(parsed.data.grantId).toBe('grant-001');
    });

    it('passes resolved configName and roleName to revokeShape use-case', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(mockDeps.grantLedger.deleteGrant).toHaveBeenCalledWith('test-agent', 'grant-001');
      expect(mockDeps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('error mapping', () => {
    it('returns 500 for unknown errors', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.deleteGrant.mockRejectedValue(new Error('unexpected'));
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });

    it('maps domain InternalError to 500', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.deleteGrant.mockRejectedValue(
        new InternalError('DynamoDB timeout', {}),
      );
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: VALID_AGENT_ID,
          grantId: 'grant-001',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
