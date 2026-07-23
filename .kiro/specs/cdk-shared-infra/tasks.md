# Implementation Plan: CDK Shared Infrastructure & Agent Identity

## Overview

Implement the CDK shared infrastructure layer and agent identity model for Hecatoncheires. This covers upstream core changes (NamingGenerator extension, core-invocation shape update), the SharedInfraStack, AgentConfigStack base class, AgentIdentity construct, CDK app entry point, and assertion tests via TestAgentConfigStack. All code is TypeScript targeting `aws-cdk-lib` ^2.258.0.

## Tasks

- [x] 1. Upstream core changes
  - [x] 1.1 Extend NamingGenerator with shared infrastructure naming methods
    - Add `busName()` method returning `hecaton-{stage}-ops-bus`
    - Add `snsTopicName()` method returning `hecaton-{stage}-notifications`
    - Add `apiGatewayName()` method returning `hecaton-{stage}-api`
    - File: `packages/core/src/constants/naming.ts`
    - _Requirements: 5.2.1, 5.2.2, 5.2.3_

  - [x] 1.2 Update core-invocation shape to include Converse API actions
    - Add `bedrock:Converse` and `bedrock:ConverseStream` to the `core-invocation` shape actions array
    - File: `packages/core/src/config/shape-catalog.ts`
    - _Requirements: 5.1.1, 5.1.2_

  - [x] 1.3 Write unit tests for NamingGenerator extensions
    - Test `busName()`, `snsTopicName()`, and `apiGatewayName()` produce correct patterns for various stages
    - Test file: `packages/core/src/constants/naming.test.ts`
    - _Requirements: 5.2.1, 5.2.2, 5.2.3_

  - [x] 1.4 Write unit test for updated core-invocation shape
    - Assert the shape includes all four Bedrock inference actions
    - Assert the resource is `${inferenceProfileArn}` for all actions
    - Test file: `packages/core/src/config/shape-catalog.test.ts`
    - _Requirements: 5.1.1, 5.1.2_

- [x] 2. Checkpoint - Ensure core tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement SharedInfraStack
  - [x] 3.1 Create the GuardrailPolicyConfig interface and default config
    - Define `GuardrailPolicyConfig` interface (contentFilters, deniedTopics)
    - Define the default guardrail config object with baseline content filters
    - File: `packages/cdk/lib/stacks/shared-infra.stack.ts`
    - _Requirements: 1.7.1, 1.7.2, 1.7.3_

  - [x] 3.2 Implement SharedInfraStack with all shared resources
    - Create EventBridge custom bus (named via `NamingGenerator.busName()`) with 7-day archive
    - Create SNS notification topic (named via `NamingGenerator.snsTopicName()`)
    - Create DynamoDB grant ledger table (PK: `configName`, SK: `grantId`, PAY_PER_REQUEST, PITR, TTL on `expiresAt`, RETAIN)
    - Create API Gateway REST API shell (named via `NamingGenerator.apiGatewayName()`, `apiKeyRequired: true`)
    - Expose typed references: `opsBus`, `snsTopic`, `grantLedgerTable`, `apiGateway`, `defaultGuardrailConfig`
    - Export CfnOutputs for cross-stack consumption (opsBusArn, snsTopicArn, grantLedgerTableName, grantLedgerTableArn, apiGatewayId, apiGatewayUrl)
    - Apply standard tags via `cdk.Tags.of(this)`: `hecatoncheires:managed=true`, `hecatoncheires:stage={stage}`, `hecatoncheires:phase=1`
    - File: `packages/cdk/lib/stacks/shared-infra.stack.ts`
    - _Requirements: 1.1.1, 1.1.2, 1.2.1, 1.3.1, 1.3.2, 1.3.3, 1.3.4, 1.3.5, 1.3.6, 1.4.1, 1.4.2, 1.5.1, 1.5.2, 1.6.1, 1.6.2, 1.7.1, 1.7.2, 1.7.3_

  - [x] 3.3 Write CDK assertion tests for SharedInfraStack
    - Verify resource counts (1 bus, 1 archive, 1 SNS topic, 1 DynamoDB table, 1 REST API)
    - Verify table key schema, billing mode, PITR, TTL attribute, removal policy
    - Verify API Gateway has `apiKeyRequired: true`
    - Verify tag propagation on all resources
    - Verify CfnOutput exports exist
    - Verify `defaultGuardrailConfig` is a typed object (no AWS resource)
    - Verify resource names follow NamingGenerator patterns
    - Test file: `packages/cdk/test/stacks/shared-infra.stack.test.ts`
    - _Requirements: 1.1.1, 1.1.2, 1.2.1, 1.3.1, 1.3.2, 1.3.3, 1.3.4, 1.3.5, 1.3.6, 1.4.1, 1.5.1, 1.6.1_

- [x] 4. Implement AgentIdentity construct
  - [x] 4.1 Create the AgentIdentity construct with IAM resources
    - Define `AgentIdentityProps` and `AgentIdentityOutputs` interfaces
    - Implement `buildTrustPolicy()` function for trust principal resolution per agentType
    - Create per-agent permission boundary managed policy with condition keys resolved from `profileArn` and `guardrailId` props
    - Create IAM role with correct trust policy, attach boundary
    - Attach base inline policy (logs write, profile describe)
    - Attach operating inline policy (deny-by-default: `Deny */*`)
    - Validate `externalPrincipalArn` non-empty when `agentType === 'openclaw'`
    - Expose outputs: `role`, `permissionBoundaryArn`
    - Name role via `NamingGenerator.roleName(configName)`
    - File: `packages/cdk/lib/constructs/agent-identity.construct.ts`
    - _Requirements: 3.3.1, 3.3.2, 3.3.3, 3.3.4, 3.3.5, 3.3.6, 3.3.7, 3.3.8, 3.3.9, 3.4.1, 3.4.2, 3.4.3, 3.4.4, 3.4.5, 3.5.1, 3.5.2, 3.5.3, 3.6.1, 3.6.2, 3.7.1, 3.7.2, 6.1.2_

  - [x] 4.2 Write property test for trust policy correctness per agent type
    - **Property 2: Trust policy correctness per agent type**
    - For any valid agentType, verify the trust policy trusts exactly the correct principal
    - **Validates: Requirements 3.4.1, 3.4.2, 3.4.3**

  - [x] 4.3 Write property test for permission boundary condition key enforcement
    - **Property 6: Condition key enforcement on Bedrock actions**
    - For any AgentIdentity instance, verify the boundary includes condition keys for `bedrock:InferenceProfileArn` and `bedrock:GuardrailIdentifier`
    - **Validates: Requirements 3.3.2, 3.3.9**

  - [x] 4.4 Write property test for deny-by-default operating policy
    - **Property 5: Deny-by-default operating policy**
    - For any newly created AgentIdentity, verify the operating policy is exactly `Deny */*`
    - **Validates: Requirements 3.6.1**

  - [x] 4.5 Write property test for S3 resource scoping
    - **Property 8: S3 resource scoping**
    - For any permission boundary, verify S3 actions are scoped to `hecaton-*` resources only
    - **Validates: Requirements 3.3.7, 3.3.8**

- [x] 5. Implement AgentConfigStack base class
  - [x] 5.1 Create the AgentConfigStack abstract base class
    - Define `AgentConfigStackProps` interface
    - Validate `configName` against `ConfigNamePattern` at synth time (throw on mismatch)
    - Validate `modelId` is non-empty at synth time (throw on empty)
    - Create `CfnApplicationInferenceProfile` resource, tagged with `hecatoncheires:config={configName}`
    - Create Bedrock guardrail resource (merge `defaultGuardrailConfig` + `guardrailOverrides`)
    - Instantiate AgentIdentity construct, passing `profileArn` and `guardrailId`
    - Populate `this.identity` with AgentIdentity outputs
    - Apply standard tags via `cdk.Tags.of(this)`
    - Name resources via `NamingGenerator.profileName()` and `NamingGenerator.guardrailName()`
    - File: `packages/cdk/lib/stacks/agent-config.stack.ts`
    - _Requirements: 2.1.1, 2.1.2, 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.3.1, 2.3.2, 2.3.3, 2.4.1, 2.4.2, 2.5.1, 6.1.1_

  - [x] 5.2 Write property test for resource naming consistency
    - **Property 1: Resource naming consistency**
    - For any valid stage and configName, verify all resources have names matching NamingGenerator patterns
    - **Validates: Requirements 1.5.2, 2.2.3, 2.3.3, 3.4.5, 5.2.1, 5.2.2, 5.2.3**

  - [x] 5.3 Write property test for tag propagation completeness
    - **Property 3: Tag propagation completeness**
    - For any resource created by SharedInfraStack or AgentConfigStack, verify mandatory tags are present
    - **Validates: Requirements 1.5.1, 2.5.1**

  - [x] 5.4 Write property test for resource co-location
    - **Property 11: Resource co-location**
    - For any AgentConfigStack instance, verify profile, guardrail, boundary, and role are in the same stack
    - **Validates: Requirements 3.3.1, 3.4.4, 2.2.1, 2.3.1, 2.4.1**

- [x] 6. Checkpoint - Ensure all CDK tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Create TestAgentConfigStack and CDK assertion tests
  - [x] 7.1 Create TestAgentConfigStack for assertion testing
    - Minimal concrete implementation extending AgentConfigStack (no additional constructs)
    - File: `packages/cdk/test/stacks/test-agent-config.stack.ts`
    - _Requirements: 2.4.1, 2.4.2, 3.7.1, 3.7.2_

  - [x] 7.2 Write CDK assertion tests for AgentConfigStack via TestAgentConfigStack
    - Verify inference profile is created and tagged with `hecatoncheires:config={configName}`
    - Verify guardrail is created using merged default + override config
    - Verify `identity` field is populated with `role` and `permissionBoundaryArn`
    - Verify synthesis fails when `configName` doesn't match ConfigNamePattern
    - Verify synthesis fails when `modelId` is empty
    - Verify standard tags are applied
    - Verify resource naming follows NamingGenerator patterns
    - Test file: `packages/cdk/test/stacks/agent-config.stack.test.ts`
    - _Requirements: 2.1.1, 2.1.2, 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.3.1, 2.3.3, 2.4.2, 2.5.1, 6.1.1_

  - [x] 7.3 Write CDK assertion tests for AgentIdentity via TestAgentConfigStack
    - Verify IAM role trust policy per agent type (agentcore-managed, agentcore-runtime, openclaw)
    - Verify `openclaw` uses provided `externalPrincipalArn`
    - Verify synthesis fails when `agentType === 'openclaw'` and `externalPrincipalArn` is missing
    - Verify per-agent permission boundary is created in same stack
    - Verify boundary includes all required Bedrock actions with condition keys
    - Verify boundary S3 resources scoped to `hecaton-*`
    - Verify boundary log actions scoped to `/aws/bedrock/*`
    - Verify base policy has logs write + profile describe only (no inference)
    - Verify operating policy is deny-by-default
    - Verify AgentIdentity does NOT create inference profile or guardrail resources
    - Test file: `packages/cdk/test/stacks/agent-config.stack.test.ts`
    - _Requirements: 3.3.1, 3.3.2, 3.3.3, 3.3.4, 3.3.5, 3.3.6, 3.3.7, 3.3.8, 3.3.9, 3.4.1, 3.4.2, 3.4.3, 3.4.4, 3.4.5, 3.5.1, 3.5.2, 3.5.3, 3.6.1, 3.6.2, 3.7.1, 3.7.2, 6.1.2_

- [x] 8. Implement CDK app entry point
  - [x] 8.1 Update CDK app entry point with stack instantiation
    - Resolve stage from CDK context (default `dev`)
    - Resolve env from `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`
    - Instantiate SharedInfraStack with stack ID `Hecaton-{Stage}-SharedInfra`
    - Pass SharedInfraStack outputs to downstream stacks
    - Wire up a placeholder agent config stack (or comment showing the pattern)
    - File: `packages/cdk/bin/app.ts`
    - _Requirements: 4.1.1, 4.1.2, 4.2.1, 4.2.2, 4.2.3_

  - [x] 8.2 Write property test for external principal validation
    - **Property 9: External principal validation for openclaw**
    - Verify synthesis fails when `agentType === 'openclaw'` and `externalPrincipalArn` is missing
    - Verify `externalPrincipalArn` is ignored for non-openclaw types
    - **Validates: Requirements 6.1.2**

  - [x] 8.3 Write property test for AgentConfigStack identity availability
    - **Property 10: AgentConfigStack identity availability**
    - For any class extending AgentConfigStack, verify `identity` is populated after construction
    - **Validates: Requirements 2.4.2, 3.7.2**

- [x] 9. Final checkpoint - Ensure all tests pass and CDK synth succeeds
  - Ensure all tests pass, ask the user if questions arise.
  - Run `pnpm --filter @hecaton/cdk synth` to verify synthesis completes without errors.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The TestAgentConfigStack is a test-only artifact — it lives in `packages/cdk/test/` and validates the full AgentConfigStack → AgentIdentity pattern
- All CDK assertion tests use `Template.fromStack()` and `Match` utilities from `aws-cdk-lib/assertions`
- The upstream core changes (tasks 1.1, 1.2) must be completed before CDK stacks can consume NamingGenerator extensions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "3.1"] },
    { "id": 2, "tasks": ["3.2"] },
    { "id": 3, "tasks": ["3.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] }
  ]
}
```
