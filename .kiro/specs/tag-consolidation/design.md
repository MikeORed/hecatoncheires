# Design Document

## Overview

Tag consolidation replaces the generic `tags()` / `tagsToCfn()` helpers on `NamingGenerator` with four purpose-specific methods, drops the `hecatoncheires:phase` tag, and renames `hecatoncheires:harness-type` to `hecatoncheires:agent-type` (carrying the raw `AgentType` enum value). Stacks apply the correct tag set once at stack scope via `cdk.Tags.of(this)`; redundant construct-level tag loops are removed. The steering/structure doc is updated to match.

The change touches three layers:

- **core** (`packages/core/src/constants/naming.ts`) — the tag vocabulary source of truth.
- **cdk stacks** (`agent-config`, `agentcore-managed`, `shared-infra`) — apply tag sets at stack scope and pass `*ToCfn` output to L1 `tags` props.
- **cdk constructs** (`AgentIdentity`, `AgentPolicyModulator`, `AgentBusChannel`) — stop tagging themselves; rely on stack-scope propagation.

Account-level tagging features (cost allocation activation, invocation logging config, synth warnings, preflight checks) are out of scope per the requirements Non-Goals.

## Architecture

### Tag vocabulary

| Tag key | Agent resources | Shared resources | Value |
|---|---|---|---|
| `hecatoncheires:managed` | ✅ | ✅ | `'true'` |
| `hecatoncheires:stage` | ✅ | ✅ | generator stage |
| `hecatoncheires:config` | ✅ | ❌ | configName |
| `hecatoncheires:agent-type` | ✅ | ❌ | raw `AgentType` enum |
| `hecatoncheires:phase` | ❌ removed | ❌ removed | — |

### Propagation semantics

`cdk.Tags.of(scope).add(key, value)` registers a **Tag aspect** on the scope. At synth time the aspect visitor walks the entire construct subtree rooted at `scope` and applies the tag to every taggable resource it finds (respecting per-resource tag support). Applying the agent tag set once at the `AgentConfigStack` scope therefore reaches every nested resource — inference profiles, guardrail, AppConfig resources, the IAM role and policies inside `AgentIdentity`, the CloudWatch alarms inside `AgentPolicyModulator`, and the SQS queues inside `AgentBusChannel` — without per-construct loops.

Two mechanisms coexist and are complementary:

1. **Aspect propagation** (`cdk.Tags.of`) — covers all L2 constructs and any L1 that participates in tag aspects.
2. **Explicit L1 `tags` props** (`agentTagsToCfn` / `sharedTagsToCfn`) — some L1 Cfn resources (Bedrock inference profile, guardrail, AppConfig, `CfnApplication`) take a `tags` array directly. We keep sourcing those from the `*ToCfn` helpers so the tags are present on the resource properties deterministically and assertable in template tests, independent of aspect ordering.

## Components and Interfaces

### 1. Core Tag Helper (`packages/core/src/constants/naming.ts`)

Remove `tags()` and `tagsToCfn()` entirely (no compatibility wrapper). Add four methods plus one private builder.

**AgentType source.** Core already defines the enum in `schemas/agent-configuration.schema.ts` (`z.enum(['agentcore-managed','openclaw','agentcore-runtime'])`) and exposes the derived type as `AgentConfiguration['agentType']` via `types/index.ts`. There is no standalone `AgentType` export today. Two options:

- **A (chosen): add a named type alias** `export type AgentType = AgentConfiguration['agentType'];` in `types/index.ts`, and reference it from `naming.ts` via a type-only import.
- B: inline the union literal in `naming.ts`.

Option A avoids drift and keeps a single source of truth. There is **no import cycle risk**: `constants/naming.ts` would import a *type only* from `../types/index.js`, and `types/index.ts` imports from `../schemas/index.js` (not from `constants`). `naming.ts` currently only imports from `../errors`. Using `import type` erases at compile time, so even the theoretical runtime edge is moot. The `AgentType` alias is re-exported through `public-api.ts` (already `export *` on `types`), making it importable in cdk as `import { NamingGenerator, type AgentType } from '@hecaton/core'`.

```typescript
import { ValidationError } from '../errors/index.js';
import type { AgentType } from '../types/index.js';

// ... existing name methods unchanged ...

/** Options for agent-scoped tag helpers. */
export interface AgentTagOptions {
  agentType: AgentType;
}

/** Full tag set for per-agent resources. */
agentTags(configName: string, opts: AgentTagOptions): Record<string, string> {
  return {
    ...this.sharedTags(),
    [`${this.projectFullName}:config`]: configName,
    [`${this.projectFullName}:agent-type`]: opts.agentType,
  };
}

/** Reduced tag set for shared infrastructure resources. */
sharedTags(): Record<string, string> {
  return {
    [`${this.projectFullName}:managed`]: 'true',
    [`${this.projectFullName}:stage`]: this.stage,
  };
}

/** Agent tag set as CloudFormation { key, value }[] for L1 `tags` props. */
agentTagsToCfn(configName: string, opts: AgentTagOptions): { key: string; value: string }[] {
  return this.toCfn(this.agentTags(configName, opts));
}

/** Shared tag set as CloudFormation { key, value }[] for L1 `tags` props. */
sharedTagsToCfn(): { key: string; value: string }[] {
  return this.toCfn(this.sharedTags());
}

/** Shared record → { key, value }[] mapper (private, avoids duplication). */
private toCfn(record: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}
```

`agentTags` is composed from `sharedTags()` so `managed` and `stage` derivation lives in one place; `config` and `agent-type` are the agent-only additions. This guarantees the shared/agent set relationship (shared ⊂ agent) by construction and keeps the phase key absent everywhere.

### 2. AgentConfigStack (`packages/cdk/lib/stacks/agent-config.stack.ts`)

`agentType` is already on `AgentConfigStackProps` and destructured in the constructor — no props change needed.

Changes:

- Replace each `naming.tagsToCfn(configName, { phase: '1' })` on the inference profile, guardrail, AppConfig configuration profile, deployment strategy, and deployment with `naming.agentTagsToCfn(configName, { agentType })`.
- Replace the stack-scope tag block:

```typescript
// --- 9. Apply standard tags (stack scope; propagates to nested resources) ---
const agentTags = naming.agentTags(configName, { agentType });
for (const [key, value] of Object.entries(agentTags)) {
  cdk.Tags.of(this).add(key, value);
}
```

  removing the four individual `.add(...)` calls and the `:phase` literal.
- Drop the `tags: naming.tags(configName, { phase: '1' })` prop passed into `AgentIdentity` (see §5 — the prop is removed from `AgentIdentityProps`).

**agent-type reaching inference profiles (Req 2.3).** Both mechanisms cover it: stack-scope aspect propagation *and* the explicit `agentTagsToCfn` on the `CfnApplicationInferenceProfile` `tags` prop. We keep the explicit `tags` prop as the primary, assertable path (template tests read resource `Tags`), and stack-scope propagation as the backstop. Choice: **both**, because the L1 already takes `tags` and the aspect is nearly free.

### 3. AgentcoreManagedStack (`packages/cdk/lib/stacks/agentcore-managed.stack.ts`)

The stack calls `super(scope, id, props)` first, so the agent tag set is already applied at stack scope (covering the `CfnHarness` via aspect propagation) by the time the harness is created.

The `CfnHarness` currently sets `tags: naming.tagsToCfn(configName, { phase: '1', harnessType: 'agentcore-managed' })` — a hardcoded harness type and a phase literal.

**Decision: pass `agentTagsToCfn(configName, { agentType: props.agentType })` explicitly on the harness `tags` prop.** Rationale: `props.agentType` is validated to be `'agentcore-managed'` earlier in the constructor, so the value is correct and no longer hardcoded (Req 3.1, 3.2). The explicit prop keeps the harness's `agent-type` tag directly assertable in the template test rather than depending solely on aspect ordering. This is the simpler correct option — it reuses the same helper the base stack uses and removes the special-cased `harnessType` argument. The `:phase` literal is dropped (Req 3.3).

```typescript
tags: naming.agentTagsToCfn(configName, { agentType: props.agentType }),
```

### 4. SharedInfraStack (`packages/cdk/lib/stacks/shared-infra.stack.ts`)

Changes:

- `CfnApplication`: replace the hand-rolled `CfnTag` array with `tags: naming.sharedTagsToCfn()`.
- Replace the stack-scope tag block with a `sharedTags()` loop, removing the `:phase` `.add(...)`:

```typescript
// --- Standard tags (shared set; propagates to nested resources) ---
const sharedTags = naming.sharedTags();
for (const [key, value] of Object.entries(sharedTags)) {
  cdk.Tags.of(this).add(key, value);
}
```

Shared resources thus never receive `:config` or `:agent-type` (Req 6.1, 6.2).

### 5. Constructs

All three constructs stop tagging themselves; the parent stack's stack-scope aspect covers their resources.

**AgentIdentity** (`agent-identity.construct.ts`):
- Remove the `tags: Record<string, string>` field from `AgentIdentityProps`.
- Remove the trailing `for (const [key, value] of Object.entries(props.tags)) { cdk.Tags.of(this).add(...) }` loop and the unused `cdk` import if it becomes unused (it is still used elsewhere? — `cdk` is only used for the tag loop here, so remove the `import * as cdk` line once the loop is gone).
- Caller (`AgentConfigStack` §2) stops passing `tags`.

**AgentPolicyModulator** (`agent-policy-modulator.construct.ts`):
- Remove the `const tags = naming.tags(props.configName, { phase: '1' })` block and its `cdk.Tags.of(this).add(...)` loop. `cdk` stays imported (used for `Duration`, `CustomResource`, `CfnOutput`, `Stack`).

**AgentBusChannel** (`agent-bus-channel.construct.ts`):
- Remove the `const tags = naming.tags(props.configName, { phase: '1' })` block and its loop. `cdk` stays imported (used for `Duration`).

Propagation confirmation (Req 5.4): the SQS queues (`AgentBusChannel`), the IAM role + inline/managed policies (`AgentIdentity`), and the CloudWatch alarms + composite alarm (`AgentPolicyModulator`) are all descendants of the `AgentConfigStack` scope, so the stack-scope `cdk.Tags.of(this)` aspect tags them with the full agent set.

### 6. Structure/steering doc (`.kiro/steering/structure.md`)

Line ~98, the standard-tag list. Edit the sentence:

- Before: ``All resources tagged: `hecatoncheires:managed`, `hecatoncheires:config`, `hecatoncheires:phase`, `hecatoncheires:harness-type`.``
- After: ``All resources tagged: `hecatoncheires:managed`, `hecatoncheires:stage`, `hecatoncheires:config`, `hecatoncheires:agent-type` (shared infrastructure omits `config` and `agent-type`).``

## Data Models

No persisted data models change. The only shape changes are:

- `AgentTagOptions { agentType: AgentType }` (new, replaces the loose `{ phase?, harnessType? }` options object).
- `AgentIdentityProps` loses its `tags: Record<string, string>` field.
- New type alias `AgentType = AgentConfiguration['agentType']` in core.

## Error Handling

No new error paths. `agentType` validity is already enforced by the zod `AgentConfigurationSchema` and by the `AgentCoreManagedStack` constructor guard (`props.agentType !== 'agentcore-managed'` throws). The tag helpers are pure and total over their typed inputs; passing a non-enum `agentType` is a compile-time type error.

## Test Updates

Per-file assertion changes:

**`packages/core/src/constants/naming.test.ts`**
- Remove the `tagsToCfn` and `tags` describe blocks that assert `phase` / `harness-type` behavior.
- Add a `agentTags` block: asserts the four keys and exact values (including `agent-type` === raw agentType).
- Add a `sharedTags` block: asserts only `managed` + `stage`, and that `config` / `agent-type` are absent.
- Add `agentTagsToCfn` / `sharedTagsToCfn` blocks: assert `{ key, value }[]` shape and round-trip equality with the record forms.

**`packages/core/src/constants/naming.property.test.ts`**
- Remove Property 2's `optionalPhase` / `optionalHarnessType` arbitraries and the `tags(..., { phase, harnessType })` usages.
- Replace `naming.tags(configName)` pattern-conformance usage with `naming.agentTags(configName, { agentType })` using an `agentType` arbitrary (`fc.constantFrom('agentcore-managed','openclaw','agentcore-runtime')`).
- Add round-trip properties for `agentTagsToCfn` / `sharedTagsToCfn`.
- Add a "no phase key" invariant property across all four methods.

**`packages/cdk/test/stacks/shared-infra.stack.test.ts`**
- Remove the `hecatoncheires:phase` assertions (DynamoDB table test, SNS topic expected-tags list, EventBus list).
- Add assertions that shared resources (EventBus / DynamoDB / `CfnApplication`) do **not** carry `:config` or `:agent-type` (e.g. `Match.not(Match.arrayWith([...]))` on `Tags`).
- Keep `managed` + `stage` assertions.

**`packages/cdk/test/stacks/agent-config.stack.test.ts`**
- Remove the `applies hecatoncheires:phase=1` test.
- Add coverage: `hecatoncheires:agent-type` reaches `AWS::Bedrock::ApplicationInferenceProfile` (value = the test stack's agentType).
- Keep `managed` / `config` assertions.

**`packages/cdk/test/stacks/agentcore-managed.stack.test.ts`**
- Update the "applies all five standard tags" test: drop `:phase` and rename `:harness-type` → `:agent-type` with value `agentcore-managed` sourced from props. Retitle to reflect four tags.

**`packages/cdk/test/constructs/agent-bus-channel.construct.test.ts`**
- Remove any `:phase` / `:harness-type` assertions from the `Tags` describe block. (These constructs are tested in isolation; since the construct no longer tags itself, tag assertions here that relied on the construct-level loop must be dropped or re-scoped. Stack-scope propagation is verified in the stack tests.)

**`packages/cdk/test/constructs/agent-identity.property.test.ts`**
- Remove the `tags: { ... }` field from the props objects passed to `AgentIdentity` (four occurrences) since the prop no longer exists.

**`packages/cdk/test/stacks/test-agent-config.stack.ts`** and **`agentcore-managed.stack.test.ts` helpers**
- No tag props to update beyond the above; verify they still compile against the new `AgentIdentityProps`.

## Testing Strategy

**Core (property + unit).** The tag helpers are pure functions with input-varying behavior, so property-based tests (Vitest + fast-check, ≥100 runs) are the primary tool for the tag-set invariants and the CFN round-trips. A handful of example unit tests pin exact key strings and the API-removal facts (`tags` / `tagsToCfn` are gone).

**CDK stacks/constructs (integration/snapshot).** Tagging on CDK resources is declarative IaC — per the workflow guidance, property-based testing is inappropriate here. These are verified with `Template.fromStack()` assertion tests using representative inputs: assert presence/absence of specific tag keys on specific resource types. Cross-stack tag retention (Req 6.3) is a single synth assertion, not a property.

**Verification gate (Req 9).** `pnpm build`, `pnpm test`, `pnpm lint` from the workspace root must all pass.

Property test tag format: **Feature: tag-consolidation, Property {n}: {property text}**.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Agent tag set content

*For any* valid stage, configName, and `agentType` enum value, `agentTags(configName, { agentType })` returns a record whose keys are exactly `hecatoncheires:managed`, `hecatoncheires:stage`, `hecatoncheires:config`, and `hecatoncheires:agent-type`, with `managed` = `'true'`, `stage` = the generator stage, `config` = configName, and `agent-type` = the raw `agentType` value unchanged.

**Validates: Requirements 1.1, 1.9, 6.4, 6.5**

### Property 2: Shared tag set content and exclusions

*For any* valid stage, `sharedTags()` returns a record whose keys are exactly `hecatoncheires:managed` and `hecatoncheires:stage` (with `managed` = `'true'` and `stage` = the generator stage), and never contains `hecatoncheires:config` or `hecatoncheires:agent-type`.

**Validates: Requirements 1.2, 1.5, 6.1, 6.2, 6.4, 6.5**

### Property 3: No phase key emitted

*For any* valid stage, configName, and `agentType`, none of `agentTags`, `sharedTags`, `agentTagsToCfn`, or `sharedTagsToCfn` produces a key equal to `hecatoncheires:phase`.

**Validates: Requirements 1.6**

### Property 4: Agent CFN round-trip

*For any* valid stage, configName, and `agentType`, converting `agentTagsToCfn(configName, { agentType })` back into a record (`Object.fromEntries` of `{ key, value }` pairs) equals `agentTags(configName, { agentType })`, and the array length equals the record's key count.

**Validates: Requirements 1.3**

### Property 5: Shared CFN round-trip

*For any* valid stage, converting `sharedTagsToCfn()` back into a record equals `sharedTags()`, and the array length equals the record's key count.

**Validates: Requirements 1.4**
