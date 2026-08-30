import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { NamingGenerator } from '@hecaton/core';

/** Props for the AgentBusChannel construct. */
export interface AgentBusChannelProps {
  /** Agent configuration name. */
  configName: string;
  /** ARN of the signals EventBridge bus. */
  signalsBusArn: string;
  /** Source namespace for event filtering (e.g., 'hecatoncheires.signals'). */
  sourceNamespace: string;
  /** Optional subscription patterns for filtering events. If omitted, matches all from sourceNamespace. */
  subscriptionPatterns?: events.EventPattern[];
  /** The agent IAM role that will consume messages. */
  agentRole: iam.IRole;
  /** Deployment stage. */
  stage: string;
}

/** Outputs from the AgentBusChannel construct. */
export interface AgentBusChannelOutputs {
  /** The signals FIFO queue. */
  signalsQueue: sqs.IQueue;
  /** The dead-letter FIFO queue. */
  deadLetterQueue: sqs.IQueue;
  /** The EventBridge rule routing events to the queue. */
  rule: events.IRule;
}

/**
 * AgentBusChannel construct — provisions per-agent EventBridge rule,
 * SQS FIFO queue, and dead-letter queue for event augmentation signal delivery.
 *
 * Creates:
 * 1. A FIFO dead-letter queue for unprocessable messages
 * 2. A FIFO signals queue with redrive policy to the DLQ
 * 3. An EventBridge rule on the signals bus filtering by source namespace
 * 4. An SQS target with causal ordering via MessageGroupId
 */
export class AgentBusChannel extends Construct {
  readonly outputs: AgentBusChannelOutputs;

  constructor(scope: Construct, id: string, props: AgentBusChannelProps) {
    super(scope, id);

    const naming = new NamingGenerator(props.stage);
    const queueNames = naming.queueNames(props.configName);

    // 1. Create DLQ (FIFO)
    const dlq = new sqs.Queue(this, 'DLQ', {
      queueName: queueNames.dlq,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    // 2. Create signals queue (FIFO) with redrive to DLQ
    const signalsQueue = new sqs.Queue(this, 'SignalsQueue', {
      queueName: queueNames.signals,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // 3. Import signals bus from ARN
    const signalsBus = events.EventBus.fromEventBusArn(this, 'SignalsBus', props.signalsBusArn);

    // 4. Build event pattern
    const eventPattern = this.buildEventPattern(props);

    // 5. Create rule on signals bus
    const rule = new events.Rule(this, 'Rule', {
      eventBus: signalsBus,
      eventPattern,
    });

    // 6. Add SQS target with MessageGroupId and DLQ
    rule.addTarget(
      new targets.SqsQueue(signalsQueue, {
        messageGroupId: '$.detail.correlationId',
        deadLetterQueue: dlq,
      }),
    );

    // 7. Grant consume permissions to agent role
    signalsQueue.grant(
      props.agentRole,
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
    );

    // Expose outputs
    this.outputs = { signalsQueue, deadLetterQueue: dlq, rule };
  }

  /**
   * Build the EventBridge event pattern from sourceNamespace and optional subscription patterns.
   * If subscriptionPatterns are provided, merges them with the source filter.
   * If not, matches all events from the sourceNamespace.
   */
  private buildEventPattern(props: AgentBusChannelProps): events.EventPattern {
    if (!props.subscriptionPatterns || props.subscriptionPatterns.length === 0) {
      return { source: [props.sourceNamespace] };
    }

    // Merge subscription patterns with source filter.
    // EventBridge treats multiple values in the same field as OR; different fields as AND.
    let detailType: string[] | undefined;
    let detail: Record<string, unknown> | undefined;

    for (const pattern of props.subscriptionPatterns) {
      if (pattern.detailType) {
        detailType = [...(detailType ?? []), ...pattern.detailType];
      }
      if (pattern.detail) {
        detail = { ...(detail ?? {}), ...pattern.detail };
      }
    }

    const mergedPattern: events.EventPattern = {
      source: [props.sourceNamespace],
      ...(detailType ? { detailType } : {}),
      ...(detail ? { detail } : {}),
    };

    return mergedPattern;
  }
}
