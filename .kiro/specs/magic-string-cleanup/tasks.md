# Implementation Plan: Magic String Cleanup

## Overview

Centralize all magic strings in the hecatoncheires monorepo into typed constants within `@hecaton/core`. The implementation progresses bottom-up: extend the core constants layer first, then migrate CDK and API consumers, then update tests. All runtime string values remain byte-for-byte identical — CDK synth output and API behavior are unaffected.

## Tasks

- [x] 1. Extend NamingGenerator with project prefix properties and new methods
  - [x] 1.1 Add `projectPrefix` and `projectFullName` readonly properties to NamingGenerator and refactor all existing methods to use them instead of inline `'hecaton'` / `'hecatoncheires'` literals
    - Add `readonly projectPrefix = 'hecaton' as const` and `readonly projectFullName = 'hecatoncheires' as const`
    - Replace all inline `'hecaton'` in `roleName`, `profileName`, `guardrailName`, `alarmNames`, `queueNames`, `lambdaName`, `ruleName`, `harnessName`, `stackName`, `tableName`, `busName`, `snsTopicName`, `apiGatewayName`, `agentRegistryTableName`, `appConfigApplicationName`, `appConfigEnvironmentName`, `appConfigProfileName`, `driftDetectionLambdaName` with `this.projectPrefix`
    - Replace all inline `'hecatoncheires'` in `tags()` with `this.projectFullName`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Add `operatingPolicyName()` method to NamingGenerator
    - Returns `${this.projectPrefix}-operating-policy` (stage-independent)
    - _Requirements: 5.1_

  - [x] 1.3 Add `tagsToCfn()` method to NamingGenerator
    - Accepts same parameters as `tags()` method
    - Delegates to `tags()` internally and maps to `{ key: string; value: string }[]`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.4 Write unit tests for new NamingGenerator methods
    - Test `operatingPolicyName()` returns `'hecaton-operating-policy'`
    - Test `tagsToCfn()` produces correct array output for base tags, with phase, and with harnessType
    - Test `projectPrefix` and `projectFullName` property values
    - Verify all existing tests still pass (no behavior change)
    - _Requirements: 1.1, 1.2, 2.2, 2.3, 5.1, 9.4_

  - [x] 1.5 Write property test: name methods embed projectPrefix (Property 1)
    - **Property 1: Name methods embed projectPrefix**
    - For any valid stage and configName, every resource name produced by methods that previously contained `'hecaton'` SHALL contain `naming.projectPrefix` as a substring, and every tag key SHALL contain `naming.projectFullName`
    - **Validates: Requirements 1.3**

  - [x] 1.6 Write property test: tagsToCfn equivalence with tags (Property 2)
    - **Property 2: tagsToCfn equivalence with tags**
    - For any valid stage, configName, and options combination, converting `tagsToCfn()` array back to a Record SHALL equal the `tags()` output
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 2. Create EventBridge and EnvVar constants modules in core
  - [x] 2.1 Create `packages/core/src/constants/events.ts` with EVENT_SOURCE and EVENT_DETAIL_TYPE constants
    - Define `EVENT_SOURCE` object with `API`, `SIGNALS`, `DRIFT` keys and `as const` assertion
    - Define `EVENT_DETAIL_TYPE` object with `GRANT_CHANGED`, `CAPABILITY_CHANGED`, `BREAKER_TRIPPED`, `DRIFT_DETECTED` keys
    - Export `EventSource` and `EventDetailType` union types
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.2 Create `packages/core/src/constants/env-vars.ts` with EnvVar enum
    - Define `enum EnvVar` with members: `GRANT_LEDGER_TABLE_NAME`, `AGENT_REGISTRY_TABLE_NAME`, `OPS_BUS_ARN`, `OPERATING_POLICY_NAME`, `SNS_TOPIC_ARN`, `KNOWN_PRINCIPALS`
    - Each member's value equals its name (self-referencing string enum)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.3 Update `packages/core/src/constants/index.ts` barrel to re-export `events.ts` and `env-vars.ts`
    - Add `export * from './events.js'` and `export * from './env-vars.js'`
    - Verify exports are accessible via `@hecaton/core` public barrel
    - _Requirements: 3.4, 10.1, 10.2, 10.3_

- [x] 3. Checkpoint — core package builds and tests pass
  - Ensure `pnpm --filter @hecaton/core build` succeeds
  - Ensure `pnpm --filter @hecaton/core test` passes (all existing tests unchanged)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Migrate CDK stacks and constructs to centralized constants
  - [x] 4.1 Migrate `shared-infra.stack.ts` to use `EnvVar` enum and `naming.operatingPolicyName()`
    - Replace all inline env var key strings (`'GRANT_LEDGER_TABLE_NAME'`, `'OPS_BUS_ARN'`, etc.) with `EnvVar.*` computed property names
    - Replace inline `'hecaton-operating-policy'` with `naming.operatingPolicyName()`
    - Replace inline tag arrays with `naming.tagsToCfn(...)` calls where applicable (L1 resources)
    - Keep `cdk.Tags.of(this).add(...)` calls using `naming.projectFullName` for L2 tag propagation
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 4.2 Migrate `agent-config.stack.ts` to use `naming.tagsToCfn()` for all inline tag arrays
    - Replace all 6 inline `{ key: 'hecatoncheires:...', value: ... }` arrays with `naming.tagsToCfn(configName, { phase: '1' })`
    - Replace `cdk.Tags.of(this).add(...)` calls to use `naming.projectFullName` template
    - _Requirements: 6.1_

  - [x] 4.3 Migrate `agentcore-managed.stack.ts` to use `naming.tagsToCfn()`
    - Replace inline tag array with `naming.tagsToCfn(configName, { phase: '1', harnessType: 'agentcore-managed' })`
    - _Requirements: 6.1_

  - [x] 4.4 Migrate `agent-policy-modulator.construct.ts` to use `EnvVar` enum
    - Replace inline `'AGENT_REGISTRY_TABLE_NAME'` string with `[EnvVar.AGENT_REGISTRY_TABLE_NAME]`
    - _Requirements: 6.2_

- [x] 5. Migrate API use-cases, adapters, and handlers to centralized constants
  - [x] 5.1 Migrate `event.mapper.ts` to use `EVENT_SOURCE` and `EVENT_DETAIL_TYPE`
    - Replace inline `'hecatoncheires.api'` with `EVENT_SOURCE.API`
    - Replace inline `'GrantChanged'`, `'CapabilityChanged'`, `'BreakerTripped'` with `EVENT_DETAIL_TYPE.*`
    - _Requirements: 7.1_

  - [x] 5.2 Migrate `dependencies.ts` to use `EnvVar` enum
    - Replace `requireEnv('GRANT_LEDGER_TABLE_NAME')` with `requireEnv(EnvVar.GRANT_LEDGER_TABLE_NAME)` etc.
    - Replace `process.env['OPERATING_POLICY_NAME']` with `process.env[EnvVar.OPERATING_POLICY_NAME]`
    - Replace inline `'hecaton-operating-policy'` fallback with `new NamingGenerator('_').operatingPolicyName()`
    - _Requirements: 7.2, 7.3_

  - [x] 5.3 Remove `DEFAULT_POLICY_NAME` from all use-cases (`grant-shape.ts`, `revoke-shape.ts`, `trip-breaker.ts`, `onboard-agent.ts`)
    - Delete the local `const DEFAULT_POLICY_NAME = 'hecaton-operating-policy'` line from each file
    - Replace `DEFAULT_POLICY_NAME` usage with `deps.operatingPolicy.getDefaultPolicyName()` or the equivalent injected value
    - _Requirements: 7.2, 7.4_

  - [x] 5.4 Migrate `drift-detect.event.ts` handler to use `EnvVar.KNOWN_PRINCIPALS`
    - Replace inline `process.env['KNOWN_PRINCIPALS']` with `process.env[EnvVar.KNOWN_PRINCIPALS]`
    - _Requirements: 7.3_

- [x] 6. Checkpoint — CDK synth and API tests pass
  - Ensure `pnpm --filter @hecaton/cdk build` and `pnpm --filter @hecaton/api build` succeed
  - Ensure `pnpm --filter @hecaton/cdk test` and `pnpm --filter @hecaton/api test` pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Migrate test files to use centralized constants
  - [x] 7.1 Migrate CDK test files to use NamingGenerator and `EnvVar` for assertions
    - Update `shared-infra.stack.test.ts`: replace inline `'hecatoncheires:managed'` etc. with `naming.projectFullName` template or constant references in tag assertions
    - Update `agent-config.stack.test.ts`: same pattern
    - Update `agentcore-managed.stack.test.ts`: same pattern
    - Update `agent-bus-channel.construct.test.ts`: same pattern
    - Update `agent-identity.property.test.ts`: replace inline `'hecatoncheires:managed'` in props with constant reference
    - _Requirements: 8.1, 8.4_

  - [x] 7.2 Migrate API test files to use `EVENT_SOURCE`, `EVENT_DETAIL_TYPE`, and `EnvVar`
    - Update `event.mapper.test.ts`: replace inline `'hecatoncheires.api'`, `'GrantChanged'`, etc. with constants
    - Update `bus-emitter.adapter.test.ts`: replace inline event source/detailType strings
    - Update `trip-breaker.test.ts`: replace inline `'BreakerTripped'` and source assertions
    - Update `drift-detect.event.test.ts`: replace `process.env['KNOWN_PRINCIPALS']` with `process.env[EnvVar.KNOWN_PRINCIPALS]`
    - _Requirements: 8.2, 8.3_

- [x] 8. Final verification — full test suite and CDK synth unchanged
  - Run `pnpm build` (all packages)
  - Run `pnpm test` (full suite — all tests must pass without expected-value changes)
  - Run `pnpm --filter @hecaton/cdk synth` and verify output is byte-for-byte identical to pre-refactoring
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `operatingPolicyName()` method is stage-independent (always returns `'hecaton-operating-policy'`), so a dummy stage like `'_'` can be used when only that method is needed
- CDK L2 constructs use `cdk.Tags.of(scope).add(key, value)` pattern — only L1 resources use the `tags: []` array format that `tagsToCfn()` targets
- The `agent-identity.construct.ts` file uses tag key strings in IAM policy conditions (`aws:ResourceTag/hecatoncheires:managed`) — these should reference `naming.projectFullName` for consistency but the string value must remain identical

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.6", "2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "5.1", "5.2", "5.4"] },
    { "id": 5, "tasks": ["5.3"] },
    { "id": 6, "tasks": ["7.1", "7.2"] }
  ]
}
```
