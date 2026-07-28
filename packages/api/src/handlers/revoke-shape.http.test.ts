import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InternalError } from '@hecaton/core';

import { handler } from './revoke-shape.http.js';

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
    path: '/revocations',
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

describe('revoke-shape.http handler', () => {
  beforeEach(() => {
    vi.mocked(getDependencies).mockReturnValue(createMockDeps());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Property 9: Validation failure produces 400 VALIDATION_ERROR', () => {
    it('returns 400 for missing required fields', async () => {
      const result = await handler(makeEvent({}));
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid grantId pattern', async () => {
      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
          grantId: 'not-a-uuid-v7',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid configName', async () => {
      const result = await handler(
        makeEvent({
          configName: '123-bad',
          roleName: 'test-role',
          grantId: '01912345-6789-7abc-8def-0123456789ab',
        }),
      );
      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('happy path', () => {
    it('returns 200 with revocation confirmation', async () => {
      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
          grantId: '01912345-6789-7abc-8def-0123456789ab',
        }),
      );

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data.operation).toBe('revoked');
    });
  });

  describe('error mapping', () => {
    it('returns 500 for unknown errors', async () => {
      const mockDeps = createMockDeps();
      mockDeps.grantLedger.deleteGrant.mockRejectedValue(new Error('unexpected'));
      vi.mocked(getDependencies).mockReturnValue(mockDeps);

      const result = await handler(
        makeEvent({
          configName: 'test-agent',
          roleName: 'test-role',
          grantId: '01912345-6789-7abc-8def-0123456789ab',
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
          configName: 'test-agent',
          roleName: 'test-role',
          grantId: '01912345-6789-7abc-8def-0123456789ab',
        }),
      );

      expect(result.statusCode).toBe(500);
      const parsed = JSON.parse(result.body);
      expect(parsed.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
