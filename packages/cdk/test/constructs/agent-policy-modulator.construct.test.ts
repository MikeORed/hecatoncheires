import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EnvVar } from '@hecaton/core';
import { AgentPolicyModulator } from '../../lib/constructs/agent-policy-modulator.construct.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTemplate(overrides?: {
  configName?: string;
  profileEntityId?: string;
  thresholds?: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
}): Template {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');

  const mockTable = new dynamodb.Table(stack, 'MockTable', {
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  });

  const mockLambda = new lambda.Function(stack, 'MockBreakerLambda', {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {}'),
  });

  const mockRole = new iam.Role(stack, 'MockAgentRole', {
    assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    roleName: 'hecaton-test-test-agent-agent-role',
  });

  new AgentPolicyModulator(stack, 'TestModulator', {
    configName: overrides?.configName ?? 'test-agent',
    profileEntityId: overrides?.profileEntityId ?? 'profile-entity-123',
    profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test',
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    agentRole: mockRole,
    agentType: 'AgentCore Managed',
    guardrailId: 'guardrail-abc',
    breakerLambda: mockLambda,
    agentRegistryTable: mockTable,
    stage: 'test',
    thresholds: overrides?.thresholds ?? {
      outputTokensPerHour: 50000,
      guardrailBlocksPer10Min: 5,
      guardrailObservationsPerHour: 20,
    },
  });

  return Template.fromStack(stack);
}

// ---------------------------------------------------------------------------
// Task 12.1: AgentPolicyModulator construct assertion tests
// Validates: Requirements 10.1, 10.2, 10.3, 10.4
// ---------------------------------------------------------------------------

describe('AgentPolicyModulator construct', () => {
  describe('CloudWatch alarms', () => {
    it('creates exactly 3 CloudWatch alarms', () => {
      const template = createTemplate();
      template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });

    it('creates a token alarm with OutputTokenCount metric and 3600s period', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'OutputTokenCount',
        Namespace: 'AWS/Bedrock',
        Period: 3600,
        Statistic: 'Sum',
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        Threshold: 50000,
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('creates a block alarm with GuardrailBlocked metric and 600s period', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'GuardrailBlocked',
        Namespace: 'AWS/Bedrock',
        Period: 600,
        Statistic: 'Sum',
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        Threshold: 5,
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('creates an observation alarm with GuardrailObserved metric and 3600s period', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'GuardrailObserved',
        Namespace: 'AWS/Bedrock',
        Period: 3600,
        Statistic: 'Sum',
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        Threshold: 20,
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('filters each alarm on the InferenceProfileId dimension', () => {
      const template = createTemplate({ profileEntityId: 'my-profile-entity' });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'OutputTokenCount',
        Dimensions: Match.arrayWith([
          { Name: 'InferenceProfileId', Value: 'my-profile-entity' },
        ]),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'GuardrailBlocked',
        Dimensions: Match.arrayWith([
          { Name: 'InferenceProfileId', Value: 'my-profile-entity' },
        ]),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'GuardrailObserved',
        Dimensions: Match.arrayWith([
          { Name: 'InferenceProfileId', Value: 'my-profile-entity' },
        ]),
      });
    });
  });

  describe('Alarm actions', () => {
    it('each alarm has AlarmActions referencing the Breaker Lambda ARN', () => {
      const template = createTemplate();
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      const alarmLogicalIds = Object.keys(alarms);
      expect(alarmLogicalIds).toHaveLength(3);

      for (const id of alarmLogicalIds) {
        const alarmActions = alarms[id].Properties.AlarmActions;
        expect(alarmActions).toBeDefined();
        expect(alarmActions.length).toBeGreaterThanOrEqual(1);
        // The alarm action should reference the mock breaker lambda's ARN (via Fn::GetAtt)
        const action = alarmActions[0];
        expect(action).toHaveProperty('Fn::GetAtt');
      }
    });
  });

  describe('Custom resource (RegistrySeed)', () => {
    it('creates a CloudFormation custom resource with correct properties', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        configName: 'test-agent',
        profileEntityId: 'profile-entity-123',
        roleName: Match.anyValue(),
        agentType: 'AgentCore Managed',
        guardrailId: 'guardrail-abc',
      });
    });

    it('custom resource includes modelId and profileArn', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test',
      });
    });
  });

  describe('RegistrySeed Lambda IAM policy', () => {
    it('grants DynamoDB actions scoped to the registry table', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:DeleteItem',
                'dynamodb:TransactWriteItems',
              ]),
              Resource: Match.arrayWith([
                Match.objectLike({
                  'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('MockTable')]),
                }),
              ]),
            }),
          ]),
        },
      });
    });
  });

  describe('RegistrySeed Lambda configuration', () => {
    it('uses Node.js 20 runtime', () => {
      const template = createTemplate();
      // Find Lambda functions with the registry seed handler entry
      const functions = template.findResources('AWS::Lambda::Function');
      const registrySeedFunctions = Object.values(functions).filter(
        (fn) => fn.Properties.Runtime === 'nodejs20.x' && fn.Properties.MemorySize === 128,
      );
      expect(registrySeedFunctions.length).toBeGreaterThanOrEqual(1);
    });

    it('uses arm64 architecture', () => {
      const template = createTemplate();
      const functions = template.findResources('AWS::Lambda::Function');
      const registrySeedFunctions = Object.values(functions).filter(
        (fn) => fn.Properties.MemorySize === 128,
      );
      expect(registrySeedFunctions.length).toBeGreaterThanOrEqual(1);
      for (const fn of registrySeedFunctions) {
        expect(fn.Properties.Architectures).toContain('arm64');
      }
    });

    it('has 30-second timeout', () => {
      const template = createTemplate();
      const functions = template.findResources('AWS::Lambda::Function');
      const registrySeedFunctions = Object.values(functions).filter(
        (fn) => fn.Properties.MemorySize === 128,
      );
      expect(registrySeedFunctions.length).toBeGreaterThanOrEqual(1);
      for (const fn of registrySeedFunctions) {
        expect(fn.Properties.Timeout).toBe(30);
      }
    });

    it('has AGENT_REGISTRY_TABLE_NAME environment variable', () => {
      const template = createTemplate();
      const functions = template.findResources('AWS::Lambda::Function');
      const registrySeedFunctions = Object.values(functions).filter(
        (fn) => fn.Properties.MemorySize === 128,
      );
      expect(registrySeedFunctions.length).toBeGreaterThanOrEqual(1);
      for (const fn of registrySeedFunctions) {
        expect(fn.Properties.Environment?.Variables?.[EnvVar.AGENT_REGISTRY_TABLE_NAME]).toBeDefined();
      }
    });
  });

  describe('Validation', () => {
    it('throws when configName is empty', () => {
      expect(() => {
        createTemplate({ configName: '' });
      }).toThrow(/configName must be non-empty/);
    });

    it('throws when configName is whitespace only', () => {
      expect(() => {
        createTemplate({ configName: '   ' });
      }).toThrow(/configName must be non-empty/);
    });

    it('throws when profileEntityId is empty', () => {
      expect(() => {
        createTemplate({ profileEntityId: '' });
      }).toThrow(/profileEntityId must be non-empty/);
    });

    it('throws when profileEntityId is whitespace only', () => {
      expect(() => {
        createTemplate({ profileEntityId: '   ' });
      }).toThrow(/profileEntityId must be non-empty/);
    });

    it('throws when a threshold is zero', () => {
      expect(() => {
        createTemplate({
          thresholds: {
            outputTokensPerHour: 0,
            guardrailBlocksPer10Min: 5,
            guardrailObservationsPerHour: 20,
          },
        });
      }).toThrow(/thresholds\.outputTokensPerHour must be a positive integer/);
    });

    it('throws when a threshold is negative', () => {
      expect(() => {
        createTemplate({
          thresholds: {
            outputTokensPerHour: 50000,
            guardrailBlocksPer10Min: -1,
            guardrailObservationsPerHour: 20,
          },
        });
      }).toThrow(/thresholds\.guardrailBlocksPer10Min must be a positive integer/);
    });

    it('throws when a threshold is not an integer', () => {
      expect(() => {
        createTemplate({
          thresholds: {
            outputTokensPerHour: 50000,
            guardrailBlocksPer10Min: 5,
            guardrailObservationsPerHour: 20.5,
          },
        });
      }).toThrow(/thresholds\.guardrailObservationsPerHour must be a positive integer/);
    });
  });

  describe('Alarm naming', () => {
    it('names the token alarm using NamingGenerator pattern', () => {
      const template = createTemplate({ configName: 'test-agent' });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'hecaton-test-test-agent-token-alarm',
        MetricName: 'OutputTokenCount',
      });
    });

    it('names the block alarm using NamingGenerator pattern', () => {
      const template = createTemplate({ configName: 'test-agent' });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'hecaton-test-test-agent-block-alarm',
        MetricName: 'GuardrailBlocked',
      });
    });

    it('names the observation alarm using NamingGenerator pattern', () => {
      const template = createTemplate({ configName: 'test-agent' });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'hecaton-test-test-agent-observation-alarm',
        MetricName: 'GuardrailObserved',
      });
    });
  });
});
