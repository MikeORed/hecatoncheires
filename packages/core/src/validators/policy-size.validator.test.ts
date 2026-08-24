import { describe, it, expect } from 'vitest';
import { validatePolicySize } from './policy-size.validator.js';
import { AWS_INLINE_POLICY_SIZE_LIMIT } from '../constants/limits.js';
import type { IamPolicyDocument } from '../types/index.js';

describe('validatePolicySize', () => {
  const smallPolicy: IamPolicyDocument = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::my-bucket/*',
      },
    ],
  };

  it('returns valid for a policy within the size limit', () => {
    const result = validatePolicySize(smallPolicy);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid for a policy exactly at the size limit', () => {
    // Build a policy whose JSON serialization is exactly AWS_INLINE_POLICY_SIZE_LIMIT bytes
    const base: IamPolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::bucket/',
        },
      ],
    };
    const baseSize = Buffer.byteLength(JSON.stringify(base), 'utf8');
    const padding = AWS_INLINE_POLICY_SIZE_LIMIT - baseSize;

    // Pad the resource ARN to reach exactly the limit
    const paddedResource = 'arn:aws:s3:::bucket/' + 'x'.repeat(padding);
    const exactPolicy: IamPolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: paddedResource,
        },
      ],
    };

    const exactSize = Buffer.byteLength(JSON.stringify(exactPolicy), 'utf8');
    expect(exactSize).toBe(AWS_INLINE_POLICY_SIZE_LIMIT);

    const result = validatePolicySize(exactPolicy);
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid with error details for a policy exceeding the size limit', () => {
    // Create an oversized policy by adding many statements with long resource ARNs
    const longArn = 'arn:aws:s3:::' + 'a'.repeat(500);
    const statements = Array.from({ length: 30 }, () => ({
      Effect: 'Allow' as const,
      Action: 's3:GetObject',
      Resource: longArn,
    }));

    const oversizedPolicy: IamPolicyDocument = {
      Version: '2012-10-17',
      Statement: statements,
    };

    const actualSize = Buffer.byteLength(JSON.stringify(oversizedPolicy), 'utf8');
    expect(actualSize).toBeGreaterThan(AWS_INLINE_POLICY_SIZE_LIMIT);

    const result = validatePolicySize(oversizedPolicy);
    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.error.code).toBe('POLICY_SIZE_EXCEEDED');
      expect(result.error.details).toEqual({
        actualSize,
        limit: AWS_INLINE_POLICY_SIZE_LIMIT,
      });
    }
  });

  it('reports the correct byte size for multi-byte characters in resources', () => {
    // Use multi-byte chars to verify we measure bytes, not string length
    const multiByteArn = 'arn:aws:s3:::' + '\u00e9'.repeat(5000); // é is 2 bytes in UTF-8
    const policy: IamPolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: multiByteArn,
        },
      ],
    };

    const json = JSON.stringify(policy);
    const byteSize = Buffer.byteLength(json, 'utf8');

    // The byte size should be larger than the string length due to multi-byte chars
    expect(byteSize).toBeGreaterThan(json.length);

    const result = validatePolicySize(policy);

    if (byteSize > AWS_INLINE_POLICY_SIZE_LIMIT) {
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.details).toEqual({
          actualSize: byteSize,
          limit: AWS_INLINE_POLICY_SIZE_LIMIT,
        });
      }
    } else {
      expect(result.valid).toBe(true);
    }
  });
});
