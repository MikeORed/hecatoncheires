import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { NamingGenerator, EnvVar } from '@hecaton/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Props for the AgentPolicyModulator construct. */
export interface AgentPolicyModulatorProps {
  configName: string;
  profileEntityId: string;
  profileArn: string;
  modelId: string;
  agentRole: iam.IRole;
  agentType: string;
  guardrailId: string;
  breakerLambda: lambda.IFunction;
  agentRegistryTable: dynamodb.ITable;
  stage: string;
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
}

/** Typed outputs from the AgentPolicyModulator construct. */
export interface AgentPolicyModulatorOutputs {
  tokenAlarm: cloudwatch.IAlarm;
  blockAlarm: cloudwatch.IAlarm;
  observationAlarm: cloudwatch.IAlarm;
}

/**
 * AgentPolicyModulator construct — composes per-agent CloudWatch alarms
 * that target the shared Breaker Lambda, and deploys a RegistrySeed custom
 * resource that manages the agent's registry records.
 */
export class AgentPolicyModulator extends Construct {
  readonly outputs: AgentPolicyModulatorOutputs;

  constructor(scope: Construct, id: string, props: AgentPolicyModulatorProps) {
    super(scope, id);

    // --- Validation ---
    if (!props.configName || props.configName.trim().length === 0) {
      throw new Error('AgentPolicyModulator: configName must be non-empty');
    }
    if (!props.profileEntityId || props.profileEntityId.trim().length === 0) {
      throw new Error('AgentPolicyModulator: profileEntityId must be non-empty');
    }
    this.validateThresholds(props.thresholds);

    const naming = new NamingGenerator(props.stage);
    const alarmNames = naming.alarmNames(props.configName);

    // --- CloudWatch Alarms ---
    const metricDimension = { InferenceProfileId: props.profileEntityId };

    const tokenAlarm = new cloudwatch.Alarm(this, 'TokenAlarm', {
      alarmName: alarmNames.token,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'OutputTokenCount',
        dimensionsMap: metricDimension,
        statistic: 'Sum',
        period: cdk.Duration.seconds(3600),
      }),
      threshold: props.thresholds.outputTokensPerHour,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const blockAlarm = new cloudwatch.Alarm(this, 'BlockAlarm', {
      alarmName: alarmNames.block,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'GuardrailBlocked',
        dimensionsMap: metricDimension,
        statistic: 'Sum',
        period: cdk.Duration.seconds(600),
      }),
      threshold: props.thresholds.guardrailBlocksPer10Min,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const observationAlarm = new cloudwatch.Alarm(this, 'ObservationAlarm', {
      alarmName: alarmNames.observation,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'GuardrailObserved',
        dimensionsMap: metricDimension,
        statistic: 'Sum',
        period: cdk.Duration.seconds(3600),
      }),
      threshold: props.thresholds.guardrailObservationsPerHour,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- Alarm actions → Breaker Lambda ---
    // Use a simple alarm action config that points to the Lambda ARN without
    // adding permissions here (permissions are managed in SharedInfraStack to
    // avoid cross-stack circular dependencies).
    const alarmActionConfig: cloudwatch.IAlarmAction = {
      bind: () => ({ alarmActionArn: props.breakerLambda.functionArn }),
    };
    tokenAlarm.addAlarmAction(alarmActionConfig);
    blockAlarm.addAlarmAction(alarmActionConfig);
    observationAlarm.addAlarmAction(alarmActionConfig);

    // --- RegistrySeed Custom Resource ---
    const registrySeedHandler = new NodejsFunction(this, 'RegistrySeedHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      entry: join(__dirname, '..', 'lambda', 'registry-seed.handler.ts'),
      bundling: {
        externalModules: ['@aws-sdk/*'],
        target: 'node20',
      },
      environment: {
        [EnvVar.AGENT_REGISTRY_TABLE_NAME]: props.agentRegistryTable.tableName,
      },
    });

    // Grant DynamoDB permissions to seed handler
    props.agentRegistryTable.grant(
      registrySeedHandler,
      'dynamodb:PutItem',
      'dynamodb:GetItem',
      'dynamodb:DeleteItem',
      'dynamodb:TransactWriteItems',
    );

    const provider = new cr.Provider(this, 'RegistrySeedProvider', {
      onEventHandler: registrySeedHandler,
    });

    const registrySeedCR = new cdk.CustomResource(this, 'RegistrySeed', {
      serviceToken: provider.serviceToken,
      properties: {
        configName: props.configName,
        roleName: props.agentRole.roleName,
        profileEntityId: props.profileEntityId,
        profileArn: props.profileArn,
        agentType: props.agentType,
        modelId: props.modelId,
        guardrailId: props.guardrailId,
      },
    });

    // Expose agentId as CfnOutput
    const agentId = registrySeedCR.getAttString('agentId');
    new cdk.CfnOutput(this, 'AgentId', {
      value: agentId,
      exportName: `${cdk.Stack.of(this).stackName}-agentId`,
    });

    // --- Tags ---
    const tags = naming.tags(props.configName, { phase: '1' });
    for (const [key, value] of Object.entries(tags)) {
      cdk.Tags.of(this).add(key, value);
    }

    // --- Outputs ---
    this.outputs = { tokenAlarm, blockAlarm, observationAlarm };
  }

  private validateThresholds(thresholds: AgentPolicyModulatorProps['thresholds']): void {
    const entries = Object.entries(thresholds) as [string, number][];
    for (const [key, value] of entries) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `AgentPolicyModulator: thresholds.${key} must be a positive integer, got ${value}`,
        );
      }
    }
  }
}
