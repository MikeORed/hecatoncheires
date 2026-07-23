import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { NamingGenerator, ConfigNamePattern } from '@hecaton/core';

import {
  AgentIdentity,
  AgentIdentityOutputs,
} from '../constructs/agent-identity.construct.js';
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
  /** Cross-stack references from SharedInfraStack. */
  sharedInfra: {
    opsBus: events.IEventBus;
    snsTopic: sns.ITopic;
    grantLedgerTable: dynamodb.ITable;
    defaultGuardrailConfig: GuardrailPolicyConfig;
  };
}

/**
 * Abstract base class for per-agent configuration stacks.
 *
 * Validates configuration, creates the inference profile and guardrail resources,
 * then instantiates AgentIdentity passing the resolved profileArn and guardrailId.
 * Subclasses extend this to add further constructs (policy modulator, bus channel, etc.).
 */
export abstract class AgentConfigStack extends cdk.Stack {
  /** The AgentIdentity outputs — always available after construction. */
  readonly identity: AgentIdentityOutputs;

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
        tags: [
          { key: 'hecatoncheires:managed', value: 'true' },
          { key: 'hecatoncheires:config', value: configName },
          { key: 'hecatoncheires:stage', value: stage },
          { key: 'hecatoncheires:phase', value: '1' },
        ],
      },
    );

    const profileArn = inferenceProfile.attrInferenceProfileArn;

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
      tags: [
        { key: 'hecatoncheires:managed', value: 'true' },
        { key: 'hecatoncheires:config', value: configName },
        { key: 'hecatoncheires:stage', value: stage },
        { key: 'hecatoncheires:phase', value: '1' },
      ],
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
      tags: {
        'hecatoncheires:managed': 'true',
        'hecatoncheires:config': configName,
        'hecatoncheires:stage': stage,
        'hecatoncheires:phase': '1',
      },
    });

    this.identity = agentIdentity.outputs;

    // --- 6. Apply standard tags ---
    cdk.Tags.of(this).add('hecatoncheires:managed', 'true');
    cdk.Tags.of(this).add('hecatoncheires:config', configName);
    cdk.Tags.of(this).add('hecatoncheires:stage', stage);
    cdk.Tags.of(this).add('hecatoncheires:phase', '1');
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
