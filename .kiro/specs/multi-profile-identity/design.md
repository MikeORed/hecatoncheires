# Design Document: Multi-Profile Identity

## Overview

This design extends the Hecatoncheires agent identity model from a single inference profile per agent to an ordered array of model bindings, each producing its own `CfnApplicationInferenceProfile` resource. The change spans all three packages: core (schema, policy assembly), cdk (resource loop, composite alarms, permission boundary), and the agent registry (multi-profile storage, exclusivity enforcement).

The guiding principles are:

- **Core stays pure** — no AWS SDK imports, validation and algorithms remain unit-testable without mocks.
- **Grant decoupling** — `core-invocation` grants no longer store profile ARNs; policy assembly resolves them from registry context at assembly time.

---

## Architecture

### Component Interaction

```
┌────────────────────────────────────────────────────────────────────┐
│ packages/core                                                      │
│                                                                    │
│  AgentConfigurationSchema ──► createAgentConfiguration() factory   │
│                                                                    │
│  ModelBindingSchema (new)                                          │
│                                                                    │
│  SHAPE_CATALOG ──► resolveShape() ──► assemblePolicy()            │
│       │                   ▲                                       │
│       │                   │ (new: PolicyAssemblyContext)           │
│       ▼                   │                                       │
│  core-invocation          │                                       │
│  requiredParameters: []   │                                       │
│                           │                                       │
└───────────────────────────┼───────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│ packages/api              │                                       │
│                           │                                       │
│  use-cases/grant ─────────┘ (passes PolicyAssemblyContext from    │
│                              registry)                            │
│                                                                    │
│  adapters/dynamo ──► Agent Registry (exclusivity check)           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ packages/cdk                                                       │
│                                                                    │
│  AgentConfigStack                                                  │
│    └─ for each modelBinding:                                       │
│         └─ CfnApplicationInferenceProfile                          │
│    └─ AgentIdentity (profileArns: string[])                        │
│    └─ AgentPolicyModulator (profileBindings[])                     │
│         ├─ per-profile alarms (token, block, observation)          │
│         └─ composite alarm → Breaker Lambda                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Core Schema Changes

#### ModelBindingSchema (new file: `packages/core/src/schemas/model-binding.schema.ts`)

```typescript
import { z } from 'zod';

/**
 * Pattern for model binding labels.
 * Lowercase letters, digits, and hyphens; starts with a letter; max 30 chars.
 */
export const ModelBindingLabelPattern = /^[a-z][a-z0-9-]*$/;

export const ModelBindingThresholdsSchema = z.object({
  outputTokensPerHour: z.number().int().positive(),
});

export const ModelBindingSchema = z.object({
  modelId: z.string().min(1),
  label: z
    .string()
    .min(1)
    .max(30)
    .regex(
      ModelBindingLabelPattern,
      'label must start with a lowercase letter and contain only lowercase letters, digits, and hyphens',
    ),
  thresholds: ModelBindingThresholdsSchema.optional(),
});
```

#### AgentConfigurationSchema (modified)

The schema replaces the single `modelId` field with a `modelBindings` array. A `superRefine` enforces label uniqueness:

```typescript
import { z } from 'zod';
import { ModelBindingSchema } from './model-binding.schema.js';

export const ConfigNamePattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;

const MAX_MODEL_BINDINGS = 5;

export const AgentConfigurationSchema = z
  .object({
    configName: z
      .string()
      .min(1)
      .max(40)
      .regex(ConfigNamePattern, '...'),
    agentType: z.enum(['agentcore-managed', 'openclaw', 'agentcore-runtime']),
    modelBindings: z
      .array(ModelBindingSchema)
      .min(1, 'At least one model binding is required')
      .max(MAX_MODEL_BINDINGS, `Maximum ${MAX_MODEL_BINDINGS} model bindings allowed`),
    guardrailId: z.string().min(1),
    guardrailVersion: z.string().min(1).default('DRAFT'),
    owner: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    // Reject duplicate labels
    const labels = data.modelBindings.map((b) => b.label);
    const seen = new Set<string>();
    for (let i = 0; i < labels.length; i++) {
      if (seen.has(labels[i])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelBindings', i, 'label'],
          message: `Duplicate label "${labels[i]}" in modelBindings`,
        });
      }
      seen.add(labels[i]);
    }
  });
```

#### Updated Types

```typescript
export type ModelBinding = z.infer<typeof ModelBindingSchema>;
export type ModelBindingThresholds = z.infer<typeof ModelBindingThresholdsSchema>;
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;
```

---

### 2. Shape Catalog Change

The `core-invocation` shape removes `inferenceProfileArn` from `requiredParameters`. Profile ARNs are no longer resolved via the generic parameter substitution mechanism — they are injected by `assemblePolicy` from the `PolicyAssemblyContext`:

```typescript
{
  shapeName: 'core-invocation',
  riskTier: 'medium',
  requiredParameters: [],
  statements: [
    {
      Effect: 'Allow',
      Action: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Converse',
        'bedrock:ConverseStream',
      ],
      Resource: '*',
    },
  ],
}
```

The `Resource: '*'` placeholder is overwritten by `assemblePolicy` when it detects a `core-invocation` grant. The generic `resolveShape` path is not used for this shape.

---

### 3. Policy Assembly Changes

#### PolicyAssemblyContext (new interface)

```typescript
/**
 * Context provided to policy assembly for profile-aware resolution.
 * Supplied by the use-case layer from the agent registry.
 */
export interface PolicyAssemblyContext {
  /** All profile ARNs owned by the agent. Empty triggers deny-all for core-invocation. */
  profileArns: string[];
}
```

#### assemblePolicy signature change

```typescript
export function assemblePolicy(
  grants: GrantRecord[],
  catalog: readonly ShapeTemplate[],
  context: PolicyAssemblyContext,
): IamPolicyDocument {
  if (grants.length === 0) {
    return {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
    };
  }

  const statements: IamStatement[] = [];

  for (const grant of grants) {
    const template = catalog.find((t) => t.shapeName === grant.shapeName);
    if (!template) {
      throw new ShapeNotFoundError(`Shape "${grant.shapeName}" not found in catalog`, {
        shapeName: grant.shapeName,
      });
    }

    if (grant.shapeName === 'core-invocation') {
      statements.push(...resolveCoreInvocation(template, context));
    } else {
      statements.push(...resolveShape(template, grant.parameters));
    }
  }

  return { Version: '2012-10-17', Statement: statements };
}

function resolveCoreInvocation(
  template: ShapeTemplate,
  context: PolicyAssemblyContext,
): IamStatement[] {
  if (context.profileArns.length === 0) {
    return [{ Effect: 'Deny', Action: '*', Resource: '*' }];
  }

  return template.statements.map((stmt) => ({
    Effect: stmt.Effect,
    Action: stmt.Action,
    Resource: context.profileArns.length === 1
      ? context.profileArns[0]
      : context.profileArns,
  }));
}
```

The `PolicyAssemblyContext` parameter is required. The api layer's grant use-case fetches profiles from the registry adapter and passes them through.

---

### 4. CDK AgentConfigStack Changes

The stack loops over `modelBindings` to create N inference profiles:

```typescript
export interface AgentConfigStackProps extends cdk.StackProps {
  stage: string;
  configName: string;
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  /** Ordered model bindings — replaces the single `modelId` prop. */
  modelBindings: Array<{
    modelId: string;
    label: string;
    thresholds?: { outputTokensPerHour: number };
  }>;
  guardrailOverrides?: Partial<GuardrailPolicyConfig>;
  externalPrincipalArn?: string;
  /** Agent-level alarm thresholds (used as defaults when per-profile thresholds omitted). */
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
  sharedInfra: { /* unchanged */ };
}
```

**Profile creation loop:**

```typescript
const profileOutputs: Array<{ arn: string; entityId: string; label: string; modelId: string }> = [];

for (const binding of props.modelBindings) {
  if (!binding.modelId || binding.modelId.trim().length === 0) {
    throw new Error(
      `AgentConfigStack: modelId must be a non-empty string for binding "${binding.label}" (configName: ${configName}).`,
    );
  }

  const profile = new bedrock.CfnApplicationInferenceProfile(
    this,
    `InferenceProfile-${binding.label}`,
    {
      inferenceProfileName: naming.multiProfileName(configName, binding.label),
      modelSource: { copyFrom: binding.modelId },
      tags: naming.tagsToCfn(configName, { phase: '1' }),
    },
  );

  profileOutputs.push({
    arn: profile.attrInferenceProfileArn,
    entityId: profile.attrInferenceProfileId,
    label: binding.label,
    modelId: binding.modelId,
  });
}

if (profileOutputs.length === 0) {
  throw new Error(
    `AgentConfigStack: at least one model binding is required (configName: ${configName}).`,
  );
}

this.profileArns = profileOutputs.map((p) => p.arn);
```

**NamingGenerator additions:**

```typescript
/** Pattern: hecaton-{stage}-{configName}-{label}-profile */
multiProfileName(configName: string, label: string): string {
  return `${this.projectPrefix}-${this.stage}-${configName}-${label}-profile`;
}

/** Per-profile alarm naming. Pattern: hecaton-{stage}-{configName}-{label}-{type} */
perProfileAlarmNames(
  configName: string,
  label: string,
): { token: string; block: string; observation: string } {
  const prefix = `${this.projectPrefix}-${this.stage}-${configName}-${label}`;
  return {
    token: `${prefix}-token-alarm`,
    block: `${prefix}-block-alarm`,
    observation: `${prefix}-observation-alarm`,
  };
}
```

---

### 5. CDK AgentIdentity Changes

The construct accepts `profileArns: string[]` instead of a single `profileArn`:

```typescript
export interface AgentIdentityProps {
  configName: string;
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  /** All inference profile ARNs for this agent. */
  profileArns: string[];
  guardrailId: string;
  externalPrincipalArn?: string;
  tags: Record<string, string>;
  stage: string;
}
```

**Permission boundary condition change:**

```typescript
new iam.PolicyStatement({
  sid: 'BedrockInference',
  effect: iam.Effect.ALLOW,
  actions: [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',
    'bedrock:Converse',
    'bedrock:ConverseStream',
  ],
  resources: ['*'],
  conditions: {
    'ForAnyValue:StringEquals': {
      'bedrock:InferenceProfileArn': profileArns,
    },
    StringEquals: {
      'bedrock:GuardrailIdentifier': guardrailId,
    },
  },
}),
```

When `profileArns` has a single element, `ForAnyValue:StringEquals` with a single-element array is functionally equivalent to `StringEquals` with a scalar — AWS IAM evaluates them identically.

---

### 6. CDK AgentPolicyModulator Changes

The construct accepts an array of profile bindings and creates per-profile alarms plus a composite alarm:

```typescript
export interface ProfileBinding {
  profileEntityId: string;
  profileArn: string;
  modelId: string;
  label: string;
  thresholds?: { outputTokensPerHour: number };
}

export interface AgentPolicyModulatorProps {
  configName: string;
  profileBindings: ProfileBinding[];
  agentRole: iam.IRole;
  agentType: string;
  guardrailId: string;
  breakerLambda: lambda.IFunction;
  agentRegistryTable: dynamodb.ITable;
  stage: string;
  /** Agent-level default thresholds. */
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
}

export interface AgentPolicyModulatorOutputs {
  perProfileAlarms: Array<{
    label: string;
    tokenAlarm: cloudwatch.IAlarm;
    blockAlarm: cloudwatch.IAlarm;
    observationAlarm: cloudwatch.IAlarm;
  }>;
  compositeAlarm: cloudwatch.CompositeAlarm;
}
```

**Per-profile alarm loop:**

```typescript
const allAlarms: cloudwatch.IAlarm[] = [];

for (const binding of props.profileBindings) {
  const names = naming.perProfileAlarmNames(props.configName, binding.label);
  const effectiveTokenThreshold =
    binding.thresholds?.outputTokensPerHour ?? props.thresholds.outputTokensPerHour;

  const tokenAlarm = new cloudwatch.Alarm(this, `TokenAlarm-${binding.label}`, {
    alarmName: names.token,
    metric: new cloudwatch.Metric({
      namespace: 'AWS/Bedrock',
      metricName: 'OutputTokenCount',
      dimensionsMap: { InferenceProfileId: binding.profileEntityId },
      statistic: 'Sum',
      period: cdk.Duration.seconds(3600),
    }),
    threshold: effectiveTokenThreshold,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });

  // block and observation alarms created similarly...
  allAlarms.push(tokenAlarm, blockAlarm, observationAlarm);
}
```

**Composite alarm:**

```typescript
const compositeAlarm = new cloudwatch.CompositeAlarm(this, 'CompositeAlarm', {
  compositeAlarmName: `${naming.projectPrefix}-${props.stage}-${props.configName}-composite`,
  alarmRule: cloudwatch.AlarmRule.anyOf(...allAlarms),
});

const compositeAction: cloudwatch.IAlarmAction = {
  bind: () => ({ alarmActionArn: props.breakerLambda.functionArn }),
};
compositeAlarm.addAlarmAction(compositeAction);
```

Individual per-profile alarms no longer directly trigger the Breaker Lambda. Only the composite alarm does — providing a single agent-level trip wire.

---

### 7. Agent Registry Schema Changes

The DynamoDB record for each agent gains a `profiles` list attribute:

```typescript
/** Shape of a single profile entry in the agent registry record. */
export interface RegistryProfileRecord {
  profileArn: string;
  profileEntityId: string;
  modelId: string;
  label: string;
}

/** Agent registry DynamoDB record shape. */
export interface AgentRegistryRecord {
  agentId: string;         // PK
  configName: string;
  roleName: string;
  agentType: string;
  guardrailId: string;
  profiles: RegistryProfileRecord[];
  createdAt: string;
  updatedAt: string;
}
```

The `profileArn` field is additionally stored in a GSI (`profileArn-index`) to support the exclusivity check:

| Attribute | Key Type |
|-----------|----------|
| profileArn | GSI PK |
| agentId | GSI SK |

---

### 8. Profile Exclusivity Enforcement

The registry adapter uses a DynamoDB `TransactWriteItems` operation:

1. For each profile ARN in the new record, include a `ConditionCheck` item against the GSI to ensure no other agent owns that ARN.
2. Include a `Put` item for the agent record itself.

If any condition check fails, the transaction is rejected and the adapter throws a `ProfileExclusivityError`.

```typescript
export class ProfileExclusivityError extends DomainError {
  constructor(
    public readonly conflictingAgent: string,
    public readonly conflictingProfileArn: string,
  ) {
    super(
      `Profile exclusivity violation: ${conflictingProfileArn} already owned by agent ${conflictingAgent}`,
    );
  }
}
```

This approach uses a single round-trip transaction for atomicity without requiring distributed locks.

---

## Data Models

### ModelBinding (core domain)

| Field | Type | Constraints |
|-------|------|-------------|
| modelId | string | Non-empty |
| label | string | 1–30 chars, `/^[a-z][a-z0-9-]*$/` |
| thresholds | object (optional) | `outputTokensPerHour`: positive integer |

### AgentConfiguration (updated)

| Field | Type | Description |
|-------|------|-------------|
| configName | string | Unchanged |
| agentType | enum | Unchanged |
| modelBindings | ModelBinding[] | 1–5 entries, unique labels |
| guardrailId | string | Unchanged |
| guardrailVersion | string | Unchanged |
| owner | string | Unchanged |

### PolicyAssemblyContext (new)

| Field | Type | Description |
|-------|------|-------------|
| profileArns | string[] | All profile ARNs for the agent, resolved from registry |

### RegistryProfileRecord (new)

| Field | Type | Description |
|-------|------|-------------|
| profileArn | string | CfnApplicationInferenceProfile ARN |
| profileEntityId | string | CfnApplicationInferenceProfile ID |
| modelId | string | Bedrock model ID |
| label | string | Model binding label |

---

## Interfaces

### Core Exports (additions to public-api.ts)

```typescript
// New schema exports
export { ModelBindingSchema, ModelBindingLabelPattern, ModelBindingThresholdsSchema } from './schemas/model-binding.schema.js';

// New type exports
export type { ModelBinding, ModelBindingThresholds } from './types/index.js';
export type { PolicyAssemblyContext } from './shared/algorithms/assemble-policy.js';

// New error export
export { ProfileExclusivityError } from './errors/profile-exclusivity-error.js';
```

### assemblePolicy (updated signature)

```typescript
export function assemblePolicy(
  grants: GrantRecord[],
  catalog: readonly ShapeTemplate[],
  context: PolicyAssemblyContext,
): IamPolicyDocument;
```

### NamingGenerator (new methods)

```typescript
multiProfileName(configName: string, label: string): string;
perProfileAlarmNames(configName: string, label: string): { token: string; block: string; observation: string };
```

---

## Error Handling

| Scenario | Error Type | Location |
|----------|-----------|----------|
| Invalid modelBindings input | `ValidationError` | `createAgentConfiguration` factory |
| Duplicate labels | `ValidationError` (via superRefine) | Schema layer |
| Max bindings exceeded | `ValidationError` | Schema layer |
| Profile ARN collision on registry write | `ProfileExclusivityError` | Registry adapter |
| Empty profileArns during core-invocation assembly | Produces deny-all statement (not an error) | `assemblePolicy` |
| Shape not found | `ShapeNotFoundError` | `assemblePolicy` (unchanged) |
| Empty modelId in CDK props | `Error` thrown at synth time | CDK AgentConfigStack |
| Empty modelBindings array in CDK props | `Error` thrown at synth time | CDK AgentConfigStack |

---

## Migration Strategy

No data migration is required — nothing has been deployed yet. All references to the previous single `modelId` field are updated to use `modelBindings` throughout:

- `AgentConfigurationSchema`: `modelId` field replaced by `modelBindings` array.
- `AgentConfigStackProps`: `modelId: string` replaced by `modelBindings: Array<{...}>`.
- `AgentIdentityProps`: `profileArn: string` replaced by `profileArns: string[]`.
- `AgentPolicyModulatorProps`: single profile fields replaced by `profileBindings: ProfileBinding[]`.
- `bin/app.ts`: stack instantiation updated to use new props shape.
- `SHAPE_CATALOG`: `core-invocation.requiredParameters` cleared; `Resource` placeholder updated.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Valid model bindings are accepted, invalid are rejected

*For any* object with a `modelBindings` array where every entry has a non-empty `modelId`, a `label` matching `/^[a-z][a-z0-9-]*$/` (1–30 chars), optional `thresholds` with a positive integer `outputTokensPerHour`, and the array length is between 1 and 5 inclusive, the `AgentConfigurationSchema` SHALL successfully parse and return a valid `AgentConfiguration`. Conversely, *for any* entry where `modelId` is empty, `label` violates the pattern, `thresholds.outputTokensPerHour` is not a positive integer, or the array length is 0 or exceeds 5, the schema SHALL reject the input.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 8.1, 8.2**

### Property 2: Duplicate labels are rejected

*For any* `modelBindings` array containing two or more entries with the same `label` value, the `AgentConfigurationSchema` SHALL reject the input with a validation error referencing the duplicate label.

**Validates: Requirements 1.5**

### Property 3: Profile exclusivity enforcement

*For any* set of existing agent registry records and a new agent record whose `profiles` array contains at least one `profileArn` already present in another agent's records, the registry write operation SHALL reject the write and return a `ProfileExclusivityError` identifying the conflicting agent and the colliding profile ARN.

**Validates: Requirements 2.1, 2.2**

### Property 4: Policy assembly resolves core-invocation from profile context

*For any* non-empty `profileArns` array in the `PolicyAssemblyContext` and any `core-invocation` grant record, `assemblePolicy` SHALL produce IAM statements whose `Resource` field contains exactly the profile ARNs from the context. The resulting `Resource` SHALL be a string when one profile ARN is provided and an array when multiple are provided. *For any* empty `profileArns` array, `assemblePolicy` SHALL produce a deny-all statement.

**Validates: Requirements 6.2, 6.3, 6.4**

### Property 5: Per-profile alarm naming follows pattern

*For any* valid `stage`, `configName`, and `label` combination, the `NamingGenerator.perProfileAlarmNames` method SHALL produce alarm names matching the pattern `hecaton-{stage}-{configName}-{label}-{token|block|observation}-alarm`.

**Validates: Requirements 5.5**

### Property 6: Registry profile ordering is preserved

*For any* ordered `modelBindings` array, when the registry record is constructed from that array, the resulting `profiles` array SHALL have entries in the same positional order — `profiles[i].label === modelBindings[i].label` and `profiles[i].modelId === modelBindings[i].modelId` for all valid indices.

**Validates: Requirements 7.1, 7.4**
