import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AgentBusChannel } from '../../lib/constructs/agent-bus-channel.construct.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_STAGE = 'test';
const TEST_CONFIG_NAME = 'sre-ops';
const TEST_SIGNALS_BUS_ARN =
  'arn:aws:events:us-east-1:123456789012:event-bus/test-signals-bus';
const TEST_SOURCE_NAMESPACE = 'hecatoncheires.signals';

function createTemplate(overrides?: {
  configName?: string;
  subscriptionPatterns?: events.EventPattern[];
  stage?: string;
}): Template {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');

  const mockRole = new iam.Role(stack, 'MockAgentRole', {
    assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    roleName: 'hecaton-test-sre-ops-agent-role',
  });

  new AgentBusChannel(stack, 'TestBusChannel', {
    configName: overrides?.configName ?? TEST_CONFIG_NAME,
    signalsBusArn: TEST_SIGNALS_BUS_ARN,
    sourceNamespace: TEST_SOURCE_NAMESPACE,
    subscriptionPatterns: overrides?.subscriptionPatterns,
    agentRole: mockRole,
    stage: overrides?.stage ?? TEST_STAGE,
  });

  return Template.fromStack(stack);
}

// ---------------------------------------------------------------------------
// Task 9.2: AgentBusChannel construct assertion tests
// Validates: Requirements 8.4, 8.5, 8.6
// ---------------------------------------------------------------------------

describe('AgentBusChannel construct', () => {
  describe('Signals Queue', () => {
    it('creates a FIFO queue with the correct name', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        FifoQueue: true,
      });
    });

    it('sets visibility timeout to 60 seconds', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        VisibilityTimeout: 60,
      });
    });

    it('sets message retention period to 14 days (1209600 seconds)', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        MessageRetentionPeriod: 1209600,
      });
    });

    it('enables content-based deduplication', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        ContentBasedDeduplication: true,
      });
    });
  });

  describe('Dead Letter Queue', () => {
    it('creates a FIFO DLQ with the correct name', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals-dlq.fifo',
        FifoQueue: true,
      });
    });

    it('sets DLQ message retention period to 14 days (1209600 seconds)', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals-dlq.fifo',
        MessageRetentionPeriod: 1209600,
      });
    });
  });

  describe('Redrive Policy', () => {
    it('configures redrive policy with maxReceiveCount of 3', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });

    it('redrive policy targets the DLQ', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        RedrivePolicy: Match.objectLike({
          deadLetterTargetArn: Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('DLQ')]),
          }),
        }),
      });
    });
  });

  describe('EventBridge Rule', () => {
    it('creates a rule on the signals bus with source pattern', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::Events::Rule', {
        EventBusName: 'test-signals-bus',
        EventPattern: Match.objectLike({
          source: ['hecatoncheires.signals'],
        }),
      });
    });
  });

  describe('EventBridge Rule with subscription patterns', () => {
    it('merges subscription patterns with source filter', () => {
      const template = createTemplate({
        subscriptionPatterns: [{ detailType: ['agent.heartbeat', 'agent.status'] }],
      });
      template.hasResourceProperties('AWS::Events::Rule', {
        EventBusName: 'test-signals-bus',
        EventPattern: Match.objectLike({
          source: ['hecatoncheires.signals'],
          'detail-type': ['agent.heartbeat', 'agent.status'],
        }),
      });
    });

    it('supports detail filtering in subscription patterns', () => {
      const template = createTemplate({
        subscriptionPatterns: [
          {
            detailType: ['task.completed'],
            detail: { priority: ['high'] },
          },
        ],
      });
      template.hasResourceProperties('AWS::Events::Rule', {
        EventBusName: 'test-signals-bus',
        EventPattern: Match.objectLike({
          source: ['hecatoncheires.signals'],
          'detail-type': ['task.completed'],
          detail: { priority: ['high'] },
        }),
      });
    });

    it('without subscriptionPatterns, rule matches all events from sourceNamespace', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::Events::Rule', {
        EventBusName: 'test-signals-bus',
        EventPattern: {
          source: ['hecatoncheires.signals'],
        },
      });
    });
  });

  describe('SQS Target', () => {
    it('adds the signals queue as a target with MessageGroupId', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            SqsParameters: {
              MessageGroupId: '$.detail.correlationId',
            },
          }),
        ]),
      });
    });

    it('configures a dead-letter queue on the target', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            DeadLetterConfig: Match.objectLike({
              Arn: Match.anyValue(),
            }),
          }),
        ]),
      });
    });
  });

  describe('Agent role permissions', () => {
    it('grants sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes to agent role', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ]),
            }),
          ]),
        },
      });
    });
  });

  describe('Tags', () => {
    it('applies hecatoncheires:managed tag', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
        ]),
      });
    });

    it('applies hecatoncheires:config tag with configName', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:config', Value: 'sre-ops' },
        ]),
      });
    });

    it('applies hecatoncheires:stage tag', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:stage', Value: 'test' },
        ]),
      });
    });

    it('applies hecatoncheires:phase tag', () => {
      const template = createTemplate();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'hecaton-test-sre-ops-signals.fifo',
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:phase', Value: '1' },
        ]),
      });
    });
  });
});
