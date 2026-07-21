import { describe, it, expect } from 'vitest';

import { validateGrantSet } from './grant-set.validator.js';
import { GrantConflictError } from '../errors/index.js';
import type { GrantRecord } from '../types/index.js';

describe('validateGrantSet', () => {
  const baseGrant: GrantRecord = {
    grantId: '0190d4a1-7e00-7000-8000-000000000001',
    configName: 'my-agent',
    shapeName: 'core-invocation',
    parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-east-1:123456789012:profile/test' },
    grantedAt: '2024-01-01T00:00:00Z',
    grantedBy: 'admin',
  };

  it('returns valid for an empty grant set', () => {
    const result = validateGrantSet([]);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for a single grant', () => {
    const result = validateGrantSet([baseGrant]);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for grants with different configNames', () => {
    const grants: GrantRecord[] = [
      baseGrant,
      { ...baseGrant, configName: 'other-agent', grantId: '0190d4a1-7e00-7000-8000-000000000002' },
    ];
    const result = validateGrantSet(grants);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for grants with different shapeNames', () => {
    const grants: GrantRecord[] = [
      baseGrant,
      { ...baseGrant, shapeName: 's3-prefix-read', grantId: '0190d4a1-7e00-7000-8000-000000000002' },
    ];
    const result = validateGrantSet(grants);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for grants with different parameters', () => {
    const grants: GrantRecord[] = [
      baseGrant,
      {
        ...baseGrant,
        parameters: { inferenceProfileArn: 'arn:aws:bedrock:us-west-2:123456789012:profile/other' },
        grantId: '0190d4a1-7e00-7000-8000-000000000002',
      },
    ];
    const result = validateGrantSet(grants);
    expect(result).toEqual({ valid: true });
  });

  it('detects duplicate grants with identical configName, shapeName, and parameters', () => {
    const grants: GrantRecord[] = [
      baseGrant,
      {
        ...baseGrant,
        grantId: '0190d4a1-7e00-7000-8000-000000000002',
        grantedAt: '2024-02-01T00:00:00Z',
        grantedBy: 'other-admin',
      },
    ];
    const result = validateGrantSet(grants);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(GrantConflictError);
      expect(result.error.code).toBe('GRANT_CONFLICT');
      expect(result.error.details).toMatchObject({
        configName: 'my-agent',
        shapeName: 'core-invocation',
      });
    }
  });

  it('detects duplicates regardless of parameter key order', () => {
    const grants: GrantRecord[] = [
      {
        ...baseGrant,
        parameters: { bucketArn: 'arn:aws:s3:::my-bucket', prefix: 'data/' },
      },
      {
        ...baseGrant,
        grantId: '0190d4a1-7e00-7000-8000-000000000002',
        parameters: { prefix: 'data/', bucketArn: 'arn:aws:s3:::my-bucket' },
      },
    ];
    const result = validateGrantSet(grants);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeInstanceOf(GrantConflictError);
    }
  });

  it('returns valid for grants that differ only by an extra parameter key', () => {
    const grants: GrantRecord[] = [
      {
        ...baseGrant,
        parameters: { bucketArn: 'arn:aws:s3:::my-bucket' },
      },
      {
        ...baseGrant,
        grantId: '0190d4a1-7e00-7000-8000-000000000002',
        parameters: { bucketArn: 'arn:aws:s3:::my-bucket', prefix: 'data/' },
      },
    ];
    const result = validateGrantSet(grants);
    expect(result).toEqual({ valid: true });
  });
});
