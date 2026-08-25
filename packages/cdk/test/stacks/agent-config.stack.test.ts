import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NamingGenerator } from '@hecaton/core';
import { SharedInfraStack } from '../../lib/stacks/shared-infra.stack.js';
import { TestAgentConfigStack } from './test-agent-config.stack.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestStacks(overrides?: {
  stage?: string;
  configName?: string;
  agentType?: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  modelId?: string;
  externalPrincipalArn?: string;
  guardrailOverrides?: {
    contentFilters?: {
      type: 'SEXUAL' | 'VIOLENCE' | 'HATE' | 'INSULTS' | 'MISCONDUCT' | 'PROMPT_ATTACK';
      inputStrength: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
      outputStrength: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    }[];
    deniedTopics?: { name: string; definition: string; examples: string[] }[];
  };
}) {
  const stage = overrides?.stage ?? 'test';
  const configName = overrides?.configName ?? 'sre-ops';
  const agentType = overrides?.agentType ?? 'agentcore-managed';
  const modelId = overrides?.modelId ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0';

  const app = new cdk.App();
  const sharedInfra = new SharedInfraStack(app, 'SharedInfra', { stage });
  const agentStack = new TestAgentConfigStack(app, 'AgentConfig', {
    stage,
    configName,
    agentType,
    modelId,
    thresholds: {
      outputTokensPerHour: 100000,
      guardrailBlocksPer10Min: 5,
      guardrailObservationsPerHour: 20,
    },
    sharedInfra: {
      opsBus: sharedInfra.opsBus,
      snsTopic: sharedInfra.snsTopic,
      grantLedgerTable: sharedInfra.grantLedgerTable,
      defaultGuardrailConfig: sharedInfra.defaultGuardrailConfig,
      breakerLambda: sharedInfra.breakerLambda,
      agentRegistryTable: sharedInfra.agentRegistryTable,
    },
    externalPrincipalArn: overrides?.externalPrincipalArn,
    guardrailOverrides: overrides?.guardrailOverrides,
  });

  return {
    app,
    sharedInfra,
    agentStack,
    template: Template.fromStack(agentStack),
  };
}

// ---------------------------------------------------------------------------
// Task 7.2: AgentConfigStack assertion tests
// Validates: Requirements 2.1.1, 2.1.2, 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.3.1,
//            2.3.3, 2.4.2, 2.5.1, 6.1.1
// ---------------------------------------------------------------------------

describe('AgentConfigStack (via TestAgentConfigStack)', () => {
  describe('Inference profile', () => {
    it('creates an inference profile tagged with hecatoncheires:config={configName}', () => {
      const { template } = createTestStacks({ configName: 'sre-ops' });
      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:config', Value: 'sre-ops' },
        ]),
      });
    });

    it('names the inference profile using NamingGenerator pattern', () => {
      const { template } = createTestStacks({ stage: 'test', configName: 'sre-ops' });
      const naming = new NamingGenerator('test');
      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        InferenceProfileName: naming.profileName('sre-ops'),
      });
    });

    it('tags the inference profile with hecatoncheires:managed=true', () => {
      const { template } = createTestStacks();
      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
        ]),
      });
    });
  });

  describe('Guardrail', () => {
    it('creates a guardrail using the default config from SharedInfraStack', () => {
      const { template } = createTestStacks();
      template.resourceCountIs('AWS::Bedrock::Guardrail', 1);
      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        ContentPolicyConfig: {
          FiltersConfig: Match.arrayWith([
            Match.objectLike({ Type: 'SEXUAL', InputStrength: 'HIGH', OutputStrength: 'HIGH' }),
          ]),
        },
      });
    });

    it('merges guardrail overrides with the default config', () => {
      const { template } = createTestStacks({
        guardrailOverrides: {
          contentFilters: [
            { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          ],
          deniedTopics: [
            {
              name: 'harmful-instructions',
              definition: 'Instructions for causing harm',
              examples: ['How to exploit', 'How to break in'],
            },
          ],
        },
      });

      // Verify the override replaced VIOLENCE filter strength
      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        ContentPolicyConfig: {
          FiltersConfig: Match.arrayWith([
            Match.objectLike({
              Type: 'VIOLENCE',
              InputStrength: 'HIGH',
              OutputStrength: 'HIGH',
            }),
          ]),
        },
      });

      // Verify denied topics were added
      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        TopicPolicyConfig: {
          TopicsConfig: Match.arrayWith([
            Match.objectLike({
              Name: 'harmful-instructions',
              Type: 'DENY',
            }),
          ]),
        },
      });
    });

    it('names the guardrail using NamingGenerator pattern', () => {
      const { template } = createTestStacks({ stage: 'test', configName: 'sre-ops' });
      const naming = new NamingGenerator('test');
      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        Name: naming.guardrailName('sre-ops'),
      });
    });
  });

  describe('Identity field', () => {
    it('populates identity with role and permissionBoundaryArn', () => {
      const { agentStack } = createTestStacks();
      expect(agentStack.identity).toBeDefined();
      expect(agentStack.identity.role).toBeDefined();
      expect(agentStack.identity.permissionBoundaryArn).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('throws synthesis error when configName does not match ConfigNamePattern', () => {
      expect(() => {
        createTestStacks({ configName: 'INVALID_NAME' });
      }).toThrow(/configName.*does not match ConfigNamePattern/);
    });

    it('throws synthesis error when configName starts with digit', () => {
      expect(() => {
        createTestStacks({ configName: '1-bad-name' });
      }).toThrow(/configName.*does not match ConfigNamePattern/);
    });

    it('throws synthesis error when configName ends with hyphen', () => {
      expect(() => {
        createTestStacks({ configName: 'bad-name-' });
      }).toThrow(/configName.*does not match ConfigNamePattern/);
    });

    it('throws synthesis error when modelId is empty', () => {
      expect(() => {
        createTestStacks({ modelId: '' });
      }).toThrow(/modelId must be a non-empty string/);
    });

    it('throws synthesis error when modelId is only whitespace', () => {
      expect(() => {
        createTestStacks({ modelId: '   ' });
      }).toThrow(/modelId must be a non-empty string/);
    });
  });

  describe('Standard tags', () => {
    it('applies hecatoncheires:managed=true to all resources', () => {
      const { template } = createTestStacks();

      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
        ]),
      });

      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:managed', Value: 'true' },
        ]),
      });
    });

    it('applies hecatoncheires:stage tag to resources', () => {
      const { template } = createTestStacks({ stage: 'test' });

      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:stage', Value: 'test' },
        ]),
      });

      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        Tags: Match.arrayWith([
          { Key: 'hecatoncheires:stage', Value: 'test' },
        ]),
      });
    });

    it('applies hecatoncheires:phase=1 tag to resources', () => {
      const { template } = createTestStacks();

      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        Tags: Match.arrayWith([{ Key: 'hecatoncheires:phase', Value: '1' }]),
      });

      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        Tags: Match.arrayWith([{ Key: 'hecatoncheires:phase', Value: '1' }]),
      });
    });

    it('applies hecatoncheires:config={configName} to IAM role', () => {
      const { template } = createTestStacks({ configName: 'sre-ops' });
      const roles = template.findResources('AWS::IAM::Role');
      const roleLogicalIds = Object.keys(roles);
      expect(roleLogicalIds.length).toBeGreaterThanOrEqual(1);

      // At least one role should have the config tag
      const hasManagedTag = roleLogicalIds.some((id) => {
        const tags = roles[id].Properties.Tags as Array<{
          Key: string;
          Value: string;
        }>;
        return tags?.some(
          (t) => t.Key === 'hecatoncheires:config' && t.Value === 'sre-ops',
        );
      });
      expect(hasManagedTag).toBe(true);
    });
  });

  describe('Resource naming', () => {
    it('inference profile name follows NamingGenerator pattern', () => {
      const naming = new NamingGenerator('prod');
      const { template } = createTestStacks({ stage: 'prod', configName: 'code-review' });
      template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
        InferenceProfileName: naming.profileName('code-review'),
      });
    });

    it('guardrail name follows NamingGenerator pattern', () => {
      const naming = new NamingGenerator('prod');
      const { template } = createTestStacks({ stage: 'prod', configName: 'code-review' });
      template.hasResourceProperties('AWS::Bedrock::Guardrail', {
        Name: naming.guardrailName('code-review'),
      });
    });

    it('IAM role name follows NamingGenerator pattern', () => {
      const naming = new NamingGenerator('test');
      const { template } = createTestStacks({ stage: 'test', configName: 'sre-ops' });
      const roles = template.findResources('AWS::IAM::Role');
      const roleNames = Object.values(roles).map(
        (r) => r.Properties.RoleName as string,
      );
      expect(roleNames).toContain(naming.roleName('sre-ops'));
    });
  });
});

// ---------------------------------------------------------------------------
// Task 12.3: AgentPolicyModulator integration tests (via TestAgentConfigStack)
// Validates: Requirements 14.1, 14.2, 14.3
// ---------------------------------------------------------------------------

describe('AgentPolicyModulator integration (via TestAgentConfigStack)', () => {
  describe('Alarm creation', () => {
    it('creates exactly 3 CloudWatch alarms', () => {
      const { template } = createTestStacks();
      template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });

    it('creates a token alarm with correct threshold', () => {
      const { template } = createTestStacks();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 100000,
        MetricName: 'OutputTokenCount',
        Namespace: 'AWS/Bedrock',
        Period: 3600,
      });
    });

    it('creates a block alarm with correct threshold', () => {
      const { template } = createTestStacks();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 5,
        MetricName: 'GuardrailBlocked',
        Namespace: 'AWS/Bedrock',
        Period: 600,
      });
    });

    it('creates an observation alarm with correct threshold', () => {
      const { template } = createTestStacks();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 20,
        MetricName: 'GuardrailObserved',
        Namespace: 'AWS/Bedrock',
        Period: 3600,
      });
    });
  });

  describe('ProfileEntityId output', () => {
    it('exports profileEntityId as a CfnOutput', () => {
      const { template } = createTestStacks();
      template.hasOutput('ProfileEntityId', {});
    });
  });

  describe('Modulator outputs', () => {
    it('exposes modulator outputs with all alarm references', () => {
      const { agentStack } = createTestStacks();
      expect(agentStack.modulator).toBeDefined();
      expect(agentStack.modulator.tokenAlarm).toBeDefined();
      expect(agentStack.modulator.blockAlarm).toBeDefined();
      expect(agentStack.modulator.observationAlarm).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Task 7.3: AgentIdentity assertion tests (via TestAgentConfigStack)
// Validates: Requirements 3.3.1, 3.3.2, 3.3.3, 3.3.4, 3.3.5, 3.3.6, 3.3.7,
//            3.3.8, 3.3.9, 3.4.1, 3.4.2, 3.4.3, 3.4.4, 3.4.5, 3.5.1, 3.5.2,
//            3.5.3, 3.6.1, 3.6.2, 3.7.1, 3.7.2, 6.1.2
// ---------------------------------------------------------------------------

describe('AgentIdentity (via TestAgentConfigStack)', () => {
  describe('Trust policy per agent type', () => {
    it('agentcore-managed trusts bedrock-agentcore.amazonaws.com', () => {
      const { template } = createTestStacks({ agentType: 'agentcore-managed' });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                Service: 'bedrock-agentcore.amazonaws.com',
              },
            }),
          ]),
        },
      });
    });

    it('agentcore-runtime trusts bedrock-agentcore.amazonaws.com', () => {
      const { template } = createTestStacks({ agentType: 'agentcore-runtime' });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                Service: 'bedrock-agentcore.amazonaws.com',
              },
            }),
          ]),
        },
      });
    });

    it('openclaw trusts the provided externalPrincipalArn', () => {
      const externalArn = 'arn:aws:iam::123456789012:role/external-agent';
      const { template } = createTestStacks({
        agentType: 'openclaw',
        externalPrincipalArn: externalArn,
      });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                AWS: externalArn,
              },
            }),
          ]),
        },
      });
    });
  });

  describe('External principal validation', () => {
    it('throws when agentType is openclaw and externalPrincipalArn is missing', () => {
      expect(() => {
        createTestStacks({ agentType: 'openclaw' });
      }).toThrow(/externalPrincipalArn must be a non-empty string/);
    });

    it('throws when agentType is openclaw and externalPrincipalArn is empty string', () => {
      expect(() => {
        createTestStacks({ agentType: 'openclaw', externalPrincipalArn: '' });
      }).toThrow(/externalPrincipalArn must be a non-empty string/);
    });

    it('throws when agentType is openclaw and externalPrincipalArn is whitespace', () => {
      expect(() => {
        createTestStacks({ agentType: 'openclaw', externalPrincipalArn: '   ' });
      }).toThrow(/externalPrincipalArn must be a non-empty string/);
    });
  });

  describe('Permission boundary', () => {
    it('creates a per-agent permission boundary in the same stack', () => {
      const { template } = createTestStacks();
      template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    });

    it('boundary includes Bedrock inference actions with condition keys', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::ManagedPolicy');
      const policyLogicalId = Object.keys(policies)[0];
      const policyDoc = policies[policyLogicalId].Properties.PolicyDocument;
      const statements = policyDoc.Statement as Array<Record<string, unknown>>;

      // Find the Bedrock inference statement
      const bedrockInferenceStmt = statements.find((stmt) => {
        const actions = stmt.Action as string[];
        return (
          Array.isArray(actions) &&
          actions.includes('bedrock:InvokeModel') &&
          actions.includes('bedrock:InvokeModelWithResponseStream') &&
          actions.includes('bedrock:Converse') &&
          actions.includes('bedrock:ConverseStream')
        );
      });
      expect(bedrockInferenceStmt).toBeDefined();

      // Verify condition keys exist
      const condition = bedrockInferenceStmt!.Condition as Record<
        string,
        Record<string, unknown>
      >;
      expect(condition).toBeDefined();
      expect(condition.StringEquals).toBeDefined();
      expect(condition.StringEquals['bedrock:InferenceProfileArn']).toBeDefined();
      expect(condition.StringEquals['bedrock:GuardrailIdentifier']).toBeDefined();
    });

    it('boundary includes ApplyGuardrail action with guardrail condition key', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::ManagedPolicy');
      const policyLogicalId = Object.keys(policies)[0];
      const policyDoc = policies[policyLogicalId].Properties.PolicyDocument;
      const statements = policyDoc.Statement as Array<Record<string, unknown>>;

      const applyGuardrailStmt = statements.find((stmt) => {
        const actions = stmt.Action as string[] | string;
        return Array.isArray(actions)
          ? actions.includes('bedrock:ApplyGuardrail')
          : actions === 'bedrock:ApplyGuardrail';
      });
      expect(applyGuardrailStmt).toBeDefined();

      const condition = applyGuardrailStmt!.Condition as Record<
        string,
        Record<string, unknown>
      >;
      expect(condition).toBeDefined();
      expect(condition.StringEquals).toBeDefined();
      expect(condition.StringEquals['bedrock:GuardrailIdentifier']).toBeDefined();
    });

    it('boundary includes GetInferenceProfile action with managed tag condition', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::ManagedPolicy');
      const policyLogicalId = Object.keys(policies)[0];
      const policyDoc = policies[policyLogicalId].Properties.PolicyDocument;
      const statements = policyDoc.Statement as Array<Record<string, unknown>>;

      const getProfileStmt = statements.find((stmt) => {
        const actions = stmt.Action as string[] | string;
        return Array.isArray(actions)
          ? actions.includes('bedrock:GetInferenceProfile')
          : actions === 'bedrock:GetInferenceProfile';
      });
      expect(getProfileStmt).toBeDefined();

      const condition = getProfileStmt!.Condition as Record<
        string,
        Record<string, unknown>
      >;
      expect(condition).toBeDefined();
      expect(condition.StringEquals).toBeDefined();
      expect(
        condition.StringEquals['aws:ResourceTag/hecatoncheires:managed'],
      ).toBe('true');
    });

    it('boundary S3 resources scoped to hecaton-* only', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::ManagedPolicy');
      const policyLogicalId = Object.keys(policies)[0];
      const policyDoc = policies[policyLogicalId].Properties.PolicyDocument;
      const statements = policyDoc.Statement as Array<Record<string, unknown>>;

      const s3Stmt = statements.find((stmt) => {
        const actions = stmt.Action as string[];
        return Array.isArray(actions) && actions.includes('s3:GetObject');
      });
      expect(s3Stmt).toBeDefined();

      const resources = s3Stmt!.Resource as string[];
      expect(resources).toContain('arn:aws:s3:::hecaton-*');
      expect(resources).toContain('arn:aws:s3:::hecaton-*/*');
      // Verify no wildcard-only resource
      expect(resources).not.toContain('*');
    });

    it('boundary log actions scoped to /aws/bedrock/* log groups', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::ManagedPolicy');
      const policyLogicalId = Object.keys(policies)[0];
      const policyDoc = policies[policyLogicalId].Properties.PolicyDocument;
      const statements = policyDoc.Statement as Array<Record<string, unknown>>;

      // Find log write statement
      const logWriteStmt = statements.find((stmt) => {
        const actions = stmt.Action as string[];
        return Array.isArray(actions) && actions.includes('logs:CreateLogGroup');
      });
      expect(logWriteStmt).toBeDefined();
      const writeResources = logWriteStmt!.Resource as string | string[];
      const writeResourceArr = Array.isArray(writeResources)
        ? writeResources
        : [writeResources];
      expect(
        writeResourceArr.every((r) => r.includes('/aws/bedrock/')),
      ).toBe(true);

      // Find log read statement
      const logReadStmt = statements.find((stmt) => {
        const actions = stmt.Action as string[];
        return Array.isArray(actions) && actions.includes('logs:GetLogEvents');
      });
      expect(logReadStmt).toBeDefined();
      const readResources = logReadStmt!.Resource as string | string[];
      const readResourceArr = Array.isArray(readResources)
        ? readResources
        : [readResources];
      expect(
        readResourceArr.every((r) => r.includes('/aws/bedrock/')),
      ).toBe(true);
    });
  });

  describe('Base policy', () => {
    it('has logs write and profile describe only (no inference actions)', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::Policy');
      const policyLogicalIds = Object.keys(policies);

      // Helper to normalize actions from a statement (string or string[])
      const getActions = (stmt: Record<string, unknown>): string[] => {
        const raw = stmt.Action;
        if (Array.isArray(raw)) return raw as string[];
        if (typeof raw === 'string') return [raw];
        return [];
      };

      // Find the base policy (contains LogsWrite or ProfileDescribe statements)
      const basePolicy = policyLogicalIds.find((id) => {
        const doc = policies[id].Properties.PolicyDocument;
        const statements = doc.Statement as Array<Record<string, unknown>>;
        return statements.some((stmt) => {
          const actions = getActions(stmt);
          return (
            actions.includes('logs:CreateLogStream') ||
            actions.includes('bedrock:GetInferenceProfile')
          );
        });
      });
      expect(basePolicy).toBeDefined();

      const basePolicyDoc = policies[basePolicy!].Properties.PolicyDocument;
      const baseStatements = basePolicyDoc.Statement as Array<Record<string, unknown>>;

      // Verify it contains logs write
      const logsStmt = baseStatements.find((stmt) => {
        const actions = getActions(stmt);
        return actions.includes('logs:CreateLogStream');
      });
      expect(logsStmt).toBeDefined();

      // Verify it contains profile describe
      const profileStmt = baseStatements.find((stmt) => {
        const actions = getActions(stmt);
        return actions.includes('bedrock:GetInferenceProfile');
      });
      expect(profileStmt).toBeDefined();

      // Verify NO Bedrock inference actions present
      const allActions = baseStatements.flatMap((stmt) => getActions(stmt));
      expect(allActions).not.toContain('bedrock:InvokeModel');
      expect(allActions).not.toContain('bedrock:InvokeModelWithResponseStream');
      expect(allActions).not.toContain('bedrock:Converse');
      expect(allActions).not.toContain('bedrock:ConverseStream');
    });
  });

  describe('Operating policy', () => {
    it('is deny-by-default (Deny * / *)', () => {
      const { template } = createTestStacks();
      const policies = template.findResources('AWS::IAM::Policy');
      const policyLogicalIds = Object.keys(policies);

      // Find the operating policy (contains Deny * *)
      const operatingPolicy = policyLogicalIds.find((id) => {
        const doc = policies[id].Properties.PolicyDocument;
        const statements = doc.Statement as Array<Record<string, unknown>>;
        return statements.some(
          (stmt) => stmt.Effect === 'Deny' && stmt.Action === '*' && stmt.Resource === '*',
        );
      });
      expect(operatingPolicy).toBeDefined();

      // Verify it has exactly one statement
      const opDoc = policies[operatingPolicy!].Properties.PolicyDocument;
      const opStatements = opDoc.Statement as Array<Record<string, unknown>>;
      expect(opStatements).toHaveLength(1);
      expect(opStatements[0].Effect).toBe('Deny');
      expect(opStatements[0].Action).toBe('*');
      expect(opStatements[0].Resource).toBe('*');
    });
  });

  describe('AgentIdentity does NOT create inference profile or guardrail', () => {
    it('only AgentConfigStack creates inference profile (exactly 1 in stack)', () => {
      const { template } = createTestStacks();
      // Only 1 inference profile — created by AgentConfigStack, not AgentIdentity
      template.resourceCountIs('AWS::Bedrock::ApplicationInferenceProfile', 1);
    });

    it('only AgentConfigStack creates guardrail (exactly 1 in stack)', () => {
      const { template } = createTestStacks();
      // Only 1 guardrail — created by AgentConfigStack, not AgentIdentity
      template.resourceCountIs('AWS::Bedrock::Guardrail', 1);
    });
  });
});
