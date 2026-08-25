# Implementation Plan: Policy Modulator Lambda Wiring

## Overview

This plan implements Bundle A of Hecatoncheires Phase 1: the AgentPolicyModulator CDK construct, shared Breaker Lambda, Agent Registry table, API Gateway L2 upgrade with method wiring, and the runtime plumbing connecting these pieces. Work flows bottom-up: core extension → API ports/adapters → handler/use-case refactoring → CDK infrastructure → tests.

## Tasks

- [x] 1. Core package extension
  - [x] 1.1 Add `agentRegistryTableName()` method to NamingGenerator
    - Add a method returning `hecaton-{stage}-agent-registry` to `packages/core/src/constants/naming.ts`
    - Add a unit test in `packages/core/src/constants/naming.test.ts` verifying the new method
    - Export is already covered via the existing barrel chain
    - _Requirements: 14.5, 12.1_

- [x] 2. API layer — ports and adapters
  - [x] 2.1 Create AgentRegistryPort interface
    - Create `packages/api/src/ports/agent-registry.port.ts` with `AgentRegistryRecord` interface and `AgentRegistryPort` interface (getByAgentId, getByProfileEntityId, getByConfigName, updateBreakerState)
    - Re-export from `packages/api/src/ports/index.ts`
    - _Requirements: 11.9_

  - [x] 2.2 Create SnsNotifierPort interface
    - Create `packages/api/src/ports/sns-notifier.port.ts` with `SnsNotifierPort` interface (publish method)
    - Re-export from `packages/api/src/ports/index.ts`
    - _Requirements: 3.5_

  - [x] 2.3 Implement AgentRegistryAdapter
    - Create `packages/api/src/adapters/dynamo/agent-registry.adapter.ts` implementing AgentRegistryPort
    - Uses DynamoDB GetItemCommand, QueryCommand, UpdateItemCommand with PK patterns (AGENT#, PROFILE#, CONFIG#)
    - getByProfileEntityId and getByConfigName perform a two-step lookup (query reverse-lookup → getByAgentId)
    - _Requirements: 11.10_

  - [x] 2.4 Write unit tests for AgentRegistryAdapter
    - Create `packages/api/src/adapters/dynamo/agent-registry.adapter.test.ts`
    - Mock DynamoDB client send() method
    - Test getByAgentId (found/not-found), getByProfileEntityId (two-step, found/not-found), getByConfigName (two-step), updateBreakerState (command construction)
    - _Requirements: 11.10_

  - [x] 2.5 Implement SnsNotifierAdapter
    - Create `packages/api/src/adapters/sns/sns-notifier.adapter.ts` implementing SnsNotifierPort
    - Uses SNSClient PublishCommand with topicArn and subject/message
    - _Requirements: 3.5_

  - [x] 2.6 Write unit tests for SnsNotifierAdapter
    - Create `packages/api/src/adapters/sns/sns-notifier.adapter.test.ts`
    - Mock SNSClient send(), verify PublishCommand parameters
    - _Requirements: 3.5_

- [x] 3. API layer — dependencies extension
  - [x] 3.1 Extend Dependencies interface and getDependencies() factory
    - Add `agentRegistry: AgentRegistryPort` to the `Dependencies` interface in `packages/api/src/shared/dependencies.ts`
    - Instantiate `AgentRegistryAdapter` in `getDependencies()` using `AGENT_REGISTRY_TABLE_NAME` env var
    - _Requirements: 11.11_

  - [x] 3.2 Create BreakerDependencies interface and getBreakerDependencies() factory
    - Add `BreakerDependencies` extending `Dependencies` with `snsNotifier: SnsNotifierPort`
    - Implement `getBreakerDependencies()` using `SNS_TOPIC_ARN` env var for SnsNotifierAdapter
    - _Requirements: 3.5, 11.7_

- [x] 4. Checkpoint - Ensure ports, adapters, and dependencies compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. API layer — use-case refactoring
  - [x] 5.1 Extend trip-breaker use-case
    - Update `packages/api/src/use-cases/trip-breaker.ts` to accept `TripBreakerInput` with agentId and alarmName
    - Add registry `updateBreakerState` call (best-effort)
    - Add SNS notification publish (best-effort) via `deps.snsNotifier`
    - Change deps parameter type to `BreakerDependencies`
    - IAM write failure must propagate, other failures are swallowed
    - _Requirements: 3.3, 3.4, 3.5, 3.9, 3.10_

  - [x] 5.2 Write unit tests for extended trip-breaker use-case
    - Update `packages/api/src/use-cases/trip-breaker.test.ts`
    - Test deny-all written, registry updated (best-effort), event emitted (best-effort), SNS published (best-effort)
    - Test IAM failure propagates while registry/event/SNS failures are swallowed
    - _Requirements: 3.3, 3.4, 3.5, 3.9, 3.10_

  - [x] 5.3 Extend grant-shape use-case with policy size rollback
    - Update `packages/api/src/use-cases/grant-shape.ts` to handle policy size violation (>10,240 bytes): delete the newly written grant from ledger and throw PolicySizeExceededError
    - _Requirements: 2.3, 2.7_

  - [x] 5.4 Write unit tests for grant-shape policy size rollback
    - Update `packages/api/src/use-cases/grant-shape.test.ts`
    - Test that oversized policy triggers grant deletion and error
    - Test that unknown shapeName aborts operation
    - _Requirements: 2.7, 2.9_

- [x] 6. API layer — handler refactoring
  - [x] 6.1 Refactor breaker-trip.alarm handler
    - Update `packages/api/src/handlers/breaker-trip.alarm.ts` to extract profileEntityId from alarm dimensions
    - Resolve agent identity via `deps.agentRegistry.getByProfileEntityId()`
    - No-op for non-ALARM transitions
    - Parse failures: log and return (no throw)
    - Registry miss: log and return (no throw)
    - Use `getBreakerDependencies()` factory
    - _Requirements: 3.1, 3.2, 3.6, 3.7, 3.8, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 6.2 Write unit tests for breaker-trip.alarm handler
    - Update `packages/api/src/handlers/breaker-trip.alarm.test.ts`
    - Test: profile entity ID extraction, registry resolution, non-ALARM no-op, missing dimensions logged + returns, registry miss logged + returns, use-case error propagates
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 11.4, 11.5, 11.8_

  - [x] 6.3 Refactor grant-shape.http handler for agentId resolution
    - Update `packages/api/src/handlers/grant-shape.http.ts` to accept `agentId` in request body
    - Resolve agentId → configName + roleName via `deps.agentRegistry.getByAgentId()`
    - Return 404 AGENT_NOT_FOUND if registry lookup returns null
    - Update GrantShapeRequestSchema (agentId replaces configName/roleName in request)
    - _Requirements: 2.1, 2.10, 15.5, 15.7, 15.8_

  - [x] 6.4 Write unit tests for grant-shape.http handler
    - Update `packages/api/src/handlers/grant-shape.http.test.ts`
    - Test: agentId resolution success, 404 on unknown agent, validation error on bad body, full grant flow
    - _Requirements: 2.1, 2.10, 15.7, 15.8_

  - [x] 6.5 Refactor revoke-shape.http handler for agentId resolution
    - Update `packages/api/src/handlers/revoke-shape.http.ts` to accept `agentId` in request body
    - Resolve agentId → configName + roleName via registry lookup
    - Return 404 AGENT_NOT_FOUND if not found
    - Update RevokeShapeRequestSchema
    - _Requirements: 2.1, 2.10, 15.5, 15.7, 15.8_

  - [x] 6.6 Write unit tests for revoke-shape.http handler
    - Update `packages/api/src/handlers/revoke-shape.http.test.ts`
    - Test: agentId resolution, 404 on unknown agent, full revoke flow
    - _Requirements: 2.1, 2.10, 15.7, 15.8_

  - [x] 6.7 Refactor query-fleet-state.http handler to use Agent Registry
    - Update `packages/api/src/handlers/query-fleet-state.http.ts` to query Agent Registry (GSI1: SK = #META) for fleet listing
    - Response includes agentId, configName, agentType, modelId, status, breakerState, and grants per agent
    - _Requirements: 15.6_

  - [x] 6.8 Write unit tests for query-fleet-state.http handler
    - Update `packages/api/src/handlers/query-fleet-state.http.test.ts`
    - Test: response includes agentId, configName, status, breakerState per agent
    - _Requirements: 15.6_

- [x] 7. Checkpoint - Ensure API package compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. CDK — SharedInfraStack extensions
  - [x] 8.1 Add Agent Registry table to SharedInfraStack
    - Add DynamoDB table `hecaton-{stage}-agent-registry` with pk/sk keys, PAY_PER_REQUEST, PITR, RETAIN removal policy
    - Add GSI `gsi1` (pk: sk, sk: pk)
    - Expose as `agentRegistryTable` property on the stack
    - Add CfnOutputs for table name and ARN
    - Apply standard Hecatoncheires tags
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 12.5_

  - [x] 8.2 Add Breaker Lambda to SharedInfraStack
    - Deploy using NodejsFunction with entry at `packages/api/src/handlers/breaker-trip.alarm.ts`
    - Configure: Node.js 20, arm64, 256 MB, 30s timeout
    - Environment vars: AGENT_REGISTRY_TABLE_NAME, OPS_BUS_ARN, SNS_TOPIC_ARN, OPERATING_POLICY_NAME
    - Name via `naming.lambdaName('breaker-trip')`
    - IAM: read/update Agent Registry, PutRolePolicy scoped to agent role pattern, PutEvents on ops bus, Publish on SNS topic
    - Expose as `breakerLambda` property on the stack
    - Apply standard tags
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.3 Upgrade API Gateway from L1 CfnRestApi to L2 RestApi
    - Replace existing CfnRestApi with L2 RestApi construct
    - Configure: restApiName, apiKeySourceType HEADER, deploy: true, deployOptions with stageName
    - Add /grants resource (POST, DELETE) and /fleet resource (GET)
    - Create handler Lambdas (grant-shape, revoke-shape, query-fleet-state) with NodejsFunction
    - Wire LambdaIntegration, apiKeyRequired: true on all methods
    - Create usage plan + API key, associate with stage
    - Grant each Lambda appropriate IAM: DynamoDB (grant ledger + registry), IAM PutRolePolicy, EventBridge PutEvents
    - Configure handler environment variables: GRANT_LEDGER_TABLE_NAME, AGENT_REGISTRY_TABLE_NAME, OPS_BUS_ARN, OPERATING_POLICY_NAME
    - Export API key value as CfnOutput
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 12.3, 12.4_

- [x] 9. CDK — AgentPolicyModulator construct
  - [x] 9.1 Create AgentPolicyModulator construct
    - Create `packages/cdk/lib/constructs/agent-policy-modulator.construct.ts`
    - Props validation (configName non-empty, profileEntityId non-empty, thresholds positive integers)
    - Create 3 CloudWatch alarms with correct metrics, periods, thresholds, and InferenceProfileId dimension
    - Configure alarm actions targeting shared Breaker Lambda (LambdaAction)
    - Add Lambda invoke permissions scoped to alarm ARNs
    - Deploy RegistrySeed Lambda + CDK Provider custom resource
    - Expose `outputs: AgentPolicyModulatorOutputs` (tokenAlarm, blockAlarm, observationAlarm)
    - Expose agentId as CfnOutput
    - Apply tags via NamingGenerator
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.13, 6.14, 6.15, 12.1, 12.2_

  - [x] 9.2 Create RegistrySeed Lambda handler
    - Create `packages/cdk/lib/lambda/registry-seed.handler.ts`
    - Implement onCreate: generate UUIDv7, TransactWriteItems for 3 records (metadata, profile reverse-lookup, config reverse-lookup) with conditional write
    - Implement onUpdate: read existing agentId, handle profileEntityId change cleanup, TransactWriteItems for updated records preserving agentId and createdAt
    - Implement onDelete: TransactWriteItems to remove all 3 records
    - Return agentId as PhysicalResourceId and Data attribute
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

- [x] 10. CDK — AgentConfigStack updates
  - [x] 10.1 Update AgentConfigStack to integrate AgentPolicyModulator
    - Expose `profileEntityId` from `CfnApplicationInferenceProfile.attrInferenceProfileId` as a class property
    - Extend `AgentConfigStackProps` with `thresholds` and `sharedInfra.breakerLambda`/`sharedInfra.agentRegistryTable`
    - Instantiate AgentPolicyModulator after AgentIdentity, passing all required props
    - Add CfnOutput for profileEntityId
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 11. Checkpoint - Ensure CDK package synthesizes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. CDK assertion tests
  - [x] 12.1 Write AgentPolicyModulator construct assertion tests
    - Create `packages/cdk/test/constructs/agent-policy-modulator.construct.test.ts`
    - Verify: 3 alarms with correct MetricName, Namespace, Period; alarm actions target Breaker Lambda ARN; custom resource with correct properties; RegistrySeed Lambda IAM policy
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 12.2 Extend SharedInfraStack assertion tests
    - Update `packages/cdk/test/stacks/shared-infra.stack.test.ts`
    - Add tests: Agent Registry table (key schema, GSI, PITR, billing); Breaker Lambda (env vars, runtime, memory, permissions); API Gateway methods (POST/DELETE/GET with AWS_PROXY); usage plan + API key; all methods apiKeyRequired; RestApi with correct name and ApiKeySourceType
    - _Requirements: 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [x] 12.3 Extend AgentConfigStack assertion tests
    - Update `packages/cdk/test/stacks/agent-config.stack.test.ts`
    - Verify: AgentPolicyModulator instantiated, profileEntityId output exists, thresholds passed through
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 13. Final checkpoint - Ensure all packages build and tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation across package boundaries
- The design document does not include a Correctness Properties section suitable for property-based testing (PBT) — the feature is predominantly infrastructure (CDK) and I/O adapters. Verification uses CDK assertion tests and example-based unit tests instead.
- CDK tests live in `packages/cdk/test/{constructs,stacks}/` (separate from source), while API tests are co-located with source files
- The RegistrySeed Lambda is deployed within the CDK package (`lib/lambda/`) since it's a custom resource handler, not a runtime API handler
- The `uuid` package (for UUIDv7) will need to be added as a dependency to the CDK package for the RegistrySeed Lambda

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.5", "3.1"] },
    { "id": 3, "tasks": ["2.4", "2.6", "3.2"] },
    { "id": 4, "tasks": ["5.1", "5.3"] },
    { "id": 5, "tasks": ["5.2", "5.4", "6.1", "6.3", "6.5", "6.7"] },
    { "id": 6, "tasks": ["6.2", "6.4", "6.6", "6.8"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["8.3", "9.2"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["12.1", "12.2", "12.3"] }
  ]
}
```
