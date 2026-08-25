import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { NamingGenerator } from '@hecaton/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  readonly agentRegistryTable: dynamodb.ITable;
  readonly breakerLambda: lambda.IFunction;
  readonly apiGateway: apigateway.RestApi;
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

    // --- DynamoDB agent registry table ---
    const registryTable = new dynamodb.Table(this, 'AgentRegistryTable', {
      tableName: naming.agentRegistryTableName(),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    registryTable.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });

    this.agentRegistryTable = registryTable;

    // --- Breaker Lambda ---
    // Entry path relative to monorepo root (resolved via ../.. from packages/cdk/)
    const breakerLambda = new NodejsFunction(this, 'BreakerLambda', {
      functionName: naming.lambdaName('breaker-trip'),
      entry: join(__dirname, '..', '..', '..', 'api', 'src', 'handlers', 'breaker-trip.alarm.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        AGENT_REGISTRY_TABLE_NAME: registryTable.tableName,
        OPS_BUS_ARN: bus.eventBusArn,
        SNS_TOPIC_ARN: topic.topicArn,
        OPERATING_POLICY_NAME: 'hecaton-operating-policy',
      },
    });

    // IAM permissions — DynamoDB read/update on registry table + indexes
    registryTable.grant(breakerLambda, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    breakerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${registryTable.tableArn}/index/*`],
      }),
    );

    // IAM — EventBridge PutEvents
    bus.grantPutEventsTo(breakerLambda);

    // IAM — SNS Publish
    topic.grantPublish(breakerLambda);

    // IAM — PutRolePolicy scoped to agent role pattern
    breakerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PutRolePolicy'],
        resources: [`arn:aws:iam::${this.account}:role/hecaton-${stage}-*-agent-role`],
      }),
    );

    // Allow CloudWatch alarms to invoke the Breaker Lambda.
    // Permission is granted here (in SharedInfraStack) rather than per-agent stacks
    // to avoid circular cross-stack dependencies.
    breakerLambda.addPermission('AllowCloudWatchAlarmInvoke', {
      principal: new iam.ServicePrincipal('lambda.alarms.cloudwatch.amazonaws.com'),
    });

    this.breakerLambda = breakerLambda;

    // --- API Gateway L2 RestApi with method integrations ---
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: naming.apiGatewayName(),
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
      deploy: true,
      deployOptions: { stageName: stage },
    });

    // Resources
    const grantsResource = api.root.addResource('grants');
    const fleetResource = api.root.addResource('fleet');

    // --- Handler Lambdas ---
    const grantLambda = new NodejsFunction(this, 'GrantShapeLambda', {
      functionName: naming.lambdaName('grant-shape'),
      entry: join(__dirname, '..', '..', '..', 'api', 'src', 'handlers', 'grant-shape.http.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GRANT_LEDGER_TABLE_NAME: table.tableName,
        AGENT_REGISTRY_TABLE_NAME: registryTable.tableName,
        OPS_BUS_ARN: bus.eventBusArn,
        OPERATING_POLICY_NAME: 'hecaton-operating-policy',
      },
    });

    const revokeLambda = new NodejsFunction(this, 'RevokeShapeLambda', {
      functionName: naming.lambdaName('revoke-shape'),
      entry: join(__dirname, '..', '..', '..', 'api', 'src', 'handlers', 'revoke-shape.http.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GRANT_LEDGER_TABLE_NAME: table.tableName,
        AGENT_REGISTRY_TABLE_NAME: registryTable.tableName,
        OPS_BUS_ARN: bus.eventBusArn,
        OPERATING_POLICY_NAME: 'hecaton-operating-policy',
      },
    });

    const fleetLambda = new NodejsFunction(this, 'QueryFleetStateLambda', {
      functionName: naming.lambdaName('query-fleet-state'),
      entry: join(__dirname, '..', '..', '..', 'api', 'src', 'handlers', 'query-fleet-state.http.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GRANT_LEDGER_TABLE_NAME: table.tableName,
        AGENT_REGISTRY_TABLE_NAME: registryTable.tableName,
        OPS_BUS_ARN: bus.eventBusArn,
        OPERATING_POLICY_NAME: 'hecaton-operating-policy',
      },
    });

    // --- IAM permissions for handler Lambdas ---

    // Grant Lambda: PutItem, Query, DeleteItem on grant ledger; Query, GetItem on registry
    table.grant(grantLambda, 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:DeleteItem');
    registryTable.grant(grantLambda, 'dynamodb:Query', 'dynamodb:GetItem');
    grantLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${registryTable.tableArn}/index/*`],
      }),
    );
    grantLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PutRolePolicy'],
        resources: [`arn:aws:iam::${this.account}:role/hecaton-${stage}-*-agent-role`],
      }),
    );
    bus.grantPutEventsTo(grantLambda);

    // Revoke Lambda: Query, DeleteItem on grant ledger; Query, GetItem on registry
    table.grant(revokeLambda, 'dynamodb:Query', 'dynamodb:DeleteItem');
    registryTable.grant(revokeLambda, 'dynamodb:Query', 'dynamodb:GetItem');
    revokeLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${registryTable.tableArn}/index/*`],
      }),
    );
    revokeLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PutRolePolicy'],
        resources: [`arn:aws:iam::${this.account}:role/hecaton-${stage}-*-agent-role`],
      }),
    );
    bus.grantPutEventsTo(revokeLambda);

    // Fleet Lambda: Scan on grant ledger; Query, GetItem on registry (+ GSI)
    table.grant(fleetLambda, 'dynamodb:Scan');
    registryTable.grant(fleetLambda, 'dynamodb:Query', 'dynamodb:GetItem');
    fleetLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${registryTable.tableArn}/index/*`],
      }),
    );
    bus.grantPutEventsTo(fleetLambda);

    // --- Method integrations ---
    grantsResource.addMethod('POST', new apigateway.LambdaIntegration(grantLambda), {
      apiKeyRequired: true,
    });
    grantsResource.addMethod('DELETE', new apigateway.LambdaIntegration(revokeLambda), {
      apiKeyRequired: true,
    });
    fleetResource.addMethod('GET', new apigateway.LambdaIntegration(fleetLambda), {
      apiKeyRequired: true,
    });

    // --- Usage plan + API key ---
    const plan = api.addUsagePlan('UsagePlan', {
      name: `${naming.apiGatewayName()}-plan`,
      apiStages: [{ api, stage: api.deploymentStage }],
    });
    const apiKey = api.addApiKey('ApiKey');
    plan.addApiKey(apiKey);

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

    new cdk.CfnOutput(this, 'AgentRegistryTableName', {
      value: registryTable.tableName,
      exportName: `${id}-agentRegistryTableName`,
    });

    new cdk.CfnOutput(this, 'AgentRegistryTableArn', {
      value: registryTable.tableArn,
      exportName: `${id}-agentRegistryTableArn`,
    });

    new cdk.CfnOutput(this, 'BreakerLambdaArn', {
      value: breakerLambda.functionArn,
      exportName: `${id}-breakerLambdaArn`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: api.restApiId,
      exportName: `${id}-apiGatewayId`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      exportName: `${id}-apiGatewayUrl`,
    });

    new cdk.CfnOutput(this, 'ApiKeyValue', {
      value: apiKey.keyId,
      exportName: `${id}-apiKeyValue`,
    });
  }
}
