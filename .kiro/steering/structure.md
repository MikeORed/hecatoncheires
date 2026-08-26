# Project Structure

## Monorepo Layout

pnpm workspace with four packages following clean architecture layering.

```
hecatoncheires/
├── packages/
│   ├── core/          Pure domain logic (Layers 0–2). No AWS deps.
│   ├── api/           Use-cases + adapters (Layer 3, Lambda runtime)
│   ├── cdk/           Infrastructure constructs & stacks (Layer 3, CDK)
│   └── web/           Operator dashboard SPA (Layer 4, placeholder)
├── test/              Cross-package integration tests
├── .github/workflows/ CI per package (core, api, cdk, web)
└── .initial-planning/ Architecture docs and project planning
```

## Dependency Rules (enforced via ESLint)

- `core` imports nothing outside itself (zod is the sole external dep)
- `api` and `cdk` import only `@hecaton/core` (barrel import, no deep paths)
- `api` and `cdk` never import each other
- `web` imports only `@hecaton/core`
- All cross-package imports use the workspace package name (`@hecaton/core`), never relative paths into another package

## packages/core — Domain Engine

```
src/
├── public-api.ts        Single barrel export (THE port)
├── schemas/             Layer 0: zod schemas (source of types + validators)
├── types/               Layer 0: re-exported types for ergonomic use
├── entity/              Layer 0: factory functions for domain objects
├── errors/              Layer 0: typed error classes
├── constants/           Layer 0: thresholds, shape names, enumerations
├── config/              Layer 0: shape template definitions
├── shared/algorithms/   Layer 0: policy assembly, shape merging
├── validators/          Layer 0: cross-field, structural, referential validation
├── test-generators/     Layer 0: randomized builders for property-based testing
└── domain/
    ├── identity/        Layer 1: role model, profile binding, boundary logic
    ├── capability/      Layer 1: shape resolution, grant logic, policy assembly
    ├── telemetry/       Layer 2: enrichment logic, profile-ID resolution
    ├── signals/         Layer 2: envelope validation, correlation chains
    └── fleet/           Layer 2: config validation, onboarding eligibility
```

## packages/api — Runtime (Lambdas)

```
src/
├── handlers/            Lambda entry points (flat, named: {action}.{trigger}.ts)
├── use-cases/           Orchestrate core domain into workflows
├── ports/               Port interfaces for adapter dependencies
├── shared/              Shared utilities (logging, middleware)
└── adapters/            I/O boundary (only code touching AWS SDKs)
    ├── http/dto/        Request/response DTOs + mappers
    ├── dynamo/dto/      Persistence DTOs + mappers
    ├── iam/             Operating policy writer
    ├── eventbridge/dto/ Event DTOs + mappers
    ├── appconfig/       Runtime tunables reader
    ├── cloudwatch/      Metric emitter
    └── sns/             Notification emitter
```

**Handler naming convention**: `{what-it-does}.{trigger-type}.ts`
Trigger suffixes: `.http`, `.alarm`, `.schedule`, `.event`, `.logs`

**DTO flow**: AWS event → handler → request DTO (parse) → mapper (toDomain) → use-case → core domain → mapper (toResponse) → response DTO → AWS response

## packages/cdk — Infrastructure

```
bin/
└── app.ts               CDK app entry point
lib/
├── stacks/              Stack definitions (SharedInfra, AgentConfig, AgentcoreManaged)
├── constructs/          L3 constructs (AgentIdentity, AgentPolicyModulator, AgentBusChannel)
├── config/              Seed configuration and constants
└── lambda/              Bundled handler code for deployment
test/
├── constructs/          Construct-level assertion tests
└── stacks/              Stack-level assertion tests
```

## Naming Conventions

| Resource | Pattern |
|---|---|
| IAM role | `hecaton-{configName}-agent-role` |
| Inference profile | `hecaton-{configName}-profile` |
| Lambda | `hecaton-{handler-name}` |
| SQS queue | `hecaton-{configName}-signals.fifo` |
| Stack | `Hecaton-{Stage}-{Purpose}` |
| DynamoDB table | `hecaton-{stage}-grant-ledger` |

All resources tagged: `hecatoncheires:managed`, `hecatoncheires:config`, `hecatoncheires:phase`, `hecatoncheires:harness-type`.

## Key Architecture Patterns

- **Clean architecture**: domain logic is pure and testable without mocks. If you need a mock to test core logic, the boundary is leaking.
- **Single barrel export**: `@hecaton/core` exposes everything through `public-api.ts`. Internal module paths are not importable externally.
- **Adapters own their DTOs**: each I/O boundary has its own DTO folder with request/response/persistence shapes and pure mapper functions.
- **No business logic in handlers**: handlers parse, delegate to use-cases, and format responses. AWS SDK calls live in adapters only.
- **Three-layer IAM role model**: permission boundary (ceiling) → base config (floor) → operating policy (modulated by the platform).
