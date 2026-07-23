import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SharedInfraStack } from '../../lib/stacks/shared-infra.stack.js';
import { DEFAULT_GUARDRAIL_CONFIG } from '../../lib/stacks/shared-infra.stack.js';

function createTemplate(): { template: Template; stack: SharedInfraStack } {
  const app = new App();
  const stack = new SharedInfraStack(app, 'TestStack', { stage: 'test' });
  const template = Template.fromStack(stack);
  return { template, stack };
}

describe('SharedInfraStack', () => {
  describe('Resource counts', () => {
    it('creates exactly 1 EventBridge custom bus', () => {
      const { template } = createTemplate();
      template.resourceCountIs('AWS::Events::EventBus', 1);
    });

    it('creates exactly 1 EventBridge archive', () => {
      const { template } = createTemplate();
      template.resourceCountIs('AWS::Events::Archive', 1);
    });

    it('creates exactly 1 SNS topic', () => {
      const { template } = createTemplate();
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('creates exactly 1 DynamoDB table', () => {
      const { template } = createTemplate();
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
    });

    it('creates exactly 1 REST API', () => {
      const { template } = createTemplate();
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });
  });

  describe('EventBridge bus', () => {
    it('is named using NamingGenerator pattern', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'hecaton-test-ops-bus',
      });
    });
  });

  describe('EventBridge archive', () => {
    it('has 7-day retention', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::Events::Archive', {
        RetentionDays: 7,
      });
    });
  });

  describe('DynamoDB grant ledger table', () => {
    it('has correct key schema (configName PK, grantId SK)', () => {
      const { template } = createTemplate();
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
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('has point-in-time recovery enabled', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it('has TTL attribute expiresAt', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'expiresAt',
          Enabled: true,
        },
      });
    });

    it('has removal policy RETAIN (DeletionPolicy: Retain)', () => {
      const { template } = createTemplate();
      const tables = template.findResources('AWS::DynamoDB::Table');
      const tableLogicalIds = Object.keys(tables);
      expect(tableLogicalIds.length).toBe(1);
      const tableResource = tables[tableLogicalIds[0]];
      expect(tableResource.DeletionPolicy).toBe('Retain');
    });

    it('is named using NamingGenerator pattern', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'hecaton-test-grant-ledger',
      });
    });
  });

  describe('SNS topic', () => {
    it('is named using NamingGenerator pattern', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'hecaton-test-notifications',
      });
    });
  });

  describe('API Gateway', () => {
    it('is named using NamingGenerator pattern', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'hecaton-test-api',
      });
    });

    it('has apiKeySourceType set to HEADER', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        ApiKeySourceType: 'HEADER',
      });
    });
  });

  describe('Tag propagation', () => {
    it('applies hecatoncheires:managed tag to EventBridge bus', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::Events::EventBus', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
        ]),
      });
    });

    it('applies hecatoncheires:stage tag to SNS topic', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::SNS::Topic', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:stage', Value: 'test' },
        ]),
      });
    });

    it('applies hecatoncheires:phase tag to DynamoDB table', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:phase', Value: '1' },
        ]),
      });
    });

    it('applies all standard tags to SNS topic', () => {
      const { template } = createTemplate();
      const expectedTags = [
        { Key: 'hecatoncheires:managed', Value: 'true' },
        { Key: 'hecatoncheires:phase', Value: '1' },
        { Key: 'hecatoncheires:stage', Value: 'test' },
      ];

      template.hasResourceProperties('AWS::SNS::Topic', {
        Tags: Match.arrayWith(expectedTags),
      });
    });

    it('applies all standard tags to DynamoDB table', () => {
      const { template } = createTemplate();
      const expectedTags = [
        { Key: 'hecatoncheires:managed', Value: 'true' },
        { Key: 'hecatoncheires:phase', Value: '1' },
        { Key: 'hecatoncheires:stage', Value: 'test' },
      ];

      template.hasResourceProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith(expectedTags),
      });
    });

    it('applies managed and stage tags to EventBridge bus', () => {
      const { template } = createTemplate();
      template.hasResourceProperties('AWS::Events::EventBus', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
          { Key: 'hecatoncheires:phase', Value: '1' },
          { Key: 'hecatoncheires:stage', Value: 'test' },
        ]),
      });
    });
  });

  describe('CfnOutput exports', () => {
    it('exports opsBusArn', () => {
      const { template } = createTemplate();
      template.hasOutput('OpsBusArn', {
        Export: { Name: 'TestStack-opsBusArn' },
      });
    });

    it('exports snsTopicArn', () => {
      const { template } = createTemplate();
      template.hasOutput('SnsTopicArn', {
        Export: { Name: 'TestStack-snsTopicArn' },
      });
    });

    it('exports grantLedgerTableName', () => {
      const { template } = createTemplate();
      template.hasOutput('GrantLedgerTableName', {
        Export: { Name: 'TestStack-grantLedgerTableName' },
      });
    });

    it('exports grantLedgerTableArn', () => {
      const { template } = createTemplate();
      template.hasOutput('GrantLedgerTableArn', {
        Export: { Name: 'TestStack-grantLedgerTableArn' },
      });
    });

    it('exports apiGatewayId', () => {
      const { template } = createTemplate();
      template.hasOutput('ApiGatewayId', {
        Export: { Name: 'TestStack-apiGatewayId' },
      });
    });

    it('exports apiGatewayUrl', () => {
      const { template } = createTemplate();
      template.hasOutput('ApiGatewayUrl', {
        Export: { Name: 'TestStack-apiGatewayUrl' },
      });
    });
  });

  describe('Default guardrail config', () => {
    it('is a typed object (not an AWS resource)', () => {
      const { stack } = createTemplate();
      expect(stack.defaultGuardrailConfig).toBeDefined();
      expect(stack.defaultGuardrailConfig).toEqual(DEFAULT_GUARDRAIL_CONFIG);
      expect(stack.defaultGuardrailConfig.contentFilters).toBeInstanceOf(Array);
      expect(stack.defaultGuardrailConfig.deniedTopics).toBeInstanceOf(Array);
    });

    it('does not create any Bedrock guardrail AWS resource', () => {
      const { template } = createTemplate();
      // Ensure no Bedrock guardrail resource is synthesized in SharedInfraStack
      template.resourceCountIs('AWS::Bedrock::Guardrail', 0);
    });
  });
});
