import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NamingGenerator } from '@hecaton/core';

/** Typed guardrail policy configuration — data only, not an AWS resource. */
export interface GuardrailPolicyConfig {
  contentFilters: {
    type: 'SEXUAL' | 'VIOLENCE' | 'HATE' | 'INSULTS' | 'MISCONDUCT' | 'PROMPT_ATTACK';
    inputStrength: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    outputStrength: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  }[];
  deniedTopics: {
    name: string;
    definition: string;
    examples: string[];
  }[];
}

/**
 * Default guardrail policy configuration with baseline content filters.
 * Each agent config can add denied topics and override filter strengths via guardrailOverrides.
 */
export const DEFAULT_GUARDRAIL_CONFIG: GuardrailPolicyConfig = {
  contentFilters: [
    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
    { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
  ],
  deniedTopics: [],
};

export interface SharedInfraStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Account-level shared infrastructure deployed once per stage.
 * Provides the foundational resources all agent configurations reference.
 */
export class SharedInfraStack extends cdk.Stack {
  readonly opsBus: events.IEventBus;
  readonly snsTopic: sns.ITopic;
  readonly grantLedgerTable: dynamodb.ITable;
  readonly apiGateway: apigateway.IRestApi;
  readonly defaultGuardrailConfig: GuardrailPolicyConfig;

  constructor(scope: Construct, id: string, props: SharedInfraStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const naming = new NamingGenerator(stage);

    // --- EventBridge custom bus ---
    const bus = new events.EventBus(this, 'OpsBus', {
      eventBusName: naming.busName(),
    });

    // 7-day archive on the ops bus (L1 construct)
    new events.CfnArchive(this, 'OpsBusArchive', {
      archiveName: `${naming.busName()}-archive`,
      sourceArn: bus.eventBusArn,
      retentionDays: 7,
    });

    this.opsBus = bus;

    // --- SNS notification topic ---
    const topic = new sns.Topic(this, 'NotificationTopic', {
      topicName: naming.snsTopicName(),
    });

    this.snsTopic = topic;

    // --- DynamoDB grant ledger table ---
    const table = new dynamodb.Table(this, 'GrantLedgerTable', {
      tableName: naming.tableName(),
      partitionKey: { name: 'configName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'grantId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.grantLedgerTable = table;

    // --- API Gateway REST API shell (no methods in this phase) ---
    // Using L1 CfnRestApi to avoid L2 RestApi's "no methods" validation.
    // This is intentionally a shell — methods will be added in later phases.
    const cfnApi = new apigateway.CfnRestApi(this, 'ApiGateway', {
      name: naming.apiGatewayName(),
      apiKeySourceType: 'HEADER',
    });

    const api = apigateway.RestApi.fromRestApiId(this, 'ApiGatewayRef', cfnApi.ref);
    this.apiGateway = api;

    // --- Default guardrail config (typed data, not an AWS resource) ---
    this.defaultGuardrailConfig = DEFAULT_GUARDRAIL_CONFIG;

    // --- Standard tags ---
    cdk.Tags.of(this).add('hecatoncheires:managed', 'true');
    cdk.Tags.of(this).add('hecatoncheires:stage', stage);
    cdk.Tags.of(this).add('hecatoncheires:phase', '1');

    // --- CfnOutputs for cross-stack consumption ---
    new cdk.CfnOutput(this, 'OpsBusArn', {
      value: bus.eventBusArn,
      exportName: `${id}-opsBusArn`,
    });

    new cdk.CfnOutput(this, 'SnsTopicArn', {
      value: topic.topicArn,
      exportName: `${id}-snsTopicArn`,
    });

    new cdk.CfnOutput(this, 'GrantLedgerTableName', {
      value: table.tableName,
      exportName: `${id}-grantLedgerTableName`,
    });

    new cdk.CfnOutput(this, 'GrantLedgerTableArn', {
      value: table.tableArn,
      exportName: `${id}-grantLedgerTableArn`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: cfnApi.ref,
      exportName: `${id}-apiGatewayId`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: `https://${cfnApi.ref}.execute-api.${this.region}.amazonaws.com/`,
      exportName: `${id}-apiGatewayUrl`,
    });
  }
}
