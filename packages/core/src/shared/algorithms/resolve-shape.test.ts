import { describe, it, expect } from 'vitest';

import { resolveShape } from './resolve-shape.js';
import { InvalidShapeParametersError } from '../../errors/index.js';
import type { ShapeTemplate } from '../../types/index.js';

describe('resolveShape', () => {
  const singleParamTemplate: ShapeTemplate = {
    shapeName: 'single-param-shape',
    riskTier: 'medium',
    requiredParameters: ['resourceArn'],
    statements: [
      {
        Effect: 'Allow',
        Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        Resource: '${resourceArn}',
      },
    ],
  };

  const s3PrefixReadTemplate: ShapeTemplate = {
    shapeName: 's3-prefix-read',
    riskTier: 'low',
    requiredParameters: ['bucketArn', 'prefix'],
    statements: [
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: '${bucketArn}/${prefix}*',
      },
      {
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: '${bucketArn}',
        Condition: { StringLike: { 's3:prefix': '${prefix}*' } },
      },
    ],
  };

  it('substitutes a single placeholder in Resource', () => {
    const result = resolveShape(singleParamTemplate, {
      resourceArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-profile',
    });

    expect(result).toHaveLength(1);
    expect(result[0].Effect).toBe('Allow');
    expect(result[0].Action).toEqual([
      'bedrock:InvokeModel',
      'bedrock:InvokeModelWithResponseStream',
    ]);
    expect(result[0].Resource).toBe(
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-profile',
    );
  });

  it('substitutes multiple placeholders in Resource and Condition', () => {
    const result = resolveShape(s3PrefixReadTemplate, {
      bucketArn: 'arn:aws:s3:::my-bucket',
      prefix: 'data/',
    });

    expect(result).toHaveLength(2);

    expect(result[0].Resource).toBe('arn:aws:s3:::my-bucket/data/*');

    expect(result[1].Resource).toBe('arn:aws:s3:::my-bucket');
    expect(result[1].Condition).toEqual({
      StringLike: { 's3:prefix': 'data/*' },
    });
  });

  it('throws InvalidShapeParametersError when parameters are missing', () => {
    expect(() => resolveShape(singleParamTemplate, {})).toThrow(
      InvalidShapeParametersError,
    );
  });

  it('includes missing parameter names in error details', () => {
    try {
      resolveShape(s3PrefixReadTemplate, { bucketArn: 'arn:aws:s3:::bucket' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidShapeParametersError);
      const error = err as InvalidShapeParametersError;
      expect(error.details).toEqual({ missingParameters: ['prefix'] });
    }
  });

  it('lists all missing parameters when multiple are absent', () => {
    try {
      resolveShape(s3PrefixReadTemplate, {});
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidShapeParametersError);
      const error = err as InvalidShapeParametersError;
      expect(error.details).toEqual({ missingParameters: ['bucketArn', 'prefix'] });
    }
  });

  it('handles Resource as string array', () => {
    const template: ShapeTemplate = {
      shapeName: 'multi-resource',
      riskTier: 'low',
      requiredParameters: ['arn1', 'arn2'],
      statements: [
        {
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: ['${arn1}', '${arn2}'],
        },
      ],
    };

    const result = resolveShape(template, {
      arn1: 'arn:aws:s3:::bucket-a/*',
      arn2: 'arn:aws:s3:::bucket-b/*',
    });

    expect(result[0].Resource).toEqual([
      'arn:aws:s3:::bucket-a/*',
      'arn:aws:s3:::bucket-b/*',
    ]);
  });

  it('does not include Condition when template has no Condition', () => {
    const result = resolveShape(singleParamTemplate, {
      resourceArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test',
    });

    expect(result[0].Condition).toBeUndefined();
  });

  it('handles template with no required parameters', () => {
    const template: ShapeTemplate = {
      shapeName: 'no-params',
      riskTier: 'low',
      requiredParameters: [],
      statements: [
        {
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
        },
      ],
    };

    const result = resolveShape(template, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      Effect: 'Deny',
      Action: '*',
      Resource: '*',
    });
  });
});
