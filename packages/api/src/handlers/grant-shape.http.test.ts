import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

import { handler } from './grant-shape.http.js';

// Mock the dependencies module
vi.mock('../shared/dependencies.js', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDependencies } from '../shared/dependencies.js';

const TEST_AGENT_ID = '01912345-6789-7abc-8def-0123456789ab';

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
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
        agentId: TEST_AGENT_ID,
        configName: 'test-agent',
        roleName: 'test-role',
        profiles: [
          {
            profileArn: 'arn:aws:bedrock:us-east-1:123:profile/test',
            profileEntityId: 'profile-123',
            modelId: 'anthropic.claude-3',
            label: 'primary',
          },
        ],
        agentType: 'AgentCore Managed',
        guardrailId: 'gr-123',
        status: 'active',
        breakerState: 'armed',
      }),
      getByProfileArn: vi.fn().mockResolvedValue(null),
      getByProfileEntityId: vi.fn().mockResolvedValue(null),
      getByConfigName: vi.fn().mockResolvedValue(null),
      updateBreakerState: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('grant-shape.http handler', () => {
  beforeEach(() => {
    vi.mocked(getDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Property 9: Validation failure produces 400 VALIDATION_ERROR', () => {
    it('returns 400 VALIDATION_ERROR for any invalid request body', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant({}), // missing all fields
            fc.constant({ agentId: 'not-a-uuid' }), // invalid uuid
            fc.constant({ agentId: TEST_AGENT_ID, shapeName: '' }), // empty shapeName
            fc.record({
              agentId: fc.constant(TEST_AGENT_ID),
              shapeName: fc.constant('shape'),
              parameters: fc.constant('not-an-object'), // wrong type
              grantedBy: fc.constant('admin'),
            }),
          ),
          async (body) => {
            const result = await handler(makeEvent(body));
            expect(result.statusCode).toBe(400);
            const parsed = JSON.parse(result.body);
            expect(parsed.success).toBe(false);
            expect(parsed.error.code).toBe('VALIDATION_ERROR');
          },
        ),
        { numRuns: 20 },
      );
    });

    it('returns 400 for missing required fields', async () => {
      const result = await handler(makeEvent({}));
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid agentId format', async () => {
      const result = await handler(
        makeEvent({
          agentId: 'not-a-valid-uuid',
          shapeName: 'shape',
          parameters: {},
          grantedBy: 'admin',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('agentId resolution', () => {
    it('returns 404 AGENT_NOT_FOUND when agentId is not in registry', async () => {
      const mockDeps = createMockDeps();
      mockDeps.agentRegistry.getByAgentId.mockResolvedValue(null);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(result.statusCode).toBe(404);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('AGENT_NOT_FOUND');
      expect(parsed.error.message).toContain(TEST_AGENT_ID);
    });

    it('calls getByAgentId with the agentId from the request', async () => {
      const mockDeps = createMockDeps();
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(mockDeps.agentRegistry.getByAgentId).toHaveBeenCalledWith(TEST_AGENT_ID);
    });
  });

  describe('happy path', () => {
    it('returns 201 with grant record including agentId on success', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.agentId).toBe(TEST_AGENT_ID);
      expect(parsed.data.configName).toBe('test-agent');
      expect(parsed.data.grantId).toBeDefined();
    });

    it('uses resolved roleName for policy write', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(mockDeps.operatingPolicy.writePolicy).toHaveBeenCalledWith(
        'test-role',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('error mapping', () => {
    it('maps domain errors to correct HTTP status', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      // Use a shape that doesn't exist in catalog to trigger ShapeNotFoundError via validateGrant
      const result = await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'nonexistent-shape',
          parameters: {},
          grantedBy: 'admin@company.com',
        }),
      );

      expect(result.statusCode).toBe(404);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('SHAPE_NOT_FOUND');
    });

    it('returns 500 for unknown errors', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.putGrant.mockRejectedValue(new Error('unexpected'));
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          agentId: TEST_AGENT_ID,
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
