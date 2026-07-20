---
tags: [core/project, topic/ai, topic/aws]
created: 2026-06-08
parent: "[[Hecatoncheires]]"
status: Active
---

# Architecture diagrams

Mermaid diagrams for the Hecatoncheires platform. Renders natively in Obsidian.

---

## 1. System context (high-level)

What Hecatoncheires is and what surrounds it.

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

```mermaid
classDiagram
    class AgentTypeHarness {
        <<abstract>>
        +AgentIdentity identity
        +AgentTelemetry telemetry
        +AgentPolicyModulator modulator
        +AgentBusChannel bus
        +deploy()
    }

    class AgentIdentity {
        +IAM Role (with conditions)
        +Permission Boundary
        +App Inference Profile
        +Guardrail binding
        +tags: Map
    }

    class AgentTelemetry {
        +Log subscription filter
        +Enrichment pipeline ref
        +Profile ID mapping
    }

    class AgentPolicyModulator {
        +CloudWatch Alarms
        +Grant/Revoke engine
        +Operating policy rewrite
        +SNS notification
        +Threshold config (AppConfig ref)
        +Grant ledger (DynamoDB ref)
    }

    class AgentBusChannel {
        +EventBridge rule
        +SQS queue
        +DLQ
        +Event routing config
    }

    class AgentCoreManagedHarness {
        +CfnHarness resource
        +executionRoleArn
        +maxIterations
        +maxTokens
        +timeoutSeconds
        +allowedTools
        +systemPrompt
    }

    class OpenClawHarness {
        +plugin.json shape awareness
        +External trust principal
        +EventBridge channel config
    }

    class AgentCoreRuntimeHarness {
        +Runtime resource (L2)
        +ECR / CodeZip artifact
        +Environment variables
    }

    AgentTypeHarness *-- AgentIdentity
    AgentTypeHarness *-- AgentTelemetry
    AgentTypeHarness *-- AgentPolicyModulator
    AgentTypeHarness *-- AgentBusChannel
    AgentCoreManagedHarness --|> AgentTypeHarness
    OpenClawHarness --|> AgentTypeHarness
    AgentCoreRuntimeHarness --|> AgentTypeHarness
```

---

## 4. Circuit breaker flow (Phase 1 - alarm-based)

What happens when an agent exceeds thresholds.

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

How a sensitive AWS-backed capability is gated and granted. Replaces the earlier HITL approval flow (see [[ADR-0001-iam-operating-policy-modulator-over-hitl]]). There is no pause-resume: the capability is simply absent until granted, and its absence fails the AWS call.

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

## 9. Data flow overview (complete system)

All components, all flows, at steady state after Phase 3.

```mermaid
flowchart TB
    subgraph "Agent Runtime (anywhere)"
        OC["OpenClaw<br/>Instance"]
        ACM["AgentCore<br/>Managed Harness"]
        ACR["AgentCore<br/>Runtime"]
    end

    subgraph "Identity Layer"
        STS["STS"]
        Role["IAM Role<br/>(conditions + boundary)"]
        OC -->|"AssumeRole"| STS
        ACM -->|"AssumeRole"| STS
        ACR -->|"AssumeRole"| STS
        STS --> Role
    end

    subgraph "Inference Layer"
        Profile["App Inference<br/>Profile"]
        Guard["Bedrock<br/>Guardrail"]
        FM["Foundation<br/>Model"]
        Role --> Profile
        Profile --> Guard
        Guard --> FM
    end

    subgraph "Passive Observation"
        CWMetrics["CloudWatch<br/>Metrics"]
        CWLogs["CloudWatch<br/>Logs"]
        Profile -.->|"Token metrics"| CWMetrics
        FM -.->|"Invocation logs"| CWLogs
        Guard -.->|"Block/Observe"| CWLogs
    end

    subgraph "Policy Modulator (breaker + capability control)"
        Alarm["CW Alarm<br/>(threshold)"]
        ModLambda["Policy Modulator<br/>Lambda"]
        OpPolicy["Operating Policy<br/>(granted shapes)"]
        CWMetrics --> Alarm
        Alarm -->|"ALARM = revoke invocation shape"| ModLambda
        ModLambda -->|"Rewrite"| OpPolicy
        OpPolicy -.->|"Grants/denies at API"| Role
    end

    subgraph "Telemetry Pipeline"
        SubFilter["Subscription<br/>Filter"]
        Enrichment["Enrichment<br/>Lambda"]
        CWLogs --> SubFilter
        SubFilter --> Enrichment
    end

    subgraph "Ops Bus"
        OpsBus["EventBridge<br/>(Ops)"]
        Enrichment -->|"Enriched events"| OpsBus
        ModLambda -->|"Breaker/capability events"| OpsBus
    end

    subgraph "Control Plane"
        SNSTopic["SNS Topic"]
        Dashboard["CloudWatch<br/>Dashboard"]
        OpsBus --> Dashboard
        ModLambda --> SNSTopic
    end

    subgraph "Operator"
        Human["Operator"]
        SNSTopic -->|"Alerts"| Human
        Human -->|"Grant/revoke shapes"| ModLambda
        Human -->|"View"| Dashboard
    end

    subgraph "Configuration"
        AppCfg["AppConfig"]
        Enrichment -->|"Read sensitive-tool patterns"| AppCfg
        Alarm -.->|"Read thresholds"| AppCfg
        ModLambda -.->|"Read granted shapes"| AppCfg
        OC -->|"Read config"| AppCfg
        ACM -->|"Read config"| AppCfg
        ACR -->|"Read config"| AppCfg
    end

    subgraph "Drift Detection"
        CT["CloudTrail"]
        DriftLambda["Drift Lambda"]
        Role -.->|"IAM changes"| CT
        CT --> DriftLambda
        DriftLambda -->|"Alert"| SNSTopic
    end

    style OpsBus fill:#f9d71c,stroke:#333
    style Enrichment fill:#4ecdc4,stroke:#333
    style Guard fill:#ff6b6b,stroke:#333
    style Profile fill:#4ecdc4,stroke:#333
    style OpPolicy fill:#ff6b6b,stroke:#333
```
