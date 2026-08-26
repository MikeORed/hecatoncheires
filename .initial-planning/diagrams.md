---
tags: [core/project, topic/ai, topic/aws]
created: 2026-06-08
parent: "[[Hecatoncheires]]"
status: Active
---

> [!note] Maintaining this document
> The copy in this repository is the one to edit. The Obsidian vault copy is a read-only archive and is no longer synchronised.
>
> Every diagram carries a status callout above its Mermaid block saying what is built and what is still specification. When you implement one of the specified paths, move it from the `Specification:` line to the `Built:` line in the same commit that lands the code. A stale status line is worse than an undated diagram, because it reads as current.
>
> Diagrams 3 and 9 are transcriptions of the code. Rewrite them from the code rather than annotating them. Closed decisions live in [decisions.md](./decisions.md).

# Architecture diagrams

Mermaid diagrams for the Hecatoncheires platform. Renders natively in Obsidian. Closed decisions are recorded in [decisions.md](./decisions.md).

---

## 1. System context (high-level)

What Hecatoncheires is and what surrounds it.

> [!note] Status: partly built
> Built: the operator, the platform, the AgentCore Managed harness leg, Bedrock, and the guardrail enforcement edge. Bedrock invocation logging is enabled by `packages/cdk/lib/stacks/shared-infra.stack.ts` and writes to a log group the platform owns.
> Specification: the OpenClaw and AgentCore Runtime legs. `AgentIdentity` builds a trust policy for both types, but neither has a stack, and `packages/cdk/bin/app.ts` skips any seed whose `agentType` is not `agentcore-managed`.
> Gap: two edges run one way in practice. "Reads invocation logs" does not happen; the log group exists and Bedrock writes to it, and nothing consumes it. "Stores/retrieves agent configs & tunables" stores only.

```mermaid
C4Context
    title Hecatoncheires - System Context

    Person(operator, "Operator", "Configures agents, reviews alerts, grants/revokes capability shapes")

    System(hecatoncheires, "Hecatoncheires", "CDK-deployed governance & observability platform")

    System_Ext(openclaw, "OpenClaw Agent", "External autonomous agent (local/Docker)")
    System_Ext(agentcore_managed, "AgentCore Managed Harness", "AWS-hosted agent loop (config-driven)")
    System_Ext(agentcore_runtime, "AgentCore Runtime", "AWS-hosted agent (custom container)")
    System_Ext(bedrock, "AWS Bedrock", "Foundation model inference")
    System_Ext(appconfig, "AWS AppConfig", "Runtime configuration & tunables")

    Rel(operator, hecatoncheires, "Deploys, configures, approves")
    Rel(openclaw, hecatoncheires, "Assumes governed role, observed passively")
    Rel(agentcore_managed, hecatoncheires, "Uses governed execution role, observed passively")
    Rel(agentcore_runtime, hecatoncheires, "Uses governed execution role, observed passively")
    Rel(openclaw, bedrock, "Invokes models (via governed role)")
    Rel(agentcore_managed, bedrock, "Invokes models (via governed role)")
    Rel(agentcore_runtime, bedrock, "Invokes models (via governed role)")
    Rel(hecatoncheires, bedrock, "Reads invocation logs, enforces guardrails")
    Rel(hecatoncheires, appconfig, "Stores/retrieves agent configs & tunables")
    Rel(hecatoncheires, operator, "Alerts, dashboards, capability grant/revoke")
```

---

## 2. Agent invocation path (enforced boundaries)

How an agent reaches a foundation model through the governance layer.

> [!note] Status: built
> Built: all six numbered steps. `AgentIdentity` conditions every Bedrock inference action on `bedrock:InferenceProfileArn` and `bedrock:GuardrailIdentifier`, so the profile and guardrail hops are enforced rather than conventional. Per-profile metrics and invocation logs are both live.
> Specification: none.
> Gap: the diagram reads as though assuming the role is enough to reach the model. The operating policy that `AgentIdentity` attaches is `Deny *` at rest, so no model invocation is possible until a `core-invocation` grant is written into that policy. Steps 3 to 6 describe the ceiling, not the resting state.

```mermaid
flowchart LR
    Agent["Agent Instance<br/>(any harness type)"]
    STS["STS AssumeRole"]
    Role["IAM Role<br/>(conditions + boundary)"]
    Profile["App Inference Profile<br/>(tagged, per-config)"]
    Guardrail["Bedrock Guardrail<br/>(PII, secrets, off-topic)"]
    FM["Foundation Model"]
    CW["CloudWatch Metrics<br/>(per-profile)"]
    Logs["Invocation Logs<br/>(CloudWatch + S3)"]

    Agent -->|"1. Assume role"| STS
    STS -->|"2. Scoped credentials"| Role
    Role -->|"3. Must specify profile"| Profile
    Profile -->|"4. Must specify guardrail"| Guardrail
    Guardrail -->|"5. Policy passes"| FM
    FM -->|"6. Response"| Agent

    Profile -.->|"Emits metrics"| CW
    FM -.->|"Emits logs"| Logs
    Guardrail -.->|"Block/Mask/Observe"| Logs

    style Role fill:#f9d71c,stroke:#333
    style Guardrail fill:#ff6b6b,stroke:#333
    style Profile fill:#4ecdc4,stroke:#333
```

---

## 3. CDK construct hierarchy

How the CDK constructs compose.

> [!note] Status: built
> Built: everything drawn. The diagram is a transcription of `packages/cdk/lib/` and `packages/api/src/handlers/`, so it carries no specification content by construction.
> Specification: none.
> Gap: `onboard-agent.http.ts` is in the handler folder and `packages/cdk/` contains no reference to it. There is no Lambda for it and no route to it. `AgentBusChannel` is drawn as a conditional child because the one seed in the repository supplies no signals bus ARN, so it is never synthesised.

```mermaid
classDiagram
    direction TB

    class SharedInfraStack {
        +opsBus EventBus
        +opsBusArchive CfnArchive
        +snsTopic Topic
        +grantLedgerTable Table
        +agentRegistryTable Table
        +breakerLambda NodejsFunction
        +grantShapeLambda NodejsFunction
        +revokeShapeLambda NodejsFunction
        +queryFleetStateLambda NodejsFunction
        +driftDetectionLambda NodejsFunction
        +apiGateway RestApi
        +appConfigApplication CfnApplication
        +bedrockInvocationLogGroup LogGroup
    }

    class AgentConfigStack {
        <<abstract>>
        +inferenceProfile CfnApplicationInferenceProfile
        +guardrail CfnGuardrail
        +appConfigTunables CfnConfigurationProfile
        +identity AgentIdentityOutputs
        +modulator AgentPolicyModulatorOutputs
    }

    class AgentCoreManagedStack {
        +harness CfnHarness
        +signalChannel AgentBusChannelOutputs
    }

    class AgentIdentity {
        +permissionBoundary ManagedPolicy
        +role Role
        +basePolicy Policy
        +operatingPolicy Policy
    }

    class AgentPolicyModulator {
        +tokenAlarm Alarm
        +blockAlarm Alarm
        +observationAlarm Alarm
        +registrySeed CustomResource
    }

    class AgentBusChannel {
        +signalsQueue Queue
        +deadLetterQueue Queue
        +rule Rule
    }

    class ApiHandlers {
        +grant-shape.http.ts
        +revoke-shape.http.ts
        +query-fleet-state.http.ts
        +breaker-trip.alarm.ts
        +drift-detect.event.ts
        +onboard-agent.http.ts
    }

    AgentCoreManagedStack --|> AgentConfigStack
    AgentConfigStack *-- AgentIdentity
    AgentConfigStack *-- AgentPolicyModulator
    AgentCoreManagedStack *-- AgentBusChannel : only when a seed supplies signalChannel
    AgentCoreManagedStack ..> SharedInfraStack : reads outputs through props
    AgentPolicyModulator ..> SharedInfraStack : alarm actions target breakerLambda
    SharedInfraStack ..> ApiHandlers : bundles five of the six entry points
```

---

## 4. Circuit breaker flow (Phase 1 - alarm-based)

What happens when an agent exceeds thresholds.

> [!note] Status: partly built
> Built: the alarm to Lambda to IAM to SNS sequence. The three alarms in `AgentPolicyModulator` are dimensioned on `InferenceProfileId` and name the shared breaker Lambda directly as their alarm action. `packages/api/src/handlers/breaker-trip.alarm.ts` resolves that dimension to a role name through the agent registry table, a participant the diagram does not show.
> Specification: nothing automates the reset. Re-granting is a manual `POST /grants` call, which is what the diagram's closing notes already say.
> Gap: the diagram says the breaker revokes the invocation shape. `packages/api/src/use-cases/trip-breaker.ts` writes a full deny-all policy to the operating policy instead, so a trip removes every granted shape rather than only invocation. The SNS publish happens, but the topic has no subscription, so no email is delivered.

```mermaid
sequenceDiagram
    participant Agent as Agent Instance
    participant Bedrock as Bedrock (FM)
    participant CW as CloudWatch
    participant Alarm as CW Alarm
    participant Lambda as Policy Modulator
    participant IAM as IAM (Role)
    participant SNS as SNS Topic
    participant Op as Operator

    Agent->>Bedrock: InvokeModel (via profile)
    Bedrock-->>CW: Emit metrics (tokens, guardrail blocks)
    
    Note over CW,Alarm: Threshold exceeded (200k tokens/hr or >3 blocks/10min)
    
    CW->>Alarm: Alarm -> ALARM state
    Alarm->>Lambda: Trigger
    Lambda->>IAM: Revoke invocation shape (rewrite operating policy)
    Lambda->>SNS: Publish breaker-trip notification
    SNS->>Op: Email (config, reason, metric value)
    
    Agent->>Bedrock: InvokeModel (next attempt)
    Bedrock--xAgent: ACCESS DENIED (invocation shape revoked)

    Note over Op,Lambda: Reset = operator re-grants the invocation shape (same modulator engine)
    Note over Op,Lambda: Phase 1: manual re-grant via CLI/console. No auto-reset.
```

---

## 5. Telemetry pipeline (Phase 2)

How invocation logs become structured ops events.

> [!note] Status: specification
> Built: two edges. Bedrock to CloudWatch Logs, which the shared stack enables through the Bedrock model invocation logging configuration, and the ops bus to its archive, a seven-day EventBridge archive. The ops bus itself exists and receives events from the breaker, grant, revoke, and drift Lambdas.
> Specification: every other edge. There is no subscription filter, no enrichment Lambda, no S3 export, no profile-ID mapping lookup, and no dashboard. The rule feeding a policy modulator consumer does not exist either; the Lambdas publish to the ops bus rather than consuming from it.
> Gap: the AppConfig node implies a runtime read of sensitive-tool patterns. `packages/api/src/adapters/appconfig/` contains only a `.gitkeep`.

```mermaid
flowchart TB
    subgraph "Agent Activity (passive)"
        Agent["Agent Instance"]
        Bedrock["Bedrock FM"]
        Agent -->|"Invoke"| Bedrock
    end

    subgraph "Log Delivery (automatic)"
        Bedrock -->|"Invocation logs"| CWLogs["CloudWatch Logs"]
        CWLogs -->|"Subscription filter"| Enrichment["Enrichment Lambda"]
        CWLogs -->|"Export"| S3["S3 (90-day retention)"]
    end

    subgraph "Enrichment"
        Enrichment -->|"Resolve profile ID"| SSM["SSM/Env<br/>(ID -> name mapping)"]
        Enrichment -->|"Flag sensitive tool use<br/>(audit / breaker trigger)"| AppConfig["AppConfig<br/>(sensitive-tool patterns)"]
    end

    subgraph "Ops Bus"
        Enrichment -->|"Enriched events"| OpsBus["EventBridge<br/>(Ops Bus)"]
        OpsBus -->|"Archive"| Archive["EB Archive"]
        OpsBus -->|"Rule: breaker/capability events"| ModulatorSQS["Policy Modulator<br/>Consumer"]
        OpsBus -->|"Rule: metrics"| Dashboard["CloudWatch<br/>Dashboard"]
    end

    style Enrichment fill:#4ecdc4,stroke:#333
    style OpsBus fill:#f9d71c,stroke:#333
```

---

## 6. Capability control flow (operating-policy modulation)

How a sensitive AWS-backed capability is gated and granted. Replaces an earlier stateful HITL approval flow, which was dropped as more machinery than the problem warranted. There is no pause-resume: the capability is simply absent until granted, and its absence fails the AWS call.

> [!note] Status: partly built
> Built: the grant path. The participant labelled "Policy Modulator" is API Gateway fronting a grant-shape Lambda: `POST /grants` reaches `packages/api/src/handlers/grant-shape.http.ts`, which resolves the agent through the registry, writes the grant to the ledger, and rewrites the operating policy. `DELETE /grants` is the revoke half. The deny-by-default resting state and the absence of any pause-resume step are both accurate.
> Specification: the time-boxed grant block at the end. There is no expiry sweep and no scheduler.
> Gap: the grant ledger has TTL on `expiresAt`, so DynamoDB deletes an expired grant row, and no code rewrites the operating policy when that happens. An expired grant keeps its IAM permissions after its ledger row is gone.

```mermaid
sequenceDiagram
    participant Op as Operator
    participant Mod as Policy Modulator
    participant IAM as IAM (Role operating policy)
    participant Agent as Agent Instance
    participant AWS as AWS API (e.g. S3)

    Note over IAM: Resting state: sensitive shape NOT granted

    Agent->>AWS: DeleteBucket (tool executes)
    AWS--xAgent: AccessDenied (shape not in operating policy)

    Note over Agent,AWS: Agent's own error handling / retry decides what next

    Op->>Mod: Grant "destructive-infra" shape (optionally time-boxed)
    Mod->>IAM: Rewrite operating policy (add shape statements)
    Note over IAM: Takes effect on next request (IAM propagation, seconds)

    Agent->>AWS: DeleteBucket (retry)
    AWS-->>Agent: Success (shape now granted)

    opt Time-boxed grant (Phase 3)
        Note over Mod: Grant ledger records expiry
        Mod->>IAM: Auto-revoke shape on expiry (sweep/scheduler)
    end
```

---

## 7. Event augmentation module (parallel workstream)

How agents become bus-native signal processors.

> [!note] Status: specification
> Built: the per-agent leg only. `AgentBusChannel` creates the FIFO queue, the dead-letter queue, and the rule, with `MessageGroupId` taken from the event's `correlationId`.
> Specification: the shared signals bus, its archive, the non-agent peers, and the observability edge to the ops bus. None of it is deployed.
> Gap: `AgentBusChannel` is unreachable from `packages/cdk/bin/app.ts`. It is instantiated only when a seed supplies a signals bus ARN, and the one seed in `packages/cdk/lib/config/seeds/` supplies none. The per-agent leg is written and never synthesised.

```mermaid
flowchart TB
    subgraph "Signals Bus"
        SigBus["EventBridge<br/>(Signals Bus)"]
        SigArchive["EB Archive"]
        SigBus --> SigArchive
    end

    subgraph "Agent A (SRE Ops)"
        RuleA["EB Rule<br/>(alert.*, incident.*)"]
        SQSA["SQS FIFO Queue A<br/>(GroupId: correlationId)"]
        AgentA["OpenClaw Instance<br/>(SRE config)"]
        SigBus -->|"Matching events"| RuleA
        RuleA --> SQSA
        SQSA -->|"Poll"| AgentA
        AgentA -->|"PutEvents<br/>(source: openclaw.sre)"| SigBus
    end

    subgraph "Agent B (CI/CD)"
        RuleB["EB Rule<br/>(deploy.*, build.*)"]
        SQSB["SQS FIFO Queue B<br/>(GroupId: correlationId)"]
        AgentB["OpenClaw Instance<br/>(CI/CD config)"]
        SigBus -->|"Matching events"| RuleB
        RuleB --> SQSB
        SQSB -->|"Poll"| AgentB
        AgentB -->|"PutEvents<br/>(source: openclaw.cicd)"| SigBus
    end

    subgraph "Non-Agent Peers"
        CWAlarm["CloudWatch Alarms"]
        Pipeline["CodePipeline"]
        Custom["Custom Services"]
        CWAlarm -->|"Events"| SigBus
        Pipeline -->|"Events"| SigBus
        Custom -->|"Events"| SigBus
    end

    subgraph "Governance (from Core)"
        OpsBus["Ops Bus"]
        SigBus -.->|"Observability events"| OpsBus
    end

    style SigBus fill:#f9d71c,stroke:#333
    style OpsBus fill:#4ecdc4,stroke:#333
```

---

## 8. Phase deployment progression

What exists after each phase deploys.

> [!note] Status: partly built
> Built: the Phase 1 bars for IAM roles and boundaries, inference profiles and guardrails, the policy modulator, and drift detection with SNS. The AppConfig bar is built as a deploy-time write only.
> Specification: every Phase 2, Phase 3, and Phase 4 bar, and the signals bus infrastructure bar.
> Gap: the dates are the plan as drafted in June and are not maintained. Current milestone status is in the milestone table in [Hecatoncheires.md](./Hecatoncheires.md).

```mermaid
gantt
    title Hecatoncheires Deployment Phases
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Requirements
    Requirements & Design       :done, req, 2026-06-08, 2026-06-22

    section Phase 1
    IAM Roles + Boundaries      :p1a, 2026-06-22, 7d
    Inference Profiles + Guardrails :p1b, after p1a, 5d
    AppConfig Setup             :p1c, after p1a, 5d
    Policy Modulator (breaker + shapes) :p1d, after p1b, 6d
    Drift Detection + SNS       :p1e, after p1c, 4d

    section Phase 2
    Ops Bus + Archive           :p2a, 2026-07-13, 4d
    Enrichment Lambda           :p2b, after p2a, 10d
    Dashboard                   :p2c, after p2b, 5d
    S3 Retention                :p2d, after p2a, 3d

    section Phase 3
    Time-Boxed Grants           :p3a, 2026-08-03, 7d
    Pipeline-Speed Breaker      :p3b, after p3a, 5d
    Per-Config Dashboards       :p3c, after p3a, 5d
    Hardening + Runbooks        :p3d, after p3b, 5d

    section Phase 4 (post-v1)
    Recipe Registry             :p4a, after p3d, 5d
    Pipeline Provisioning       :p4b, after p4a, 7d
    Onboarding Flow + CLI       :p4c, after p4b, 5d

    section Event Augmentation
    OpenClaw Plugin (upstream)  :done, ea1, 2026-06-22, 45d
    Signals Bus Infra           :ea2, after ea1, 10d
```

---

## 9. Data flow overview (as deployed)

Every component and edge that a `cdk deploy --all` currently creates.

> [!note] Status: built
> Built: everything drawn, on the same transcription basis as diagram 3. Alarm thresholds are synth-time constants taken from the seed JSON, so the alarms have no runtime configuration input.
> Specification: the telemetry pipeline, the fleet dashboard, and S3 retention are removed from this diagram rather than drawn as future work. They are in diagram 5. The signals bus is in diagram 7.
> Gap: the AppConfig nodes are written at deploy time and read by nothing. The SNS topic has no subscription, so the operator edge from it delivers nothing yet.

```mermaid
flowchart TB
    subgraph "Synth time"
        Seed["Seed JSON<br/>packages/cdk/lib/config/seeds/"]
        AppTs["bin/app.ts<br/>(skips non-managed seeds)"]
        Seed --> AppTs
    end

    subgraph "Agent Runtime"
        ACM["AgentCore Managed<br/>CfnHarness"]
    end

    subgraph "Identity Layer"
        Role["IAM Role<br/>hecaton-STAGE-CONFIG-agent-role"]
        Boundary["Permission Boundary<br/>(per-agent managed policy)"]
        OpPolicy["Operating Policy<br/>(inline, Deny * at rest)"]
        Role --- Boundary
        Role --- OpPolicy
    end

    subgraph "Inference Layer"
        Profile["App Inference<br/>Profile"]
        Guard["Bedrock<br/>Guardrail"]
        FM["Foundation<br/>Model"]
        Profile --> Guard
        Guard --> FM
    end

    ACM -->|"executionRoleArn"| Role
    Role -->|"conditioned on profile + guardrail"| Profile
    OpPolicy -.->|"Deny * blocks invocation until granted"| Role

    subgraph "Passive Observation"
        CWMetrics["CloudWatch Metrics<br/>AWS/Bedrock, dim InferenceProfileId"]
        CWLogs["CloudWatch Logs<br/>Bedrock invocation logs"]
        Profile -.->|"Token metrics"| CWMetrics
        FM -.->|"Invocation logs"| CWLogs
        Guard -.->|"Block/Observe"| CWLogs
    end

    subgraph "Circuit Breaker"
        Alarm["CW Alarms<br/>token, block, observation"]
        BreakerLambda["Breaker Lambda<br/>breaker-trip.alarm.ts"]
        Registry[("DynamoDB<br/>Agent Registry")]
        CWMetrics --> Alarm
        Alarm -->|"ALARM state, direct Lambda action"| BreakerLambda
        BreakerLambda -->|"resolve InferenceProfileId to roleName"| Registry
        BreakerLambda -->|"updateBreakerState"| Registry
    end

    BreakerLambda -->|"PutRolePolicy, deny-all"| OpPolicy
    Seed -.->|"thresholds are synth-time constants"| Alarm

    subgraph "Operator API"
        APIGW["API Gateway<br/>(x-api-key required)"]
        GrantL["grant-shape Lambda<br/>POST /grants"]
        RevokeL["revoke-shape Lambda<br/>DELETE /grants"]
        FleetL["query-fleet-state Lambda<br/>GET /fleet"]
        Ledger[("DynamoDB<br/>Grant Ledger")]
        APIGW --> GrantL
        APIGW --> RevokeL
        APIGW --> FleetL
        GrantL --> Ledger
        RevokeL --> Ledger
        FleetL --> Ledger
        GrantL --> Registry
        RevokeL --> Registry
        FleetL --> Registry
    end

    GrantL -->|"PutRolePolicy"| OpPolicy
    RevokeL -->|"PutRolePolicy"| OpPolicy

    subgraph "Drift Detection"
        CT["CloudTrail via<br/>default event bus"]
        DriftL["Drift Lambda<br/>drift-detect.event.ts"]
        OpPolicy -.->|"IAM mutation events"| CT
        CT --> DriftL
    end

    subgraph "Ops Bus"
        OpsBus["EventBridge<br/>(Ops Bus)"]
        Archive["EB Archive<br/>(7 days)"]
        OpsBus --> Archive
    end

    BreakerLambda --> OpsBus
    GrantL --> OpsBus
    RevokeL --> OpsBus
    DriftL --> OpsBus

    subgraph "Notification"
        SNSTopic["SNS Topic<br/>(no subscription)"]
    end

    BreakerLambda --> SNSTopic
    DriftL --> SNSTopic

    subgraph "Configuration"
        AppCfg["AppConfig application<br/>+ environment"]
        Tunables["Hosted tunables version<br/>(written at deploy, read by nothing)"]
        AppTs --> AppCfg
        AppTs --> Tunables
    end

    Operator["Operator"]
    Operator -->|"Grant/revoke, query fleet"| APIGW
    SNSTopic -.->|"Alerts, once subscribed"| Operator

    style OpsBus fill:#f9d71c,stroke:#333
    style Guard fill:#ff6b6b,stroke:#333
    style Profile fill:#4ecdc4,stroke:#333
    style OpPolicy fill:#ff6b6b,stroke:#333
```
