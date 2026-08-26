# Design Document

## Overview

This design centralizes all magic strings in the hecatoncheires monorepo into typed constants within `@hecaton/core`. The refactoring touches three layers:

1. **Core constants** — new properties on `NamingGenerator`, new `events.ts` and `env-vars.ts` modules
2. **CDK infrastructure** — replaces inline tag arrays, env var keys, event sources, and policy names with imports from core
3. **API runtime** — replaces local `DEFAULT_POLICY_NAME` definitions and inline event strings with core imports

The refactoring is purely structural. All runtime string values remain byte-for-byte identical, meaning CDK synth output and API runtime behavior are unaffected.

## Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  @hecaton/core (packages/core)                               │
│                                                              │
│  constants/                                                  │
│  ├── naming.ts        NamingGenerator (extended)             │
│  │   ├── projectPrefix: 'hecaton'                            │
│  │   ├── projectFullName: 'hecatoncheires'                   │
│  │   ├── operatingPolicyName(): string                       │
│  │   └── tagsToCfn(...): { key: string; value: string }[]   │
│  ├── events.ts        EVENT_SOURCE, EVENT_DETAIL_TYPE        │
│  ├── env-vars.ts      enum EnvVar                            │
│  ├── limits.ts        (unchanged)                            │
│  └── index.ts         barrel (re-exports all)                │
└──────────────────────────┬───────────────────────────────────┘
                           │ imported by
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
  ┌──────────────┐  ┌──────────────┐  (future)
  │ packages/cdk │  │ packages/api │  │ packages/web │
  └──────────────┘  └──────────────┘  └──────────────┘
```

### Data Flow

- CDK stacks import `NamingGenerator`, `EnvVar`, `EVENT_SOURCE`, and use them to populate CloudFormation resource properties.
- API handlers/use-cases import `NamingGenerator` (for `operatingPolicyName()`) and `EVENT_SOURCE`/`EVENT_DETAIL_TYPE` for event construction.
- No new runtime data flows are introduced — only the source location of string values changes.

## Components

### 1. NamingGenerator Extensions (packages/core/src/constants/naming.ts)

```typescript
export class NamingGenerator {
  private readonly stage: string;

  /** The short project prefix used in all resource names. */
  readonly projectPrefix = 'hecaton' as const;

  /** The full project name used in tag keys and metadata. */
  readonly projectFullName = 'hecatoncheires' as const;

  constructor(stage: string) {
    if (!stage || stage.trim().length === 0) {
      throw new ValidationError('Stage must be a non-empty string');
    }
    this.stage = stage;
  }

  /**
   * The fixed inline policy name for the modulated operating policy.
   * Pattern: {projectPrefix}-operating-policy
   */
  operatingPolicyName(): string {
    return `${this.projectPrefix}-operating-policy`;
  }

  /**
   * Converts tags() output into CloudFormation-compatible format.
   * Returns { key, value }[] suitable for L1 construct `tags` props.
   */
  tagsToCfn(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): { key: string; value: string }[] {
    const record = this.tags(configName, options);
    return Object.entries(record).map(([key, value]) => ({ key, value }));
  }

  // --- Existing methods refactored to use this.projectPrefix / this.projectFullName ---

  roleName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-agent-role`;
  }

  profileName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-profile`;
  }

  // ... (all other methods follow same pattern)

  tags(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): Record<string, string> {
    const result: Record<string, string> = {
      [`${this.projectFullName}:managed`]: 'true',
      [`${this.projectFullName}:config`]: configName,
      [`${this.projectFullName}:stage`]: this.stage,
    };

    if (options?.phase) {
      result[`${this.projectFullName}:phase`] = options.phase;
    }
    if (options?.harnessType) {
      result[`${this.projectFullName}:harness-type`] = options.harnessType;
    }
    return result;
  }
}
```

**Key design decisions:**
- `projectPrefix` and `projectFullName` are `readonly` class properties with const assertions, not constructor parameters. They represent immutable project-level constants.
- `operatingPolicyName()` is a method (not a property) for consistency with other name-generating methods on the class.
- `tagsToCfn()` delegates to `tags()` internally, ensuring the two always produce equivalent data.
- All existing methods that previously had inline `'hecaton'` now use `this.projectPrefix`; methods with `'hecatoncheires'` use `this.projectFullName`.

### 2. EventBridge Constants (packages/core/src/constants/events.ts)

```typescript
/**
 * EventBridge source namespace constants.
 * Used in CDK event rules and API event emitters.
 */
export const EVENT_SOURCE = {
  API: 'hecatoncheires.api',
  SIGNALS: 'hecatoncheires.signals',
  DRIFT: 'hecatoncheires.drift',
} as const;

export type EventSource = (typeof EVENT_SOURCE)[keyof typeof EVENT_SOURCE];

/**
 * EventBridge detail-type constants.
 * Used in CDK event rules and API event emitters.
 */
export const EVENT_DETAIL_TYPE = {
  GRANT_CHANGED: 'GrantChanged',
  CAPABILITY_CHANGED: 'CapabilityChanged',
  BREAKER_TRIPPED: 'BreakerTripped',
  DRIFT_DETECTED: 'drift.detected',
} as const;

export type EventDetailType = (typeof EVENT_DETAIL_TYPE)[keyof typeof EVENT_DETAIL_TYPE];
```

**Design decisions:**
- Using `const` object + `as const` rather than `enum` because:
  - Event sources use dot-separated namespaces (`'hecatoncheires.api'`) which are awkward as enum member names.
  - `as const` objects are more ergonomic for string literal types in TypeScript.
  - They compose better with object destructuring.
- A derived `EventSource` / `EventDetailType` union type is exported for type-safe function signatures.

### 3. Environment Variable Enum (packages/core/src/constants/env-vars.ts)

```typescript
/**
 * Environment variable names forming the CDK-to-Lambda contract.
 * CDK stacks use these as keys in Lambda environment definitions;
 * API runtime uses them as keys in process.env lookups.
 */
export enum EnvVar {
  GRANT_LEDGER_TABLE_NAME = 'GRANT_LEDGER_TABLE_NAME',
  AGENT_REGISTRY_TABLE_NAME = 'AGENT_REGISTRY_TABLE_NAME',
  OPS_BUS_ARN = 'OPS_BUS_ARN',
  OPERATING_POLICY_NAME = 'OPERATING_POLICY_NAME',
  SNS_TOPIC_ARN = 'SNS_TOPIC_ARN',
  KNOWN_PRINCIPALS = 'KNOWN_PRINCIPALS',
}
```

**Design decisions:**
- `enum` (not const enum) is used here because:
  - Enum member names match their string values exactly (e.g., `EnvVar.OPS_BUS_ARN === 'OPS_BUS_ARN'`).
  - This makes it natural to use as a `process.env[EnvVar.X]` key.
  - Regular enum preserves runtime access for iteration if needed.
- The enum value matches the previously hardcoded string in both CDK environment definitions and API `requireEnv`/`process.env` calls.

### 4. Constants Barrel Update (packages/core/src/constants/index.ts)

```typescript
export * from './limits.js';
export * from './naming.js';
export * from './events.js';
export * from './env-vars.js';
```

### 5. CDK Migration Pattern

Each CDK stack/construct replaces inline patterns with imports:

```typescript
// Before (shared-infra.stack.ts)
environment: {
  GRANT_LEDGER_TABLE_NAME: table.tableName,
  OPS_BUS_ARN: bus.eventBusArn,
  OPERATING_POLICY_NAME: 'hecaton-operating-policy',
},

// After
import { NamingGenerator, EnvVar } from '@hecaton/core';

environment: {
  [EnvVar.GRANT_LEDGER_TABLE_NAME]: table.tableName,
  [EnvVar.OPS_BUS_ARN]: bus.eventBusArn,
  [EnvVar.OPERATING_POLICY_NAME]: naming.operatingPolicyName(),
},
```

```typescript
// Before (agent-config.stack.ts)
tags: [
  { key: 'hecatoncheires:managed', value: 'true' },
  { key: 'hecatoncheires:config', value: configName },
  { key: 'hecatoncheires:stage', value: stage },
  { key: 'hecatoncheires:phase', value: '1' },
],

// After
tags: naming.tagsToCfn(configName, { phase: '1' }),
```

### 6. API Migration Pattern

```typescript
// Before (grant-shape.ts)
const DEFAULT_POLICY_NAME = 'hecaton-operating-policy';
await deps.operatingPolicy.writePolicy(roleName, DEFAULT_POLICY_NAME, policyDocument);

// After
import { NamingGenerator } from '@hecaton/core';

const naming = new NamingGenerator(/* stage not needed for static method */);
await deps.operatingPolicy.writePolicy(roleName, naming.operatingPolicyName(), policyDocument);
```

However, since `operatingPolicyName()` requires a NamingGenerator instance (with a stage), and the API use-cases don't have a stage at the call site (it comes from the environment), the better approach is:

```typescript
// After (dependencies.ts)
import { NamingGenerator, EnvVar } from '@hecaton/core';

const policyName = process.env[EnvVar.OPERATING_POLICY_NAME] ?? new NamingGenerator('default').operatingPolicyName();
```

Actually, looking at the current code, the dependency factory already reads `OPERATING_POLICY_NAME` from env vars and falls back to the inline string. After migration:

```typescript
// dependencies.ts (after)
import { NamingGenerator, EnvVar } from '@hecaton/core';

const naming = new NamingGenerator('_'); // stage irrelevant for operatingPolicyName()
const policyName = process.env[EnvVar.OPERATING_POLICY_NAME] ?? naming.operatingPolicyName();
```

For the use-cases (`grant-shape.ts`, `revoke-shape.ts`, `trip-breaker.ts`), the local `DEFAULT_POLICY_NAME` constant is removed entirely. The policy name is already available via `deps.operatingPolicy.getDefaultPolicyName()` which gets it from `dependencies.ts`. Alternatively, the use-cases can be migrated to simply use the dependency-injected policy name without any local constant.

**Refined API migration strategy:**

The cleanest approach: remove all `DEFAULT_POLICY_NAME` constants from use-cases. The `OperatingPolicyAdapter` constructor already accepts the policy name, and `dependencies.ts` already passes it in. Use-cases that currently reference `DEFAULT_POLICY_NAME` should instead call `deps.operatingPolicy.getDefaultPolicyName()` (which already exists on the adapter).

```typescript
// grant-shape.ts (after) — removes the local const entirely
await deps.operatingPolicy.writePolicy(
  roleName,
  deps.operatingPolicy.getDefaultPolicyName(),
  policyDocument,
);
```

This way, the single source of truth for the policy name value flows through `dependencies.ts` which reads from `EnvVar.OPERATING_POLICY_NAME` env var (set by CDK using `naming.operatingPolicyName()`).

### 7. Event Mapper Migration

```typescript
// Before (event.mapper.ts)
export function toGrantChangedEvent(detail: GrantChangedDetail): BusEvent {
  return {
    source: 'hecatoncheires.api',
    detailType: 'GrantChanged',
    detail: { ...detail },
  };
}

// After
import { EVENT_SOURCE, EVENT_DETAIL_TYPE } from '@hecaton/core';

export function toGrantChangedEvent(detail: GrantChangedDetail): BusEvent {
  return {
    source: EVENT_SOURCE.API,
    detailType: EVENT_DETAIL_TYPE.GRANT_CHANGED,
    detail: { ...detail },
  };
}
```

## Interfaces

### New Public API Additions to @hecaton/core

```typescript
// NamingGenerator new members
interface NamingGeneratorPublicAPI {
  readonly projectPrefix: 'hecaton';
  readonly projectFullName: 'hecatoncheires';
  operatingPolicyName(): string;
  tagsToCfn(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): { key: string; value: string }[];
}

// Event constants
const EVENT_SOURCE: {
  readonly API: 'hecatoncheires.api';
  readonly SIGNALS: 'hecatoncheires.signals';
  readonly DRIFT: 'hecatoncheires.drift';
};

const EVENT_DETAIL_TYPE: {
  readonly GRANT_CHANGED: 'GrantChanged';
  readonly CAPABILITY_CHANGED: 'CapabilityChanged';
  readonly BREAKER_TRIPPED: 'BreakerTripped';
  readonly DRIFT_DETECTED: 'drift.detected';
};

// Derived union types
type EventSource = 'hecatoncheires.api' | 'hecatoncheires.signals' | 'hecatoncheires.drift';
type EventDetailType = 'GrantChanged' | 'CapabilityChanged' | 'BreakerTripped' | 'drift.detected';

// Environment variable enum
enum EnvVar {
  GRANT_LEDGER_TABLE_NAME = 'GRANT_LEDGER_TABLE_NAME',
  AGENT_REGISTRY_TABLE_NAME = 'AGENT_REGISTRY_TABLE_NAME',
  OPS_BUS_ARN = 'OPS_BUS_ARN',
  OPERATING_POLICY_NAME = 'OPERATING_POLICY_NAME',
  SNS_TOPIC_ARN = 'SNS_TOPIC_ARN',
  KNOWN_PRINCIPALS = 'KNOWN_PRINCIPALS',
}
```

## Data Models

No new data models are introduced. The only structural addition is the `{ key: string; value: string }` output type of `tagsToCfn()`, which matches the existing CloudFormation tag shape already used by CDK L1 constructs.

## Error Handling

No new error paths are introduced. The refactoring preserves all existing error handling:
- `NamingGenerator` constructor still throws `ValidationError` for empty/whitespace stage.
- All other methods remain pure string transformations with no failure modes.
- `EnvVar` usage in `requireEnv()` produces the same `InternalError` on missing vars.

## Migration Scope

### Files Modified in packages/core

| File | Change |
|------|--------|
| `src/constants/naming.ts` | Add `projectPrefix`, `projectFullName`, `operatingPolicyName()`, `tagsToCfn()`. Refactor all methods to use properties. |
| `src/constants/events.ts` | **New file.** EventBridge constants. |
| `src/constants/env-vars.ts` | **New file.** EnvVar enum. |
| `src/constants/index.ts` | Add re-exports for new modules. |

### Files Modified in packages/cdk

| File | Change |
|------|--------|
| `lib/stacks/shared-infra.stack.ts` | Replace env var string keys with `EnvVar`, policy name with `naming.operatingPolicyName()` |
| `lib/stacks/agent-config.stack.ts` | Replace inline tag arrays with `naming.tagsToCfn(...)` |
| `lib/stacks/agentcore-managed.stack.ts` | Replace inline tag arrays with `naming.tagsToCfn(...)` |
| `lib/constructs/agent-policy-modulator.construct.ts` | Replace env var key with `EnvVar.AGENT_REGISTRY_TABLE_NAME` |

### Files Modified in packages/api

| File | Change |
|------|--------|
| `src/adapters/eventbridge/dto/event.mapper.ts` | Replace inline source/detailType strings with `EVENT_SOURCE`/`EVENT_DETAIL_TYPE` |
| `src/shared/dependencies.ts` | Replace env var string keys with `EnvVar` members |
| `src/use-cases/grant-shape.ts` | Remove local `DEFAULT_POLICY_NAME`, use `deps.operatingPolicy.getDefaultPolicyName()` |
| `src/use-cases/revoke-shape.ts` | Remove local `DEFAULT_POLICY_NAME`, use `deps.operatingPolicy.getDefaultPolicyName()` |
| `src/use-cases/trip-breaker.ts` | Remove local `DEFAULT_POLICY_NAME`, use `deps.operatingPolicy.getDefaultPolicyName()` |
| `src/adapters/iam/operating-policy.adapter.ts` | Change default parameter from inline `'hecaton-operating-policy'` to use imported constant |

### Test Files Updated

All test files that assert against now-centralized string values will import from `@hecaton/core` instead of using inline string literals. This includes:
- `packages/core/src/constants/naming.test.ts` — add tests for new methods
- `packages/core/src/constants/naming.property.test.ts` — add property tests for new methods
- `packages/api/src/adapters/eventbridge/dto/event.mapper.test.ts` — use constant imports for assertions
- `packages/api/src/use-cases/grant-shape.test.ts` — remove local `DEFAULT_POLICY_NAME` references
- `packages/api/src/use-cases/revoke-shape.test.ts` — same
- `packages/api/src/use-cases/trip-breaker.test.ts` — same
- `packages/api/src/adapters/iam/operating-policy.adapter.test.ts` — use imported constant

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Name methods embed projectPrefix

*For any* valid stage and configName, every resource name produced by NamingGenerator methods that previously contained the literal `'hecaton'` SHALL contain `naming.projectPrefix` as a substring, and every tag key produced by `tags()` SHALL contain `naming.projectFullName` as a substring.

**Validates: Requirements 1.3**

### Property 2: tagsToCfn equivalence with tags

*For any* valid stage, configName, and options combination, converting the `tagsToCfn()` array output back into a `Record<string, string>` (by mapping `{ key, value }` pairs) SHALL produce an object identical to the output of `tags()` called with the same arguments.

**Validates: Requirements 2.2, 2.3, 2.4**
