import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InternalError } from '@hecaton/core';

import { handler } from './onboard-agent.http.js';

vi.mock('../shared/dependencies.js', () => ({
  getDependencies: vi.fn(),
  resetDependencies: vi.fn(),
}));

import { getDependencies } from '../shared/dependencies.js';

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/onboard',
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

describe('onboard-agent.http handler', () => {
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
            fc.constant({ configName: 'UPPER-CASE' }), // invalid configName + missing roleName
            fc.constant({ configName: 'valid-config', roleName: '' }), // empty roleName
            fc.record({
              configName: fc.constantFrom('123-bad', '-leading-dash', 'CAPS', 'a'),
              roleName: fc.constant('role'),
            }), // various invalid configName shapes
            fc.record({
              configName: fc.constant('valid-config'),
              roleName: fc.constant(123 as unknown as string),
            }), // wrong type for roleName
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
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid configName', async () => {
      const result = await handler(
        makeEvent({
          configName: 'UPPER-CASE',
          roleName: 'test-role',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty roleName', async () => {
      const result = await handler(
        makeEvent({
          configName: 'valid-config',
          roleName: '',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('happy path', () => {
    it('returns 201 with confirmation on success', async () => {
      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
        }),
      );

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.configName).toBe('test-agent');
    });
  });

  describe('error mapping', () => {
    it('maps domain errors to correct HTTP status', async () => {
      const mockDeps = createMockDeps();
      mockDeps.busEmitter.emit.mockRejectedValue(
        new InternalError('EventBridge unavailable', {}),
      );
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 for non-domain errors', async () => {
      const mockDeps = createMockDeps();
      mockDeps.operatingPolicy.writePolicy.mockRejectedValue(new Error('random'));
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
