import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NamingGenerator, EnvVar } from '@hecaton/core';
import { SharedInfraStack } from '../../lib/stacks/shared-infra.stack.js';
import { DEFAULT_GUARDRAIL_CONFIG } from '../../lib/stacks/shared-infra.stack.js';

// Shared synth — all tests use the same stage:'test' config, so synth once.
const app = new App();
const stack = new SharedInfraStack(app, 'TestStack', { stage: 'test' });
const template = Template.fromStack(stack);
const naming = new NamingGenerator('test');

describe('SharedInfraStack', () => {
  describe('Resource counts', () => {
    it('creates exactly 1 EventBridge custom bus', () => {
      template.resourceCountIs('AWS::Events::EventBus', 1);
    });

    it('creates exactly 1 EventBridge archive', () => {
      template.resourceCountIs('AWS::Events::Archive', 1);
    });

    it('creates exactly 1 SNS topic', () => {
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('creates exactly 2 DynamoDB tables', () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 2);
    });

    it('creates exactly 1 REST API', () => {
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });
  });

  describe('EventBridge bus', () => {
    it('is named using NamingGenerator pattern', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'hecaton-test-ops-bus',
      });
    });
  });

  describe('EventBridge archive', () => {
    it('has 7-day retention', () => {
      template.hasResourceProperties('AWS::Events::Archive', {
        RetentionDays: 7,
      });
    });
  });

  describe('DynamoDB grant ledger table', () => {
    it('has correct key schema (configName PK, grantId SK)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'configName', KeyType: 'HASH' },
          { AttributeName: 'grantId', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: 'configName', AttributeType: 'S' },
          { AttributeName: 'grantId', AttributeType: 'S' },
        ]),
      });
    });

    it('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('has point-in-time recovery enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it('has TTL attribute expiresAt', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'expiresAt',
          Enabled: true,
        },
      });
    });

    it('has removal policy RETAIN (DeletionPolicy: Retain)', () => {
      const tables = template.findResources('AWS::DynamoDB::Table', {
        Properties: { TableName: 'hecaton-test-grant-ledger' },
      });
      const tableLogicalIds = Object.keys(tables);
      expect(tableLogicalIds.length).toBe(1);
      const tableResource = tables[tableLogicalIds[0]];
      expect(tableResource.DeletionPolicy).toBe('Retain');
    });

    it('is named using NamingGenerator pattern', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-grant-ledger',
      });
    });
  });

  describe('SNS topic', () => {
    it('is named using NamingGenerator pattern', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'hecaton-test-notifications',
      });
    });
  });

  describe('API Gateway', () => {
    it('is named using NamingGenerator pattern', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'hecaton-test-api',
      });
    });

    it('has apiKeySourceType set to HEADER', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        ApiKeySourceType: 'HEADER',
      });
    });
  });

  describe('Tag propagation', () => {
    it('applies hecatoncheires:managed tag to EventBridge bus', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Tags: Match.arrayWith([
          { Key: `${naming.projectFullName}:managed`, Value: 'true' },
        ]),
      });
    });

    it('applies hecatoncheires:stage tag to SNS topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        Tags: Match.arrayWith([
          { Key: `${naming.projectFullName}:stage`, Value: 'test' },
        ]),
      });
    });

    it('applies hecatoncheires:phase tag to DynamoDB table', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith([
          { Key: `${naming.projectFullName}:phase`, Value: '1' },
        ]),
      });
    });

    it('applies all standard tags to SNS topic', () => {
      const expectedTags = [
        { Key: `${naming.projectFullName}:managed`, Value: 'true' },
        { Key: `${naming.projectFullName}:phase`, Value: '1' },
        { Key: `${naming.projectFullName}:stage`, Value: 'test' },
      ];

      template.hasResourceProperties('AWS::SNS::Topic', {
        Tags: Match.arrayWith(expectedTags),
      });
    });

    it('applies all standard tags to DynamoDB table', () => {
      const expectedTags = [
        { Key: `${naming.projectFullName}:managed`, Value: 'true' },
        { Key: `${naming.projectFullName}:phase`, Value: '1' },
        { Key: `${naming.projectFullName}:stage`, Value: 'test' },
      ];

      template.hasResourceProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith(expectedTags),
      });
    });

    it('applies managed and stage tags to EventBridge bus', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Tags: Match.arrayWith([
          { Key: `${naming.projectFullName}:managed`, Value: 'true' },
          { Key: `${naming.projectFullName}:phase`, Value: '1' },
          { Key: `${naming.projectFullName}:stage`, Value: 'test' },
        ]),
      });
    });
  });

  describe('CfnOutput exports', () => {
    it('exports opsBusArn', () => {
      template.hasOutput('OpsBusArn', {
        Export: { Name: 'TestStack-opsBusArn' },
      });
    });

    it('exports snsTopicArn', () => {
      template.hasOutput('SnsTopicArn', {
        Export: { Name: 'TestStack-snsTopicArn' },
      });
    });

    it('exports grantLedgerTableName', () => {
      template.hasOutput('GrantLedgerTableName', {
        Export: { Name: 'TestStack-grantLedgerTableName' },
      });
    });

    it('exports grantLedgerTableArn', () => {
      template.hasOutput('GrantLedgerTableArn', {
        Export: { Name: 'TestStack-grantLedgerTableArn' },
      });
    });

    it('exports apiGatewayId', () => {
      template.hasOutput('ApiGatewayId', {
        Export: { Name: 'TestStack-apiGatewayId' },
      });
    });

    it('exports apiGatewayUrl', () => {
      template.hasOutput('ApiGatewayUrl', {
        Export: { Name: 'TestStack-apiGatewayUrl' },
      });
    });
  });

  describe('Agent Registry table', () => {
    it('has correct key schema (pk/sk STRING)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-agent-registry',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ]),
      });
    });

    it('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-agent-registry',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('has point-in-time recovery enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-agent-registry',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it('has GSI named gsi1 with inverted keys (sk as PK, pk as SK)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-agent-registry',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'gsi1',
            KeySchema: [
              { AttributeName: 'sk', KeyType: 'HASH' },
              { AttributeName: 'pk', KeyType: 'RANGE' },
            ],
          }),
        ]),
      });
    });

    it('has removal policy RETAIN (DeletionPolicy: Retain)', () => {
      const tables = template.findResources('AWS::DynamoDB::Table', {
        Properties: { TableName: 'hecaton-test-agent-registry' },
      });
      const tableLogicalIds = Object.keys(tables);
      expect(tableLogicalIds.length).toBe(1);
      const tableResource = tables[tableLogicalIds[0]];
      expect(tableResource.DeletionPolicy).toBe('Retain');
    });

    it('is named hecaton-test-agent-registry', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-agent-registry',
      });
    });
  });

  describe('Breaker Lambda', () => {
    it('has environment variable AGENT_REGISTRY_TABLE_NAME', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.AGENT_REGISTRY_TABLE_NAME]: Match.anyValue(),
          }),
        },
      });
    });

    it('has environment variable OPS_BUS_ARN', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.OPS_BUS_ARN]: Match.anyValue(),
          }),
        },
      });
    });

    it('has environment variable SNS_TOPIC_ARN', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.SNS_TOPIC_ARN]: Match.anyValue(),
          }),
        },
      });
    });

    it('has environment variable OPERATING_POLICY_NAME', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.OPERATING_POLICY_NAME]: naming.operatingPolicyName(),
          }),
        },
      });
    });

    it('uses nodejs20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Runtime: 'nodejs20.x',
      });
    });

    it('has 256 MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        MemorySize: 256,
      });
    });

    it('has 30 second timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Timeout: 30,
      });
    });

    it('uses arm64 architecture', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-breaker-trip',
        Architectures: ['arm64'],
      });
    });

    it('has IAM policy with iam:PutRolePolicy scoped to agent role pattern', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'iam:PutRolePolicy',
              Effect: 'Allow',
              Resource: Match.objectLike({
                'Fn::Join': Match.anyValue(),
              }),
            }),
          ]),
        },
      });
    });
  });

  describe('API Gateway methods', () => {
    it('has POST method with AWS_PROXY integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        Integration: Match.objectLike({
          Type: 'AWS_PROXY',
        }),
      });
    });

    it('has DELETE method with AWS_PROXY integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        Integration: Match.objectLike({
          Type: 'AWS_PROXY',
        }),
      });
    });

    it('has GET method with AWS_PROXY integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        Integration: Match.objectLike({
          Type: 'AWS_PROXY',
        }),
      });
    });

    it('all methods have ApiKeyRequired set to true', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: Match.anyValue(),
          Integration: Match.objectLike({ Type: 'AWS_PROXY' }),
        },
      });
      const methodIds = Object.keys(methods);
      expect(methodIds.length).toBeGreaterThanOrEqual(3);
      for (const id of methodIds) {
        expect(methods[id].Properties.ApiKeyRequired).toBe(true);
      }
    });

    it('RestApi has correct name and ApiKeySourceType HEADER', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'hecaton-test-api',
        ApiKeySourceType: 'HEADER',
      });
    });
  });

  describe('Usage plan and API key', () => {
    it('creates a UsagePlan', () => {
      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
    });

    it('creates an ApiKey', () => {
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
    });

    it('creates a UsagePlanKey to associate key with plan', () => {
      template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 1);
    });
  });

  describe('Handler Lambdas environment variables', () => {
    it('grant-shape Lambda has correct environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-grant-shape',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.GRANT_LEDGER_TABLE_NAME]: Match.anyValue(),
            [EnvVar.AGENT_REGISTRY_TABLE_NAME]: Match.anyValue(),
            [EnvVar.OPS_BUS_ARN]: Match.anyValue(),
            [EnvVar.OPERATING_POLICY_NAME]: naming.operatingPolicyName(),
          }),
        },
      });
    });

    it('revoke-shape Lambda has correct environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-revoke-shape',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.GRANT_LEDGER_TABLE_NAME]: Match.anyValue(),
            [EnvVar.AGENT_REGISTRY_TABLE_NAME]: Match.anyValue(),
            [EnvVar.OPS_BUS_ARN]: Match.anyValue(),
            [EnvVar.OPERATING_POLICY_NAME]: naming.operatingPolicyName(),
          }),
        },
      });
    });

    it('query-fleet-state Lambda has correct environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-query-fleet-state',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.GRANT_LEDGER_TABLE_NAME]: Match.anyValue(),
            [EnvVar.AGENT_REGISTRY_TABLE_NAME]: Match.anyValue(),
            [EnvVar.OPS_BUS_ARN]: Match.anyValue(),
            [EnvVar.OPERATING_POLICY_NAME]: naming.operatingPolicyName(),
          }),
        },
      });
    });
  });

  describe('Default guardrail config', () => {
    it('is a typed object (not an AWS resource)', () => {
      expect(stack.defaultGuardrailConfig).toBeDefined();
      expect(stack.defaultGuardrailConfig).toEqual(DEFAULT_GUARDRAIL_CONFIG);
      expect(stack.defaultGuardrailConfig.contentFilters).toBeInstanceOf(Array);
      expect(stack.defaultGuardrailConfig.deniedTopics).toBeInstanceOf(Array);
    });

    it('does not create any Bedrock guardrail AWS resource', () => {
      // Ensure no Bedrock guardrail resource is synthesized in SharedInfraStack
      template.resourceCountIs('AWS::Bedrock::Guardrail', 0);
    });
  });

  describe('AppConfig Application and Environment', () => {
    it('creates an AppConfig Application with correct name', () => {
      template.hasResourceProperties('AWS::AppConfig::Application', {
        Name: 'hecaton-test-platform',
      });
    });

    it('applies standard tags to AppConfig Application', () => {
      template.hasResourceProperties('AWS::AppConfig::Application', {
        Tags: Match.arrayWith([
          { Key: `${naming.projectFullName}:managed`, Value: 'true' },
          { Key: `${naming.projectFullName}:stage`, Value: 'test' },
        ]),
      });
    });

    it('creates an AppConfig Environment named with stage value', () => {
      template.hasResourceProperties('AWS::AppConfig::Environment', {
        Name: 'test',
      });
    });

    it('AppConfig Environment is linked to the application', () => {
      template.hasResourceProperties('AWS::AppConfig::Environment', {
        ApplicationId: Match.anyValue(),
      });
    });

    it('exports AppConfigAppId', () => {
      template.hasOutput('AppConfigAppId', {
        Export: { Name: 'TestStack-appConfigAppId' },
      });
    });

    it('exports AppConfigEnvId', () => {
      template.hasOutput('AppConfigEnvId', {
        Export: { Name: 'TestStack-appConfigEnvId' },
      });
    });
  });

  describe('Drift Detection Lambda', () => {
    it('exists with correct function name', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
      });
    });

    it('uses nodejs20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Runtime: 'nodejs20.x',
      });
    });

    it('uses arm64 architecture', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Architectures: ['arm64'],
      });
    });

    it('has 256 MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        MemorySize: 256,
      });
    });

    it('has 30 second timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Timeout: 30,
      });
    });

    it('has environment variable OPS_BUS_ARN', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.OPS_BUS_ARN]: Match.anyValue(),
          }),
        },
      });
    });

    it('has environment variable SNS_TOPIC_ARN', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.SNS_TOPIC_ARN]: Match.anyValue(),
          }),
        },
      });
    });

    it('has environment variable KNOWN_PRINCIPALS as JSON array', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'hecaton-test-drift-detection',
        Environment: {
          Variables: Match.objectLike({
            [EnvVar.KNOWN_PRINCIPALS]: Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('Drift Detection EventBridge rule', () => {
    it('has an EventBridge rule matching IAM CloudTrail mutations', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          source: ['aws.iam'],
          'detail-type': ['AWS API Call via CloudTrail'],
        }),
      });
    });

    it('matches IAM mutation event names', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          detail: Match.objectLike({
            eventSource: ['iam.amazonaws.com'],
            eventName: [
              'PutRolePolicy',
              'DeleteRolePolicy',
              'AttachRolePolicy',
              'DetachRolePolicy',
              'PutRolePermissionsBoundary',
              'DeleteRolePermissionsBoundary',
            ],
          }),
        }),
      });
    });

    it('filters by role name prefix matching hecaton-test-', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          detail: Match.objectLike({
            requestParameters: Match.objectLike({
              roleName: Match.arrayWith([{ prefix: 'hecaton-test-' }]),
            }),
          }),
        }),
      });
    });
  });

  describe('Bedrock Invocation Logging', () => {
    it('creates a CloudWatch Logs log group with correct name', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/bedrock/invocations/test',
      });
    });

    it('has 30-day retention on the log group', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/bedrock/invocations/test',
        RetentionInDays: 30,
      });
    });

    it('has removal policy RETAIN on the log group', () => {
      const logGroups = template.findResources('AWS::Logs::LogGroup', {
        Properties: { LogGroupName: '/aws/bedrock/invocations/test' },
      });
      const logGroupIds = Object.keys(logGroups);
      expect(logGroupIds.length).toBe(1);
      const logGroupResource = logGroups[logGroupIds[0]];
      expect(logGroupResource.DeletionPolicy).toBe('Retain');
    });

    it('exports BedrockLogGroupArn', () => {
      template.hasOutput('BedrockLogGroupArn', {
        Export: { Name: 'TestStack-bedrockLogGroupArn' },
      });
    });
  });
});
