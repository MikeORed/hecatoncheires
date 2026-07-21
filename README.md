*If you're here, someone made a mistake. Either I forgot to remove this text, or you're here too early. If it's the former, give me the heads up. If it's the latter, feel free to look around, but this is still a tad too fresh to judge holistically.*

# Hecatoncheires

> *The Hundred-Handed Ones: primordial giants who guarded the gates of Tartarus.*

A CDK-deployed AWS governance and observability platform for autonomous AI agent fleets. Hecatoncheires enforces identity, cost, and capability boundaries on agents that use Amazon Bedrock, ensuring they cannot operate outside their granted permissions.

Autonomous agents need a governance plane that matches their execution speed. Without one, they become unaccountable cost and security liabilities. This platform is my attempt at an agent agnostic warden of sorts.

## What it does

The platform wraps every agent in a three-layer IAM role model (permission boundary, base config, operating policy) that governs what AWS API and CLI actions the agent can take. At the Bedrock layer specifically, it forces use of an assigned inference profile and guardrail. No profile, no inference. No guardrail, no inference. No shoes, no service.

Capability control happens through a modulated operating policy. The resting state is deny-by-default. An operator (or automation) grants capability shapes to the operating policy via the grant ledger; the policy modulator rewrites the inline policy to match. The circuit breaker is the coarsest revocation: it pulls the invocation shape entirely.

Circuit breakers operate at two speeds. The slower path is CloudWatch alarm-driven, tripping when cumulative thresholds are exceeded over a window. The faster path rides the telemetry pipeline (below), evaluating the invocation log stream in near-real-time. Either way, the modulator revokes the invocation shape and the agent's next Bedrock call fails with AccessDenied. Recovery is manual in Phase 1.

The telemetry pipeline (Phase 2) processes Bedrock invocation logs through an enrichment Lambda, resolves profile IDs back to config names, and emits structured events to an ops EventBridge bus. A fleet-level CloudWatch dashboard surfaces token burn, breaker states, and guardrail interventions.

A parallel workstream extends agents to participate as signal processors on a shared EventBridge fabric via per-agent SQS FIFO queues.

## Architecture

```
                    ┌─────────────────────────────────┐
                    │        Operator / Dashboard      │
                    └──────────────┬──────────────────┘
                                   │ grant / revoke / observe
                    ┌──────────────▼──────────────────┐
                    │         Hecatoncheires           │
                    │  (IAM modulation, telemetry,     │
                    │   breakers, capability control)  │
                    └──┬───────────┬──────────────┬───┘
                       │           │              │
          ┌────────────▼┐   ┌─────▼─────┐   ┌───▼────────────┐
          │  AgentCore   │   │  OpenClaw  │   │ AgentCore      │
          │  Managed     │   │  (external)│   │ Runtime        │
          └──────┬───────┘   └─────┬─────┘   └───┬────────────┘
                 │                  │              │
                 └──────────┬──────┘──────────────┘
                            │ governed role assumption
                 ┌──────────▼──────────┐
                 │   Amazon Bedrock     │
                 │  (inference profile  │
                 │   + guardrail)       │
                 └─────────────────────┘
```

## Agent harness types

| Harness | Description | Build priority |
|---------|-------------|----------------|
| AgentCore Managed | Config-driven, AWS-hosted agent loop | 1st (primary test rig) |
| OpenClaw | External agent assumes a governed role | 2nd (proves agent-agnostic governance) |
| AgentCore Runtime | Container-based custom agent code | 3rd |

## Governance layering

Every agent role has three IAM layers:

1. Permission Boundary: absolute ceiling, never modulated.
2. Base config: minimal shared floor (invocation permissions, logging).
3. Operating policy: single inline policy, rewritten by the modulator from the grant ledger. Deny-by-default.

## Monorepo structure

```
hecatoncheires/
├── packages/
│   ├── core/       Pure domain logic (Layers 0-2). No AWS deps. Only zod.
│   ├── api/        Use-cases + adapters (Layer 3, Lambda runtime)
│   ├── cdk/        Infrastructure constructs & stacks (Layer 3, CDK)
│   └── web/        Operator dashboard SPA (Layer 4, placeholder)
├── test/           Cross-package integration tests
└── .github/        CI workflows per package
```

Dependency rules: `core` imports nothing outside itself (zod is the sole external dep). `api` and `cdk` import only `@hecaton/core` via barrel export and never import each other. `web` imports only `@hecaton/core`.

## Getting started

### Prerequisites

- Node.js 20 LTS (see `.nvmrc`)
- pnpm 9.x (`corepack enable` handles this)
- AWS account with CDK bootstrapped (for deployment)

### Install and build

```bash
pnpm install
pnpm build
```

### Run tests

```bash
pnpm test
```

### Lint and format

```bash
pnpm lint
pnpm format:check
```

### Per-package commands

```bash
# Build a single package
pnpm --filter @hecaton/core build

# Test a single package
pnpm --filter @hecaton/api test

# CDK synth
pnpm --filter @hecaton/cdk synth

# CDK deploy
pnpm --filter @hecaton/cdk deploy --all
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.5, strict mode, ESM-only |
| Package manager | pnpm 9.x with workspaces |
| Validation | zod 3.23 |
| Infrastructure | aws-cdk-lib 2.258+ |
| Runtime | AWS Lambda (esbuild bundled) |
| Testing | Vitest 4.x |
| Linting | ESLint 8 + @typescript-eslint |
| Formatting | Prettier (single quotes, trailing commas, 100 width) |

## Project status

Phase 1 (Identity + Boundaries + Basic Safety) is in progress. Single-account deployment for now; multi-account is a documented future path.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Identity, IAM boundaries, breakers, capability control | In progress |
| 2 | Telemetry pipeline, ops bus, fleet dashboard | Planned |
| 3 | Advanced control, hardening | Planned |
| 4 | Fleet onboarding, self-service provisioning | Planned |
| Parallel | Event augmentation (signals bus, OpenClaw channel plugin) | In progress |

## Design decisions

Operating policy modulator over HITL: capability control is implemented via IAM operating policy rewrite, not human-in-the-loop approval queues. The agent never pauses; the capability is simply absent until granted.

Clean architecture: domain logic is pure and testable without mocks. If you need a mock to test core logic, the boundary is leaking.

Single barrel export: `@hecaton/core` exposes everything through `public-api.ts`. No deep imports.

Adapters own their DTOs: each I/O boundary has its own DTO folder with shapes and pure mapper functions.

No business logic in handlers: handlers parse, delegate to use-cases, and format responses. AWS SDK calls live in adapters only.

## License

Private.
