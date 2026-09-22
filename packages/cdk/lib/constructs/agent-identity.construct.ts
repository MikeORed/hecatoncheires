import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NamingGenerator } from '@hecaton/core';

/** Props for AgentIdentity construct. */
export interface AgentIdentityProps {
  /** The agent configuration name (must match ConfigNamePattern). */
  configName: string;
  /** The agent harness type — determines trust policy principal. */
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  /** All inference profile ARNs for this agent, created by AgentConfigStack. */
  profileArns: string[];
  /** The ID of the guardrail, created by AgentConfigStack. */
  guardrailId: string;
  /** Required when agentType === 'openclaw'. The IAM principal ARN trusted to assume this role. */
  externalPrincipalArn?: string;
  /** Deployment stage — needed by NamingGenerator for role naming. */
  stage: string;
}

/** Outputs from AgentIdentity construct. */
export interface AgentIdentityOutputs {
  role: iam.IRole;
  permissionBoundaryArn: string;
}

/**
 * Resolve the trust principal for the agent role based on agentType.
 *
 * - agentcore-managed / agentcore-runtime: trust bedrock-agentcore.amazonaws.com
 * - openclaw: trust the provided externalPrincipalArn
 */
function buildTrustPolicy(
  agentType: AgentIdentityProps['agentType'],
  externalPrincipalArn?: string,
): iam.IPrincipal {
  switch (agentType) {
    case 'agentcore-managed':
    case 'agentcore-runtime':
      return new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com');
    case 'openclaw':
      return new iam.ArnPrincipal(externalPrincipalArn!);
  }
}

/**
 * AgentIdentity construct — encapsulates the three-layer IAM role model
 * for a single agent configuration.
 *
 * Creates:
 * 1. A per-agent permission boundary (absolute ceiling)
 * 2. An IAM role with trust policy varying by agentType
 * 3. A base inline policy (floor permissions)
 * 4. An operating inline policy (deny-by-default resting state)
 */
export class AgentIdentity extends Construct {
  readonly outputs: AgentIdentityOutputs;

  constructor(scope: Construct, id: string, props: AgentIdentityProps) {
    super(scope, id);

    const { configName, agentType, profileArns, guardrailId, externalPrincipalArn, stage } = props;

    // --- Validation ---
    if (agentType === 'openclaw') {
      if (!externalPrincipalArn || externalPrincipalArn.trim().length === 0) {
        throw new Error(
          `AgentIdentity: externalPrincipalArn must be a non-empty string when agentType is 'openclaw' (configName: ${configName})`,
        );
      }
    }

    const naming = new NamingGenerator(stage);

    // --- 1. Permission Boundary (per-agent managed policy) ---
    // The AgentCore managed harness (and runtime) invoke the model on the
    // agent's behalf and make multiple internal InvokeModel calls, some of
    // which do not carry a guardrail identifier. AWS documents that a role used
    // by such managed-invoke APIs must NOT carry a `bedrock:GuardrailIdentifier`
    // IAM condition, or those internal calls get AccessDenied even when the
    // caller specifies a guardrail. So the guardrail condition is only enforced
    // at the IAM ceiling for agent types that make single, caller-controlled
    // InvokeModel calls (openclaw). For managed/runtime harnesses, guardrail
    // enforcement rides on the harness's request-level guardrailConfig instead.
    // See: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions-id.html
    const enforceGuardrailCondition = agentType === 'openclaw';

    const guardrailCondition = enforceGuardrailCondition
      ? { StringEquals: { 'bedrock:GuardrailIdentifier': guardrailId } }
      : {};

    const bedrockInvokeActions = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];

    const permissionBoundary = new iam.ManagedPolicy(this, 'PermissionBoundary', {
      statements: [
        // Invoking THROUGH an (application/system) inference profile authorizes
        // against BOTH the profile resource AND each backing foundation-model
        // resource (in every region the profile spans). AWS requires two things
        // for the profile-only path:
        //   1. Allow invoke on the inference-profile ARN(s).
        //   2. Allow invoke on the foundation-model ARNs, gated by the
        //      `aws:InferenceProfileArn` condition key so the model can only be
        //      reached through the assigned profile.
        // A single wildcard-resource statement with `bedrock:InferenceProfileArn`
        // does NOT work — that was the cause of "no permissions boundary allows
        // InvokeModelWithResponseStream" on harness invokes.
        // See: https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html

        // 1. Invoke on the assigned inference profile resource(s).
        new iam.PolicyStatement({
          sid: 'BedrockInferenceProfile',
          effect: iam.Effect.ALLOW,
          // Converse/ConverseStream are not IAM actions — they authorize under
          // InvokeModel and InvokeModelWithResponseStream respectively.
          actions: bedrockInvokeActions,
          resources: profileArns,
          ...(enforceGuardrailCondition ? { conditions: guardrailCondition } : {}),
        }),

        // 2. Invoke on the backing foundation models, but only when the request
        // routes through the assigned inference profile (aws:InferenceProfileArn).
        new iam.PolicyStatement({
          sid: 'BedrockInferenceFoundationModel',
          effect: iam.Effect.ALLOW,
          actions: bedrockInvokeActions,
          resources: ['arn:aws:bedrock:*::foundation-model/*'],
          conditions: {
            // Request context key is `bedrock:InferenceProfileArn` (NOT the
            // `aws:` prefix some AWS prose shows) — the model can only be
            // reached through the assigned profile.
            'ForAnyValue:StringEquals': {
              'bedrock:InferenceProfileArn': profileArns,
            },
            ...guardrailCondition,
          },
        }),
        // Allow guardrail application. For the ApplyGuardrail action the
        // guardrail is the RESOURCE, not a request condition-key value — a
        // `bedrock:GuardrailIdentifier` StringEquals condition does not populate
        // for this action and would deny it (observed: "no permissions boundary
        // allows bedrock:ApplyGuardrail"). Scope by the guardrail ARN instead.
        new iam.PolicyStatement({
          sid: 'BedrockApplyGuardrail',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:ApplyGuardrail'],
          resources: [`arn:aws:bedrock:*:*:guardrail/${guardrailId}`],
        }),
        // Allow describing own inference profile (read-only)
        new iam.PolicyStatement({
          sid: 'BedrockGetInferenceProfile',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:GetInferenceProfile'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/hecatoncheires:managed': 'true',
            },
          },
        }),
        // Allow CloudWatch Logs write
        new iam.PolicyStatement({
          sid: 'CloudWatchLogsWrite',
          effect: iam.Effect.ALLOW,
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['arn:aws:logs:*:*:log-group:/aws/bedrock/*'],
        }),
        // Allow CloudWatch Logs read
        new iam.PolicyStatement({
          sid: 'CloudWatchLogsRead',
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:GetLogEvents',
            'logs:FilterLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          resources: ['arn:aws:logs:*:*:log-group:/aws/bedrock/*'],
        }),
        // Allow S3 access scoped to hecatoncheires-managed buckets
        new iam.PolicyStatement({
          sid: 'S3Access',
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
          resources: ['arn:aws:s3:::hecaton-*', 'arn:aws:s3:::hecaton-*/*'],
        }),
        // Allow AgentCore managed-memory operations for the harness's own
        // memory. A managed harness persists/loads conversation state in
        // AgentCore Memory every turn, so without this the harness cannot
        // complete an invocation (observed: AccessDenied on ListEvents).
        // Scoped to this stage's memory resources by naming convention.
        new iam.PolicyStatement({
          sid: 'AgentCoreMemory',
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock-agentcore:CreateEvent',
            'bedrock-agentcore:ListEvents',
            'bedrock-agentcore:GetEvent',
            'bedrock-agentcore:ListSessions',
            'bedrock-agentcore:RetrieveMemories',
          ],
          resources: [`arn:aws:bedrock-agentcore:*:*:memory/${naming.projectPrefix}_${stage}_*`],
        }),
      ],
    });

    // --- 2. IAM Role with trust policy ---
    const trustPrincipal = buildTrustPolicy(agentType, externalPrincipalArn);

    const role = new iam.Role(this, 'AgentRole', {
      roleName: naming.roleName(configName),
      assumedBy: trustPrincipal,
      permissionsBoundary: permissionBoundary,
    });

    // --- 3. Base inline policy (floor permissions) ---
    role.attachInlinePolicy(
      new iam.Policy(this, 'BasePolicy', {
        statements: [
          // Write to CloudWatch Logs
          new iam.PolicyStatement({
            sid: 'LogsWrite',
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: ['arn:aws:logs:*:*:log-group:/aws/bedrock/*'],
          }),
          // Describe own inference profile
          new iam.PolicyStatement({
            sid: 'ProfileDescribe',
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:GetInferenceProfile'],
            resources: ['*'],
            conditions: {
              StringEquals: {
                'aws:ResourceTag/hecatoncheires:managed': 'true',
              },
            },
          }),
          // AgentCore managed-memory floor for the harness (see boundary note).
          new iam.PolicyStatement({
            sid: 'AgentCoreMemory',
            effect: iam.Effect.ALLOW,
            actions: [
              'bedrock-agentcore:CreateEvent',
              'bedrock-agentcore:ListEvents',
              'bedrock-agentcore:GetEvent',
              'bedrock-agentcore:ListSessions',
              'bedrock-agentcore:RetrieveMemories',
            ],
            resources: [`arn:aws:bedrock-agentcore:*:*:memory/${naming.projectPrefix}_${stage}_*`],
          }),
          // Apply the agent's assigned guardrail. The managed harness carries
          // the guardrail on every Converse call (baked into its model config),
          // so bedrock:ApplyGuardrail is required on the guardrail resource for
          // the invocation to succeed. Scoped to this agent's guardrail.
          new iam.PolicyStatement({
            sid: 'BedrockApplyGuardrail',
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:ApplyGuardrail'],
            resources: [`arn:aws:bedrock:*:*:guardrail/${guardrailId}`],
          }),
        ],
      }),
    );

    // --- 4. Operating inline policy (deny-by-default) ---
    // Fixed, deterministic name so the modulator (grant/revoke) and the shared
    // breaker Lambda — which write the operating policy by name via
    // OperatingPolicyAdapter.getDefaultPolicyName() — target THIS inline policy
    // rather than creating a second one. Without a fixed name CDK auto-generates
    // a per-stack name, and the breaker's deny-all would land on the wrong
    // policy, leaving the granted Allow in place (agent not halted).
    role.attachInlinePolicy(
      new iam.Policy(this, 'OperatingPolicy', {
        policyName: naming.operatingPolicyName(),
        statements: [
          new iam.PolicyStatement({
            sid: 'DenyByDefault',
            effect: iam.Effect.DENY,
            actions: ['*'],
            resources: ['*'],
          }),
        ],
      }),
    );

    // --- Expose outputs ---
    this.outputs = {
      role,
      permissionBoundaryArn: permissionBoundary.managedPolicyArn,
    };
  }
}
