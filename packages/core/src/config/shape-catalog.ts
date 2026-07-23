import type { ShapeTemplate } from '../types/index.js';

/**
 * Built-in catalog of capability shape templates.
 *
 * Each shape defines a risk-tier bundle of IAM statement templates that,
 * when resolved with parameters, produces concrete IAM policy statements.
 *
 * The catalog is frozen to prevent runtime mutation.
 */
export const SHAPE_CATALOG: readonly ShapeTemplate[] = Object.freeze([
  {
    shapeName: 'core-invocation',
    riskTier: 'medium',
    requiredParameters: ['inferenceProfileArn'],
    statements: [
      {
        Effect: 'Allow',
        Action: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
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
      {
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: '${bucketArn}',
        Condition: { StringLike: { 's3:prefix': '${prefix}*' } },
      },
    ],
  },
  {
    shapeName: 's3-prefix-write',
    riskTier: 'medium',
    requiredParameters: ['bucketArn', 'prefix'],
    statements: [
      {
        Effect: 'Allow',
        Action: 's3:PutObject',
        Resource: '${bucketArn}/${prefix}*',
      },
    ],
  },
  {
    shapeName: 'cloudwatch-logs-read',
    riskTier: 'low',
    requiredParameters: ['logGroupArn'],
    statements: [
      {
        Effect: 'Allow',
        Action: ['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'],
        Resource: '${logGroupArn}',
      },
    ],
  },
]);
