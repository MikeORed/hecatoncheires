# Implementation Plan: Phase 1 Infrastructure Completion

## Overview

Completes the Hecatoncheires Phase 1 infrastructure by implementing AppConfig integration, drift detection, Bedrock invocation logging, and the AgentBusChannel construct. Implementation follows dependency order: core NamingGenerator extensions first, then the API handler, then CDK constructs and stack additions.

## Tasks

- [x] 1. Extend NamingGenerator with new naming methods
  - [x] 1.1 Add `appConfigApplicationName`, `appConfigEnvironmentName`, `appConfigProfileName`, `driftDetectionLambdaName`, and `bedrockLogGroupName` methods to `packages/core/src/constants/naming.ts`
    - `appConfigApplicationName()` → `hecaton-{stage}-platform`
    - `appConfigEnvironmentName(environmentName?)` → `hecaton-{stage}-{environmentName}` (defaults to stage)
    - `appConfigProfileName(configName)` → `hecaton-{stage}-{configName}-tunables`
    - `driftDetectionLambdaName()` → `hecaton-{stage}-drift-detection`
    - `bedrockLogGroupName()` → `/aws/bedrock/invocations/{stage}`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 1.2 Add unit tests for all new NamingGenerator methods in `packages/core/src/constants/naming.test.ts`
    - Test each method with stage "dev" and configName "sre-ops" (matching existing test pattern)
    - Test across multiple stages (prod, staging, sit)
    - Test `appConfigEnvironmentName` with and without explicit environmentName parameter
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 1.3 Write property tests for NamingGenerator extensions
    - **Property 1: NamingGenerator methods produce stage-embedded, pattern-conforming names**
    - **Property 2: NamingGenerator methods produce unique names across different methods**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [x] 2. Checkpoint - Ensure core package builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement drift detection handler
  - [x] 3.1 Create `packages/api/src/handlers/drift-detect.event.ts` with handler logic
    - Define `DriftDetectEvent` interface matching CloudTrail event shape
    - Implement `isKnownPrincipal(modifierArn, knownPrincipals)` — extract role name from both `arn:aws:iam::ACCOUNT:role/ROLE_NAME` and `arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION` formats
    - Parse `KNOWN_PRINCIPALS` env var (JSON array), default to empty on missing/invalid
    - If modifier is known principal → return (no action)
    - If unknown → emit `drift.detected` event to ops bus and publish SNS alert
    - Follow existing handler pattern: flat file, use dependency injection via a `getDriftDependencies()` function
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 3.2 Create drift detection dependencies and adapters
    - Add `getDriftDependencies()` to `packages/api/src/shared/dependencies.ts` (or a separate drift-dependencies file) providing `BusEmitterPort` and `SnsNotifierPort`
    - Reuse existing `BusEmitterAdapter` and `SnsNotifierAdapter`
    - _Requirements: 3.5, 3.6, 3.8_

  - [x] 3.3 Write unit tests for drift detection handler in `packages/api/src/handlers/drift-detect.event.test.ts`
    - Test known principal → no alert emitted
    - Test unknown principal → event + SNS notification emitted
    - Test assumed-role ARN format correctly extracts role name
    - Test missing `userIdentity.arn` → skips gracefully
    - Test missing/invalid `KNOWN_PRINCIPALS` env var → treats as empty (alerts on everything)
    - Mock adapters at the boundary (matching existing test pattern)
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 3.4 Write property tests for `isKnownPrincipal` function
    - **Property 3: Known principal identification is correct for all ARN formats**
    - **Property 4: Known principal check is symmetric with list membership**
    - **Validates: Requirements 3.4, 3.7**

- [x] 4. Checkpoint - Ensure api package builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add AppConfig resources to SharedInfraStack
  - [x] 5.1 Add AppConfig Application and Environment to `packages/cdk/lib/stacks/shared-infra.stack.ts`
    - Create `CfnApplication` named `hecaton-{stage}-platform` via NamingGenerator
    - Create `CfnEnvironment` associated with the application, named with stage value
    - Apply standard Hecatoncheires tags to the application
    - Expose `appConfigAppId` and `appConfigEnvId` as stack properties
    - Add CfnOutputs for cross-stack consumption
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 5.2 Add drift detection infrastructure to `packages/cdk/lib/stacks/shared-infra.stack.ts`
    - Create `NodejsFunction` for drift detection (Node.js 20, ARM64, 256MB, 30s timeout)
    - Set function name via `NamingGenerator.driftDetectionLambdaName()`
    - Entry: `packages/api/src/handlers/drift-detect.event.ts`
    - Environment variables: `OPS_BUS_ARN`, `SNS_TOPIC_ARN`, `KNOWN_PRINCIPALS` (JSON array of platform Lambda role ARNs)
    - Create EventBridge rule on default bus matching CloudTrail IAM mutation events targeting `hecaton-{stage}-*-agent-role`
    - Grant `events:PutEvents` on ops bus and `sns:Publish` on SNS topic
    - Expose `breakerLambdaRoleArn`, `grantLambdaRoleArn`, `revokeLambdaRoleArn` for the known principals list
    - _Requirements: 3.1, 3.2, 3.3, 3.8_

  - [x] 5.3 Add Bedrock invocation logging to `packages/cdk/lib/stacks/shared-infra.stack.ts`
    - Create CloudWatch Logs log group `/aws/bedrock/invocations/{stage}` with 30-day retention
    - Create `AwsCustomResource` calling `bedrock:PutModelInvocationLoggingConfiguration`
    - Grant the custom resource execution role the necessary Bedrock logging permissions
    - Add resource policy on log group granting `bedrock.amazonaws.com` write access
    - Expose log group ARN as CfnOutput (`BedrockLogGroupArn`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Implement AgentBusChannel construct
  - [x] 6.1 Create `packages/cdk/lib/constructs/agent-bus-channel.construct.ts`
    - Define `AgentBusChannelProps` interface (configName, signalsBusArn, sourceNamespace, subscriptionPatterns?, agentRole, stage)
    - Define `AgentBusChannelOutputs` interface (signalsQueue, deadLetterQueue, rule)
    - Create SQS FIFO DLQ with 14-day retention
    - Create SQS FIFO signals queue (visibility timeout 60s, retention 14 days, maxReceiveCount 3 → DLQ, content-based deduplication)
    - Import signals bus from ARN
    - Build event pattern from sourceNamespace + optional subscriptionPatterns (default: match all from source)
    - Create EventBridge rule on signals bus with the event pattern
    - Add SQS target with `MessageGroupId: $.detail.correlationId` and rule-level DLQ
    - Grant agent role consume permissions (sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes)
    - Apply standard Hecatoncheires tags
    - Expose outputs
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 7. Add AppConfig profile to AgentConfigStack
  - [x] 7.1 Extend `AgentConfigStackProps` and add AppConfig profile creation to `packages/cdk/lib/stacks/agent-config.stack.ts`
    - Add `appConfigAppId` and `appConfigEnvId` to `sharedInfra` props
    - Create `CfnConfigurationProfile` named via `NamingGenerator.appConfigProfileName(configName)`
    - Create `CfnHostedConfigurationVersion` with JSON content built from `props.thresholds` + default feature flags
    - Create `CfnDeploymentStrategy` — zero-duration for dev, linear 10-min for staging/prod
    - Create `CfnDeployment` triggering initial deployment
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 8. Checkpoint - Ensure CDK package synthesizes without errors
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Write CDK assertion tests
  - [x] 9.1 Extend `packages/cdk/test/stacks/shared-infra.stack.test.ts` with new assertion tests
    - Verify AppConfig Application exists with correct name
    - Verify AppConfig Environment is linked to application
    - Verify Drift Detection Lambda exists with correct runtime, architecture, memory, timeout
    - Verify EventBridge rule on default bus with correct IAM mutation event pattern
    - Verify Lambda IAM permissions (PutEvents on ops bus, Publish on SNS topic)
    - Verify CloudWatch Logs log group with `/aws/bedrock/invocations/test` name and 30-day retention
    - Verify CfnOutputs for AppConfig IDs and Bedrock log group ARN
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 9.2 Create `packages/cdk/test/constructs/agent-bus-channel.construct.test.ts`
    - Verify SQS FIFO queue with correct name, visibility timeout (60s), retention (14 days)
    - Verify DLQ (FIFO) with correct name and retention
    - Verify redrive policy with maxReceiveCount = 3
    - Verify EventBridge rule with correct event pattern (source + subscription patterns)
    - Verify SQS target with MessageGroupId configuration
    - Verify agent role gets consume permissions
    - Verify fallback: no subscriptionPatterns → rule matches all events from sourceNamespace
    - Verify standard tags applied
    - _Requirements: 8.4, 8.5, 8.6_

  - [x] 9.3 Extend `packages/cdk/test/stacks/agent-config.stack.test.ts` with AppConfig profile assertions
    - Verify ConfigurationProfile exists with correct name and location type
    - Verify HostedConfigurationVersion contains valid JSON content
    - Verify DeploymentStrategy matches stage logic (0-duration for dev)
    - _Requirements: 8.1_

- [x] 10. Final checkpoint - Ensure all packages build, lint, and tests pass
  - Run `pnpm build && pnpm test && pnpm lint` from workspace root
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- NamingGenerator extensions (task 1) must be completed first — all CDK constructs depend on `@hecaton/core`
- Drift detection handler (task 3) must be completed before CDK infra (task 5.2) since `NodejsFunction` bundles from source
- The `RuntimeTunablesSchema` already exists in `packages/core/src/schemas/runtime-tunables.schema.ts` — no need to create it
- Existing adapters (`BusEmitterAdapter`, `SnsNotifierAdapter`) can be reused for the drift handler
- CDK tests follow the existing `Template.fromStack()` assertion pattern visible in `shared-infra.stack.test.ts`
- Property tests use `fast-check` library with Vitest, minimum 100 iterations per property
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
