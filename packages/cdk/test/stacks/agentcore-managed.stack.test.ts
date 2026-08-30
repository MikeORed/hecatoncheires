import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NamingGenerator } from '@hecaton/core';
import { SharedInfraStack } from '../../lib/stacks/shared-infra.stack.js';
import {
  AgentCoreManagedStack,
  AgentCoreManagedStackProps,
  HarnessConfig,
} from '../../lib/stacks/agentcore-managed.stack.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManagedTestStacks(overrides?: Partial<{
  stage: string;
  configName: string;
  modelBindings: Array<{ modelId: string; label: string; thresholds?: { outputTokensPerHour: number } }>;
  harnessConfig: Partial<HarnessConfig>;
  signalChannel: AgentCoreManagedStackProps['signalChannel'];
}>) {
  const stage = overrides?.stage ?? 'test';
  const configName = overrides?.configName ?? 'test-managed';
  const modelBindings = overrides?.modelBindings ?? [
    { modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0', label: 'default' },
  ];

  const app = new cdk.App();
  const sharedInfra = new SharedInfraStack(app, 'SharedInfra', { stage });

  const harnessConfig: HarnessConfig = {
    systemPrompt: 'Test system prompt for managed agent.',
    ...overrides?.harnessConfig,
  };

  const managedStack = new AgentCoreManagedStack(app, 'ManagedStack', {
    stage,
    configName,
    agentType: 'agentcore-managed',
    modelBindings,
    thresholds: {
      outputTokensPerHour: 500,
      guardrailBlocksPer10Min: 3,
      guardrailObservationsPerHour: 20,
    },
    harnessConfig,
    signalChannel: overrides?.signalChannel,
    sharedInfra: {
      opsBus: sharedInfra.opsBus,
      snsTopic: sharedInfra.snsTopic,
      grantLedgerTable: sharedInfra.grantLedgerTable,
      defaultGuardrailConfig: sharedInfra.defaultGuardrailConfig,
      breakerLambda: sharedInfra.breakerLambda,
      agentRegistryTable: sharedInfra.agentRegistryTable,
      appConfigAppId: sharedInfra.appConfigAppId,
      appConfigEnvId: sharedInfra.appConfigEnvId,
    },
  });

  return {
    app,
    sharedInfra,
    managedStack,
    template: Template.fromStack(managedStack),
  };
}

// ---------------------------------------------------------------------------
// Pre-synthesized stacks for the default config
// ---------------------------------------------------------------------------
const defaultStacks = createManagedTestStacks();
const defaultTemplate = defaultStacks.template;
const defaultManagedStack = defaultStacks.managedStack;

// ---------------------------------------------------------------------------
// Task 5.1: CfnHarness resource creation tests
// Validates: Requirements 9.1, 9.2, 9.3, 9.6, 9.9
// ---------------------------------------------------------------------------

describe('AgentCoreManagedStack — CfnHarness resource creation', () => {
  it('creates exactly 1 AWS::BedrockAgentCore::Harness resource', () => {
    defaultTemplate.resourceCountIs('AWS::BedrockAgentCore::Harness', 1);
  });

  it('sets executionRoleArn to the AgentIdentity role via Fn::GetAtt', () => {
    defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      ExecutionRoleArn: Match.objectLike({
        'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('.*Role.*'), 'Arn']),
      }),
    });
  });

  it('sets harnessName matching NamingGenerator.harnessName pattern', () => {
    const naming = new NamingGenerator('test');
    defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      HarnessName: naming.harnessName('test-managed'),
    });
  });

  it('sets model.bedrockModelConfig.modelId to the inference profile ARN (not raw modelId)', () => {
    defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Model: Match.objectLike({
        BedrockModelConfig: Match.objectLike({
          ModelId: {
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('InferenceProfile'),
              'InferenceProfileArn',
            ]),
          },
        }),
      }),
    });
  });

  it('sets systemPrompt containing a content block with the provided text', () => {
    defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      SystemPrompt: Match.arrayWith([
        Match.objectLike({ Text: 'Test system prompt for managed agent.' }),
      ]),
    });
  });

  it('applies all four standard Hecatoncheires agent tags', () => {
    const naming = new NamingGenerator('test');
    const expectedTags = [
      { Key: `${naming.projectFullName}:managed`, Value: 'true' },
      { Key: `${naming.projectFullName}:config`, Value: 'test-managed' },
      { Key: `${naming.projectFullName}:stage`, Value: 'test' },
      { Key: `${naming.projectFullName}:agent-type`, Value: 'agentcore-managed' },
    ];

    for (const tag of expectedTags) {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Tags: Match.arrayWith([Match.objectLike(tag)]),
      });
    }
  });

  it('exposes harnessName property matching NamingGenerator pattern', () => {
    const naming = new NamingGenerator('test');
    expect(defaultManagedStack.harnessName).toBe(naming.harnessName('test-managed'));
  });

  it('uses a different modelId for the inference profile when configured', () => {
    const { template } = createManagedTestStacks({
      modelBindings: [{ modelId: 'us.anthropic.claude-haiku-3-20240307-v1:0', label: 'default' }],
    });
    // The inference profile resource uses the seed modelId as its source
    template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
      ModelSource: Match.objectLike({
        CopyFrom: 'us.anthropic.claude-haiku-3-20240307-v1:0',
      }),
    });
    // The harness still references the profile ARN (not the raw modelId)
    template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      Model: Match.objectLike({
        BedrockModelConfig: Match.objectLike({
          ModelId: {
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('InferenceProfile'),
              'InferenceProfileArn',
            ]),
          },
        }),
      }),
    });
  });

  it('uses a different configName for harnessName when configured', () => {
    const { template } = createManagedTestStacks({ configName: 'my-agent' });
    const naming = new NamingGenerator('test');
    template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
      HarnessName: naming.harnessName('my-agent'),
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.2: Harness-native limits (presence/absence)
// Validates: Requirements 9.4, 9.5
// ---------------------------------------------------------------------------

describe('AgentCoreManagedStack — Harness-native limits', () => {
  describe('maxIterations', () => {
    it('is absent from template when not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: Match.absent(),
      });
    });

    it('is present in template when provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', maxIterations: 50 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: 50,
      });
    });
  });

  describe('maxTokens', () => {
    it('is absent from Model.BedrockModelConfig when not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: Match.absent(),
          }),
        }),
      });
    });

    it('is present in Model.BedrockModelConfig when provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', maxTokens: 8192 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: 8192,
          }),
        }),
      });
    });
  });

  describe('timeoutSeconds', () => {
    it('is absent from template when not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        TimeoutSeconds: Match.absent(),
      });
    });

    it('is present in template when provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', timeoutSeconds: 300 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        TimeoutSeconds: 300,
      });
    });
  });

  describe('independence and combination', () => {
    it('sets maxIterations independently without affecting other limits', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', maxIterations: 25 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: 25,
        TimeoutSeconds: Match.absent(),
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: Match.absent(),
          }),
        }),
      });
    });

    it('sets maxTokens independently without affecting other limits', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', maxTokens: 4096 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: Match.absent(),
        TimeoutSeconds: Match.absent(),
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: 4096,
          }),
        }),
      });
    });

    it('sets timeoutSeconds independently without affecting other limits', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', timeoutSeconds: 600 },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: Match.absent(),
        TimeoutSeconds: 600,
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: Match.absent(),
          }),
        }),
      });
    });

    it('sets all three limits together when all are provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          maxIterations: 50,
          maxTokens: 8192,
          timeoutSeconds: 300,
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        MaxIterations: 50,
        TimeoutSeconds: 300,
        Model: Match.objectLike({
          BedrockModelConfig: Match.objectLike({
            MaxTokens: 8192,
          }),
        }),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.3: Tool/Skill configuration and Signal Channel integration
// Validates: Requirements 9.4, 9.5, 9.8
// ---------------------------------------------------------------------------

describe('AgentCoreManagedStack — Tool and Skill configuration', () => {
  describe('tools', () => {
    it('maps tools array 1:1 preserving order when provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          tools: [
            { type: 'codeInterpreter', name: 'code' },
            { type: 'http', name: 'api' },
          ],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Tools: [
          Match.objectLike({ Type: 'codeInterpreter', Name: 'code' }),
          Match.objectLike({ Type: 'http', Name: 'api' }),
        ],
      });
    });

    it('is absent from template when tools is not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Tools: Match.absent(),
      });
    });

    it('is absent from template when tools is an empty array', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', tools: [] },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Tools: Match.absent(),
      });
    });
  });

  describe('allowedTools', () => {
    it('preserves allowedTools array in order when provided', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          allowedTools: ['code', 'api'],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        AllowedTools: ['code', 'api'],
      });
    });

    it('is absent from template when allowedTools is not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        AllowedTools: Match.absent(),
      });
    });

    it('is absent from template when allowedTools is an empty array', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', allowedTools: [] },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        AllowedTools: Match.absent(),
      });
    });
  });

  describe('skills', () => {
    it('maps skills array 1:1 when provided (awsSkills source)', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          skills: [{ sourceType: 'awsSkills', location: '/path/to/skill' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: [Match.objectLike({ AwsSkills: { Paths: ['/path/to/skill'] } })],
      });
    });

    it('maps git skill source correctly', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          skills: [{ sourceType: 'git', location: 'https://github.com/example/repo' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: [Match.objectLike({ Git: { Url: 'https://github.com/example/repo' } })],
      });
    });

    it('maps s3 skill source correctly', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          skills: [{ sourceType: 's3', location: 's3://my-bucket/skill.zip' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: [Match.objectLike({ S3: { Uri: 's3://my-bucket/skill.zip' } })],
      });
    });

    it('maps filesystem skill source correctly', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          skills: [{ sourceType: 'filesystem', location: '/local/path/skill' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: [Match.objectLike({ Path: '/local/path/skill' })],
      });
    });

    it('is absent from template when skills is not provided', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: Match.absent(),
      });
    });

    it('is absent from template when skills is an empty array', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: { systemPrompt: 'Test prompt.', skills: [] },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: Match.absent(),
      });
    });
  });

  describe('independence', () => {
    it('tools presence does not affect skills or allowedTools', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          tools: [{ type: 'codeInterpreter', name: 'code' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Tools: Match.arrayWith([Match.objectLike({ Type: 'codeInterpreter' })]),
        Skills: Match.absent(),
        AllowedTools: Match.absent(),
      });
    });

    it('skills presence does not affect tools or allowedTools', () => {
      const { template } = createManagedTestStacks({
        harnessConfig: {
          systemPrompt: 'Test prompt.',
          skills: [{ sourceType: 'awsSkills', location: '/skill' }],
        },
      });
      template.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        Skills: Match.arrayWith([Match.objectLike({ AwsSkills: { Paths: ['/skill'] } })]),
        Tools: Match.absent(),
        AllowedTools: Match.absent(),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.3: Signal channel integration tests
// Validates: Requirement 9.8
// ---------------------------------------------------------------------------

describe('AgentCoreManagedStack — Signal channel integration', () => {
  describe('with signalChannel configured', () => {
    const signalStacks = createManagedTestStacks({
      signalChannel: {
        signalsBusArn: 'arn:aws:events:us-east-1:123456789012:event-bus/test-signals',
        sourceNamespace: 'test.signals',
      },
    });
    const signalTemplate = signalStacks.template;

    it('creates SQS FIFO queue for signal delivery', () => {
      signalTemplate.hasResourceProperties('AWS::SQS::Queue', {
        FifoQueue: true,
        ContentBasedDeduplication: true,
      });
    });

    it('creates a dead-letter queue (FIFO)', () => {
      // The DLQ is FIFO but doesn't have ContentBasedDeduplication
      signalTemplate.hasResourceProperties('AWS::SQS::Queue', {
        FifoQueue: true,
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });

    it('creates an EventBridge rule targeting the signals bus', () => {
      signalTemplate.hasResourceProperties('AWS::Events::Rule', {
        EventBusName: 'test-signals',
        EventPattern: Match.objectLike({
          source: ['test.signals'],
        }),
      });
    });

    it('creates exactly 1 EventBridge rule for signal delivery', () => {
      signalTemplate.resourceCountIs('AWS::Events::Rule', 1);
    });

    it('passes SIGNAL_QUEUE_URL to the harness via EnvironmentVariables', () => {
      signalTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        EnvironmentVariables: Match.objectLike({
          SIGNAL_QUEUE_URL: Match.anyValue(),
        }),
      });
    });

    it('exposes signalChannel outputs on stack instance', () => {
      expect(signalStacks.managedStack.signalChannel).toBeDefined();
      expect(signalStacks.managedStack.signalChannel!.signalsQueue).toBeDefined();
      expect(signalStacks.managedStack.signalChannel!.deadLetterQueue).toBeDefined();
      expect(signalStacks.managedStack.signalChannel!.rule).toBeDefined();
    });

    it('creates CfnOutput for signal queue URL', () => {
      signalTemplate.hasOutput('SignalQueueUrl', {
        Value: Match.anyValue(),
      });
    });
  });

  describe('without signalChannel configured', () => {
    it('creates zero EventBridge rules in the template', () => {
      defaultTemplate.resourceCountIs('AWS::Events::Rule', 0);
    });

    it('does not set EnvironmentVariables on the harness', () => {
      defaultTemplate.hasResourceProperties('AWS::BedrockAgentCore::Harness', {
        EnvironmentVariables: Match.absent(),
      });
    });

    it('exposes signalChannel as undefined on stack instance', () => {
      expect(defaultManagedStack.signalChannel).toBeUndefined();
    });
  });
});


// ---------------------------------------------------------------------------
// Task 5.4: Governance composition and input validation errors
// Validates: Requirement 9.7
// ---------------------------------------------------------------------------

describe('AgentCoreManagedStack — Governance composition', () => {
  it('CfnHarness declares DependsOn to IAM role logical ID', () => {
    defaultTemplate.hasResource('AWS::BedrockAgentCore::Harness', {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('.*Role.*')]),
    });
  });

  it('CfnOutput exists with harnessArn export name', () => {
    defaultTemplate.hasOutput('HarnessArn', {
      Value: Match.anyValue(),
      Export: Match.objectLike({
        Name: Match.stringLikeRegexp('.*harnessArn'),
      }),
    });
  });

  it('harnessName property on stack instance matches NamingGenerator pattern', () => {
    const naming = new NamingGenerator('test');
    expect(defaultManagedStack.harnessName).toBe(naming.harnessName('test-managed'));
  });
});

describe('AgentCoreManagedStack — Input validation errors', () => {
  it('throws when agentType is not agentcore-managed', () => {
    const app = new cdk.App();
    const sharedInfra = new SharedInfraStack(app, 'SharedInfra-AgentType', { stage: 'test' });

    expect(() => {
      new AgentCoreManagedStack(app, 'BadAgentType', {
        stage: 'test',
        configName: 'test-managed',
        agentType: 'openclaw' as 'agentcore-managed',
        modelBindings: [{ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0', label: 'default' }],
        thresholds: {
          outputTokensPerHour: 500,
          guardrailBlocksPer10Min: 3,
          guardrailObservationsPerHour: 20,
        },
        harnessConfig: {
          systemPrompt: 'Test prompt.',
        },
        sharedInfra: {
          opsBus: sharedInfra.opsBus,
          snsTopic: sharedInfra.snsTopic,
          grantLedgerTable: sharedInfra.grantLedgerTable,
          defaultGuardrailConfig: sharedInfra.defaultGuardrailConfig,
          breakerLambda: sharedInfra.breakerLambda,
          agentRegistryTable: sharedInfra.agentRegistryTable,
          appConfigAppId: sharedInfra.appConfigAppId,
          appConfigEnvId: sharedInfra.appConfigEnvId,
        },
      });
    }).toThrow("CfnHarness creation is only valid for agentType 'agentcore-managed'");
  });

  it('throws when systemPrompt is an empty string', () => {
    expect(() => {
      createManagedTestStacks({ harnessConfig: { systemPrompt: '' } });
    }).toThrow('systemPrompt must be a non-empty, non-whitespace string');
  });

  it('throws when systemPrompt is whitespace-only', () => {
    expect(() => {
      createManagedTestStacks({ harnessConfig: { systemPrompt: '   \t\n  ' } });
    }).toThrow('systemPrompt must be a non-empty, non-whitespace string');
  });

  describe('maxIterations validation', () => {
    it('throws when maxIterations is 0', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxIterations: 0 },
        });
      }).toThrow('maxIterations must be a positive integer (1\u20131000), got 0');
    });

    it('throws when maxIterations is negative', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxIterations: -1 },
        });
      }).toThrow('maxIterations must be a positive integer (1\u20131000), got -1');
    });

    it('throws when maxIterations exceeds 1000', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxIterations: 1001 },
        });
      }).toThrow('maxIterations must be a positive integer (1\u20131000), got 1001');
    });

    it('throws when maxIterations is a non-integer', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxIterations: 3.5 },
        });
      }).toThrow('maxIterations must be a positive integer (1\u20131000), got 3.5');
    });
  });

  describe('maxTokens validation', () => {
    it('throws when maxTokens is 0', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxTokens: 0 },
        });
      }).toThrow('maxTokens must be a positive integer (1\u2013128000), got 0');
    });

    it('throws when maxTokens exceeds 128000', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', maxTokens: 128001 },
        });
      }).toThrow('maxTokens must be a positive integer (1\u2013128000), got 128001');
    });
  });

  describe('timeoutSeconds validation', () => {
    it('throws when timeoutSeconds is 0', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', timeoutSeconds: 0 },
        });
      }).toThrow('timeoutSeconds must be a positive integer (1\u20133600), got 0');
    });

    it('throws when timeoutSeconds exceeds 3600', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: { systemPrompt: 'Valid prompt.', timeoutSeconds: 3601 },
        });
      }).toThrow('timeoutSeconds must be a positive integer (1\u20133600), got 3601');
    });
  });

  describe('tools validation', () => {
    it('throws when a tool has an empty type (error includes index)', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: {
            systemPrompt: 'Valid prompt.',
            tools: [{ type: '', name: 'bad' }],
          },
        });
      }).toThrow('tools[0].type is required and must be non-empty');
    });

    it('throws for second tool with empty type (error includes correct index)', () => {
      expect(() => {
        createManagedTestStacks({
          harnessConfig: {
            systemPrompt: 'Valid prompt.',
            tools: [
              { type: 'codeInterpreter', name: 'good' },
              { type: '', name: 'bad' },
            ],
          },
        });
      }).toThrow('tools[1].type is required and must be non-empty');
    });
  });
});
