# Implementation Plan: Tag Consolidation

## Overview

Consolidate the resource-tagging vocabulary across the Hecatoncheires CDK infrastructure. Work proceeds bottom-up through the clean-architecture layers: refactor the core tag helper (the vocabulary source of truth) first, update its tests, then propagate the change into the CDK stacks and constructs that consume it, update the CDK tests, refresh the steering doc, and finish with a full workspace verification gate.

Implementation language: **TypeScript** (existing monorepo).

## Tasks

- [x] 1. Refactor core tag vocabulary
  - [x] 1.1 Add `AgentType` type alias in core
    - In `packages/core/src/types/index.ts`, add `export type AgentType = AgentConfiguration['agentType'];`
    - Confirm it re-exports through `public-api.ts` (already `export *` on `types`), making `import { NamingGenerator, type AgentType } from '@hecaton/core'` valid in cdk
    - _Requirements: 1.9_

  - [x] 1.2 Refactor `NamingGenerator` tag helpers in `packages/core/src/constants/naming.ts`
    - Add `import type { AgentType } from '../types/index.js';`
    - Add `export interface AgentTagOptions { agentType: AgentType; }`
    - Add `sharedTags()` returning `{ managed: 'true', stage }` keyed by `${projectFullName}:managed` / `${projectFullName}:stage`
    - Add `agentTags(configName, opts)` composed from `sharedTags()` plus `:config` = configName and `:agent-type` = `opts.agentType`
    - Add private `toCfn(record)` mapping a record to `{ key, value }[]`
    - Add `agentTagsToCfn(configName, opts)` and `sharedTagsToCfn()` delegating to `toCfn`
    - Remove `tags()` and `tagsToCfn()` entirely with no backward-compat wrapper; ensure no `:phase` literal remains
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 1.3 Update `naming.test.ts` unit assertions
    - In `packages/core/src/constants/naming.test.ts`, remove the `tags` / `tagsToCfn` describe blocks asserting `phase` / `harness-type`
    - Add `agentTags` block (four keys + exact values, `agent-type` === raw agentType), `sharedTags` block (only `managed` + `stage`; `config` / `agent-type` absent), and `agentTagsToCfn` / `sharedTagsToCfn` blocks (`{ key, value }[]` shape + round-trip equality)
    - _Requirements: 7.1_

  - [x] 1.4 Write property test: Agent tag set content
    - In `packages/core/src/constants/naming.property.test.ts`
    - **Feature: tag-consolidation, Property 1: Agent tag set content**
    - Use `fc.constantFrom('agentcore-managed','openclaw','agentcore-runtime')` for agentType
    - **Validates: Requirements 1.1, 1.9, 6.4, 6.5**

  - [x] 1.5 Write property test: Shared tag set content and exclusions
    - In `packages/core/src/constants/naming.property.test.ts`
    - **Feature: tag-consolidation, Property 2: Shared tag set content and exclusions**
    - **Validates: Requirements 1.2, 1.5, 6.1, 6.2, 6.4, 6.5**

  - [x] 1.6 Write property test: No phase key emitted
    - In `packages/core/src/constants/naming.property.test.ts`; assert across all four helper methods
    - Remove Property 2's old `optionalPhase` / `optionalHarnessType` arbitraries and `tags(...)` usages
    - **Feature: tag-consolidation, Property 3: No phase key emitted**
    - **Validates: Requirements 1.6**

  - [x] 1.7 Write property test: Agent CFN round-trip
    - In `packages/core/src/constants/naming.property.test.ts`; `Object.fromEntries` of the array equals `agentTags(...)` and lengths match
    - **Feature: tag-consolidation, Property 4: Agent CFN round-trip**
    - **Validates: Requirements 1.3**

  - [x] 1.8 Write property test: Shared CFN round-trip
    - In `packages/core/src/constants/naming.property.test.ts`; `Object.fromEntries` of the array equals `sharedTags()` and lengths match
    - **Feature: tag-consolidation, Property 5: Shared CFN round-trip**
    - **Validates: Requirements 1.4**

- [x] 2. Checkpoint - Core builds and tests pass
  - Ensure `pnpm --filter @hecaton/core build` and `pnpm --filter @hecaton/core test` pass before cdk consumes the new API. Ask the user if questions arise.

- [x] 3. Refactor CDK stacks to apply consolidated tag sets
  - [x] 3.1 Refactor `AgentConfigStack` (`packages/cdk/lib/stacks/agent-config.stack.ts`)
    - Replace each `naming.tagsToCfn(configName, { phase: '1' })` on the inference profile, guardrail, AppConfig configuration profile, deployment strategy, and deployment with `naming.agentTagsToCfn(configName, { agentType })`
    - Replace the stack-scope tag block with a loop over `naming.agentTags(configName, { agentType })` via `cdk.Tags.of(this).add(...)`, removing the four individual `.add(...)` calls and the `:phase` literal
    - Stop passing the `tags: naming.tags(...)` prop into `AgentIdentity`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Refactor `SharedInfraStack` (`packages/cdk/lib/stacks/shared-infra.stack.ts`)
    - Replace the `CfnApplication` hand-rolled `CfnTag` array with `tags: naming.sharedTagsToCfn()`
    - Replace the stack-scope tag block with a loop over `naming.sharedTags()`, removing the `:phase` `.add(...)`
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.2_

  - [x] 3.3 Refactor `AgentcoreManagedStack` (`packages/cdk/lib/stacks/agentcore-managed.stack.ts`)
    - Set the `CfnHarness` `tags` prop to `naming.agentTagsToCfn(configName, { agentType: props.agentType })`, removing the hardcoded `harnessType` argument and the `:phase` literal
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Remove redundant construct-level tag loops
  - [x] 4.1 Refactor `AgentIdentity` (`packages/cdk/lib/constructs/agent-identity.construct.ts`)
    - Remove the `tags: Record<string, string>` field from `AgentIdentityProps`
    - Remove the trailing `Object.entries(props.tags)` / `cdk.Tags.of(this).add(...)` loop
    - Remove the now-unused `import * as cdk` line (it was only used by the tag loop here)
    - _Requirements: 5.1, 5.4_

  - [x] 4.2 Refactor `AgentPolicyModulator` (`packages/cdk/lib/constructs/agent-policy-modulator.construct.ts`)
    - Remove the `const tags = naming.tags(props.configName, { phase: '1' })` block and its `cdk.Tags.of(this).add(...)` loop
    - Keep the `cdk` import (still used for `Duration`, `CustomResource`, `CfnOutput`, `Stack`)
    - _Requirements: 5.2, 5.4_

  - [x] 4.3 Refactor `AgentBusChannel` (`packages/cdk/lib/constructs/agent-bus-channel.construct.ts`)
    - Remove the `const tags = naming.tags(props.configName, { phase: '1' })` block and its loop
    - Keep the `cdk` import (still used for `Duration`)
    - _Requirements: 5.3, 5.4_

- [x] 5. Update CDK tests to match new tag vocabulary
  - [x] 5.1 Update `shared-infra.stack.test.ts` (`packages/cdk/test/stacks/shared-infra.stack.test.ts`)
    - Remove `hecatoncheires:phase` assertions (DynamoDB table test, SNS topic expected-tags list, EventBus list)
    - Add assertions that shared resources (EventBus / DynamoDB / `CfnApplication`) do not carry `:config` or `:agent-type`; keep `managed` + `stage` assertions
    - _Requirements: 7.3_

  - [x] 5.2 Update `agent-config.stack.test.ts` (`packages/cdk/test/stacks/agent-config.stack.test.ts`)
    - Remove the `applies hecatoncheires:phase=1` and `harness-type` assertions
    - Add coverage that `hecatoncheires:agent-type` reaches `AWS::Bedrock::ApplicationInferenceProfile` (value = the test stack's agentType); keep `managed` / `config` assertions
    - _Requirements: 7.4_

  - [x] 5.3 Update `agentcore-managed.stack.test.ts` (`packages/cdk/test/stacks/agentcore-managed.stack.test.ts`)
    - Update the standard-tags test: drop `:phase`, rename `:harness-type` → `:agent-type` with value `agentcore-managed` sourced from props; retitle to reflect four tags
    - _Requirements: 7.4_

  - [x] 5.4 Update `agent-bus-channel.construct.test.ts` (`packages/cdk/test/constructs/agent-bus-channel.construct.test.ts`)
    - Remove `:phase` / `:harness-type` assertions from the `Tags` describe block (construct no longer tags itself; stack-scope propagation is covered by stack tests)
    - _Requirements: 7.5_

  - [x] 5.5 Update `agent-identity.property.test.ts` (`packages/cdk/test/constructs/agent-identity.property.test.ts`)
    - Remove the `tags: { ... }` field from the props objects passed to `AgentIdentity` (four occurrences) since the prop no longer exists
    - Verify any `test-agent-config.stack.ts` helper still compiles against the new `AgentIdentityProps`
    - _Requirements: 7.4_

- [x] 6. Update steering/structure doc (`.kiro/steering/structure.md`)
  - Edit the standard-tag list (~line 98): remove `hecatoncheires:phase`, replace `hecatoncheires:harness-type` with `hecatoncheires:agent-type`, and note that shared infrastructure omits `config` and `agent-type`
  - _Requirements: 8.1, 8.2_

- [x] 7. Final checkpoint - Workspace verification gate
  - Run `pnpm build`, `pnpm test`, and `pnpm lint` from the workspace root; all must pass. Fix any failures before completing. Ask the user if questions arise.
  - _Requirements: 9.1, 9.2, 9.3_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but all test updates are required to satisfy Requirement 7 and the verification gate (Req 9).
- Each task references specific requirement clauses for traceability.
- Property tests (1.4–1.8) map one-to-one to the five correctness properties in the design; each is labeled `Feature: tag-consolidation, Property N: ...`.
- CDK stack/construct tagging is declarative IaC, so it is verified with `Template.fromStack()` assertion tests rather than property-based tests.
- Core must build (task 2 checkpoint) before the CDK layer consumes the new helper API.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] }
  ]
}
```
