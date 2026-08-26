import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { NamingGenerator } from '@hecaton/core';

import {
  AgentBusChannel,
  AgentBusChannelOutputs,
} from '../constructs/agent-bus-channel.construct.js';
import { AgentConfigStack, AgentConfigStackProps } from './agent-config.stack.js';

/** Tool definition for the CfnHarness. */
export interface HarnessToolConfig {
  /** Tool type identifier (e.g., 'codeInterpreter', 'userInput', 'http'). */
  type: string;
  /** Tool name for reference in allowedTools. */
  name: string;
  /** Tool-specific configuration (varies by type). */
  config?: Record<string, unknown>;
}

/** Skill source definition for the CfnHarness. */
export interface HarnessSkillConfig {
  /** Skill source type. */
  sourceType: 'awsSkills' | 'git' | 's3' | 'filesystem';
  /** Source location (path, URI, or bucket reference). */
  location: string;
  /** Additional source-specific fields. */
  config?: Record<string, unknown>;
}

/** Harness-specific configuration for AgentCoreManagedStack. */
export interface HarnessConfig {
  /** System prompt text (required, non-empty). */
  systemPrompt: string;
  /** Max iterations per invocation (1–1000). Optional — omitted means service default. */
  maxIterations?: number;
  /** Max output tokens per invocation (1–128000). Optional — omitted means service default. */
  maxTokens?: number;
  /** Timeout in seconds per invocation (1–3600). Optional — omitted means service default. */
  timeoutSeconds?: number;
  /** Tools available to the agent. Optional. */
  tools?: HarnessToolConfig[];
  /** Allowed tool names (whitelist). Optional. */
  allowedTools?: string[];
  /** Skills available to the agent. Optional. */
  skills?: HarnessSkillConfig[];
}

/** Signal channel configuration (optional). */
export interface SignalChannelConfig {
  /** ARN of the signals EventBridge bus. */
  signalsBusArn: string;
  /** Source namespace for event filtering. */
  sourceNamespace: string;
  /** Optional subscription patterns for filtering events. */
  subscriptionPatterns?: events.EventPattern[];
}

/** Props for AgentCoreManagedStack. */
export interface AgentCoreManagedStackProps extends AgentConfigStackProps {
  /** Harness-specific configuration (required). */
  harnessConfig: HarnessConfig;
  /** Optional signal channel configuration. */
  signalChannel?: SignalChannelConfig;
}

/**
 * Concrete CDK stack that extends AgentConfigStack to deploy an
 * AWS BedrockAgentCore CfnHarness resource fully wired to the
 * Hecatoncheires governance plane.
 *
 * Validates harness-specific configuration at synthesis time, creates
 * the CfnHarness bound to the governed IAM role, and optionally attaches
 * a signal delivery channel.
 */
export class AgentCoreManagedStack extends AgentConfigStack {
  /** The deterministic harness name. */
  readonly harnessName: string;
  /** Signal channel outputs (undefined if signal channel not configured). */
  readonly signalChannel: AgentBusChannelOutputs | undefined;

  constructor(scope: Construct, id: string, props: AgentCoreManagedStackProps) {
    // --- Validation (ordered, first failure halts synthesis) ---

    // 1. Validate agentType
    if (props.agentType !== 'agentcore-managed') {
      throw new Error(
        `AgentCoreManagedStack: CfnHarness creation is only valid for agentType 'agentcore-managed'`,
      );
    }

    // 2. Validate systemPrompt
    if (!props.harnessConfig.systemPrompt || props.harnessConfig.systemPrompt.trim().length === 0) {
      throw new Error(
        'AgentCoreManagedStack: systemPrompt must be a non-empty, non-whitespace string',
      );
    }

    // 3. Validate maxIterations (if provided)
    if (props.harnessConfig.maxIterations !== undefined) {
      const val = props.harnessConfig.maxIterations;
      if (!Number.isInteger(val) || val < 1 || val > 1000) {
        throw new Error(
          `AgentCoreManagedStack: maxIterations must be a positive integer (1\u20131000), got ${val}`,
        );
      }
    }

    // 4. Validate maxTokens (if provided)
    if (props.harnessConfig.maxTokens !== undefined) {
      const val = props.harnessConfig.maxTokens;
      if (!Number.isInteger(val) || val < 1 || val > 128000) {
        throw new Error(
          `AgentCoreManagedStack: maxTokens must be a positive integer (1\u2013128000), got ${val}`,
        );
      }
    }

    // 5. Validate timeoutSeconds (if provided)
    if (props.harnessConfig.timeoutSeconds !== undefined) {
      const val = props.harnessConfig.timeoutSeconds;
      if (!Number.isInteger(val) || val < 1 || val > 3600) {
        throw new Error(
          `AgentCoreManagedStack: timeoutSeconds must be a positive integer (1\u20133600), got ${val}`,
        );
      }
    }

    // 6. Validate tools[i].type (if tools provided)
    if (props.harnessConfig.tools) {
      for (let i = 0; i < props.harnessConfig.tools.length; i++) {
        const tool = props.harnessConfig.tools[i];
        if (!tool.type || tool.type.trim().length === 0) {
          throw new Error(
            `AgentCoreManagedStack: tools[${i}].type is required and must be non-empty`,
          );
        }
      }
    }

    // --- Call super (creates identity, modulator, appconfig, etc.) ---
    super(scope, id, props);

    const { stage, configName } = props;
    const naming = new NamingGenerator(stage);
    this.harnessName = naming.harnessName(configName);

    // --- CfnHarness resource creation (task 1.2) ---

    // Build model configuration — use the governance-created inference profile ARN
    // (not the raw modelId from the seed) so the agent is forced through it.
    // Uses the first profile ARN as the primary model for the harness.
    const bedrockModelConfig: bedrockagentcore.CfnHarness.HarnessBedrockModelConfigProperty = {
      modelId: this.profileArns[0],
      ...(props.harnessConfig.maxTokens !== undefined && {
        maxTokens: props.harnessConfig.maxTokens,
      }),
    };

    // Build tools array (only if non-empty)
    const tools: bedrockagentcore.CfnHarness.HarnessToolProperty[] | undefined =
      props.harnessConfig.tools && props.harnessConfig.tools.length > 0
        ? props.harnessConfig.tools.map((tool) => ({
            type: tool.type,
            name: tool.name,
          }))
        : undefined;

    // Build skills array (only if non-empty)
    const skills: bedrockagentcore.CfnHarness.HarnessSkillProperty[] | undefined =
      props.harnessConfig.skills && props.harnessConfig.skills.length > 0
        ? props.harnessConfig.skills.map(
            (skill): bedrockagentcore.CfnHarness.HarnessSkillProperty => {
              switch (skill.sourceType) {
                case 'awsSkills':
                  return { awsSkills: { paths: [skill.location] } };
                case 'git':
                  return { git: { url: skill.location } };
                case 's3':
                  return { s3: { uri: skill.location } };
                case 'filesystem':
                  return { path: skill.location };
              }
            },
          )
        : undefined;

    // Build allowedTools (only if non-empty)
    const allowedTools: string[] | undefined =
      props.harnessConfig.allowedTools && props.harnessConfig.allowedTools.length > 0
        ? props.harnessConfig.allowedTools
        : undefined;

    // Build systemPrompt array
    const systemPrompt: bedrockagentcore.CfnHarness.HarnessSystemContentBlockProperty[] = [
      { text: props.harnessConfig.systemPrompt },
    ];

    // Create the CfnHarness resource
    const harness = new bedrockagentcore.CfnHarness(this, 'Harness', {
      executionRoleArn: this.identity.role.roleArn,
      harnessName: this.harnessName,
      model: {
        bedrockModelConfig,
      },
      systemPrompt,
      ...(props.harnessConfig.maxIterations !== undefined && {
        maxIterations: props.harnessConfig.maxIterations,
      }),
      ...(props.harnessConfig.timeoutSeconds !== undefined && {
        timeoutSeconds: props.harnessConfig.timeoutSeconds,
      }),
      ...(tools && { tools }),
      ...(allowedTools && { allowedTools }),
      ...(skills && { skills }),
      tags: naming.tagsToCfn(configName, { phase: '1', harnessType: 'agentcore-managed' }),
    });

    // Add DependsOn to the AgentIdentity role (ensures role is fully created before harness)
    const roleCfnResource = this.identity.role.node.defaultChild as cdk.CfnResource;
    harness.addDependency(roleCfnResource);

    // Create CfnOutput for harnessArn
    new cdk.CfnOutput(this, 'HarnessArn', {
      value: harness.attrArn,
      exportName: `${id}-harnessArn`,
    });

    // --- Signal channel integration (task 1.3) ---
    if (props.signalChannel) {
      const busChannel = new AgentBusChannel(this, 'SignalChannel', {
        configName,
        signalsBusArn: props.signalChannel.signalsBusArn,
        sourceNamespace: props.signalChannel.sourceNamespace,
        subscriptionPatterns: props.signalChannel.subscriptionPatterns,
        agentRole: this.identity.role,
        stage,
      });

      // Pass SIGNAL_QUEUE_URL to harness via environmentVariables
      harness.environmentVariables = {
        SIGNAL_QUEUE_URL: busChannel.outputs.signalsQueue.queueUrl,
      };

      // Create CfnOutput for the signal queue URL
      new cdk.CfnOutput(this, 'SignalQueueUrl', {
        value: busChannel.outputs.signalsQueue.queueUrl,
        exportName: `${id}-signalQueueUrl`,
      });

      this.signalChannel = busChannel.outputs;
    } else {
      this.signalChannel = undefined;
    }
  }
}
