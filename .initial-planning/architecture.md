---
tags: [core/project, topic/ai, topic/aws, topic/cdk, topic/architecture]
created: 2026-07-19
revised: 2026-07-19
parent: "[[Hecatoncheires]]"
status: Draft
version: 2
---

# Project architecture

Monorepo structure, clean-architecture layering, package decomposition, construct interfaces, and deployment flow for Hecatoncheires.

Source material: [diagrams.md](./diagrams.md) and [Hecatoncheires.md](./Hecatoncheires.md) in this folder. Also drawn from planning notes kept in a private Obsidian vault and not published here: `monorepo-exploration`, `requirements`, `exploration`, `my-flavor-clean-arch`, `ADR-0001-iam-operating-policy-modulator-over-hitl`.

---

## Harness development order

Three agent type harnesses, built in the order that most efficiently proves governance concepts.

| Priority | Harness | What it proves | Setup cost |
|---|---|---|---|
| 1st | AgentCore Managed Harness | IAM governance, profile enforcement, guardrail binding, breakers, observability, deny-policy mechanism | Minimal. `CfnHarness` + role + `InvokeHarness`. |
| 2nd | OpenClaw | Agent-agnostic governance (external agent, same IAM model), EventBridge channel | Medium. Running OpenClaw instance needed. |
| 3rd | AgentCore Runtime | Custom agent code under governance | Higher. Container, ECR, agent framework. |

---

## Monorepo layout

pnpm workspaces. Four packages, clean-architecture layered as described below.

```
hecatoncheires/
├── package.json                     Workspace root, shared scripts
├── pnpm-workspace.yaml              packages: ['packages/*']
├── tsconfig.base.json               Shared strict TS options
├── .eslintrc.js                     Shared lint (import boundaries enforced)
├── .prettierrc
│
├── packages/
│   ├── core/                        THE ENGINE (Layers 0-2) — pure domain
│   │   ├── package.json             deps: zod (only)
│   │   ├── tsconfig.json            extends base
│   │   └── src/
│   │       ├── public-api.ts        THE PORT: single barrel export
│   │       ├── schemas/             Layer 0: zod schemas (source of types + validators)
│   │       ├── types/               Layer 0: re-exports for ergonomic use
│   │       ├── entity/              Layer 0: factory functions for domain objects
│   │       ├── errors/              Layer 0: custom error classes
│   │       ├── constants/           Layer 0: thresholds, shape names, enumerations
│   │       ├── config/              Layer 0: shape template definitions
│   │       ├── shared/
│   │       │   └── algorithms/      Layer 0: policy assembly, shape merging
│   │       ├── validators/          Layer 0: cross-field, structural, referential
│   │       ├── test-generators/     Layer 0: randomized builders for PBT
│   │       └── domain/
│   │           ├── identity/        Layer 1: role model, profile binding, boundary logic
│   │           ├── capability/      Layer 1: shape resolution, grant logic, policy doc assembly
│   │           ├── telemetry/       Layer 2: enrichment logic, profile-ID resolution
│   │           ├── signals/         Layer 2: envelope validation, correlation chains
│   │           └── fleet/           Layer 2: config validation, onboarding eligibility
│   │
│   ├── api/                         USE-CASES + ADAPTERS (Layer 3, runtime)
│   │   ├── package.json             deps: @hecaton/core, AWS SDK clients, esbuild
│   │   ├── tsconfig.json            extends base, references core
│   │   └── src/
│   │       ├── handlers/            Lambda entry points (flat, suffix-named)
│   │       │   ├── grant-shape.http.ts
│   │       │   ├── revoke-shape.http.ts
│   │       │   ├── query-fleet-state.http.ts
│   │       │   ├── onboard-agent.http.ts
│   │       │   ├── breaker-trip.alarm.ts
│   │       │   ├── grant-expiry-sweep.schedule.ts
│   │       │   ├── drift-detected.event.ts
│   │       │   ├── enrichment.logs.ts
│   │       │   └── capability-changed.event.ts
│   │       ├── use-cases/           Orchestrate core domain into workflows
│   │       │   ├── grant-shape.ts
│   │       │   ├── revoke-shape.ts
│   │       │   ├── trip-breaker.ts
│   │       │   ├── query-fleet-state.ts
│   │       │   └── onboard-agent.ts
│   │       └── adapters/            I/O boundary — the only code touching AWS
│   │           ├── http/
│   │           │   ├── dto/
│   │           │   │   ├── requests/
│   │           │   │   ├── responses/
│   │           │   │   └── mappers/
│   │           │   └── middleware/
│   │           ├── dynamo/
│   │           │   ├── dto/
│   │           │   │   └── mappers/
│   │           │   └── grant-ledger.adapter.ts
│   │           ├── iam/
│   │           │   └── operating-policy.adapter.ts
│   │           ├── eventbridge/
│   │           │   ├── dto/
│   │           │   │   └── mappers/
│   │           │   └── bus-emitter.adapter.ts
│   │           ├── appconfig/
│   │           │   └── tunables.adapter.ts
│   │           └── cloudwatch/
│   │               └── metric-emitter.adapter.ts
│   │
│   ├── cdk/                         ADAPTERS (Layer 3, infrastructure)
│   │   ├── package.json             deps: @hecaton/core, aws-cdk-lib, constructs
│   │   ├── tsconfig.json            extends base, references core
│   │   ├── cdk.json
│   │   ├── bin/
│   │   │   └── app.ts              CDK app entry
│   │   ├── lib/
│   │   │   ├── stacks/
│   │   │   │   ├── shared-infra.stack.ts
│   │   │   │   ├── agent-config.stack.ts
│   │   │   │   └── telemetry.stack.ts
│   │   │   ├── constructs/
│   │   │   │   ├── agent-identity.ts
│   │   │   │   ├── agent-telemetry.ts
│   │   │   │   ├── agent-policy-modulator.ts
│   │   │   │   ├── agent-bus-channel.ts
│   │   │   │   ├── agent-type-harness.ts
│   │   │   │   ├── agentcore-managed-harness.ts
│   │   │   │   ├── openclaw-harness.ts
│   │   │   │   ├── agentcore-runtime-harness.ts
│   │   │   │   ├── ops-bus.ts
│   │   │   │   ├── signals-bus.ts
│   │   │   │   ├── enrichment-pipeline.ts
│   │   │   │   └── drift-detection.ts
│   │   │   └── config/
│   │   │       └── seeds/
│   │   │           ├── example-agentcore-managed.json
│   │   │           ├── example-openclaw.json
│   │   │           └── example-agentcore-runtime.json
│   │   └── test/
│   │       ├── constructs/
│   │       └── stacks/
│   │
│   └── web/                         CONSUMER (Layer 4, SPA)
│       ├── package.json             deps: @hecaton/core (types), framework TBD
│       ├── tsconfig.json            extends base, references core
│       └── src/
│           ├── ui/                  Interface components
│           ├── state/               State management
│           └── lib/                 Pure client-side logic (no I/O)
│
├── test/                            Cross-package integration tests
│   └── integration/
│       └── deploy-and-verify.test.ts
│
└── .github/
    └── workflows/
        ├── core.yml                 Lint + test core on any push
        ├── api.yml                  Lint + test + bundle api
        ├── cdk.yml                  Synth + assertion tests
        └── web.yml                  Lint + test + build web
```

---

## Layer dependencies

```
web (L4) ──imports──→ @hecaton/core (barrel only)
  │                         ↑
  │ HTTP calls              │
  ↓                         │
api (L3) ──imports──→ @hecaton/core (barrel only)
                            ↑
cdk (L3) ──imports──→ @hecaton/core (barrel only)
  │
  │ references api build artifacts (bundled handlers) for Lambda deployment
  ↓
api build output (bundled .js per handler)
```

Rules:
- `core` imports nothing outside itself (zod is the sole external dep).
- `api` and `cdk` never import each other's source.
- `web` never imports `api` or `cdk`.
- Cross-package imports go through the workspace package name (`@hecaton/core`), never into internals.

---

## Role model: boundary, base, operating policy

Three layers on every agent role:

1. Permission Boundary — absolute ceiling, never modulated.
2. Base config — minimal shared floor (invocation permissions, logging). Per-kind trust policy delta.
3. Operating policy — single inline policy, rewritten by the modulator from the grant ledger. Deny-by-default resting state.

The policy-document assembly algorithm lives in `packages/core/src/domain/capability/`. It's pure: takes shape templates + parameters, returns IAM statement JSON. The IAM adapter in `packages/api/src/adapters/iam/` calls `putRolePolicy` with that output.

---

## Stacks (packages/cdk)

### SharedInfraStack

Deployed once per account/stage.

- Ops EventBridge bus + archive
- SNS notification topic (delivery target subscribed to ops bus via rule)
- Permission Boundary (shared)
- Bedrock invocation logging enablement
- Drift detection (CloudTrail rule + Lambda)
- AppConfig application + environments
- Grant ledger table (DynamoDB, data architecture TBD)
- API Gateway (routes to api Lambda handlers)

### AgentConfigStack (one per configuration)

- IAM role (three-layer model) via `AgentIdentity` construct
- App inference profile (tagged)
- Guardrail resource
- CloudWatch alarms + modulator Lambda via `AgentPolicyModulator` construct
- AppConfig configuration profile + tunables profile
- SQS FIFO queue + DLQ (for signals, when activated) via `AgentBusChannel`
- (Managed only) CfnHarness resource

### TelemetryStack

Phase 2 delivery.

- Enrichment Lambda + CloudWatch Logs subscription filter
- Profile ID resolution mapping
- S3 bucket (90-day lifecycle, partitioned for Athena)
- CloudWatch dashboard (fleet-level, 5 widgets)

---

## Construct interfaces

Constructs live in `packages/cdk/lib/constructs/` and import `@hecaton/core` for schema validation of seed configs. They reference `packages/api` build artifacts for Lambda deployment.

### AgentIdentity

```typescript
interface AgentIdentityProps {
  configName: string;
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  permissionBoundaryArn: string;
  modelId: string;
  guardrailConfig: {
    guardrailId?: string;
    policies?: GuardrailPolicy[];
    version?: string;
  };
  tags: Record<string, string>;
}

interface AgentIdentityOutputs {
  role: iam.IRole;
  profileArn: string;
  profileEntityId: string;
  guardrailId: string;
  guardrailVersion: string;
}
```

The role has condition keys on all Bedrock inference actions:
- `bedrock:InferenceProfileArn` must equal the assigned profile
- `bedrock:GuardrailIdentifier` must equal the assigned guardrail

Trust policy shape varies by harness type:
- AgentCore Managed: trusts `bedrock-agentcore.amazonaws.com`
- OpenClaw: trusts the principal where the instance runs (EC2, ECS, local via user/role)
- AgentCore Runtime: trusts `bedrock-agentcore.amazonaws.com`

### AgentPolicyModulator (breaker + capability control)

One IAM-mutation engine. The breaker is the coarsest operation (revoke the invocation shape); a capability gate is a narrower operation. Both are the same operation against the same policy, which is why there is no separate breaker subsystem.

```typescript
interface AgentPolicyModulatorProps {
  configName: string;
  agentRole: iam.IRole;
  profileEntityId: string;
  snsTopic: sns.ITopic;
  opsBus: events.IEventBus;
  grantLedgerTable: dynamodb.ITable;
  shapeCatalog: CapabilityShape[];
  thresholds: {
    outputTokensPerHour: number;
    guardrailBlocksPer10Min: number;
    guardrailObservationsPerHour: number;
  };
}

interface AgentPolicyModulatorOutputs {
  operatingPolicy: iam.CfnPolicy;
  tokenAlarm: cloudwatch.IAlarm;
  blockAlarm: cloudwatch.IAlarm;
  observationAlarm: cloudwatch.IAlarm;
  modulatorLambda: lambda.IFunction;
}
```

The modulator Lambda handles two trigger sources:
1. A grant/revoke request queries the grant ledger for the config's current grants, resolves each against the shape templates, and rewrites the operating policy.
2. A breaker alarm state change revokes the invocation shape directly (no ledger query needed for the emergency path).

Both paths rewrite the single inline operating policy, then emit an event to the ops bus and a notification via SNS.

The grant ledger (DynamoDB, data architecture TBD) is the source of truth for what a config is currently allowed to do. The modulator reads it; operator tooling and automation write to it. AppConfig is not involved in grant state.

### AgentBusChannel

```typescript
interface AgentBusChannelProps {
  configName: string;
  busArn: string;
  sourceNamespace: string;
  subscriptionPatterns?: EventPattern[];
  agentRole: iam.IRole;
  fifo?: boolean;
}

interface AgentBusChannelOutputs {
  queue: sqs.IQueue;
  dlq: sqs.IQueue;
  rule: events.IRule;
}
```

When `fifo` is true (signals bus), the queue is SQS FIFO and the rule sets MessageGroupId from the event's correlationId for causal ordering per chain.

### AgentTelemetry

```typescript
interface AgentTelemetryProps {
  configName: string;
  profileEntityId: string;
  enrichmentLambdaArn?: string;
}
```

Phase 1: stores the profile-ID mapping. Phase 2: wires the subscription filter.

### AgentTypeHarness (abstract base)

```typescript
interface AgentTypeHarnessProps {
  configName: string;
  agentType: 'agentcore-managed' | 'openclaw' | 'agentcore-runtime';
  sharedInfra: SharedInfraOutputs;
  config: AgentConfiguration;
}
```

Composes: AgentIdentity + AgentPolicyModulator + AgentBusChannel + AgentTelemetry.

### AgentCoreManagedHarness

```typescript
interface AgentCoreManagedHarnessProps extends AgentTypeHarnessProps {
  harnessConfig: {
    systemPrompt: string;
    maxIterations?: number;
    maxTokens?: number;
    timeoutSeconds?: number;
    allowedTools?: string[];
    tools?: HarnessTool[];
    skills?: HarnessSkill[];
  };
}
```

Deploys base governance + `CfnHarness` resource pointed at the governed execution role. Harness-native limits serve as first-line defense (per-invocation caps, allowedTools). The platform modulator is second-line (cumulative-threshold breaker + capability grant/revoke).

### OpenClawHarness

```typescript
interface OpenClawHarnessProps extends AgentTypeHarnessProps {
  trustPrincipal: iam.IPrincipal;
  eventBridgeChannel?: {
    queueUrl?: string;
    sourceNamespace?: string;
    signalSubscriptions?: Array<{ detailType: string; source: string }>;
  };
}
```

Deploys base governance + role trust policy scoped to wherever OpenClaw runs. Signal channel queue + rules activate with the event augmentation module.

### AgentCoreRuntimeHarness

```typescript
interface AgentCoreRuntimeHarnessProps extends AgentTypeHarnessProps {
  runtimeConfig: {
    ecrRepository?: string;
    codeZipS3?: string;
    environmentVariables?: Record<string, string>;
  };
}
```

Deploys base governance + AgentCore Runtime resource (L2 construct from `aws-cdk-lib/aws-bedrockagentcore`).

---

## Handler convention (packages/api)

Flat file per Lambda. Naming: `{what-it-does}.{trigger-type}.ts`.

Trigger suffixes:
- `.http` — API Gateway
- `.alarm` — CloudWatch Alarm
- `.schedule` — EventBridge Scheduler
- `.event` — EventBridge event
- `.logs` — CloudWatch Logs subscription

Each handler:
1. Receives the AWS event object
2. Parses/validates via the adapter's request DTO schema
3. Maps to domain entity via `toDomain()` mapper
4. Calls the use-case
5. Maps result to response DTO via `toResponse()` mapper
6. Returns

No business logic in the handler. No AWS SDK calls. Those live in adapters and use-cases.

---

## DTO flow

```
AWS event → Handler → Request DTO (parse + validate) → Mapper (toDomain) → Use-case → Core domain
                                                                                          │
AWS response ← Handler ← Response DTO ← Mapper (toResponse) ← Use-case result ←──────────┘
```

Each adapter boundary owns its own DTO folder with request shapes, response shapes, persistence shapes, and mappers. The domain never imports a DTO. Mappers are pure functions with co-located tests.

---

## Configuration schemas (packages/core)

### Agent configuration (validated by CDK at deploy time)

```json
{
  "configName": "string",
  "agentType": "agentcore-managed | openclaw | agentcore-runtime",
  "modelId": "string (Bedrock model ID)",
  "guardrailId": "string",
  "guardrailVersion": "string (default: DRAFT)",
  "owner": "string"
}
```

> **Note:** Signal subscriptions (EventBridge detailType + source patterns) were originally part of the base agent configuration. They have been moved to the OpenClaw harness-specific configuration (`OpenClawHarnessProps.eventBridgeChannel`) as they are a delivery concern specific to that harness type.

### Runtime tunables (AppConfig, changeable without deploy)

```json
{
  "thresholds": {
    "outputTokensPerHour": 200000,
    "guardrailBlocksPer10Min": 3,
    "guardrailObservationsPerHour": 10
  },
  "featureFlags": {
    "pipelineSpeedBreaker": false,
    "timeBoxedGrants": false
  }
}
```

Grant state does not live in AppConfig. It lives in the grant ledger (DynamoDB, data architecture TBD). The modulator reads the ledger directly.

---

## Governance layering: platform vs harness-native

| Concern | Harness-native | Platform (Hecatoncheires) | Relationship |
|---|---|---|---|
| Token limits | Per-invocation cap (`maxTokens`) | Per-hour cumulative alarm | Complementary |
| Iteration limits | Per-invocation cap (`maxIterations`) | N/A | Harness-only |
| Timeout | Per-invocation (`timeoutSeconds`) | N/A | Harness-only |
| Capability restrictions | Static whitelist (`allowedTools`), Cedar at gateway | Capability shape grant/revoke on operating policy (AWS-backed actions) | Complementary. See ADR-0001. |
| Guardrails | AgentCore Policy Engine (Cedar, at Gateway) | IAM condition keys (at role level) | Both enforce. IAM is the hard floor. |
| Observability | Built-in traces + metrics + log delivery | Enrichment pipeline + ops bus + dashboard | Platform consumes harness outputs. |
| Cost attribution | Harness tags | Inference profile tags → Cost Explorer | Same mechanism. |

---

## Naming conventions

| Resource type | Pattern | Example |
|---|---|---|
| IAM role | `hecaton-{stage}-{configName}-agent-role` | `hecaton-dev-sre-ops-agent-role` |
| Inference profile | `hecaton-{stage}-{configName}-profile` | `hecaton-dev-sre-ops-profile` |
| Guardrail | `hecaton-{stage}-{configName}-guardrail` | `hecaton-dev-sre-ops-guardrail` |
| CW alarm (tokens) | `hecaton-{stage}-{configName}-token-alarm` | `hecaton-dev-sre-ops-token-alarm` |
| CW alarm (blocks) | `hecaton-{stage}-{configName}-block-alarm` | `hecaton-dev-sre-ops-block-alarm` |
| CW alarm (observations) | `hecaton-{stage}-{configName}-observation-alarm` | `hecaton-dev-sre-ops-observation-alarm` |
| SQS FIFO queue | `hecaton-{stage}-{configName}-signals.fifo` | `hecaton-dev-sre-ops-signals.fifo` |
| SQS DLQ | `hecaton-{stage}-{configName}-signals-dlq.fifo` | `hecaton-dev-sre-ops-signals-dlq.fifo` |
| Lambda | `hecaton-{stage}-{handler-name}` | `hecaton-dev-grant-shape` |
| EventBridge rule | `hecaton-{stage}-{configName}-{purpose}` | `hecaton-dev-sre-ops-ingest` |
| CfnHarness | `hecaton-{stage}-{configName}-harness` | `hecaton-dev-test-managed-harness` |
| Stack | `Hecaton-{Stage}-{Purpose}` or `Hecaton-{Stage}-{ConfigName}` | `Hecaton-Dev-SharedInfra`, `Hecaton-Dev-SreOps` |
| DynamoDB table | `hecaton-{stage}-grant-ledger` | `hecaton-dev-grant-ledger` |

Tags on all resources:
- `hecatoncheires:managed = true`
- `hecatoncheires:config = {configName}`
- `hecatoncheires:stage = {stage}`
- `hecatoncheires:phase = {1|2|3|4}`
- `hecatoncheires:harness-type = {agentcore-managed|openclaw|agentcore-runtime}`

---

## Deployment flow

```
pnpm --filter @hecaton/core build
pnpm --filter @hecaton/cdk deploy Hecaton-Dev-SharedInfra
pnpm --filter @hecaton/cdk deploy Hecaton-Dev-TestManaged Hecaton-Dev-SreOps ...
pnpm --filter @hecaton/cdk deploy Hecaton-Dev-Telemetry
```

Or: `pnpm --filter @hecaton/cdk deploy --all`

CDK's `NodejsFunction` handles per-handler bundling from `packages/api/src/handlers/` entry points.

### Adding a new agent configuration

Phase 1-3 (manual): add a seed config in `packages/cdk/lib/config/seeds/`, instantiate a new `AgentConfigStack` in `bin/app.ts`, deploy.

Phase 4 (self-service): API/CLI creates the seed, triggers CDK Pipeline. See the Phase 4 task list in [Hecatoncheires.md](./Hecatoncheires.md).

---

## Phase 1 scope

Build order:

1. Workspace scaffolding (pnpm, tsconfig.base, eslint, prettier)
2. `packages/core` Foundation: schemas, types, entity, errors, constants
3. `packages/core` domain/identity + domain/capability (shape resolution, policy assembly)
4. `packages/api` adapters: dynamo (grant ledger), iam (policy writer), eventbridge (bus emitter)
5. `packages/api` use-cases: grant-shape, revoke-shape, trip-breaker
6. `packages/api` handlers: grant-shape.http, revoke-shape.http, breaker-trip.alarm
7. `packages/cdk` SharedInfraStack (bus, SNS-as-target, boundary, AppConfig, grant ledger table, drift detection)
8. `packages/cdk` constructs: AgentIdentity, AgentPolicyModulator, AgentBusChannel
9. `packages/cdk` AgentCoreManagedHarness (composes + CfnHarness)
10. First AgentConfigStack with a managed harness seed config
11. `cdk synth` + assertion tests
12. Deploy to test account, invoke harness, verify governance fires
13. OpenClawHarness, then AgentCoreRuntimeHarness (lower priority)

---

## Testing strategy

Runner: Vitest 4.x across all packages. Native ESM, zero-config TypeScript, fast watch mode.

Co-location: every module has a `.test.ts` beside it. No separate `__tests__` trees.

```
packages/core/src/domain/capability/
├── resolve-shape.ts
├── resolve-shape.test.ts
├── assemble-policy.ts
└── assemble-policy.test.ts
```

Categories per package:

| Package | Unit | Property-based | Integration | CDK assertions | Performance |
|---|---|---|---|---|---|
| core | Domain logic (pure, no mocks) | Shape resolution invariants, policy assembly edge cases | N/A | N/A | Policy assembly at 50/200 shapes |
| api | Use-cases + mappers (mock adapters at the boundary) | N/A | Handler → use-case → adapter (localstack or mocked SDK) | N/A | N/A |
| cdk | N/A | N/A | Deploy-and-verify (test account) | `Template.fromStack()` assertions per construct | N/A |
| web | Component logic (no I/O) | N/A | Full render pipeline | N/A | N/A |

The litmus test from the clean-arch doc applies: if you can't test a core domain function by passing it data and asserting the return value (no mocks, no setup), the boundary is leaking.

Cross-package integration tests live in the root `test/` folder.

---

## Error handling and response contract

All Lambda handlers return a standard error envelope. Domain errors propagate through use-cases and get mapped to HTTP status codes at the handler level.

Response envelope (success):
```json
{
  "success": true,
  "data": { ... }
}
```

Response envelope (error):
```json
{
  "success": false,
  "error": {
    "code": "SHAPE_NOT_FOUND",
    "message": "Shape 's3-write-workfiles' is not in the catalog",
    "details": { ... }
  }
}
```

Error flow:
1. Domain throws a typed error (from `@hecaton/core/errors`) or returns a failure result.
2. Use-case catches domain errors and re-throws or returns them.
3. Handler catches at the top level, maps the error class to an HTTP status and error code, and returns the envelope.

Typed error classes in `packages/core/src/errors/`:
- `ShapeNotFoundError` (code: `SHAPE_NOT_FOUND`)
- `InvalidShapeParametersError` (code: `INVALID_SHAPE_PARAMETERS`)
- `GrantConflictError` (code: `GRANT_CONFLICT`)
- `ConfigNotFoundError` (code: `CONFIG_NOT_FOUND`)
- `ValidationError` (code: `VALIDATION_ERROR`)
- `InternalError` (code: `INTERNAL_ERROR`, catch-all, logs full context, returns sanitized message)

Domain errors carry only `code`, `message`, and optional `details`. They do not carry transport-specific status codes. The adapter layer in `packages/api` maintains a `code → status` map for each access pattern (HTTP status codes for REST handlers, gRPC status codes for future transports).

Start verbose: return full error details in the envelope. Redact later if needed for security (Phase 3 redaction work). Internal errors never expose stack traces externally.

---

## API authentication

Two auth mechanisms, phased:

Phase 1-2 (API key): API Gateway usage plan with an API key. Operators call the API with `x-api-key` header. Simple, sufficient for a small team, and requires no identity provider setup.

Phase 3+ (Cognito): Add a Cognito user pool as an authorizer on API Gateway. The web frontend authenticates via Cognito and passes a JWT. API key remains available for programmatic/CI access (dual auth paths on the same API Gateway, different routes or stages if needed).

The CDK construct for SharedInfraStack deploys the API Gateway with API key auth from day one. Cognito authorizer is added when the web package materializes.

---

## Environment and stage strategy

Three stages: `dev`, `staging`, `prod`. Differentiated by CDK context, not separate accounts (single-account constraint for Phases 1-3).

| Concern | How it varies per stage |
|---|---|
| Stack names | `Hecaton-{Stage}-{Purpose}` e.g. `Hecaton-Dev-SharedInfra` |
| Resource names | Prefixed: `hecaton-dev-`, `hecaton-staging-`, `hecaton-prod-` |
| AppConfig environment | One per stage (`dev`, `staging`, `prod`) |
| Grant ledger table | One per stage (`hecaton-dev-grant-ledger`, etc.) |
| API Gateway stage | Maps to the environment name |
| Thresholds | Lower in dev (trip breakers fast for testing), production values in prod |
| SNS subscriptions | Dev: your own email. Prod: team distribution list. |

CDK context in `cdk.json`:
```json
{
  "context": {
    "stage": "dev"
  }
}
```

Override at deploy: `cdk deploy --context stage=prod`

All stage-dependent values resolve from the context. A single codebase produces all three environments.

---

## Dependency versions

Pin to current stable. These are the floor versions for project init:

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | Lambda runtime target |
| TypeScript | ^5.5 | Strict mode, no implicit any |
| pnpm | 9.x | Workspace tooling |
| Vitest | ^4.0 | Test runner, all packages |
| zod | ^3.23 | Schema validation, core's only external dep |
| aws-cdk-lib | ^2.258.0 | Floor for stable CfnHarness in bedrockagentcore module |
| constructs | ^10.0 | CDK peer dep |
| @aws-sdk/* | ^3.x (latest) | Lambda runtime, bundled per-handler via esbuild |
| esbuild | ^0.21 | Handler bundling (CDK NodejsFunction uses this) |

`packages/web` framework TBD. Likely Vite + React. Selected when the package materializes in Phase 3.

---

## packages/web status

Placeholder. Materializes in Phase 3 (operator dashboard, capability-state views). Framework selection deferred. The package skeleton exists from project init (package.json, tsconfig, empty src/) so workspace tooling recognizes it, but it contains no application code until then.

---

## Open questions

- Grant ledger data architecture: DynamoDB schema, key structure, access patterns.
- Capability shape templates: exact IAM actions, resource-pattern syntax, parameter resolution.
- Metric namespace and dimension conventions for custom dashboard widgets.
- Frontend framework selection (Vite + React likely, deferred to Phase 3).
- Modulator Lambda topology switchover threshold (shared → per-config).
- AppConfig deployment strategy automatic-rollback alarm metric.
- Telemetry transport switchover threshold (Lambda → Kinesis).

---

## Next steps

1. Initialize the monorepo (pnpm workspace, tsconfig.base, eslint, packages skeleton)
2. Build `@hecaton/core` Foundation (schemas + entity + errors + constants)
3. Build `@hecaton/core` domain/capability (shape resolution, policy assembly)
4. Build `@hecaton/api` adapters (DynamoDB grant ledger, IAM policy writer)
5. Build `@hecaton/cdk` SharedInfraStack
6. Build `@hecaton/cdk` AgentIdentity + AgentPolicyModulator constructs
7. First `cdk synth`, assertion tests, deploy to test account
