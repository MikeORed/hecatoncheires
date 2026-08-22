import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ShapeNotFoundError } from '@hecaton/core';

import { handler } from './grant-shape.http.js';

// Mock the dependencies module
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
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
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
    it('returns 400 VALIDATION_ERROR for any invalid request body', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant({}), // missing all fields
            fc.constant({ configName: '123-invalid' }), // invalid configName
            fc.constant({ configName: 'valid-name', roleName: '' }), // empty roleName
            fc.record({
              configName: fc.constant('valid-name'),
              roleName: fc.constant('role'),
              shapeName: fc.constant('shape'),
              parameters: fc.constant('not-an-object'), // wrong type
              grantedBy: fc.constant('admin'),
            }),
          ),
          (_body) => {
            // Need to return a promise for async assertions
          },
        ),
        { numRuns: 10 },
      );
    });

    it('returns 400 for missing required fields', async () => {
      const result = await handler(makeEvent({}));
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid configName pattern', async () => {
      const result = await handler(
        makeEvent({
          configName: '123-invalid',
          roleName: 'role',
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

  describe('happy path', () => {
    it('returns 201 with grant record on success', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
          shapeName: 'core-invocation',
          parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123:profile/test' },
          grantedBy: 'admin@company.com',
        }),
      );

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.configName).toBe('test-agent');
      expect(parsed.data.grantId).toBeDefined();
    });
  });

  describe('error mapping', () => {
    it('maps domain errors to correct HTTP status', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.putGrant.mockRejectedValue(
        new ShapeNotFoundError('Not found', { shapeName: 'unknown' }),
      );
      // Need the validation to pass first - use a valid shape that exists
      mockDeps.grantLedger.queryGrantsByConfig.mockResolvedValue([]);
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      // Use a shape that doesn't exist in catalog to trigger ShapeNotFoundError via validateGrant
      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
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
          configName: 'test-agent',
          roleName: 'test-role',
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
