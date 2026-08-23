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
    },
    busEmitter: {
      emit: vi.fn().mockResolvedValue(undefined),
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
    it('returns 200 with empty record when no grants exist', async () => {
      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({});
    });

    it('returns 200 with grouped grants', async () => {
      const mockDeps = createMockDeps();
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
      expect(Object.keys(parsed.data)).toEqual(['agent-a', 'agent-b']);
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
