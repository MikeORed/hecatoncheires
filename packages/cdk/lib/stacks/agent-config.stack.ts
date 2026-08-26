import * as cdk from 'aws-cdk-lib';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { NamingGenerator, ConfigNamePattern } from '@hecaton/core';

import {
  AgentIdentity,
  AgentIdentityOutputs,
} from '../constructs/agent-identity.construct.js';
import {
  AgentPolicyModulator,
  AgentPolicyModulatorOutputs,
} from '../constructs/agent-policy-modulator.construct.js';
import { GuardrailPolicyConfig } from './shared-infra.stack.js';

export interface AgentConfigStackProps extends cdk.StackProps {
  /** Deployment stage (e.g., 'dev', 'staging', 'prod'). */
  stage: string;
  /** Agent configuration name — must match ConfigNamePattern. */
  configName: string;
  /** Agent harness type — determines trust policy principal. */
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  /** Bedrock model ID for the inference profile. */
  modelId: string;
  /** Optional per-agent guardrail overrides merged with the default config. */
  guardrailOverrides?: Partial<GuardrailPolicyConfig>;
  /** Required when agentType === 'openclaw'. The IAM principal ARN trusted to assume this role. */
  externalPrincipalArn?: string;
  /** CloudWatch alarm thresholds for the AgentPolicyModulator. */
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
  /** Cross-stack references from SharedInfraStack. */
  sharedInfra: {
    opsBus: events.IEventBus;
    snsTopic: sns.ITopic;
    grantLedgerTable: dynamodb.ITable;
    defaultGuardrailConfig: GuardrailPolicyConfig;
    breakerLambda: lambda.IFunction;
    agentRegistryTable: dynamodb.ITable;
    appConfigAppId: string;
    appConfigEnvId: string;
  };
}

/**
 * Abstract base class for per-agent configuration stacks.
 *
 * Validates configuration, creates the inference profile and guardrail resources,
 * then instantiates AgentIdentity passing the resolved profileArn and guardrailId.
 * After identity is established, instantiates AgentPolicyModulator with alarms and
 * registry seeding. Subclasses extend this to add further constructs (bus channel, etc.).
 */
export abstract class AgentConfigStack extends cdk.Stack {
  /** The AgentIdentity outputs — always available after construction. */
  readonly identity: AgentIdentityOutputs;

  /** The inference profile ARN (CloudFormation token at synth time). */
  readonly profileArn: string;

  /** The inference profile entity ID (CloudFormation token at synth time). */
  readonly profileEntityId: string;

  /** The AgentPolicyModulator outputs — alarms exposed for cross-stack references. */
  readonly modulator: AgentPolicyModulatorOutputs;

  constructor(scope: Construct, id: string, props: AgentConfigStackProps) {
    super(scope, id, props);

    const { stage, configName, agentType, modelId, sharedInfra, externalPrincipalArn } = props;

    // --- 1. Validate configName against ConfigNamePattern ---
    if (!ConfigNamePattern.test(configName)) {
      throw new Error(
        `AgentConfigStack: configName '${configName}' does not match ConfigNamePattern. ` +
          'configName must start with a lowercase letter, end with a lowercase letter or digit, ' +
          'and contain only lowercase letters, digits, and hyphens.',
      );
    }

    // --- 2. Validate modelId is non-empty ---
    if (!modelId || modelId.trim().length === 0) {
      throw new Error(
        `AgentConfigStack: modelId must be a non-empty string (configName: ${configName}).`,
      );
    }

    const naming = new NamingGenerator(stage);

    // --- 3. Create inference profile (CfnApplicationInferenceProfile) ---
    const inferenceProfile = new bedrock.CfnApplicationInferenceProfile(
      this,
      'InferenceProfile',
      {
        inferenceProfileName: naming.profileName(configName),
        modelSource: {
          copyFrom: modelId,
        },
        tags: naming.tagsToCfn(configName, { phase: '1' }),
      },
    );

    const profileArn = inferenceProfile.attrInferenceProfileArn;
    this.profileArn = profileArn;

    // --- 4. Create Bedrock guardrail (merge defaultGuardrailConfig + overrides) ---
    const mergedConfig = this.mergeGuardrailConfig(
      sharedInfra.defaultGuardrailConfig,
      props.guardrailOverrides,
    );

    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: naming.guardrailName(configName),
      blockedInputMessaging:
        'Your request was blocked by the content safety guardrail.',
      blockedOutputsMessaging:
        'The response was blocked by the content safety guardrail.',
      contentPolicyConfig: {
        filtersConfig: mergedConfig.contentFilters.map((filter) => ({
          type: filter.type,
          inputStrength: filter.inputStrength,
          outputStrength: filter.outputStrength,
        })),
      },
      topicPolicyConfig:
        mergedConfig.deniedTopics.length > 0
          ? {
              topicsConfig: mergedConfig.deniedTopics.map((topic) => ({
                name: topic.name,
                definition: topic.definition,
                examples: topic.examples,
                type: 'DENY',
              })),
            }
          : undefined,
      tags: naming.tagsToCfn(configName, { phase: '1' }),
    });

    const guardrailId = guardrail.attrGuardrailId;

    // --- 5. Instantiate AgentIdentity with resolved profileArn and guardrailId ---
    const agentIdentity = new AgentIdentity(this, 'AgentIdentity', {
      configName,
      agentType,
      profileArn,
      guardrailId,
      externalPrincipalArn,
      stage,
      tags: naming.tags(configName, { phase: '1' }),
    });

    this.identity = agentIdentity.outputs;

    // --- 6. Expose profileEntityId ---
    const profileEntityId = inferenceProfile.attrInferenceProfileId;
    this.profileEntityId = profileEntityId;

    // --- 7. Instantiate AgentPolicyModulator (alarms + registry seed) ---
    const modulator = new AgentPolicyModulator(this, 'PolicyModulator', {
      configName,
      profileEntityId,
      profileArn,
      modelId,
      agentRole: agentIdentity.outputs.role,
      agentType,
      guardrailId,
      breakerLambda: sharedInfra.breakerLambda,
      agentRegistryTable: sharedInfra.agentRegistryTable,
      stage,
      thresholds: props.thresholds,
    });

    this.modulator = modulator.outputs;

    // --- 8. CfnOutput for profileEntityId ---
    new cdk.CfnOutput(this, 'ProfileEntityId', {
      value: profileEntityId,
      exportName: `${id}-profileEntityId`,
    });

    // --- 9. AppConfig runtime tunables profile ---
    const appConfigProfile = new appconfig.CfnConfigurationProfile(this, 'AppConfigProfile', {
      applicationId: sharedInfra.appConfigAppId,
      name: naming.appConfigProfileName(configName),
      locationUri: 'hosted',
      tags: naming.tagsToCfn(configName, { phase: '1' }),
    });

    const tunablesContent = JSON.stringify({
      thresholds: props.thresholds,
      featureFlags: {
        pipelineSpeedBreaker: false,
        timeBoxedGrants: false,
      },
    });

    const hostedConfigVersion = new appconfig.CfnHostedConfigurationVersion(
      this,
      'AppConfigHostedVersion',
      {
        applicationId: sharedInfra.appConfigAppId,
        configurationProfileId: appConfigProfile.ref,
        content: tunablesContent,
        contentType: 'application/json',
      },
    );

    const strategyConfig =
      stage === 'dev'
        ? {
            deploymentDurationInMinutes: 0,
            growthFactor: 100,
            finalBakeTimeInMinutes: 0,
          }
        : {
            deploymentDurationInMinutes: 10,
            growthFactor: 10,
            finalBakeTimeInMinutes: 2,
          };

    const deploymentStrategy = new appconfig.CfnDeploymentStrategy(
      this,
      'AppConfigDeploymentStrategy',
      {
        name: `${naming.projectPrefix}-${stage}-${configName}-strategy`,
        deploymentDurationInMinutes: strategyConfig.deploymentDurationInMinutes,
        growthFactor: strategyConfig.growthFactor,
        finalBakeTimeInMinutes: strategyConfig.finalBakeTimeInMinutes,
        replicateTo: 'NONE',
        tags: naming.tagsToCfn(configName, { phase: '1' }),
      },
    );

    new appconfig.CfnDeployment(this, 'AppConfigDeployment', {
      applicationId: sharedInfra.appConfigAppId,
      environmentId: sharedInfra.appConfigEnvId,
      configurationProfileId: appConfigProfile.ref,
      configurationVersion: hostedConfigVersion.ref,
      deploymentStrategyId: deploymentStrategy.ref,
      tags: naming.tagsToCfn(configName, { phase: '1' }),
    });

    // --- 10. Apply standard tags ---
    cdk.Tags.of(this).add(`${naming.projectFullName}:managed`, 'true');
    cdk.Tags.of(this).add(`${naming.projectFullName}:config`, configName);
    cdk.Tags.of(this).add(`${naming.projectFullName}:stage`, stage);
    cdk.Tags.of(this).add(`${naming.projectFullName}:phase`, '1');
  }

  /**
   * Merge the default guardrail config with per-agent overrides.
   * Override content filters replace by type; denied topics are appended.
   */
  private mergeGuardrailConfig(
    defaultConfig: GuardrailPolicyConfig,
    overrides?: Partial<GuardrailPolicyConfig>,
  ): GuardrailPolicyConfig {
    if (!overrides) {
      return defaultConfig;
    }

    // Merge content filters: override filters replace default filters by type
    const contentFilters = [...defaultConfig.contentFilters];
    if (overrides.contentFilters) {
      for (const override of overrides.contentFilters) {
        const idx = contentFilters.findIndex((f) => f.type === override.type);
        if (idx >= 0) {
          contentFilters[idx] = override;
        } else {
          contentFilters.push(override);
        }
      }
    }

    // Merge denied topics: append override topics to default topics
    const deniedTopics = [
      ...defaultConfig.deniedTopics,
      ...(overrides.deniedTopics ?? []),
    ];

    return { contentFilters, deniedTopics };
  }
}
