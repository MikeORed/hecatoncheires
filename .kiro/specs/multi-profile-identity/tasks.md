# Implementation Plan: Multi-Profile Identity

## Overview

Evolve the agent identity model from a single `modelId`/`profileArn` to an ordered `modelBindings` array, producing N inference profiles per agent. The change spans core (schema, policy assembly), cdk (resource loop, alarms, permission boundary), and api (registry adapter, exclusivity check). No backward compatibility or migration logic is needed.

## Tasks

- [x] 1. Core schema and types
  - [x] 1.1 Create `ModelBindingSchema` and update `AgentConfigurationSchema`
    - Create `packages/core/src/schemas/model-binding.schema.ts` with `ModelBindingSchema`, `ModelBindingLabelPattern`, and `ModelBindingThresholdsSchema`
    - Update `packages/core/src/schemas/agent-configuration.schema.ts`: replace `modelId` field with `modelBindings` array (min 1, max 5), add `superRefine` for duplicate label rejection
    - Export new schema from `packages/core/src/schemas/index.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.2_

  - [x] 1.2 Update types and entity factory
    - Add `ModelBinding` and `ModelBindingThresholds` types to `packages/core/src/types/index.ts`
    - Update `createAgentConfiguration` factory in `packages/core/src/entity/` to accept the new schema shape
    - Update existing `AgentConfiguration` type (inferred from updated schema)
    - _Requirements: 1.1, 1.2_

  - [x] 1.3 Write property tests for model bindings validation
    - **Property 1: Valid model bindings are accepted, invalid are rejected**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 8.1, 8.2**

  - [x] 1.4 Write property test for duplicate label rejection
    - **Property 2: Duplicate labels are rejected**
    - **Validates: Requirements 1.5**

- [x] 2. Shape catalog and policy assembly
  - [x] 2.1 Update `core-invocation` shape in the shape catalog
    - In `packages/core/src/config/shape-catalog.ts`, clear `requiredParameters` for `core-invocation` and set `Resource: '*'` as placeholder
    - _Requirements: 6.1_

  - [x] 2.2 Add `PolicyAssemblyContext` interface and update `assemblePolicy`
    - In `packages/core/src/shared/algorithms/assemble-policy.ts`:
      - Add `PolicyAssemblyContext` interface with `profileArns: string[]`
      - Add required `context` parameter to `assemblePolicy` signature
      - Add `resolveCoreInvocation` helper: uses context profileArns for Resource, produces deny-all when empty
      - Route `core-invocation` grants through `resolveCoreInvocation` instead of generic `resolveShape`
    - Export `PolicyAssemblyContext` from `packages/core/src/shared/algorithms/index.ts`
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 2.3 Write property test for policy assembly core-invocation resolution
    - **Property 4: Policy assembly resolves core-invocation from profile context**
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [x] 3. Core errors and naming utilities
  - [x] 3.1 Add `ProfileExclusivityError`
    - Create `packages/core/src/errors/profile-exclusivity-error.ts` extending `DomainError`
    - Export from `packages/core/src/errors/index.ts`
    - _Requirements: 2.2_

  - [x] 3.2 Add `NamingGenerator` multi-profile methods
    - In `packages/core/src/constants/` (or wherever `NamingGenerator` lives), add:
      - `multiProfileName(configName, label)` returning `hecaton-{stage}-{configName}-{label}-profile`
      - `perProfileAlarmNames(configName, label)` returning `{ token, block, observation }` with pattern `hecaton-{stage}-{configName}-{label}-{type}-alarm`
    - _Requirements: 3.2, 5.5_

  - [x] 3.3 Write property test for per-profile alarm naming
    - **Property 5: Per-profile alarm naming follows pattern**
    - **Validates: Requirements 5.5**

- [x] 4. Core public API barrel and existing test fixes
  - [x] 4.1 Update `packages/core/src/public-api.ts` barrel exports
    - Ensure `ModelBindingSchema`, `ModelBindingLabelPattern`, `ModelBindingThresholdsSchema`, `PolicyAssemblyContext`, `ProfileExclusivityError`, and new types are exported
    - _Requirements: all (enables downstream packages to import)_

  - [x] 4.2 Update existing core tests
    - Fix `packages/core/src/schemas/agent-configuration.schema.test.ts` to use `modelBindings` array instead of `modelId`
    - Fix `packages/core/src/shared/algorithms/assemble-policy.property.test.ts` to pass `PolicyAssemblyContext`
    - Fix `packages/core/src/config/shape-catalog.test.ts` if it references `core-invocation.requiredParameters`
    - Fix any other test files referencing the old `modelId` field
    - _Requirements: all core requirements_

- [x] 5. Checkpoint - Core package
  - Ensure all core tests pass (`pnpm --filter @hecaton/core test`), ask the user if questions arise.

- [x] 6. CDK constructs
  - [x] 6.1 Update `AgentIdentity` construct for multi-profile
    - In `packages/cdk/lib/constructs/agent-identity.construct.ts`:
      - Change `profileArn: string` prop to `profileArns: string[]`
      - Update permission boundary statement to use `ForAnyValue:StringEquals` with the full array of profile ARNs on the `bedrock:InferenceProfileArn` condition key
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Update `AgentConfigStack` for multi-profile loop
    - In `packages/cdk/lib/stacks/agent-config.stack.ts`:
      - Replace `modelId: string` prop with `modelBindings: Array<{ modelId, label, thresholds? }>`
      - Add loop creating one `CfnApplicationInferenceProfile` per binding using `naming.multiProfileName`
      - Add validation: throw if any `modelId` is empty or if `modelBindings` array is empty
      - Expose `profileArns` array for downstream constructs
      - Tag each profile with standard tags
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.3, 8.4_

  - [x] 6.3 Update `AgentPolicyModulator` construct for per-profile alarms
    - In `packages/cdk/lib/constructs/agent-policy-modulator.construct.ts`:
      - Replace single-profile props with `profileBindings: ProfileBinding[]`
      - Create per-profile token/block/observation alarms using `naming.perProfileAlarmNames`
      - Use per-profile thresholds when provided, fall back to agent-level defaults
      - Create a single composite alarm (`AlarmRule.anyOf(...)`) triggering the Breaker Lambda
      - Expose per-profile alarms and composite alarm as typed outputs
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. CDK wiring and seed files
  - [x] 7.1 Update `bin/app.ts` stack instantiation
    - Replace `modelId` prop with `modelBindings` array in stack instantiation
    - Pass `profileArns` array to `AgentIdentity` and `profileBindings` array to `AgentPolicyModulator`
    - _Requirements: 3.1, 3.4_

  - [x] 7.2 Update seed file format
    - Update `packages/cdk/lib/config/seeds/example-agentcore-managed.json` to use `modelBindings` array format instead of single `modelId`
    - _Requirements: 1.1_

  - [x] 7.3 Update existing CDK tests
    - Fix `packages/cdk/test/constructs/agent-identity.property.test.ts` to use `profileArns` array
    - Fix `packages/cdk/test/constructs/agent-policy-modulator.construct.test.ts` to use `profileBindings`
    - Fix `packages/cdk/test/stacks/agent-config.stack.test.ts` and `test-agent-config.stack.ts` to use `modelBindings`
    - Fix `packages/cdk/test/stacks/agent-config.property.test.ts` for new props shape
    - _Requirements: 3.1, 4.1, 5.1_

- [x] 8. Checkpoint - CDK package
  - Ensure all CDK tests pass (`pnpm --filter @hecaton/cdk test`), ask the user if questions arise.

- [x] 9. API agent registry adapter
  - [x] 9.1 Update agent registry adapter for multi-profile storage
    - In `packages/api/src/adapters/dynamo/agent-registry.adapter.ts`:
      - Update the registry record type to include `profiles: RegistryProfileRecord[]` array
      - Ensure profile ordering matches `modelBindings` ordering on write
      - Add GSI query for profileArn exclusivity check
    - Update DTOs in `packages/api/src/adapters/dynamo/dto/` if applicable
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 9.2 Implement profile exclusivity check with transactional write
    - In the registry adapter, use `TransactWriteItems`:
      - `ConditionCheck` per profile ARN to verify no other agent owns it
      - `Put` for the agent record
    - Throw `ProfileExclusivityError` (from `@hecaton/core`) on condition failure
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 9.3 Write property test for profile exclusivity enforcement
    - **Property 3: Profile exclusivity enforcement**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 9.4 Write property test for registry profile ordering
    - **Property 6: Registry profile ordering is preserved**
    - **Validates: Requirements 7.1, 7.4**

  - [x] 9.5 Update existing registry adapter tests
    - Fix `packages/api/src/adapters/dynamo/agent-registry.adapter.test.ts` to use `profiles` array instead of single profile fields
    - _Requirements: 7.1_

- [x] 10. API use-case layer wiring
  - [x] 10.1 Update grant use-case to pass `PolicyAssemblyContext`
    - In the relevant use-case file under `packages/api/src/use-cases/`, fetch profile ARNs from the registry adapter and pass as `PolicyAssemblyContext` to `assemblePolicy`
    - _Requirements: 6.2_

- [x] 11. Final checkpoint
  - Ensure all tests pass across all packages (`pnpm test`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- No backward compatibility or migration logic is needed — nothing is deployed yet
- All references to the old single `modelId` / `profileArn` pattern are replaced directly
- Property tests validate universal correctness properties from the design document
- The `core-invocation` shape's `Resource` field is now resolved at assembly time from registry context, not from grant parameters
- Checkpoints ensure incremental validation of each package before moving downstream

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "3.3", "4.1"] },
    { "id": 3, "tasks": ["2.3", "4.2"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2", "9.5"] },
    { "id": 8, "tasks": ["9.3", "9.4", "10.1"] }
  ]
}
```
