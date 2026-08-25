# Design Document: Phase 1 Infrastructure Completion

## Overview

This design completes the Hecatoncheires Phase 1 infrastructure by implementing four gaps identified in the deviation analysis (D1–D4):

1. **AppConfig integration** — runtime tunables store independent of CDK deployments
2. **Drift detection** — automated alerting on unauthorized IAM role modifications
3. **Bedrock invocation logging** — account-level log delivery for the Phase 2 telemetry pipeline
4. **AgentBusChannel construct** — per-agent event delivery via SQS FIFO queues

Additionally, the NamingGenerator in `@hecaton/core` is extended with methods for the new resources, and CDK assertion tests validate all additions.

### Design Rationale

- **AppConfig over SSM Parameter Store**: AppConfig provides deployment strategies (immediate vs. linear rollout), validation hooks, and rollback — critical for safe threshold changes in production.
- **EventBridge + Lambda for drift detection**: Uses CloudTrail's native EventBridge integration (no additional trail creation), keeping latency low and avoiding polling.
- **Bedrock CfnResource for logging**: The `PutModelInvocationLoggingConfiguration` API is not yet exposed as a CDK L2 construct, so a custom resource or L1 escape hatch is used.
- **SQS FIFO for signal delivery**: Guarantees causal ordering per correlation chain via MessageGroupId, with dead-letter queues for delivery failure isolation.

## Architecture

### High-Level Component Diagram

```mermaid
graph TD
    subgraph SharedInfraStack
        AC[AppConfig Application + Environment]
        DD[Drift Detection Lambda]
        BL[Bedrock Invocation Logging]
        EB[Ops EventBridge Bus]
        SNS[SNS Notification Topic]
        CW[CloudWatch Logs<br>/aws/bedrock/invocations/{stage}]
    end

    subgraph AgentConfigStack [AgentConfigStack per agent]
        ACP[AppConfig Profile<br>Runtime Tunables]
        AID[AgentIdentity]
        APM[AgentPolicyModulator]
        ABC[AgentBusChannel]
    end

    subgraph External
        CT[CloudTrail Default Bus]
        SB[Signals EventBridge Bus]
    end

    CT -->|IAM mutation events| DD
    DD -->|drift.detected| EB
    DD -->|alert| SNS
    BL -->|invocation logs| CW

    SB -->|filtered events| ABC
    ABC -->|SQS FIFO| AgentRole[Agent Role]

    ACP --> AC
```

### Deployment Flow

1. `SharedInfraStack` deploys first — creates AppConfig application/environment, drift detection Lambda + rule, Bedrock logging config, and exposes cross-stack references.
2. Each `AgentConfigStack` deploys after — creates AppConfig profile for its tunables, AgentBusChannel for event delivery (if signals bus is provisioned).

### Cross-Stack Dependencies

| Producer | Consumer | Data |
|----------|----------|------|
| SharedInfraStack | AgentConfigStack | `appConfigAppId`, `appConfigEnvId`, `breakerLambdaRoleArn`, `grantLambdaRoleArn`, `revokeLambdaRoleArn` |
| SharedInfraStack | Phase 2 TelemetryStack | `bedrockLogGroupArn` |
| External (signals bus) | AgentBusChannel | `signalsBusArn` |

## Components and Interfaces

### 1. NamingGenerator Extensions (`packages/core`)

New methods added to the existing `NamingGenerator` class:

```typescript
// In packages/core/src/constants/naming.ts

/** Pattern: hecaton-{stage}-platform */
appConfigApplicationName(): string;

/** Pattern: hecaton-{stage}-{environmentName} (defaults to stage) */
appConfigEnvironmentName(environmentName?: string): string;

/** Pattern: hecaton-{stage}-{configName}-tunables */
appConfigProfileName(configName: string): string;

/** Pattern: hecaton-{stage}-drift-detection */
driftDetectionLambdaName(): string;

/** Pattern: /aws/bedrock/invocations/{stage} */
bedrockLogGroupName(): string;
```

These are pure functions: `(stage, ...args) → string`. No side effects, no AWS dependencies.

### 2. AppConfig Resources (SharedInfraStack additions)

New resources created in `SharedInfraStack`:

```typescript
// New properties exposed by SharedInfraStack
readonly appConfigAppId: string;
readonly appConfigEnvId: string;
```

**CDK L1 constructs used:**
- `CfnApplication` — AppConfig application
- `CfnEnvironment` — AppConfig environment

**Resource configuration:**
- Application name: `hecaton-{stage}-platform`
- Environment name: `{stage}` (e.g., `dev`, `staging`, `prod`)
- Standard tags applied to the application

### 3. AppConfig Profile (AgentConfigStack addition)

Created within each `AgentConfigStack` after identity and modulator setup:

```typescript
// New props added to AgentConfigStackProps
sharedInfra: {
  // ... existing fields ...
  appConfigAppId: string;
  appConfigEnvId: string;
};
```

**CDK L1 constructs used:**
- `CfnConfigurationProfile` — hosts the tunables schema
- `CfnHostedConfigurationVersion` — initial JSON content
- `CfnDeploymentStrategy` — zero-duration (dev) or linear 10-min (staging/prod)
- `CfnDeployment` — triggers the initial deployment

**Configuration:**
- Profile name: `hecaton-{stage}-{configName}-tunables`
- Location type: `hosted`
- Content: JSON serialization of `RuntimeTunablesSchema`-conforming object built from `AgentConfigStackProps.thresholds` + default feature flags (`pipelineSpeedBreaker: false, timeBoxedGrants: false`)

**Deployment strategy logic:**
```typescript
const strategy = stage === 'dev'
  ? { deploymentDurationInMinutes: 0, growthFactor: 100, finalBakeTimeInMinutes: 0 }
  : { deploymentDurationInMinutes: 10, growthFactor: 10, finalBakeTimeInMinutes: 2 };
```

### 4. Drift Detection Lambda (SharedInfraStack + `packages/api`)

#### 4a. Infrastructure (SharedInfraStack)

- **Lambda function** (`NodejsFunction`):
  - Entry: `packages/api/src/handlers/drift-detect.event.ts`
  - Runtime: Node.js 20, ARM64, 256MB, 30s timeout
  - Environment variables: `OPS_BUS_ARN`, `SNS_TOPIC_ARN`, `KNOWN_PRINCIPALS` (JSON array of ARNs)
  - Function name: `hecaton-{stage}-drift-detection` (via `NamingGenerator.driftDetectionLambdaName()`)

- **EventBridge rule** (on default bus):
  - Source: `aws.iam`
  - Detail-type: `AWS API Call via CloudTrail`
  - Detail filter:
    ```json
    {
      "eventSource": ["iam.amazonaws.com"],
      "eventName": [
        "PutRolePolicy", "DeleteRolePolicy",
        "AttachRolePolicy", "DetachRolePolicy",
        "PutRolePermissionsBoundary", "DeleteRolePermissionsBoundary"
      ],
      "requestParameters": {
        "roleName": [{ "prefix": "hecaton-{stage}-" }, { "suffix": "-agent-role" }]
      }
    }
    ```
  - Target: Drift Detection Lambda

- **IAM permissions:**
  - `events:PutEvents` on ops bus
  - `sns:Publish` on notification topic

- **Outputs:**
  - `breakerLambdaRoleArn`, `grantLambdaRoleArn`, `revokeLambdaRoleArn` exposed as properties for the drift Lambda to reference as known principals

#### 4b. Handler Logic (`packages/api/src/handlers/drift-detect.event.ts`)

```typescript
export interface DriftDetectEvent {
  detail: {
    eventName: string;
    eventTime: string;
    userIdentity: {
      arn: string;
      type: string;
    };
    requestParameters: {
      roleName: string;
      policyName?: string;
      policyArn?: string;
    };
  };
}

export async function handler(event: DriftDetectEvent): Promise<void> {
  const knownPrincipals: string[] = JSON.parse(process.env.KNOWN_PRINCIPALS ?? '[]');
  const modifierArn = event.detail.userIdentity.arn;

  // Check if modifier is a known platform principal
  if (isKnownPrincipal(modifierArn, knownPrincipals)) {
    return; // No alerting action
  }

  // Emit drift.detected event + SNS alert
  await emitDriftEvent(event);
  await notifyDrift(event);
}
```

**Design decisions:**
- Known principals are passed as environment variables (JSON array) rather than hardcoded, making the Lambda testable and config-driven.
- The `isKnownPrincipal` check compares the modifier ARN against the known list. A role ARN might appear as `arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION`, so the check extracts the role name from both ARN formats.
- The Lambda uses the same dependency injection pattern as other handlers (`getDriftDependencies()`).

### 5. Bedrock Invocation Logging (SharedInfraStack)

**Resources:**
- **CloudWatch Logs log group**: `/aws/bedrock/invocations/{stage}`, 30-day retention
- **Custom Resource** (AwsCustomResource via CDK's `AwsCustomResource`):
  - Calls `bedrock:PutModelInvocationLoggingConfiguration` on create/update
  - Calls `bedrock:DeleteModelInvocationLoggingConfiguration` on delete (optional — we may choose to leave logging enabled)
  - Configuration payload:
    ```json
    {
      "loggingConfig": {
        "cloudWatchConfig": {
          "logGroupName": "/aws/bedrock/invocations/{stage}",
          "roleArn": "<service-linked role ARN>"
        },
        "textDataDeliveryEnabled": true,
        "imageDataDeliveryEnabled": false,
        "embeddingDataDeliveryEnabled": false
      }
    }
    ```
- **IAM for custom resource execution role**: `bedrock:PutModelInvocationLoggingConfiguration`, `bedrock:GetModelInvocationLoggingConfiguration`, `bedrock:DeleteModelInvocationLoggingConfiguration`
- **Resource policy on log group**: Grants `logs:CreateLogStream`, `logs:PutLogEvents` to `bedrock.amazonaws.com` service principal

**Idempotency**: The `PutModelInvocationLoggingConfiguration` API is idempotent — calling it when logging is already configured with the same settings is a no-op.

**CfnOutput:**
- `BedrockLogGroupArn` — exported for Phase 2 telemetry stack consumption

### 6. AgentBusChannel Construct (`packages/cdk/lib/constructs/`)

#### Interface

```typescript
// packages/cdk/lib/constructs/agent-bus-channel.construct.ts

import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface AgentBusChannelProps {
  /** Agent configuration name. */
  configName: string;
  /** ARN of the signals EventBridge bus. */
  signalsBusArn: string;
  /** Source namespace for event filtering (e.g., 'hecatoncheires.signals'). */
  sourceNamespace: string;
  /** Optional subscription patterns for filtering events. If omitted, matches all from sourceNamespace. */
  subscriptionPatterns?: events.EventPattern[];
  /** The agent IAM role that will consume messages. */
  agentRole: iam.IRole;
  /** Deployment stage. */
  stage: string;
}

export interface AgentBusChannelOutputs {
  /** The signals FIFO queue. */
  signalsQueue: sqs.IQueue;
  /** The dead-letter FIFO queue. */
  deadLetterQueue: sqs.IQueue;
  /** The EventBridge rule routing events to the queue. */
  rule: events.IRule;
}
```

#### Resource Configuration

| Resource | Configuration |
|----------|--------------|
| Signals Queue (FIFO) | Name: `hecaton-{stage}-{configName}-signals.fifo`, visibility timeout: 60s, retention: 14 days, content-based deduplication: enabled |
| DLQ (FIFO) | Name: `hecaton-{stage}-{configName}-signals-dlq.fifo`, retention: 14 days |
| Redrive policy | maxReceiveCount: 3 → DLQ |
| EventBridge rule | Bus: signals bus, pattern: source=sourceNamespace + subscriptionPatterns (or source-only if no patterns) |
| SQS target | MessageGroupId: `$.detail.correlationId`, rule DLQ configured for delivery failures |
| IAM grant | Agent role gets `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on signals queue |

#### Construction Logic

```typescript
export class AgentBusChannel extends Construct {
  readonly outputs: AgentBusChannelOutputs;

  constructor(scope: Construct, id: string, props: AgentBusChannelProps) {
    super(scope, id);

    const naming = new NamingGenerator(props.stage);
    const queueNames = naming.queueNames(props.configName);

    // 1. Create DLQ (FIFO)
    const dlq = new sqs.Queue(this, 'DLQ', { ... });

    // 2. Create signals queue (FIFO) with redrive to DLQ
    const signalsQueue = new sqs.Queue(this, 'SignalsQueue', { ... });

    // 3. Import signals bus from ARN
    const signalsBus = events.EventBus.fromEventBusArn(this, 'SignalsBus', props.signalsBusArn);

    // 4. Build event pattern
    const eventPattern = this.buildEventPattern(props);

    // 5. Create rule on signals bus
    const rule = new events.Rule(this, 'Rule', { ... });

    // 6. Add SQS target with MessageGroupId and DLQ
    rule.addTarget(new targets.SqsQueue(signalsQueue, {
      messageGroupId: '$.detail.correlationId',
      deadLetterQueue: dlq,
    }));

    // 7. Grant consume permissions to agent role
    signalsQueue.grant(props.agentRole,
      'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes');

    // 8. Apply tags
    const tags = naming.tags(props.configName, { phase: '1' });
    // ...

    this.outputs = { signalsQueue, deadLetterQueue: dlq, rule };
  }
}
```

## Data Models

### AppConfig Runtime Tunables Document

The JSON document stored in AppConfig conforms to the existing `RuntimeTunablesSchema`:

```typescript
// Already defined in packages/core/src/schemas/runtime-tunables.schema.ts
{
  thresholds: {
    outputTokensPerHour: number;      // positive integer
    guardrailBlocksPer10Min: number;   // positive integer
    guardrailObservationsPerHour: number; // positive integer
  },
  featureFlags: {
    pipelineSpeedBreaker: boolean;
    timeBoxedGrants: boolean;
  }
}
```

**Initial values**: Thresholds sourced from `AgentConfigStackProps.thresholds`; feature flags default to `false`.

### Drift Detection Event Schema

Events emitted to ops bus on drift detection:

```typescript
interface DriftDetectedEvent {
  source: 'hecatoncheires.drift';
  'detail-type': 'drift.detected';
  detail: {
    roleName: string;
    modifyingPrincipalArn: string;
    apiAction: string;   // e.g., 'PutRolePolicy'
    timestamp: string;   // ISO 8601 from CloudTrail eventTime
    policyName?: string; // if applicable
    policyArn?: string;  // if applicable
  };
}
```

### SNS Drift Alert Message

```json
{
  "subject": "Hecatoncheires Drift Alert: {roleName}",
  "message": "Unauthorized IAM modification detected.\nRole: {roleName}\nAction: {apiAction}\nPrincipal: {modifyingPrincipalArn}\nTime: {timestamp}"
}
```

### AgentBusChannel Event Flow

```
External producer → Signals Bus → EventBridge Rule (filter by source + pattern)
    → SQS FIFO Queue (MessageGroupId = correlationId)
        → Agent consumes via SQS API
    → DLQ (after 3 failed receives)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

> **Note:** The majority of this feature is Infrastructure as Code (CDK constructs and stacks), which is tested via template assertion tests rather than property-based tests. The properties below cover the pure function components that benefit from PBT: NamingGenerator extensions and drift detection principal matching logic.

### Property 1: NamingGenerator methods produce stage-embedded, pattern-conforming names

*For any* valid stage string and any valid configName string, every NamingGenerator naming method SHALL produce an output that:
- Contains the stage value as a substring
- Matches its documented naming pattern exactly (prefix + stage + suffix structure)
- Is deterministic (same inputs always produce the same output)

Specifically:
- `appConfigApplicationName()` → matches `/^hecaton-{stage}-platform$/`
- `appConfigEnvironmentName(envName)` → matches `/^hecaton-{stage}-{envName}$/` (defaults to stage)
- `appConfigProfileName(configName)` → matches `/^hecaton-{stage}-{configName}-tunables$/`
- `driftDetectionLambdaName()` → matches `/^hecaton-{stage}-drift-detection$/`
- `bedrockLogGroupName()` → matches `/^\/aws\/bedrock\/invocations\/{stage}$/`

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 2: NamingGenerator methods produce unique names across different methods

*For any* valid stage and configName, no two NamingGenerator methods shall produce the same output string when called with identical inputs — each method's output is unique by virtue of its distinct suffix/pattern.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 3: Known principal identification is correct for all ARN formats

*For any* IAM ARN (either role ARN format `arn:aws:iam::ACCOUNT:role/ROLE_NAME` or assumed-role ARN format `arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION`), if the role name component matches a role name in the known principals list, then `isKnownPrincipal` SHALL return `true`. If the role name does NOT match any entry, it SHALL return `false`.

**Validates: Requirements 3.4, 3.7**

### Property 4: Known principal check is symmetric with list membership

*For any* set of known principal ARNs and any modifier ARN, `isKnownPrincipal(modifierArn, knownPrincipals)` returns `true` if and only if the modifier's resolved role name matches at least one known principal's resolved role name. This is equivalent to set membership after normalization.

**Validates: Requirements 3.4, 3.5, 3.6, 3.7**

## Error Handling

### Drift Detection Lambda

| Error Scenario | Handling |
|----------------|----------|
| Missing `KNOWN_PRINCIPALS` env var | Default to empty array — all modifications trigger alerts |
| CloudTrail event missing `userIdentity.arn` | Log warning, skip event (no throw — prevents retry) |
| SNS publish failure | Throw → Lambda retries (EventBridge → Lambda has built-in retry) |
| EventBridge PutEvents failure | Throw → Lambda retries |
| JSON parse error on `KNOWN_PRINCIPALS` | Log error, treat as empty list (alert on everything) |

### AppConfig Profile

| Error Scenario | Handling |
|----------------|----------|
| Invalid tunables JSON (schema mismatch) | CDK synth-time validation using `RuntimeTunablesSchema.parse()` in the construct |
| AppConfig deployment failure | CDK deploy reports failure; automatic rollback (CDK default behavior) |
| Missing AppConfig application/environment IDs | CDK synth-time error via required props validation |

### AgentBusChannel

| Error Scenario | Handling |
|----------------|----------|
| EventBridge delivery failure to SQS | Messages routed to rule-level DLQ |
| Consumer fails to process message (3 attempts) | Message moves to queue-level DLQ |
| Missing correlationId in event detail | EventBridge uses empty string as MessageGroupId (all such messages in same group) |
| Invalid `signalsBusArn` | CDK synth succeeds but deploy fails on rule creation — standard CDK error reporting |

### Bedrock Invocation Logging

| Error Scenario | Handling |
|----------------|----------|
| Logging already configured | API is idempotent — no error |
| Insufficient permissions for custom resource | CDK deploy fails with clear IAM error |
| Log group already exists | CDK handles via `removalPolicy` — existing group is adopted |

## Testing Strategy

### Approach

This feature is **Infrastructure as Code** — the primary deliverables are CDK constructs and stacks. Property-based testing is **not appropriate** for the IaC components because:
- CDK constructs are declarative configuration, not functions with variable inputs
- Correctness is verified by synthesizing templates and asserting on resource properties
- The input space is bounded (specific config values), not unbounded random inputs

However, the **NamingGenerator extensions** (Requirement 7) and the **drift detection principal matching logic** are pure functions suitable for property-based testing.

### Property-Based Testing Configuration

- **Library**: `fast-check` (via Vitest integration)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: phase1-infra-completion, Property {number}: {property_text}`
- **Location**: Property tests co-located with unit tests in the same test file

### Test Types by Component

#### NamingGenerator Extensions — Unit Tests + Property Tests

- **Unit tests** (example-based): Each new method returns the expected string for known stage/configName combinations
- **Property tests** (fast-check, 100+ iterations): NamingGenerator methods are pure `(stage, configName?) → string` functions. Properties:
  - Output always starts with `hecaton-` (or `/aws/bedrock/` for log group)
  - Output always contains the stage
  - Output for methods accepting configName always contains the configName
  - No duplicate naming across different methods for the same inputs

#### Drift Detection Lambda — Unit Tests + Property Tests

- **Property tests** (fast-check, 100+ iterations): `isKnownPrincipal` function tested with generated ARNs in both role and assumed-role formats against random known-principal lists
- **Unit tests** (example-based):
  - Known principal → no alert (verified with mock adapters)
  - Unknown principal → emits event + SNS notification
  - Assumed-role ARN format correctly extracts role name
  - Missing fields handled gracefully

#### CDK Constructs and Stacks — Template Assertion Tests

Using `Template.fromStack()` and `aws-cdk-lib/assertions`:

**SharedInfraStack additions:**
- AppConfig Application exists with correct name
- AppConfig Environment exists linked to application
- Drift Detection Lambda exists with correct runtime, memory, timeout, architecture
- EventBridge rule on default bus with correct event pattern
- CloudWatch Logs log group with 30-day retention and correct name
- CfnOutputs for new resources

**AgentConfigStack additions:**
- AppConfig ConfigurationProfile exists with correct name and location type
- HostedConfigurationVersion contains valid JSON
- DeploymentStrategy matches stage logic (0-duration for dev, 10-min linear otherwise)

**AgentBusChannel construct:**
- SQS FIFO queue with correct name, visibility timeout, retention
- DLQ (FIFO) with correct name and retention
- Redrive policy maxReceiveCount = 3
- EventBridge rule with correct event pattern
- SQS target with MessageGroupId configuration
- IAM policy grants consume permissions to agent role
- Standard tags applied to all resources
- Fallback: when no subscriptionPatterns, rule matches all events from sourceNamespace

### Test File Locations

| Test | Path |
|------|------|
| NamingGenerator extensions | `packages/core/src/constants/naming.test.ts` |
| Drift detection handler | `packages/api/src/handlers/drift-detect.event.test.ts` |
| AgentBusChannel construct | `packages/cdk/test/constructs/agent-bus-channel.construct.test.ts` |
| SharedInfraStack additions | `packages/cdk/test/stacks/shared-infra.stack.test.ts` (extend existing) |
| AgentConfigStack additions | `packages/cdk/test/stacks/agent-config.stack.test.ts` (extend existing) |

### Test Runner Configuration

- Vitest 4.x, native ESM
- CDK tests use `Template.fromStack()` assertion style (matching existing patterns)
- Core tests are pure unit tests — no mocks needed
- API handler tests mock adapters at the boundary (matching existing `getDependencies()` pattern)
