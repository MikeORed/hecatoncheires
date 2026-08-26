---
tags: [core/project, topic/ai, topic/aws, topic/cdk, topic/architecture]
created: 2026-08-26
parent: "[[Hecatoncheires]]"
status: Active
---

> [!note] Maintaining this document
> The copy in this repository is the one to edit. The Obsidian vault copy is a read-only archive and is no longer synchronised.
>
> This document grows by appending. Add a section when a decision closes, newest at the bottom, and keep the field order used by the sections already here.
>
> A closed decision is never edited to say something different. If one is reversed or narrowed, append a new section and name the section it supersedes. The old section stays as written, so the record reads in the order things actually happened.

# Decisions

Decisions that have closed, with the question each one answered and where the answer now lives in code. The three sibling documents in this folder describe the design; this one records what was settled and when.

Related: [Hecatoncheires.md](./Hecatoncheires.md), [architecture.md](./architecture.md), [diagrams.md](./diagrams.md).

### The capability shape catalog is four frozen shapes carrying risk tiers

Question: What is the starting set of capability shapes, and where does the catalog live?
Decision: Four shapes, each carrying a risk tier: `core-invocation` (medium), `s3-prefix-read` (low), `s3-prefix-write` (medium), `cloudwatch-logs-read` (low). The catalog is a frozen array, so nothing can add a shape at runtime. Shapes are added by editing the file and deploying.
Decided: 2026-07-20
Code: `packages/core/src/config/shape-catalog.ts`

### The grant ledger is DynamoDB keyed on configName and grantId

Question: What is the grant ledger's data architecture?
Decision: One DynamoDB table, partition key `configName`, sort key `grantId`, on-demand billing. TTL on `expiresAt`, point-in-time recovery enabled, and `RemovalPolicy.RETAIN` so a stack teardown cannot destroy the grant history.
Decided: 2026-07-22
Code: `packages/cdk/lib/stacks/shared-infra.stack.ts`

### The permission boundary is per agent, not one ceiling for the fleet

Question: Is the permission boundary a single shared managed policy for the whole fleet, or one per agent?
Decision: One managed policy per agent, created inside the `AgentIdentity` construct and attached to that agent's role as its boundary. The boundary allows Bedrock inference only under condition keys binding the assigned inference profile and guardrail, plus a narrow floor of logging and `hecaton-*` S3 access.
Decided: 2026-07-22
Code: `packages/cdk/lib/constructs/agent-identity.construct.ts`
Supersedes: The earlier plan for one shared fleet boundary deployed by the shared infrastructure stack and referenced by every agent role.

### The harness abstraction is CDK stack inheritance, not an L3 construct

Question: How do the three harness types share governance wiring without duplicating it?
Decision: Stack inheritance. An abstract `AgentConfigStack` creates the inference profile, the guardrail, the identity, the modulator, and the AppConfig tunables. A concrete `AgentCoreManagedStack` extends it and adds the `CfnHarness` resource. The deployment unit is one CloudFormation stack per agent config.
Decided: 2026-07-22
Code: `packages/cdk/lib/stacks/agent-config.stack.ts`, `packages/cdk/lib/stacks/agentcore-managed.stack.ts`
Supersedes: The L3 construct named `AgentTypeHarness` with three subclass constructs (`AgentCoreManagedHarness`, `OpenClawHarness`, `AgentCoreRuntimeHarness`) composed inside a shared stack. The two subclasses for OpenClaw and AgentCore Runtime have no equivalent yet; `packages/cdk/bin/app.ts` skips any seed whose `agentType` is not `agentcore-managed`.

### A second DynamoDB table holds the agent registry

Question: How does a CloudWatch alarm, which only knows an inference profile ID, reach the IAM role it needs to modulate?
Decision: A second DynamoDB table, separate from the grant ledger, using a single-table `pk`/`sk` key schema with an inverted global secondary index named `gsi1` that swaps the two. The inversion is what makes profile-to-role lookup a query rather than a scan. Records are written by a custom resource at deploy time and carry the config name, role name, profile entity ID, profile ARN, agent type, model ID, guardrail ID, and breaker state.
Decided: 2026-08-24
Code: `packages/cdk/lib/stacks/shared-infra.stack.ts`, `packages/cdk/lib/lambda/registry-seed.handler.ts`, `packages/api/src/adapters/dynamo/agent-registry.adapter.ts`
Supersedes: Nothing. The table was never in the planning documents, which is why it is recorded here.

### There is one breaker Lambda for the whole fleet

Question: Is the modulator Lambda deployed once per account or once per agent config?
Decision: Shared. One breaker Lambda in `SharedInfraStack`, invoked directly as the alarm action of every agent's three alarms. Per-agent stacks pass the function ARN into their alarms; the invoke permission is granted once in the shared stack, because granting it per agent creates a circular cross-stack dependency.
Decided: 2026-08-24
Code: `packages/cdk/lib/stacks/shared-infra.stack.ts`, `packages/api/src/handlers/breaker-trip.alarm.ts`
Supersedes: The plan for a modulator Lambda inside each `AgentPolicyModulator` instance, which would have deployed one per agent config.

### The AgentTelemetry construct was dropped

Question: Where does the inference profile ID to config name mapping live?
Decision: In the agent registry table. The `AgentTelemetry` construct existed to hold that mapping and to wire a log subscription filter in a later phase. The registry now holds the mapping for every agent, so the construct had nothing left to own and was never built.
Decided: 2026-08-24
Code: `packages/api/src/adapters/dynamo/agent-registry.adapter.ts`
Supersedes: The `AgentTelemetry` L3 construct, which the architecture document specified props for and which no file ever implemented.
