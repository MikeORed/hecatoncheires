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

/** A single profile binding with optional per-profile thresholds. */
export interface ProfileBinding {
  profileEntityId: string;
  profileArn: string;
  modelId: string;
  label: string;
  thresholds?: { outputTokensPerHour: number };
}

/** Props for the AgentPolicyModulator construct. */
export interface AgentPolicyModulatorProps {
  configName: string;
  profileBindings: ProfileBinding[];
  agentRole: iam.IRole;
  agentType: string;
  guardrailId: string;
  breakerLambda: lambda.IFunction;
  agentRegistryTable: dynamodb.ITable;
  stage: string;
  /** Agent-level default thresholds. */
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
}

/** Typed outputs from the AgentPolicyModulator construct. */
export interface AgentPolicyModulatorOutputs {
  perProfileAlarms: Array<{
    label: string;
    tokenAlarm: cloudwatch.IAlarm;
    blockAlarm: cloudwatch.IAlarm;
    observationAlarm: cloudwatch.IAlarm;
  }>;
  compositeAlarm: cloudwatch.CompositeAlarm;
}

/**
 * AgentPolicyModulator construct — composes per-profile CloudWatch alarms
 * with a single composite alarm that targets the shared Breaker Lambda,
 * and deploys a RegistrySeed custom resource that manages the agent's
 * registry records.
 */
export class AgentPolicyModulator extends Construct {
  readonly outputs: AgentPolicyModulatorOutputs;

  constructor(scope: Construct, id: string, props: AgentPolicyModulatorProps) {
    super(scope, id);

    // --- Validation ---
    if (!props.configName || props.configName.trim().length === 0) {
      throw new Error('AgentPolicyModulator: configName must be non-empty');
    }
    if (!props.profileBindings || props.profileBindings.length === 0) {
      throw new Error('AgentPolicyModulator: profileBindings must be non-empty');
    }
    this.validateThresholds(props.thresholds);

    const naming = new NamingGenerator(props.stage);

    // --- Per-Profile CloudWatch Alarms ---
    const allAlarms: cloudwatch.IAlarm[] = [];
    const perProfileAlarms: AgentPolicyModulatorOutputs['perProfileAlarms'] = [];

    for (const binding of props.profileBindings) {
      const names = naming.perProfileAlarmNames(props.configName, binding.label);
      const effectiveTokenThreshold =
        binding.thresholds?.outputTokensPerHour ?? props.thresholds.outputTokensPerHour;

      const tokenAlarm = new cloudwatch.Alarm(this, `TokenAlarm-${binding.label}`, {
        alarmName: names.token,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'OutputTokenCount',
          dimensionsMap: { InferenceProfileId: binding.profileEntityId },
          statistic: 'Sum',
          period: cdk.Duration.seconds(3600),
        }),
        threshold: effectiveTokenThreshold,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      const blockAlarm = new cloudwatch.Alarm(this, `BlockAlarm-${binding.label}`, {
        alarmName: names.block,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'GuardrailBlocked',
          dimensionsMap: { InferenceProfileId: binding.profileEntityId },
          statistic: 'Sum',
          period: cdk.Duration.seconds(600),
        }),
        threshold: props.thresholds.guardrailBlocksPer10Min,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      const observationAlarm = new cloudwatch.Alarm(this, `ObservationAlarm-${binding.label}`, {
        alarmName: names.observation,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'GuardrailObserved',
          dimensionsMap: { InferenceProfileId: binding.profileEntityId },
          statistic: 'Sum',
          period: cdk.Duration.seconds(3600),
        }),
        threshold: props.thresholds.guardrailObservationsPerHour,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      allAlarms.push(tokenAlarm, blockAlarm, observationAlarm);
      perProfileAlarms.push({ label: binding.label, tokenAlarm, blockAlarm, observationAlarm });
    }

    // --- Composite Alarm → Breaker Lambda ---
    const compositeAlarm = new cloudwatch.CompositeAlarm(this, 'CompositeAlarm', {
      compositeAlarmName: `${naming.projectPrefix}-${props.stage}-${props.configName}-composite`,
      alarmRule: cloudwatch.AlarmRule.anyOf(...allAlarms),
    });

    const compositeAction: cloudwatch.IAlarmAction = {
      bind: () => ({ alarmActionArn: props.breakerLambda.functionArn }),
    };
    compositeAlarm.addAlarmAction(compositeAction);

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
        profiles: props.profileBindings.map((b) => ({
          profileEntityId: b.profileEntityId,
          profileArn: b.profileArn,
          modelId: b.modelId,
          label: b.label,
        })),
        agentType: props.agentType,
        guardrailId: props.guardrailId,
      },
    });

    // Expose agentId as CfnOutput
    const agentId = registrySeedCR.getAttString('agentId');
    new cdk.CfnOutput(this, 'AgentId', {
      value: agentId,
      exportName: `${cdk.Stack.of(this).stackName}-agentId`,
    });

    // --- Outputs ---
    this.outputs = { perProfileAlarms, compositeAlarm };
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
