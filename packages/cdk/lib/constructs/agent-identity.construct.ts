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
    const permissionBoundary = new iam.ManagedPolicy(this, 'PermissionBoundary', {
      statements: [
        // Allow Bedrock inference — conditioned on profile + guardrail binding
        new iam.PolicyStatement({
          sid: 'BedrockInference',
          effect: iam.Effect.ALLOW,
          // Converse/ConverseStream are not IAM actions — they authorize under
          // InvokeModel and InvokeModelWithResponseStream respectively.
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
          conditions: {
            'ForAnyValue:StringEquals': {
              'bedrock:InferenceProfileArn': profileArns,
            },
            StringEquals: {
              'bedrock:GuardrailIdentifier': guardrailId,
            },
          },
        }),
        // Allow guardrail application
        new iam.PolicyStatement({
          sid: 'BedrockApplyGuardrail',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:ApplyGuardrail'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'bedrock:GuardrailIdentifier': guardrailId,
            },
          },
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
        ],
      }),
    );

    // --- 4. Operating inline policy (deny-by-default) ---
    role.attachInlinePolicy(
      new iam.Policy(this, 'OperatingPolicy', {
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
