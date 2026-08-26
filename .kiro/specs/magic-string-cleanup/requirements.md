# Requirements Document

## Introduction

Eliminate all magic strings across the hecatoncheires monorepo by centralizing them as typed constants in `@hecaton/core`. This covers project name prefixes, EventBridge event sources and detail types, environment variable names, and the operating policy name. All CDK stacks/constructs, API use-cases/adapters/handlers, and existing tests are migrated in a single atomic pass with zero functional behavior changes.

## Glossary

- **NamingGenerator**: The class in `packages/core/src/constants/naming.ts` responsible for deterministic AWS resource name generation.
- **EventSource**: A constant representing the `source` field of an EventBridge event entry (e.g., `'hecatoncheires.api'`).
- **EventDetailType**: A constant representing the `detail-type` field of an EventBridge event entry (e.g., `'GrantChanged'`).
- **EnvVar**: A TypeScript enum whose members are the environment variable names forming the CDK-to-Lambda contract.
- **tagsToCfn**: A method on NamingGenerator that converts the tags record into the `{ key: string; value: string }[]` format required by CDK L1 (CloudFormation) constructs.
- **CDK_Package**: The `packages/cdk` workspace package containing infrastructure stacks and constructs.
- **API_Package**: The `packages/api` workspace package containing Lambda handlers, use-cases, and adapters.
- **Core_Package**: The `packages/core` workspace package containing pure domain logic and constants.
- **Operating_Policy_Name**: The fixed IAM inline policy name (`'hecaton-operating-policy'`) used when writing/reading the modulated operating policy on agent roles.

## Requirements

### Requirement 1: Project Prefix Constants on NamingGenerator

**User Story:** As a developer, I want project name prefixes centralized on NamingGenerator, so that all name-building methods reference a single source of truth.

#### Acceptance Criteria

1. THE NamingGenerator SHALL expose a `readonly projectPrefix` property with value `'hecaton'`.
2. THE NamingGenerator SHALL expose a `readonly projectFullName` property with value `'hecatoncheires'`.
3. WHEN any name-building method on NamingGenerator constructs a resource name, THE NamingGenerator SHALL use `projectPrefix` or `projectFullName` internally instead of inline string literals.

### Requirement 2: tagsToCfn Method

**User Story:** As a CDK developer, I want a tagsToCfn method on NamingGenerator, so that I can produce CloudFormation-compatible tag arrays without manual transformation.

#### Acceptance Criteria

1. THE NamingGenerator SHALL provide a `tagsToCfn` method accepting the same parameters as the existing `tags` method.
2. WHEN `tagsToCfn` is called, THE NamingGenerator SHALL return an array of objects with shape `{ key: string; value: string }`.
3. THE `tagsToCfn` method SHALL produce one array element per tag entry, with `key` set to the tag key and `value` set to the tag value.
4. THE `tagsToCfn` output SHALL contain the same tag key-value pairs as the corresponding `tags` output for identical inputs.

### Requirement 3: EventBridge Event Constants

**User Story:** As a developer, I want EventBridge source namespaces and detail types defined as constants in core, so that event routing strings are consistent across CDK rules and API emitters.

#### Acceptance Criteria

1. THE Core_Package SHALL contain a file `src/constants/events.ts` exporting EventSource constants.
2. THE `events.ts` file SHALL define constants for each event source namespace used in the codebase: `'hecatoncheires.api'`, `'hecatoncheires.signals'`, and `'hecatoncheires.drift'`.
3. THE `events.ts` file SHALL define EventDetailType constants for each detail type: `'GrantChanged'`, `'CapabilityChanged'`, `'BreakerTripped'`, and `'drift.detected'`.
4. THE constants barrel export in Core_Package SHALL re-export all symbols from `events.ts`.

### Requirement 4: Environment Variable Name Enum

**User Story:** As a developer, I want environment variable names defined as a TypeScript enum in core, so that CDK Lambda definitions and API runtime lookups share the same identifiers.

#### Acceptance Criteria

1. THE Core_Package SHALL contain a file `src/constants/env-vars.ts` exporting a TypeScript `enum EnvVar`.
2. THE `EnvVar` enum SHALL contain a member for each environment variable name in the CDK-to-Lambda contract: `GRANT_LEDGER_TABLE_NAME`, `AGENT_REGISTRY_TABLE_NAME`, `OPS_BUS_ARN`, `OPERATING_POLICY_NAME`, `SNS_TOPIC_ARN`, and `KNOWN_PRINCIPALS`.
3. WHEN the enum is used in CDK environment definitions, THE enum member value SHALL match the string previously used as the environment variable key.
4. WHEN the enum is used in API runtime lookups, THE enum member value SHALL match the string previously passed to `process.env` or `requireEnv`.

### Requirement 5: Operating Policy Name Constant

**User Story:** As a developer, I want the operating policy name centralized in core, so that API use-cases, adapters, and CDK constructs reference one definition.

#### Acceptance Criteria

1. THE NamingGenerator SHALL provide an `operatingPolicyName` method or readonly property returning `'hecaton-operating-policy'`.
2. WHEN API use-cases, adapters, or handlers reference the operating policy name, THE consumer SHALL import and use the centralized constant from `@hecaton/core`.
3. WHEN CDK constructs or stacks set the `OPERATING_POLICY_NAME` environment variable value, THE construct SHALL use the centralized constant from `@hecaton/core`.

### Requirement 6: CDK Migration to Centralized Constants

**User Story:** As a CDK developer, I want all stacks and constructs using centralized constants, so that name changes propagate automatically.

#### Acceptance Criteria

1. WHEN CDK stacks or constructs produce L1 tag arrays, THE CDK_Package SHALL use `tagsToCfn` from NamingGenerator instead of inline `{ key: string; value: string }` object literals.
2. WHEN CDK stacks define Lambda environment variables, THE CDK_Package SHALL use `EnvVar` enum members as keys instead of string literals.
3. WHEN CDK stacks or constructs reference EventBridge source namespaces, THE CDK_Package SHALL use EventSource constants from `@hecaton/core`.
4. WHEN CDK stacks set the operating policy name environment variable value, THE CDK_Package SHALL use the centralized operating policy name constant.

### Requirement 7: API Migration to Centralized Constants

**User Story:** As an API developer, I want all handlers, use-cases, and adapters using centralized constants, so that there are no duplicate string definitions.

#### Acceptance Criteria

1. WHEN API event mappers construct EventBridge events, THE API_Package SHALL use EventSource and EventDetailType constants from `@hecaton/core`.
2. WHEN API use-cases or adapters reference the operating policy name, THE API_Package SHALL import and use the centralized constant from `@hecaton/core`.
3. WHEN API runtime code reads environment variables, THE API_Package SHALL use `EnvVar` enum members as the key passed to `process.env` or `requireEnv`.
4. THE API_Package SHALL contain zero inline definitions of `DEFAULT_POLICY_NAME` or equivalent local constants for the operating policy name.

### Requirement 8: Test Migration to Constants

**User Story:** As a developer, I want all tests referencing governed string values through constants, so that tests stay in sync with production code.

#### Acceptance Criteria

1. WHEN test files in CDK_Package assert tag values, THE test file SHALL reference constants from `@hecaton/core` or use NamingGenerator outputs instead of inline string literals for tag keys.
2. WHEN test files in API_Package assert event source or detail type values, THE test file SHALL reference EventSource and EventDetailType constants from `@hecaton/core`.
3. WHEN test files in API_Package construct or assert the operating policy name, THE test file SHALL use the centralized constant from `@hecaton/core`.
4. WHEN test files in CDK_Package assert environment variable keys, THE test file SHALL use `EnvVar` enum members from `@hecaton/core`.

### Requirement 9: Zero Behavior Change Guarantee

**User Story:** As a platform operator, I want this refactoring to produce identical runtime behavior, so that no deployed agent governance is affected.

#### Acceptance Criteria

1. THE refactoring SHALL produce zero changes to synthesized CloudFormation template outputs for any CDK stack.
2. THE refactoring SHALL produce zero changes to runtime IAM policy content written by API adapters.
3. THE refactoring SHALL produce zero changes to EventBridge event payloads emitted by API event mappers.
4. THE refactoring SHALL produce zero changes to resource names generated by NamingGenerator for any input.
5. WHEN all existing tests are executed after migration, THE test suite SHALL pass without modification to expected values (only variable references change, not the underlying string values).

### Requirement 10: Barrel Export Completeness

**User Story:** As a consumer of `@hecaton/core`, I want all new constants available through the single barrel export, so that import paths remain simple.

#### Acceptance Criteria

1. THE `constants/index.ts` barrel in Core_Package SHALL re-export all symbols from `events.ts`.
2. THE `constants/index.ts` barrel in Core_Package SHALL re-export all symbols from `env-vars.ts`.
3. WHEN external packages import EventSource, EventDetailType, or EnvVar, THE import path SHALL be `@hecaton/core` (the public barrel).
