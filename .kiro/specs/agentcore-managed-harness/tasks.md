# Implementation Plan: AgentCore Managed Harness

## Overview

Implement `AgentCoreManagedStack` — a concrete CDK stack subclass that extends `AgentConfigStack` to deploy an AWS BedrockAgentCore `CfnHarness` resource fully wired to the Hecatoncheires governance plane. The stack validates harness-specific configuration at synthesis time, creates the CfnHarness bound to the governed IAM role, and optionally attaches a signal delivery channel. A seed configuration file and CDK app entry point wiring complete the deployment pipeline.

## Tasks

- [x] 1. Implement AgentCoreManagedStack with validation and CfnHarness creation
  - [x] 1.1 Create the AgentCoreManagedStack class with interfaces and input validation
    - Create file `packages/cdk/lib/stacks/agentcore-managed.stack.ts`
    - Define `HarnessToolConfig`, `HarnessSkillConfig`, `HarnessConfig`, `SignalChannelConfig`, and `AgentCoreManagedStackProps` interfaces extending `AgentConfigStackProps`
    - Implement ordered validation in constructor before calling `super()`: agentType check, systemPrompt non-empty/non-whitespace, maxIterations range (1–1000), maxTokens range (1–128000), timeoutSeconds range (1–3600), tools[i].type non-empty
    - Throw descriptive errors matching the patterns defined in the design (e.g., `AgentCoreManagedStack: systemPrompt must be a non-empty, non-whitespace string`)
    - First failing validation halts synthesis — no resources created
    - _Requirements: 4.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 1.2 Implement CfnHarness resource creation and governance wiring
    - After `super()` call, create `CfnHarness` resource using `aws-cdk-lib/aws-bedrockagentcore`
    - Set `executionRoleArn` to `this.identity.role.roleArn`
    - Set `harnessName` via `NamingGenerator.harnessName(configName)`
    - Set `model.bedrockModelConfig.modelId` to `props.modelId`
    - Set `model.bedrockModelConfig.maxTokens` only if `harnessConfig.maxTokens` is provided
    - Set `systemPrompt` to array with one `HarnessSystemContentBlockProperty` containing the text
    - Set `maxIterations` only if provided, `timeoutSeconds` only if provided
    - Map `tools`, `allowedTools`, `skills` only when non-empty arrays
    - Add `DependsOn` relationship to the AgentIdentity role logical ID via `harness.addDependency()`
    - Create `CfnOutput` for harnessArn with export name `{stackId}-harnessArn`
    - Expose readonly `harnessName` property on the stack instance
    - Apply all five standard tags including `hecatoncheires:harness-type=agentcore-managed`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4_

  - [x] 1.3 Implement optional signal channel integration
    - If `props.signalChannel` is provided, instantiate `AgentBusChannel` passing `configName`, `signalsBusArn`, `sourceNamespace`, `this.identity.role`, `stage`, and optional `subscriptionPatterns`
    - When channel is active, pass `SIGNAL_QUEUE_URL` to harness (via CfnHarness environment or output — depends on CfnHarness L1 API)
    - Expose `signalChannel: AgentBusChannelOutputs | undefined` readonly property on the stack
    - When not provided, no signal-related resources are created
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Checkpoint - Ensure stack compiles and exports are correct
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create seed configuration and wire CDK app entry point
  - [x] 3.1 Create the seed configuration JSON file
    - Create file `packages/cdk/lib/config/seeds/example-agentcore-managed.json`
    - Include all required fields: `configName` (e.g., `test-managed`), `agentType: "agentcore-managed"`, `modelId`, `thresholds` with dev-appropriate values (outputTokensPerHour ≤1000, guardrailBlocksPer10Min ≤5, guardrailObservationsPerHour ≤50)
    - Include `harnessConfig` with `systemPrompt`, `maxIterations`, `maxTokens`, `timeoutSeconds`
    - Ensure `configName` passes `ConfigNamePattern` (`^[a-z][a-z0-9-]*[a-z0-9]$`, 2–40 chars)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 3.2 Update CDK app entry point to instantiate AgentCoreManagedStack from seed
    - Update `packages/cdk/bin/app.ts` to import seed JSON and `AgentCoreManagedStack`
    - Read seed file(s) from `lib/config/seeds/` filtering for `agentType === 'agentcore-managed'`
    - Implement `toStackSuffix(configName)` helper (split on hyphens, capitalize segments, join)
    - Instantiate `AgentCoreManagedStack` with stack ID `Hecaton-{Stage}-AgentConfig-{ConfigNameCapitalized}`
    - Pass all `sharedInfra` cross-stack references from the SharedInfraStack instance
    - Add explicit CDK dependency from the AgentCoreManagedStack to SharedInfraStack
    - Handle JSON parse errors with descriptive error messages indicating file path and failure reason
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 4. Checkpoint - Verify CDK synthesis succeeds
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement CDK assertion tests
  - [x] 5.1 Create test helper and CfnHarness resource creation tests
    - Create file `packages/cdk/test/stacks/agentcore-managed.stack.test.ts`
    - Implement `createManagedTestStacks(overrides?)` helper following existing `createTestStacks` pattern
    - Test: template contains exactly 1 `AWS::BedrockAgentCore::Harness` resource
    - Test: `executionRoleArn` references the AgentIdentity role via `Fn::GetAtt`
    - Test: `harnessName` matches `NamingGenerator.harnessName(configName)` pattern
    - Test: `model.bedrockModelConfig.modelId` matches provided modelId
    - Test: `systemPrompt` contains content block with text
    - Test: all five standard tags applied to CfnHarness resource
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.9_

  - [x] 5.2 Write tests for harness-native limits (presence/absence)
    - Test: `maxIterations` present in template when provided, `Match.absent()` when omitted
    - Test: `maxTokens` present in template when provided, `Match.absent()` when omitted
    - Test: `timeoutSeconds` present in template when provided, `Match.absent()` when omitted
    - Test: all three limits can be set independently and together
    - _Requirements: 9.4, 9.5_

  - [x] 5.3 Write tests for tool/skill configuration and signal channel integration
    - Test: tools array maps 1:1 preserving order when provided
    - Test: allowedTools preserved in order when provided
    - Test: skills array maps 1:1 when provided
    - Test: empty/absent tools/skills/allowedTools → property absent from template
    - Test: with signalChannel config → template contains SQS FIFO queue + DLQ + EventBridge rule
    - Test: without signalChannel config → zero signal-related resources
    - _Requirements: 9.4, 9.5, 9.8_

  - [x] 5.4 Write tests for governance composition and input validation errors
    - Test: CfnHarness declares DependsOn to IAM role logical ID
    - Test: CfnOutput exists with harnessArn export name
    - Test: `harnessName` property on stack instance matches NamingGenerator pattern
    - Test: `agentType !== 'agentcore-managed'` throws error during construction
    - Test: empty systemPrompt throws synthesis error
    - Test: whitespace-only systemPrompt throws
    - Test: invalid maxIterations (0, negative, >1000, non-integer) throws
    - Test: invalid maxTokens throws
    - Test: invalid timeoutSeconds throws
    - Test: tool with empty type throws (error includes index)
    - _Requirements: 9.7_

- [x] 6. Final checkpoint - Ensure all tests pass and CDK synth succeeds
  - Ensure all tests pass, ask the user if questions arise.
  - Run `pnpm --filter @hecaton/cdk test` to verify all assertion tests pass
  - Run `pnpm --filter @hecaton/cdk synth` to verify full synthesis produces valid templates

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design explicitly states property-based testing does NOT apply to this IaC feature — CDK assertion tests with `Template.fromStack()` and `Match` utilities are the correct testing strategy
- The existing `test/setup.ts` mock eliminates esbuild invocations during test synthesis
- `NamingGenerator.harnessName()` already exists in `@hecaton/core` — no core changes needed
- `AgentBusChannel` construct already exists and is tested — only wiring is needed
- The `CfnHarness` L1 construct comes from `aws-cdk-lib/aws-bedrockagentcore` — verify the exact property names against the CDK API during implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.2"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4"] }
  ]
}
```
