---
tags: [core/project, topic/ai, topic/aws, topic/cdk, topic/architecture]
created: 2026-07-19
revised: 2026-08-26
parent: "[[Hecatoncheires]]"
status: Draft
version: 2
---

> [!note] Maintaining this document
> The copy in this repository is the one to edit. The Obsidian vault copy is a read-only archive and is no longer synchronised.
>
> This document holds decisions, layering rules, and rationale. It does not hold construct props, construct outputs, file inventories, handler inventories, adapter inventories, or folder decompositions. Those were removed because every one of them had drifted from the code. The code in `packages/` is the specification. Do not reintroduce them here.
>
> When the code contradicts something recorded here, fix the sentence or record a new decision in [decisions.md](./decisions.md). Do not paste the code's current shape back into this file.

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

| Package | Layers | Role |
|---|---|---|
| `packages/core` | 0 to 2 | The engine. Pure domain logic. zod is its only external dependency. |
| `packages/api` | 3 | Use-cases and adapters. The Lambda runtime. |
| `packages/cdk` | 3 | Constructs and stacks. The infrastructure adapter. |
| `packages/web` | 4 | Operator dashboard. Placeholder until Phase 3. |

The specification is the code. See `packages/core/src/`, where the folder names carry the layering. This document previously carried the full directory tree of every package, and the tree drifted from the repository within weeks, so it is not restated here.

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

The policy-document assembly algorithm lives in `packages/core/src/shared/algorithms/`. It's pure: takes shape templates + parameters, returns IAM statement JSON. The IAM adapter in `packages/api/src/adapters/iam/` calls `putRolePolicy` with that output.

---

## Stacks (packages/cdk)

Two kinds of stack. One shared stack per account and stage holds everything the whole fleet references: the ops bus, the notification topic, the permission-boundary-independent shared resources, the two DynamoDB tables, the API Gateway and its handler Lambdas, the shared breaker Lambda, drift detection, and Bedrock invocation logging. One stack per agent configuration holds that agent's identity, inference profile, guardrail, alarms, and tunables. The deployment unit is one CloudFormation stack per agent config, which is recorded in [decisions.md](./decisions.md).

The specification is the code. See `packages/cdk/lib/stacks/`, where each stack's constructor shows what it creates and what it exposes to the stacks that depend on it.

---

## Constructs (packages/cdk)

Constructs live in `packages/cdk/lib/constructs/` and import `@hecaton/core` for seed validation and resource naming. They reference `packages/api` handler entry points for Lambda bundling.

The specification is the code. See `packages/cdk/lib/constructs/`, where the exported props and outputs interfaces define each construct's contract. This document previously restated them and the copies drifted, so they are not restated here.

### Identity

The role carries condition keys on all Bedrock inference actions:

- `bedrock:InferenceProfileArn` must equal the assigned profile
- `bedrock:GuardrailIdentifier` must equal the assigned guardrail

Trust policy shape varies by harness type:

- AgentCore Managed: trusts `bedrock-agentcore.amazonaws.com`
- OpenClaw: trusts the principal where the instance runs, supplied per config
- AgentCore Runtime: trusts `bedrock-agentcore.amazonaws.com`

### Policy modulation

One IAM-mutation engine. The breaker is the coarsest operation; a capability gate is a narrower operation. Both are the same operation against the same inline policy, which is why there is no separate breaker subsystem.

Two trigger sources reach that policy. A grant or revoke request queries the grant ledger for the config's current grants, resolves each against the shape templates, and rewrites the operating policy. A breaker alarm state change writes directly, with no ledger query, because the emergency path cannot depend on a read succeeding. Both paths then emit an event to the ops bus and publish a notification to SNS.

> [!warning] Known gap
> The emergency path does not revoke the invocation shape. It writes a deny-all policy to the operating policy, so a trip removes every granted shape rather than only invocation. The published notification reaches the SNS topic, which currently has no subscription.

The grant ledger is the source of truth for what a config is allowed to do. AppConfig is not involved in grant state.

### Signal delivery

The signals queue is SQS FIFO and the rule sets `MessageGroupId` from the event's `correlationId`, which gives causal ordering per chain rather than per queue.

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

> **Note:** Signal subscriptions (EventBridge detailType + source patterns) were originally part of the base agent configuration. They have been moved to the OpenClaw harness configuration, since delivery is a concern specific to that harness type.

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

> [!warning] Known gap
> Nothing reads these tunables. `AgentConfigStack` writes them as an AppConfig hosted configuration version at deploy time, and alarm thresholds are set from the seed JSON at synth time, so changing a threshold requires a deployment. `packages/api/src/adapters/appconfig/` and `packages/api/src/adapters/cloudwatch/` contain only a `.gitkeep`.

Grant state does not live in AppConfig. It lives in the grant ledger, whose schema is recorded in [decisions.md](./decisions.md). The modulator reads the ledger directly.

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
packages/core/src/shared/algorithms/
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

## Decisions

Questions that have closed, with what was decided and where the answer lives in code, are recorded in [decisions.md](./decisions.md).

---

## Next steps

1. Initialize the monorepo (pnpm workspace, tsconfig.base, eslint, packages skeleton)
2. Build `@hecaton/core` Foundation (schemas + entity + errors + constants)
3. Build `@hecaton/core` domain/capability (shape resolution, policy assembly)
4. Build `@hecaton/api` adapters (DynamoDB grant ledger, IAM policy writer)
5. Build `@hecaton/cdk` SharedInfraStack
6. Build `@hecaton/cdk` AgentIdentity + AgentPolicyModulator constructs
7. First `cdk synth`, assertion tests, deploy to test account
