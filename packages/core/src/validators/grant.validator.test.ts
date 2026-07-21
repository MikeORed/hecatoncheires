import { describe, it, expect } from 'vitest';

import { validateGrant } from './grant.validator.js';
import type { GrantRecord, ShapeTemplate } from '../types/index.js';
import {
  ShapeNotFoundError,
  InvalidShapeParametersError,
  ValidationError,
} from '../errors/index.js';

const testCatalog: readonly ShapeTemplate[] = [
  {
    shapeName: 'core-invocation',
    riskTier: 'medium',
    requiredParameters: ['inferenceProfileArn'],
    statements: [
      {
        Effect: 'Allow',
        Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        Resource: '${inferenceProfileArn}',
      },
    ],
  },
  {
    shapeName: 's3-prefix-read',
    riskTier: 'low',
    requiredParameters: ['bucketArn', 'prefix'],
    statements: [
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: '${bucketArn}/${prefix}*',
      },
    ],
  },
];

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    configName: 'test-agent',
    shapeName: 'core-invocation',
    parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123456789012:profile/test' },
    grantedAt: '2024-01-01T00:00:00Z',
    grantedBy: 'admin',
    ...overrides,
  };
}

describe('validateGrant', () => {
  it('returns valid for a correct grant', () => {
    const result = validateGrant(makeGrant(), testCatalog);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for a grant with expiresAt > grantedAt', () => {
    const grant = makeGrant({ expiresAt: '2024-06-01T00:00:00Z' });
    const result = validateGrant(grant, testCatalog);
    expect(result).toEqual({ valid: true });
  });

  it('returns ShapeNotFoundError for unknown shapeName', () => {
    const grant = makeGrant({ shapeName: 'nonexistent-shape' });
    const result = validateGrant(grant, testCatalog);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(ShapeNotFoundError);
      expect(result.error.code).toBe('SHAPE_NOT_FOUND');
      expect(result.error.details?.shapeName).toBe('nonexistent-shape');
    }
  });

  it('returns InvalidShapeParametersError when required parameters are missing', () => {
    const grant = makeGrant({
      shapeName: 's3-prefix-read',
      parameters: { bucketArn: 'arn:aws:s3:::my-bucket' },
    });
    const result = validateGrant(grant, testCatalog);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(InvalidShapeParametersError);
      expect(result.error.code).toBe('INVALID_SHAPE_PARAMETERS');
      expect(result.error.details?.missingParameters).toEqual(['prefix']);
    }
  });

  it('returns ValidationError when expiresAt equals grantedAt', () => {
    const grant = makeGrant({
      expiresAt: '2024-01-01T00:00:00Z',
      grantedAt: '2024-01-01T00:00:00Z',
    });
    const result = validateGrant(grant, testCatalog);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns ValidationError when expiresAt is before grantedAt', () => {
    const grant = makeGrant({
      grantedAt: '2024-06-01T00:00:00Z',
      expiresAt: '2024-01-01T00:00:00Z',
    });
    const result = validateGrant(grant, testCatalog);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.details?.grantedAt).toBe('2024-06-01T00:00:00Z');
      expect(result.error.details?.expiresAt).toBe('2024-01-01T00:00:00Z');
    }
  });

  it('checks shape existence before parameter validation', () => {
    const grant = makeGrant({ shapeName: 'unknown', parameters: {} });
    const result = validateGrant(grant, testCatalog);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(ShapeNotFoundError);
    }
  });
});
