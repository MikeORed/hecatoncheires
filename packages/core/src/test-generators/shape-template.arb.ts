import fc from 'fast-check';

/**
 * Arbitrary for a valid IAM action string (e.g., "s3:GetObject").
 */
const arbIamAction = fc
  .tuple(
    fc.constantFrom('s3', 'bedrock', 'dynamodb', 'sqs', 'iam', 'logs', 'events'),
    fc.constantFrom('Get', 'Put', 'Delete', 'List', 'Create', 'Invoke', 'Describe'),
    fc.constantFrom('Object', 'Item', 'Model', 'Message', 'Role', 'Stream', 'Rule'),
  )
  .map(([service, verb, resource]) => `${service}:${verb}${resource}`);

/**
 * Arbitrary for a single IAM action or an array of actions.
 */
const arbActionField = fc.oneof(arbIamAction, fc.array(arbIamAction, { minLength: 1, maxLength: 4 }));

/**
 * Arbitrary for a parameter placeholder name (used in resource ARNs).
 */
const arbParamName = fc.constantFrom('accountId', 'region', 'bucketName', 'tableName', 'queueName');

/**
 * Arbitrary for an IAM resource ARN string that may contain ${param} placeholders.
 */
const arbResourceArn = fc
  .tuple(
    fc.constantFrom('s3', 'bedrock', 'dynamodb', 'sqs', 'iam', 'logs'),
    fc.option(arbParamName, { nil: undefined }),
  )
  .map(([service, param]) => {
    const base = `arn:aws:${service}:\${region}:\${accountId}`;
    if (param && param !== 'accountId' && param !== 'region') {
      return `${base}:\${${param}}/*`;
    }
    return `${base}:*`;
  });

/**
 * Arbitrary for a single resource ARN or array of resource ARNs.
 */
const arbResourceField = fc.oneof(
  arbResourceArn,
  fc.array(arbResourceArn, { minLength: 1, maxLength: 3 }),
);

/**
 * Arbitrary for an optional IAM Condition block.
 */
const arbCondition = fc.option(
  fc.dictionary(
    fc.constantFrom('StringEquals', 'StringLike', 'ArnLike', 'IpAddress'),
    fc.dictionary(
      fc.constantFrom(
        'aws:RequestedRegion',
        'aws:PrincipalOrgID',
        's3:prefix',
        'aws:SourceArn',
      ),
      fc.string({ minLength: 1, maxLength: 50 }),
      { minKeys: 1, maxKeys: 2 },
    ),
    { minKeys: 1, maxKeys: 2 },
  ),
  { nil: undefined },
);

/**
 * Arbitrary for a valid IamStatementTemplate object.
 */
export const arbIamStatementTemplate = fc
  .tuple(
    fc.constantFrom('Allow' as const, 'Deny' as const),
    arbActionField,
    arbResourceField,
    arbCondition,
  )
  .map(([Effect, Action, Resource, Condition]) => ({
    Effect,
    Action,
    Resource,
    ...(Condition !== undefined ? { Condition } : {}),
  }));

/**
 * Arbitrary for a valid ShapeTemplate conforming to ShapeTemplateSchema.
 */
export const arbShapeTemplate = fc.record({
  shapeName: fc.string({ minLength: 1, maxLength: 60 }),
  riskTier: fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const),
  requiredParameters: fc.array(
    fc.constantFrom('accountId', 'region', 'bucketName', 'tableName', 'queueName', 'modelId'),
    { minLength: 0, maxLength: 5 },
  ),
  statements: fc.array(arbIamStatementTemplate, { minLength: 1, maxLength: 5 }),
});

/**
 * Arbitrary for an invalid ShapeTemplate (empty shapeName violates min length).
 */
export const arbInvalidShapeTemplate = fc.record({
  shapeName: fc.constant(''),
  riskTier: fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const),
  requiredParameters: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 0,
    maxLength: 5,
  }),
  statements: fc.array(arbIamStatementTemplate, { minLength: 1, maxLength: 3 }),
});
