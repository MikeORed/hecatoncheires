import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NamingGenerator } from '@hecaton/core';
import { SharedInfraStack } from '../../lib/stacks/shared-infra.stack.js';
import { TestAgentConfigStack } from './test-agent-config.stack.js';

/** Arbitrary for valid configName values matching ConfigNamePattern: ^[a-z][a-z0-9-]*[a-z0-9]$ */
const arbConfigName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/** Arbitrary for valid stage names (lowercase, short) */
const arbStage = fc
  .stringMatching(/^[a-z][a-z0-9]{1,8}$/)
  .filter((s) => s.length >= 2 && s.length <= 9);

/** Arbitrary for agentType */
const arbAgentType = fc.constantFrom(
  'agentcore-managed' as const,
  'openclaw' as const,
  'agentcore-runtime' as const,
);

/** Helper to create a full SharedInfraStack + TestAgentConfigStack pair */
function createStacks(opts: {
  stage: string;
  configName: string;
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
}) {
  const app = new cdk.App();
  const sharedInfra = new SharedInfraStack(app, 'SharedInfra', { stage: opts.stage });
  const agentStack = new TestAgentConfigStack(app, 'AgentConfig', {
    stage: opts.stage,
    configName: opts.configName,
    agentType: opts.agentType,
    modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
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
    externalPrincipalArn:
      opts.agentType === 'openclaw'
        ? 'arn:aws:iam::123456789012:role/external-agent'
        : undefined,
  });
  return {
    agentTemplate: Template.fromStack(agentStack),
    sharedTemplate: Template.fromStack(sharedInfra),
    agentStack,
    sharedInfra,
  };
}

/**
 * Property 1: Resource naming consistency
 *
 * For any valid stage and configName, all resources created by SharedInfraStack and
 * AgentConfigStack (including AgentIdentity) SHALL have names matching the patterns
 * produced by NamingGenerator for that stage/configName combination.
 *
 * **Validates: Requirements 1.5.2, 2.2.3, 2.3.3, 3.4.5, 5.2.1, 5.2.2, 5.2.3**
 */
describe('Property 1: Resource naming consistency', () => {
  it('SharedInfraStack resources follow NamingGenerator patterns for any valid stage', () => {
    fc.assert(
      fc.property(arbStage, (stage) => {
        const app = new cdk.App();
        const stack = new SharedInfraStack(app, 'SharedInfra', { stage });
        const template = Template.fromStack(stack);
        const naming = new NamingGenerator(stage);

        // EventBridge bus name
        template.hasResourceProperties('AWS::Events::EventBus', {
          Name: naming.busName(),
        });

        // SNS topic name
        template.hasResourceProperties('AWS::SNS::Topic', {
          TopicName: naming.snsTopicName(),
        });

        // DynamoDB table name
        template.hasResourceProperties('AWS::DynamoDB::Table', {
          TableName: naming.tableName(),
        });

        // API Gateway name
        template.hasResourceProperties('AWS::ApiGateway::RestApi', {
          Name: naming.apiGatewayName(),
        });
      }),
      { numRuns: 20 },
    );
  });

  it('AgentConfigStack resources follow NamingGenerator patterns for any valid stage and configName', () => {
    fc.assert(
      fc.property(arbStage, arbConfigName, arbAgentType, (stage, configName, agentType) => {
        const naming = new NamingGenerator(stage);
        const { agentTemplate } = createStacks({ stage, configName, agentType });

        // Inference profile name
        agentTemplate.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
          InferenceProfileName: naming.profileName(configName),
        });

        // Guardrail name
        agentTemplate.hasResourceProperties('AWS::Bedrock::Guardrail', {
          Name: naming.guardrailName(configName),
        });

        // IAM role name
        const roles = agentTemplate.findResources('AWS::IAM::Role');
        const roleLogicalIds = Object.keys(roles);
        expect(roleLogicalIds.length).toBeGreaterThanOrEqual(1);

        const expectedRoleName = naming.roleName(configName);
        const roleNames = roleLogicalIds.map(
          (id) => roles[id].Properties.RoleName as string,
        );
        expect(roleNames).toContain(expectedRoleName);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Property 3: Tag propagation completeness
 *
 * For any resource created by SharedInfraStack or AgentConfigStack (including AgentIdentity
 * resources), the resource SHALL carry all mandatory tags (`hecatoncheires:managed`,
 * `hecatoncheires:stage`, `hecatoncheires:phase`).
 *
 * **Validates: Requirements 1.5.1, 2.5.1**
 */
describe('Property 3: Tag propagation completeness', () => {
  it('SharedInfraStack resources have all mandatory tags for any valid stage', () => {
    fc.assert(
      fc.property(arbStage, (stage) => {
        const app = new cdk.App();
        const stack = new SharedInfraStack(app, 'SharedInfra', { stage });
        const template = Template.fromStack(stack);

        // Check taggable resources — EventBridge bus, SNS, DynamoDB have Tags property
        const mandatoryTags = [
          { Key: 'hecatoncheires:managed', Value: 'true' },
          { Key: 'hecatoncheires:stage', Value: stage },
          { Key: 'hecatoncheires:phase', Value: '1' },
        ];

        // EventBridge bus
        const buses = template.findResources('AWS::Events::EventBus');
        for (const logicalId of Object.keys(buses)) {
          const tags = buses[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }

        // SNS topic
        const topics = template.findResources('AWS::SNS::Topic');
        for (const logicalId of Object.keys(topics)) {
          const tags = topics[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }

        // DynamoDB table
        const tables = template.findResources('AWS::DynamoDB::Table');
        for (const logicalId of Object.keys(tables)) {
          const tags = tables[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it('AgentConfigStack resources have all mandatory tags for any valid stage and configName', () => {
    fc.assert(
      fc.property(arbStage, arbConfigName, arbAgentType, (stage, configName, agentType) => {
        const { agentTemplate } = createStacks({ stage, configName, agentType });

        const mandatoryTags = [
          { Key: 'hecatoncheires:managed', Value: 'true' },
          { Key: 'hecatoncheires:stage', Value: stage },
          { Key: 'hecatoncheires:phase', Value: '1' },
        ];

        // Check IAM roles (taggable in AgentIdentity)
        const roles = agentTemplate.findResources('AWS::IAM::Role');
        for (const logicalId of Object.keys(roles)) {
          const tags = roles[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }

        // Check Bedrock inference profiles (tagged via resource-level tags)
        const profiles = agentTemplate.findResources(
          'AWS::Bedrock::ApplicationInferenceProfile',
        );
        for (const logicalId of Object.keys(profiles)) {
          const tags = profiles[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }

        // Check Bedrock guardrails (tagged via resource-level tags)
        const guardrails = agentTemplate.findResources('AWS::Bedrock::Guardrail');
        for (const logicalId of Object.keys(guardrails)) {
          const tags = guardrails[logicalId].Properties.Tags as Array<{
            Key: string;
            Value: string;
          }>;
          for (const mandatory of mandatoryTags) {
            expect(tags).toContainEqual(mandatory);
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Property 11: Resource co-location
 *
 * For any AgentConfigStack instance, the inference profile, guardrail, permission boundary,
 * and IAM role SHALL all reside in the same CloudFormation stack. No cross-stack references
 * SHALL exist between these four resources.
 *
 * **Validates: Requirements 3.3.1, 3.4.4, 2.2.1, 2.3.1, 2.4.1**
 */
describe('Property 11: Resource co-location', () => {
  it('profile, guardrail, boundary, and role are all in the same AgentConfigStack for any configName and agentType', () => {
    fc.assert(
      fc.property(arbStage, arbConfigName, arbAgentType, (stage, configName, agentType) => {
        const { agentTemplate } = createStacks({ stage, configName, agentType });

        // All four resource types must be present in the AgentConfigStack template
        const profiles = agentTemplate.findResources(
          'AWS::Bedrock::ApplicationInferenceProfile',
        );
        const guardrails = agentTemplate.findResources('AWS::Bedrock::Guardrail');
        const boundaries = agentTemplate.findResources('AWS::IAM::ManagedPolicy');
        const roles = agentTemplate.findResources('AWS::IAM::Role');

        // At least one of each must exist in the same stack
        expect(Object.keys(profiles).length).toBeGreaterThanOrEqual(1);
        expect(Object.keys(guardrails).length).toBeGreaterThanOrEqual(1);
        expect(Object.keys(boundaries).length).toBeGreaterThanOrEqual(1);
        expect(Object.keys(roles).length).toBeGreaterThanOrEqual(1);

        // Verify no cross-stack references (Fn::ImportValue) exist between
        // these resources within the AgentConfigStack template.
        // The role's PermissionsBoundary must NOT use Fn::ImportValue.
        for (const logicalId of Object.keys(roles)) {
          const permBoundary = roles[logicalId].Properties.PermissionsBoundary;
          expect(permBoundary).toBeDefined();
          // If it's a reference, it should use Fn::GetAtt or Ref (same-stack), not Fn::ImportValue
          if (typeof permBoundary === 'object') {
            expect(permBoundary).not.toHaveProperty('Fn::ImportValue');
          }
        }

        // Verify the guardrail ID referenced by the permission boundary condition keys
        // is from the same stack (Fn::GetAtt, not Fn::ImportValue)
        for (const logicalId of Object.keys(boundaries)) {
          const policyDoc = boundaries[logicalId].Properties.PolicyDocument;
          const statements = policyDoc.Statement as Array<Record<string, unknown>>;

          for (const stmt of statements) {
            const condition = stmt.Condition as
              | Record<string, Record<string, unknown>>
              | undefined;
            if (condition?.StringEquals) {
              const values = Object.values(condition.StringEquals);
              for (const value of values) {
                // Values should be Fn::GetAtt or Ref (same-stack), not Fn::ImportValue
                if (typeof value === 'object' && value !== null) {
                  expect(value).not.toHaveProperty('Fn::ImportValue');
                }
              }
            }
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});



/**
 * Property 9: External principal validation for openclaw
 *
 * For any AgentIdentity with `agentType === 'openclaw'`, synthesis SHALL fail if
 * `externalPrincipalArn` is empty or undefined. For any AgentIdentity with
 * `agentType !== 'openclaw'`, the `externalPrincipalArn` prop SHALL be ignored.
 *
 * **Validates: Requirements 6.1.2**
 */
describe('Property 9: External principal validation for openclaw', () => {
  it('synthesis fails when agentType is openclaw and externalPrincipalArn is missing', () => {
    fc.assert(
      fc.property(arbStage, arbConfigName, (stage, configName) => {
        const app = new cdk.App();
        const sharedInfra = new SharedInfraStack(app, 'SharedInfra', { stage });

        // Missing externalPrincipalArn — should throw
        expect(() => {
          new TestAgentConfigStack(app, 'AgentConfig', {
            stage,
            configName,
            agentType: 'openclaw',
            modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
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
          });
        }).toThrow(/externalPrincipalArn/);

        // Empty string externalPrincipalArn — should also throw
        expect(() => {
          new TestAgentConfigStack(app, 'AgentConfig2', {
            stage,
            configName,
            agentType: 'openclaw',
            modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            externalPrincipalArn: '',
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
          });
        }).toThrow(/externalPrincipalArn/);
      }),
      { numRuns: 20 },
    );
  });

  it('externalPrincipalArn is ignored for non-openclaw agent types', () => {
    const nonOpenclawTypes = fc.constantFrom(
      'agentcore-managed' as const,
      'agentcore-runtime' as const,
    );

    fc.assert(
      fc.property(arbStage, arbConfigName, nonOpenclawTypes, (stage, configName, agentType) => {
        const app = new cdk.App();
        const sharedInfra = new SharedInfraStack(app, 'SharedInfra', { stage });

        // Should succeed without externalPrincipalArn for non-openclaw types
        expect(() => {
          new TestAgentConfigStack(app, 'AgentConfig', {
            stage,
            configName,
            agentType,
            modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
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
          });
        }).not.toThrow();

        // Should also succeed WITH externalPrincipalArn (it's just ignored)
        const app2 = new cdk.App();
        const sharedInfra2 = new SharedInfraStack(app2, 'SharedInfra', { stage });

        expect(() => {
          new TestAgentConfigStack(app2, 'AgentConfig', {
            stage,
            configName,
            agentType,
            modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            externalPrincipalArn: 'arn:aws:iam::123456789012:role/external',
            thresholds: {
              outputTokensPerHour: 100000,
              guardrailBlocksPer10Min: 5,
              guardrailObservationsPerHour: 20,
            },
            sharedInfra: {
              opsBus: sharedInfra2.opsBus,
              snsTopic: sharedInfra2.snsTopic,
              grantLedgerTable: sharedInfra2.grantLedgerTable,
              defaultGuardrailConfig: sharedInfra2.defaultGuardrailConfig,
              breakerLambda: sharedInfra2.breakerLambda,
              agentRegistryTable: sharedInfra2.agentRegistryTable,
            },
          });
        }).not.toThrow();
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Property 10: AgentConfigStack identity availability
 *
 * For any class extending AgentConfigStack, after construction completes, the `identity`
 * field SHALL be populated with valid AgentIdentityOutputs (non-null `role` and
 * `permissionBoundaryArn`). Subclass constructors MAY rely on `this.identity` being
 * available for their own constructs.
 *
 * **Validates: Requirements 2.4.2, 3.7.2**
 */
describe('Property 10: AgentConfigStack identity availability', () => {
  it('identity field is populated with non-null role and permissionBoundaryArn after construction', () => {
    fc.assert(
      fc.property(arbStage, arbConfigName, arbAgentType, (stage, configName, agentType) => {
        const { agentStack } = createStacks({ stage, configName, agentType });

        // identity must be populated
        expect(agentStack.identity).toBeDefined();
        expect(agentStack.identity).not.toBeNull();

        // role must be non-null and have a roleArn
        expect(agentStack.identity.role).toBeDefined();
        expect(agentStack.identity.role).not.toBeNull();
        expect(agentStack.identity.role.roleArn).toBeDefined();

        // permissionBoundaryArn must be non-null and non-empty
        expect(agentStack.identity.permissionBoundaryArn).toBeDefined();
        expect(agentStack.identity.permissionBoundaryArn).not.toBeNull();
        expect(agentStack.identity.permissionBoundaryArn).toBeTruthy();
      }),
      { numRuns: 20 },
    );
  });
});
