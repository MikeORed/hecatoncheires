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

/** A single model binding within the agent configuration. */
export interface ModelBindingProp {
  /** Bedrock model ID for this inference profile. */
  modelId: string;
  /** Human-readable label (lowercase alphanumeric + hyphens, max 30 chars). */
  label: string;
  /** Optional per-profile alarm thresholds (overrides agent-level defaults). */
  thresholds?: { outputTokensPerHour: number };
}

export interface AgentConfigStackProps extends cdk.StackProps {
  /** Deployment stage (e.g., 'dev', 'staging', 'prod'). */
  stage: string;
  /** Agent configuration name — must match ConfigNamePattern. */
  configName: string;
  /** Agent harness type — determines trust policy principal. */
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  /** Ordered model bindings — each produces its own inference profile. */
  modelBindings: ModelBindingProp[];
  /** Optional per-agent guardrail overrides merged with the default config. */
  guardrailOverrides?: Partial<GuardrailPolicyConfig>;
  /** Required when agentType === 'openclaw'. The IAM principal ARN trusted to assume this role. */
  externalPrincipalArn?: string;
  /** CloudWatch alarm thresholds for the AgentPolicyModulator (agent-level defaults). */
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
 * Validates configuration, creates one inference profile per model binding and
 * guardrail resources, then instantiates AgentIdentity passing the resolved
 * profileArns and guardrailId. After identity is established, instantiates
 * AgentPolicyModulator with alarms and registry seeding. Subclasses extend this
 * to add further constructs (bus channel, etc.).
 */
export abstract class AgentConfigStack extends cdk.Stack {
  /** The AgentIdentity outputs — always available after construction. */
  readonly identity: AgentIdentityOutputs;

  /** All inference profile ARNs (one per model binding). */
  readonly profileArns: string[];

  /** Detailed profile outputs for each model binding (arn, entityId, label, modelId). */
  readonly profileOutputs: Array<{ arn: string; entityId: string; label: string; modelId: string }>;

  /** The AgentPolicyModulator outputs — alarms exposed for cross-stack references. */
  readonly modulator: AgentPolicyModulatorOutputs;

  constructor(scope: Construct, id: string, props: AgentConfigStackProps) {
    super(scope, id, props);

    const { stage, configName, agentType, sharedInfra, externalPrincipalArn } = props;

    // --- 1. Validate configName against ConfigNamePattern ---
    if (!ConfigNamePattern.test(configName)) {
      throw new Error(
        `AgentConfigStack: configName '${configName}' does not match ConfigNamePattern. ` +
          'configName must start with a lowercase letter, end with a lowercase letter or digit, ' +
          'and contain only lowercase letters, digits, and hyphens.',
      );
    }

    // --- 2. Validate modelBindings array is non-empty ---
    if (!props.modelBindings || props.modelBindings.length === 0) {
      throw new Error(
        `AgentConfigStack: at least one model binding is required (configName: ${configName}).`,
      );
    }

    const naming = new NamingGenerator(stage);

    // --- 3. Create one inference profile per model binding ---
    const profileOutputs: Array<{
      arn: string;
      entityId: string;
      label: string;
      modelId: string;
    }> = [];

    for (const binding of props.modelBindings) {
      if (!binding.modelId || binding.modelId.trim().length === 0) {
        throw new Error(
          `AgentConfigStack: modelId must be a non-empty string for binding "${binding.label}" (configName: ${configName}).`,
        );
      }

      const profile = new bedrock.CfnApplicationInferenceProfile(
        this,
        `InferenceProfile-${binding.label}`,
        {
          inferenceProfileName: naming.multiProfileName(configName, binding.label),
          modelSource: { copyFrom: binding.modelId },
          tags: naming.tagsToCfn(configName, { phase: '1' }),
        },
      );

      profileOutputs.push({
        arn: profile.attrInferenceProfileArn,
        entityId: profile.attrInferenceProfileId,
        label: binding.label,
        modelId: binding.modelId,
      });
    }

    this.profileOutputs = profileOutputs;
    this.profileArns = profileOutputs.map((p) => p.arn);

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

    // --- 5. Instantiate AgentIdentity with resolved profileArns and guardrailId ---
    const agentIdentity = new AgentIdentity(this, 'AgentIdentity', {
      configName,
      agentType,
      profileArns: this.profileArns,
      guardrailId,
      externalPrincipalArn,
      stage,
      tags: naming.tags(configName, { phase: '1' }),
    });

    this.identity = agentIdentity.outputs;

    // --- 6. Instantiate AgentPolicyModulator (per-profile alarms + composite + registry seed) ---
    const modulator = new AgentPolicyModulator(this, 'PolicyModulator', {
      configName,
      profileBindings: profileOutputs.map((p, i) => ({
        profileEntityId: p.entityId,
        profileArn: p.arn,
        modelId: p.modelId,
        label: p.label,
        thresholds: props.modelBindings[i].thresholds,
      })),
      agentRole: agentIdentity.outputs.role,
      agentType,
      guardrailId,
      breakerLambda: sharedInfra.breakerLambda,
      agentRegistryTable: sharedInfra.agentRegistryTable,
      stage,
      thresholds: props.thresholds,
    });

    this.modulator = modulator.outputs;

    // --- 7. CfnOutputs for profile entity IDs ---
    for (const profile of profileOutputs) {
      new cdk.CfnOutput(this, `ProfileEntityId-${profile.label}`, {
        value: profile.entityId,
        exportName: `${id}-profileEntityId-${profile.label}`,
      });
    }

    // --- 8. AppConfig runtime tunables profile ---
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

    // --- 9. Apply standard tags ---
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
