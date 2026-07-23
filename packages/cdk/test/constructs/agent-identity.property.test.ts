import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AgentIdentity } from '../../lib/constructs/agent-identity.construct.js';

/** Arbitrary for valid configName values matching ConfigNamePattern: ^[a-z][a-z0-9-]*[a-z0-9]$ */
const arbConfigName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/**
 * Property 2: Trust policy correctness per agent type
 *
 * For any valid agentType, the IAM role trust policy SHALL trust exactly the correct
 * service principal (`bedrock-agentcore.amazonaws.com` for managed/runtime, provided ARN
 * for openclaw) and no other principals.
 *
 * **Validates: Requirements 3.4.1, 3.4.2, 3.4.3**
 */
describe('Property 2: Trust policy correctness per agent type', () => {
  const agentTypeArb = fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  );

  const externalPrincipalArn = 'arn:aws:iam::123456789012:role/external-agent';

  function createStack(props: {
    configName: string;
    agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
    externalPrincipalArn?: string;
  }) {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    new AgentIdentity(stack, 'Identity', {
      configName: props.configName,
      agentType: props.agentType,
      profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test-profile',
      guardrailId: 'test-guardrail-id',
      stage: 'test',
      tags: { 'hecatoncheires:managed': 'true' },
      externalPrincipalArn: props.externalPrincipalArn,
    });
    return Template.fromStack(stack);
  }

  it('trust policy trusts exactly the correct principal for any agentType', () => {
    fc.assert(
      fc.property(arbConfigName, agentTypeArb, (configName, agentType) => {
        const extArn = agentType === 'openclaw' ? externalPrincipalArn : undefined;

        const template = createStack({ configName, agentType, externalPrincipalArn: extArn });

        // Find the IAM Role resource
        const roles = template.findResources('AWS::IAM::Role');
        const roleLogicalIds = Object.keys(roles);
        expect(roleLogicalIds.length).toBeGreaterThanOrEqual(1);

        for (const logicalId of roleLogicalIds) {
          const assumeRolePolicyDocument = roles[logicalId].Properties.AssumeRolePolicyDocument;
          const statements = assumeRolePolicyDocument.Statement as Array<{
            Effect: string;
            Principal: Record<string, string | string[]>;
            Action: string | string[];
          }>;

          // Requirement 3.4.3: exactly one statement in the trust policy
          expect(statements.length).toBe(1);

          const statement = statements[0];
          expect(statement.Effect).toBe('Allow');

          if (agentType === 'agentcore-managed' || agentType === 'agentcore-runtime') {
            // Requirement 3.4.1: trust bedrock-agentcore.amazonaws.com
            expect(statement.Principal).toHaveProperty('Service');
            expect(statement.Principal.Service).toBe('bedrock-agentcore.amazonaws.com');
            // No AWS principal should be present
            expect(statement.Principal).not.toHaveProperty('AWS');
          } else {
            // agentType === 'openclaw'
            // Requirement 3.4.2: trust the provided externalPrincipalArn
            expect(statement.Principal).toHaveProperty('AWS');
            expect(statement.Principal.AWS).toBe(externalPrincipalArn);
            // No Service principal should be present
            expect(statement.Principal).not.toHaveProperty('Service');
          }

          // Requirement 3.4.3: no additional principals beyond the one expected
          const principalKeys = Object.keys(statement.Principal);
          expect(principalKeys.length).toBe(1);
        }
      }),
      { numRuns: 50 },
    );
  });
});

/**
 * Property 6: Condition key enforcement on Bedrock actions
 *
 * For any AgentIdentity instance, verify the permission boundary includes condition keys
 * for `bedrock:InferenceProfileArn` and `bedrock:GuardrailIdentifier` on Bedrock inference
 * statements, and that the condition values match the profileArn and guardrailId passed as props.
 *
 * **Validates: Requirements 3.3.2, 3.3.9**
 */
describe('Property 6: Condition key enforcement on Bedrock actions', () => {
  const agentTypeArb = fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  );

  /** Arbitrary for a plausible Bedrock inference profile ARN */
  const arbProfileArn = fc
    .tuple(
      fc.stringMatching(/^[0-9]{12}$/).filter((s) => s.length === 12),
      fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
      fc.stringMatching(/^[a-z][a-z0-9-]{2,30}[a-z0-9]$/),
    )
    .map(
      ([account, region, name]) =>
        `arn:aws:bedrock:${region}:${account}:inference-profile/${name}`,
    );

  /** Arbitrary for a plausible guardrail ID */
  const arbGuardrailId = fc.stringMatching(/^[a-z0-9]{8,20}$/);

  function createStack(props: {
    configName: string;
    agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
    profileArn: string;
    guardrailId: string;
    externalPrincipalArn?: string;
  }) {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    new AgentIdentity(stack, 'Identity', {
      configName: props.configName,
      agentType: props.agentType,
      profileArn: props.profileArn,
      guardrailId: props.guardrailId,
      stage: 'test',
      tags: { 'hecatoncheires:managed': 'true' },
      externalPrincipalArn: props.externalPrincipalArn,
    });
    return Template.fromStack(stack);
  }

  it('Bedrock inference statements include condition keys matching props', () => {
    fc.assert(
      fc.property(
        arbConfigName,
        agentTypeArb,
        arbProfileArn,
        arbGuardrailId,
        (configName, agentType, profileArn, guardrailId) => {
          const externalPrincipalArn =
            agentType === 'openclaw'
              ? 'arn:aws:iam::123456789012:role/external-agent'
              : undefined;

          const template = createStack({
            configName,
            agentType,
            profileArn,
            guardrailId,
            externalPrincipalArn,
          });

          // Find the managed policy (permission boundary)
          const policies = template.findResources('AWS::IAM::ManagedPolicy');
          const policyLogicalIds = Object.keys(policies);
          expect(policyLogicalIds.length).toBeGreaterThanOrEqual(1);

          const bedrockInferenceActions = [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:Converse',
            'bedrock:ConverseStream',
          ];

          for (const logicalId of policyLogicalIds) {
            const policyDocument = policies[logicalId].Properties.PolicyDocument;
            const statements = policyDocument.Statement as Array<{
              Effect: string;
              Action: string | string[];
              Condition?: Record<string, Record<string, string>>;
            }>;

            // Find statements containing Bedrock inference actions
            const inferenceStatements = statements.filter((stmt) => {
              const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
              return bedrockInferenceActions.some((a) => actions.includes(a));
            });

            // There must be at least one inference statement
            expect(inferenceStatements.length).toBeGreaterThanOrEqual(1);

            for (const stmt of inferenceStatements) {
              // Must have a Condition block
              expect(stmt.Condition).toBeDefined();

              // Must have StringEquals condition
              expect(stmt.Condition!.StringEquals).toBeDefined();

              const stringEquals = stmt.Condition!.StringEquals;

              // Must include bedrock:InferenceProfileArn condition key
              expect(stringEquals['bedrock:InferenceProfileArn']).toBeDefined();
              // Value must match the profileArn passed as props
              expect(stringEquals['bedrock:InferenceProfileArn']).toBe(profileArn);

              // Must include bedrock:GuardrailIdentifier condition key
              expect(stringEquals['bedrock:GuardrailIdentifier']).toBeDefined();
              // Value must match the guardrailId passed as props
              expect(stringEquals['bedrock:GuardrailIdentifier']).toBe(guardrailId);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

/**
 * Property 5: Deny-by-default operating policy
 *
 * For any newly created AgentIdentity, verify the operating policy contains exactly one
 * statement: Effect Deny, Action *, Resource *. This ensures the agent is in a deny-all
 * resting state until the platform explicitly modulates its permissions.
 *
 * **Validates: Requirements 3.6.1**
 */
describe('Property 5: Deny-by-default operating policy', () => {
  const agentTypeArb = fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  );

  function createStack(props: {
    configName: string;
    agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
    externalPrincipalArn?: string;
  }) {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    new AgentIdentity(stack, 'Identity', {
      configName: props.configName,
      agentType: props.agentType,
      profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test-profile',
      guardrailId: 'test-guardrail-id',
      stage: 'test',
      tags: { 'hecatoncheires:managed': 'true' },
      externalPrincipalArn: props.externalPrincipalArn,
    });
    return Template.fromStack(stack);
  }

  it('operating policy contains exactly one Deny */*, for any agentType and configName', () => {
    fc.assert(
      fc.property(arbConfigName, agentTypeArb, (configName, agentType) => {
        const externalPrincipalArn =
          agentType === 'openclaw'
            ? 'arn:aws:iam::123456789012:role/external-agent'
            : undefined;

        const template = createStack({ configName, agentType, externalPrincipalArn });

        // Find all inline policies (AWS::IAM::Policy resources)
        const policies = template.findResources('AWS::IAM::Policy');
        const policyLogicalIds = Object.keys(policies);

        // Find the operating policy: the one with a Deny statement on Action * Resource *
        const operatingPolicies = policyLogicalIds.filter((logicalId) => {
          const policyDocument = policies[logicalId].Properties.PolicyDocument;
          const statements = policyDocument.Statement as Array<{
            Effect: string;
            Action: string;
            Resource: string;
          }>;
          return statements.some(
            (stmt) =>
              stmt.Effect === 'Deny' && stmt.Action === '*' && stmt.Resource === '*',
          );
        });

        // Exactly one operating policy must exist
        expect(operatingPolicies.length).toBe(1);

        // That policy must have exactly one statement
        const opPolicyDoc =
          policies[operatingPolicies[0]].Properties.PolicyDocument;
        const opStatements = opPolicyDoc.Statement as Array<{
          Effect: string;
          Action: string;
          Resource: string;
        }>;
        expect(opStatements.length).toBe(1);

        // The single statement must be Effect: Deny, Action: *, Resource: *
        const stmt = opStatements[0];
        expect(stmt.Effect).toBe('Deny');
        expect(stmt.Action).toBe('*');
        expect(stmt.Resource).toBe('*');
      }),
      { numRuns: 50 },
    );
  });
});

/**
 * Property 8: S3 resource scoping
 *
 * For any permission boundary, verify S3 actions are scoped to `hecaton-*` resources only.
 *
 * **Validates: Requirements 3.3.7, 3.3.8**
 */
describe('Property 8: S3 resource scoping', () => {
  const agentTypeArb = fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  );

  function createStack(props: {
    configName: string;
    agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
    externalPrincipalArn?: string;
  }) {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    new AgentIdentity(stack, 'Identity', {
      configName: props.configName,
      agentType: props.agentType,
      profileArn: 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/test-profile',
      guardrailId: 'test-guardrail-id',
      stage: 'test',
      tags: { 'hecatoncheires:managed': 'true' },
      externalPrincipalArn: props.externalPrincipalArn,
    });
    return Template.fromStack(stack);
  }

  it('S3 actions in the permission boundary are scoped to hecaton-* resources only', () => {
    fc.assert(
      fc.property(arbConfigName, agentTypeArb, (configName, agentType) => {
        const externalPrincipalArn =
          agentType === 'openclaw'
            ? 'arn:aws:iam::123456789012:role/external-agent'
            : undefined;

        const template = createStack({ configName, agentType, externalPrincipalArn });

        // Find the managed policy (permission boundary)
        const policies = template.findResources('AWS::IAM::ManagedPolicy');
        const policyLogicalIds = Object.keys(policies);
        expect(policyLogicalIds.length).toBeGreaterThanOrEqual(1);

        for (const logicalId of policyLogicalIds) {
          const policyDocument = policies[logicalId].Properties.PolicyDocument;
          const statements = policyDocument.Statement as Array<{
            Effect: string;
            Action: string | string[];
            Resource: string | string[] | Record<string, unknown>;
          }>;

          // Find statements that include S3 actions
          const s3Actions = ['s3:GetObject', 's3:PutObject', 's3:ListBucket'];

          for (const statement of statements) {
            const actions = Array.isArray(statement.Action)
              ? statement.Action
              : [statement.Action];

            const hasS3Action = actions.some((action) => s3Actions.includes(action));

            if (hasS3Action) {
              // Requirement 3.3.8: Resource must NOT be '*'
              expect(statement.Resource).not.toBe('*');

              // Resource must be an array (not a wildcard string)
              expect(Array.isArray(statement.Resource)).toBe(true);

              const resources = statement.Resource as string[];

              // Requirement 3.3.7: Every S3 resource must start with 'arn:aws:s3:::hecaton-'
              for (const resource of resources) {
                expect(resource).toMatch(/^arn:aws:s3:::hecaton-/);
              }

              // Verify both bucket-level and object-level resources are present
              const hasBucketLevel = resources.some((r) => r === 'arn:aws:s3:::hecaton-*');
              const hasObjectLevel = resources.some((r) => r === 'arn:aws:s3:::hecaton-*/*');
              expect(hasBucketLevel).toBe(true);
              expect(hasObjectLevel).toBe(true);
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
