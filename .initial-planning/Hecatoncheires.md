---
tags: [core/project, role/engineer, topic/ai, topic/aws, topic/platform]
due: 2026-09-07
created: 2026-06-08-16:00
area: "[[AI Expertise Dashboard|AI Expertise]]"
progress: 🟡 In Progress
status: Active
---

> [!info] Definition  
> A Project exists to ship a **finite outcome** inside 3–12 weeks.

# Project -- Hecatoncheires

> [!question] Why are we doing this?  
> Autonomous agents need a governance and observability plane that matches their execution speed, or they become unaccountable cost and security liabilities.

**Outcome:** A CDK-deployed AWS governance platform that observes and controls autonomous agent fleets via IAM enforcement, real-time telemetry, cost circuit breakers, and capability control through a modulated IAM operating policy. Three harness types: AgentCore Managed Harness (config-driven, AWS-hosted loop), OpenClaw (external agent, role assumption only), and AgentCore Runtime (container-based, custom code). Separately, an event augmentation module extends agents to participate as signal processors on a shared EventBridge fabric.

**Success criteria:**

- [ ] Agent type harnesses (AgentCore Managed, OpenClaw, AgentCore Runtime) deployable via CDK with full governance wiring
- [ ] IAM boundary model enforces per-config inference profiles and guardrails -- agents cannot invoke without them
- [ ] Alarm-based circuit breakers halt runaway agents within 5 minutes of threshold breach
- [ ] Enrichment pipeline processes invocation logs in near-real-time, emits structured events to ops bus
- [ ] Capability control: grant/revoke IAM capability shapes on the operating policy, deny-by-default resting state (breaker is the coarsest shape)
- [ ] Fleet-level CloudWatch dashboard shows token burn, breaker states, guardrail interventions, capability state
- [ ] Architecture documented with multi-account migration path noted (single-account now)
- [ ] CDK infrastructure deployable and reproducible from a single `cdk deploy`

**Event augmentation module (parallel workstream):**
- [ ] OpenClaw EventBridge channel plugin contributed upstream (PR merged)
- [ ] Signals bus deployed with per-agent SQS queues and routing rules
- [ ] Agents operate as bus-native signal processors (send/receive structured events)

**Start:** 2026-06-08 **Target end:** 2026-09-07 (core phases)

---

## Project Status

**Current Status:** 🟡 In Progress -- Requirements Drafted

> Options: 🟢 On track, 🟡 In Progress, 🟠 At risk, 🔴 Blocked

**Progress:** 20%

**Area:** AI Expertise

## Project structure

Two workstreams under one project:

**Core phases** -- sequential, internally complete. Delivers governance and observability that works with agents as they exist today. All observation is passive.

**Event augmentation module** -- parallel. Extends agents to actively participate in the event fabric. Plugin is implemented; upstream PR pending live validation. Infrastructure work can proceed now.

## Milestones

| Date | Goal | Owner | Status |
| ---- | ---- | ----- | ------ |
| 2026-06-08 | Problem space exploration complete | Michael | 🟢 |
| 2026-06-22 | Requirements and design finalized | Michael | 🟡 |
| 2026-07-13 | Phase 1: Identity + Boundaries + Basic Safety deployed | Michael | 🟡 |
| 2026-08-03 | Phase 2: Telemetry Pipeline + Ops Bus + Dashboard live | Michael | ⏸️ |
| 2026-08-24 | Phase 3: Advanced Control + Hardening complete | Michael | ⏸️ |
| TBD | Phase 4: Fleet Onboarding + Self-Service Provisioning | Michael | ⏸️ |
| TBD | Event Augmentation: OpenClaw channel plugin merged upstream | Michael | 🟡 |
| TBD | Event Augmentation: Signals bus + multi-agent infra deployed | Michael | ⏸️ |

> [!example] Milestone granularity  
> Core phases: ~3 weeks each. Event augmentation: timeline depends on upstream PR lifecycle.

## Tasks

**Immediate (Requirements Phase):**
- [x] Map the problem space
- [x] Document existing state: guardrails PR, IAM role patterns, inference profiles
- [x] Identify and resolve architectural decisions
- [x] Confirm invocation log ToolUse emission across APIs
- [x] Derive formal requirements from exploration findings
- [x] Sketch component diagrams (see [diagrams.md](./diagrams.md) -- mermaid, 9 diagrams)
- [ ] Define CDK construct interfaces (props, methods, outputs per L3)
- [ ] Define AppConfig schemas (agent configs + runtime tunables)
- [ ] Identify AWS service limits that could constrain the design

**Phase 1: Identity + Boundaries + Basic Safety**
- [ ] `AgentTypeHarness` base construct
- [ ] `AgentCoreManagedHarness` extension (primary test rig -- built first)
- [ ] `OpenClawHarness` extension (proves agent-agnostic governance)
- [ ] `AgentCoreRuntimeHarness` extension (container variant -- lower priority, can defer)
- [ ] IAM roles with condition keys (must use assigned profile + guardrail)
- [ ] Permission Boundaries on all agent roles
- [ ] App Inference Profiles (one per config, tagged)
- [ ] Bedrock Guardrail resources
- [ ] Three-layer role model (boundary / base config / operating policy)
- [ ] AppConfig: config store + tunables (thresholds, feature flags)
- [ ] Grant ledger (DynamoDB likely, data architecture TBD) for live capability-shape state
- [ ] Capability shape catalog (risk-tier bundles) + core invocation shape
- [ ] `AgentPolicyModulator`: operating-policy grant/revoke engine (breaker = revoke invocation shape)
- [ ] Seed initial configurations via CDK
- [ ] SNS notification topic + email subscription
- [ ] Drift detection Lambda (CloudTrail -> tag check -> alert)
- [ ] Enable Bedrock Invocation Logs (account-level)
- [ ] Deploy to test account, invoke managed harness, verify governance + grant/revoke fires

**Phase 2: Telemetry Pipeline + Ops Bus + Dashboard**
- [ ] Ops EventBridge bus + Archive
- [ ] Enrichment Lambda (log ingestion, profile ID resolution, ToolUse extraction)
- [ ] SQS routing from enrichment to downstream consumers
- [ ] CloudWatch Dashboard (fleet-level, 5 widgets)
- [ ] S3 log retention (lifecycle policy)
- [ ] S3 log partitioning for Athena query (by date and config)
- [ ] Additional SNS subscriptions (Slack, PagerDuty, webhook) on the ops-bus delivery rule

**Phase 3: Advanced Control + Hardening**
- [ ] Time-boxed capability grants with auto-revocation (grant ledger + expiry sweep)
- [ ] Sensitive-tool detection in enrichment Lambda (audit + breaker trigger, post-hoc)
- [ ] Pipeline-speed circuit breaker (supplements Phase 1 alarms)
- [ ] Per-config drill-down dashboards
- [ ] Config Rule supplement for drift detection (hardens the CloudTrail-based approach)
- [ ] Service limit documentation
- [ ] Operational runbooks
- [ ] Load testing / quota validation

**Phase 4: Fleet Onboarding + Self-Service Provisioning (future, post-v1)**
- [ ] Recipe registry: named templates per harness type with default configs
- [ ] Pipeline-triggered provisioning (Path A): API/CLI creates seed config, triggers CDK Pipeline
- [ ] Onboarding flow for externally deployed agents (trust-principal input, output governed-role ARN + queue URL)
- [ ] Onboarding CLI or lightweight API endpoint
- [ ] Approval UI for breaker reset and capability grants (lightweight, on top of the same grant operation)
- [ ] Deprovisioning / teardown flow (destroy a config's governance stack cleanly)
- [ ] Fleet registry (if Path B warranted): direct API provisioner, state tracking, lifecycle management
- [ ] Operator self-service UI (if demand warrants)

## Future enhancements (post-v1, unphased)

Items that don't fit neatly into Phases 1-4 but are known future needs. Collected here so they're visible without cluttering active task lists.

- Per-instance profiles and per-instance breakers via runtime profile creation. Only needed when fleet scale makes per-config granularity insufficient. Depends on fleet management (Phase 4+).
- Grafana upgrade from CloudWatch Dashboards. Needed for cross-account views, richer query composition, or when dashboard complexity exceeds what CloudWatch widgets support. Natural successor once multi-account is functional.
- Multi-account functional deployment. Structural prep is Phase 1 (bus policies, role chaining). Actual cross-account governance is a separate effort after the single-account platform is proven.
- Direct API provisioner (Path B). Only if fleet churn or scale makes CDK Pipeline provisioning too slow. The grant ledger is the seed of the fleet registry this requires.
- Broader capability shape taxonomy. The starter shapes (S3 prefix read/write, CloudWatch Logs read) expand as agent use cases grow. This is ongoing, not a single deliverable.
- Invocation shim for arbitrary tool gating. The only way to gate non-AWS tools pre-execution. A different product with different properties. Noted, not planned.

**Event Augmentation Module (parallel):**
- [x] Design and implement OpenClaw EventBridge channel plugin
- [ ] Submit upstream PR to OpenClaw (blocked: prove under fire first)
- [ ] AgentCore bus adapter (if needed)
- [ ] Signals EventBridge bus + Archive
- [ ] Per-agent SQS FIFO queues + rules for signal subscriptions (MessageGroupId = correlationId)
- [ ] IAM for PutEvents/ReceiveMessage scoped per config
- [ ] Multi-agent coordination pattern documentation

> [!tip] Task sources  
> Vault notes (not in this repo): `exploration` for architectural decisions and rationale, `reference-agent-ops-presentation` for foundations and control patterns, `eventbridge-channel-idea` for signal channel design.

## Prior art and context

- OpenClaw PR #58588 -- Bedrock Guardrails support (merged). Configures guardrails in `openclaw.plugin.json` and enforces policy at the API layer.
- Application inference profiles with cost labels -- in use today for cost attribution.
- Token-based circuit breakers -- basic version exists informally, formalized in this project.
- IAM role binding pattern -- proven in presentation demo (agent -> profile -> guardrail -> FM).
- EventBridge channel plugin design -- full design in the `eventbridge-channel-idea` vault note, with inbound/outbound options ranked.
- AWS AgentCore Managed Harness (GA June 2026) -- config-driven agent runtime with `executionRoleArn`, built-in observability, per-invocation limits. Primary test rig for proving governance concepts.

## References

### In this repository

- [architecture.md](./architecture.md) -- CDK + monorepo project layout, clean-arch layering, construct interfaces (v2)
- [diagrams.md](./diagrams.md) -- architecture diagrams (mermaid, 9 diagrams)

### Planning notes (private Obsidian vault, not published here)

Listed for the author's own traceability. These are working notes, not authoritative
specifications, and nothing in this repo should be read as depending on them.

- `exploration` -- problem space exploration (v1, all decisions resolved); `exploration-v0` superseded
- `requirements` -- exhaustive requirements (45 reqs across 10 domains, phase-mapped)
- `architecture-v1` -- archived: CDK-only flat structure (superseded by v2)
- `monorepo-exploration` -- reasoning behind the monorepo structure and clean-arch mapping
- `my-flavor-clean-arch` -- personal clean-architecture layering convention
- `pattern-and-service-review` -- critical review of architecture/software patterns and service-tiering decisions
- `ADR-0001-iam-operating-policy-modulator-over-hitl` -- scope decision: stateful HITL was more machinery than the problem warranted, so capability control is done by rewriting the IAM operating policy instead
- `project-brief` -- full project brief (comprehensive, all diagrams inline)
- `reference-agent-ops-presentation` -- "Opening the Black Box" presentation
- `eventbridge-channel-idea` -- EventBridge signal channel design
- `eventbridge-plugin-handoff` -- plugin implementation details, file map, integration checklist

### External

- OpenClaw docs / source
- AWS EventBridge, Lambda, IAM, Bedrock, AppConfig documentation
- AgentCore documentation (generalization target)

> [!todo] Add links  
> Ops runbooks and deployment guides will be added under "In this repository" as they're created.

## Weekly Status Updates

| Date | Status | Progress | Notes |
| ---- | ------ | -------- | ----- |
| 2026-06-08 | 🟡 | 10% | Project created. Exploration complete -- all decisions resolved. Moving to requirements. |
| 2026-06-08 | 🟡 | 15% | Requirements doc drafted (45 reqs, 10 domains). Remaining: construct interfaces, AppConfig schemas, component diagram. |
| 2026-07-19 | 🟡 | 20% | EventBridge channel plugin complete (79 tests, merged main). Handoff ingested. Starting core project architecture and CDK structure. |

> [!note] Update during weekly review  
> Track progress changes and status updates here to maintain project history.
