# Requirements Document

## Introduction

Complete Phase 1 steps 7 and 8 of the Hecatoncheires governance platform by adding the remaining SharedInfraStack components (AppConfig integration, drift detection, Bedrock invocation logging) and the AgentBusChannel construct. These additions close the gaps identified in the deviation analysis (D1–D4) and bring the platform to full Phase 1 infrastructure readiness.

## Glossary

- **SharedInfraStack**: The CDK stack deployed once per stage containing account-level shared resources (ops bus, grant ledger, breaker Lambda, API Gateway, etc.)
- **AgentBusChannel**: A CDK construct that provisions a per-agent EventBridge rule, SQS FIFO queue, and dead-letter queue for event augmentation signal delivery
- **AppConfig_Application**: An AWS AppConfig application representing the Hecatoncheires platform configuration store within a given stage
- **AppConfig_Environment**: An AWS AppConfig environment scoped to a deployment stage (dev, staging, prod)
- **AppConfig_Profile**: An AWS AppConfig configuration profile holding the runtime tunables JSON document
- **Runtime_Tunables**: A JSON document conforming to the RuntimeTunablesSchema (thresholds + feature flags) that operators modify without CDK redeployment
- **Drift_Detection_Lambda**: A Lambda function triggered by CloudTrail events that detects unauthorized modifications to agent IAM roles
- **NamingGenerator**: The deterministic resource name generator in @hecaton/core that produces consistent, stage-aware names for all AWS resources
- **Operating_Policy**: The single inline IAM policy on an agent role, rewritten by the platform modulator from the grant ledger
- **Signals_Bus**: The EventBridge bus used for agent-to-agent event augmentation (distinct from the ops bus which is for platform observability)
- **Correlation_ID**: A unique identifier propagated through event chains to maintain causal ordering in FIFO queues
- **Permission_Boundary**: The per-agent IAM managed policy that sets the absolute ceiling of allowed actions

## Requirements

### Requirement 1: AppConfig Application and Environment Provisioning

**User Story:** As a platform operator, I want AppConfig infrastructure deployed per stage, so that I have a runtime configuration store independent of CDK deployments.

#### Acceptance Criteria

1. WHEN the SharedInfraStack is deployed, THE SharedInfraStack SHALL create an AppConfig_Application named using the pattern `hecaton-{stage}-platform` via the NamingGenerator
2. WHEN the SharedInfraStack is deployed, THE SharedInfraStack SHALL create an AppConfig_Environment associated with the AppConfig_Application, named with the stage value (e.g., `dev`, `staging`, `prod`)
3. THE SharedInfraStack SHALL expose the AppConfig_Application ID and AppConfig_Environment ID as CfnOutputs for cross-stack consumption
4. THE SharedInfraStack SHALL apply standard Hecatoncheires tags (`hecatoncheires:managed`, `hecatoncheires:stage`, `hecatoncheires:phase`) to the AppConfig_Application

### Requirement 2: AppConfig Runtime Tunables Configuration Profile

**User Story:** As a platform operator, I want per-agent runtime tunables stored in AppConfig, so that I can adjust thresholds and feature flags without redeploying infrastructure.

#### Acceptance Criteria

1. WHEN an AgentConfigStack is deployed, THE AgentConfigStack SHALL create an AppConfig_Profile within the shared AppConfig_Application for the agent's configuration
2. THE AppConfig_Profile SHALL store a JSON document conforming to the RuntimeTunablesSchema defined in @hecaton/core (thresholds: outputTokensPerHour, guardrailBlocksPer10Min, guardrailObservationsPerHour; featureFlags: pipelineSpeedBreaker, timeBoxedGrants)
3. THE AppConfig_Profile SHALL be initialized with the threshold values provided in the AgentConfigStack props as its initial hosted configuration version
4. WHEN the AppConfig_Profile document is deployed, THE AppConfig_Application SHALL use a deployment strategy with a duration of zero seconds for immediate availability in dev stage and a linear 10-minute rollout for staging and prod stages
5. THE NamingGenerator SHALL provide a method for generating the AppConfig profile name following the pattern `hecaton-{stage}-{configName}-tunables`

### Requirement 3: Drift Detection Lambda

**User Story:** As a security operator, I want automated detection of unauthorized IAM role modifications, so that I am alerted when agent roles are tampered with outside the platform.

#### Acceptance Criteria

1. WHEN the SharedInfraStack is deployed, THE SharedInfraStack SHALL create a Drift_Detection_Lambda with Node.js 20 runtime and ARM64 architecture
2. THE SharedInfraStack SHALL create an EventBridge rule on the default event bus that matches CloudTrail IAM mutation events (PutRolePolicy, DeleteRolePolicy, AttachRolePolicy, DetachRolePolicy, PutRolePermissionsBoundary, DeleteRolePermissionsBoundary) targeting role names matching the pattern `hecaton-{stage}-*-agent-role`
3. WHEN the EventBridge rule matches a CloudTrail event, THE Drift_Detection_Lambda SHALL be invoked with the event payload
4. WHEN the Drift_Detection_Lambda is invoked, THE Drift_Detection_Lambda SHALL check whether the event's `userIdentity.arn` matches a known platform principal (the Breaker Lambda role ARN, the Grant Shape Lambda role ARN, or the Revoke Shape Lambda role ARN)
5. IF the modifying principal is not a known platform principal, THEN THE Drift_Detection_Lambda SHALL publish a notification to the SNS topic with a message containing the role name, modifying principal ARN, API action, and timestamp
6. IF the modifying principal is not a known platform principal, THEN THE Drift_Detection_Lambda SHALL emit an event to the ops EventBridge bus with detail-type `drift.detected` and source `hecatoncheires.drift`
7. IF the modifying principal is a known platform principal, THEN THE Drift_Detection_Lambda SHALL take no alerting action
8. THE Drift_Detection_Lambda SHALL have IAM permissions scoped to: reading CloudTrail events (via the EventBridge rule, no additional permission needed), publishing to the SNS topic, and putting events on the ops bus

### Requirement 4: Bedrock Invocation Logging Configuration

**User Story:** As a platform operator, I want Bedrock model invocation logging enabled at the account level, so that invocation logs flow to CloudWatch Logs for the Phase 2 telemetry pipeline.

#### Acceptance Criteria

1. WHEN the SharedInfraStack is deployed, THE SharedInfraStack SHALL configure Bedrock model invocation logging to deliver logs to a CloudWatch Logs log group named `/aws/bedrock/invocations/{stage}`
2. THE SharedInfraStack SHALL create the target CloudWatch Logs log group with a retention period of 30 days
3. THE SharedInfraStack SHALL grant the Bedrock service principal write access to the log group via a resource policy
4. THE SharedInfraStack SHALL expose the log group ARN as a CfnOutput for consumption by the Phase 2 telemetry stack
5. IF Bedrock invocation logging is already enabled for the account, THEN THE SharedInfraStack SHALL not fail deployment (the configuration is idempotent)

### Requirement 5: AgentBusChannel Construct — Queue Infrastructure

**User Story:** As a platform developer, I want a reusable CDK construct for per-agent event delivery infrastructure, so that each agent can receive filtered events via a dedicated FIFO queue.

#### Acceptance Criteria

1. THE AgentBusChannel construct SHALL accept props: configName (string), signalsBusArn (string), sourceNamespace (string), subscriptionPatterns (optional array of EventPattern objects), agentRole (iam.IRole), and stage (string)
2. WHEN the AgentBusChannel construct is instantiated, THE AgentBusChannel SHALL create an SQS FIFO queue named using the NamingGenerator pattern `hecaton-{stage}-{configName}-signals.fifo`
3. WHEN the AgentBusChannel construct is instantiated, THE AgentBusChannel SHALL create a dead-letter queue (FIFO) named using the NamingGenerator pattern `hecaton-{stage}-{configName}-signals-dlq.fifo`
4. THE AgentBusChannel SHALL configure the signals queue with a maxReceiveCount of 3 before messages are routed to the dead-letter queue
5. THE AgentBusChannel SHALL set a message retention period of 14 days on both the signals queue and the dead-letter queue
6. THE AgentBusChannel SHALL set a visibility timeout of 60 seconds on the signals queue
7. THE AgentBusChannel SHALL grant the agent role consume permissions (sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes) on the signals queue

### Requirement 6: AgentBusChannel Construct — EventBridge Routing

**User Story:** As a platform developer, I want per-agent EventBridge rules that route matching events to the agent's FIFO queue, so that agents receive only the events they subscribe to with causal ordering preserved.

#### Acceptance Criteria

1. WHEN subscriptionPatterns are provided, THE AgentBusChannel SHALL create an EventBridge rule on the signals bus that matches events using the provided patterns combined with a source filter for the sourceNamespace
2. THE AgentBusChannel SHALL configure the EventBridge rule target to deliver matching events to the agent's SQS FIFO queue
3. THE AgentBusChannel SHALL set the MessageGroupId on the SQS target to the value of `$.detail.correlationId` from the event payload for causal ordering per chain
4. WHEN subscriptionPatterns are not provided, THE AgentBusChannel SHALL create a rule that matches all events from the sourceNamespace on the signals bus
5. THE AgentBusChannel SHALL configure a dead-letter queue on the EventBridge rule target for delivery failures
6. THE AgentBusChannel SHALL apply standard Hecatoncheires tags to all created resources (queue, DLQ, rule)
7. THE AgentBusChannel SHALL expose outputs: the signals queue (sqs.IQueue), the dead-letter queue (sqs.IQueue), and the EventBridge rule (events.IRule)

### Requirement 7: NamingGenerator Extensions

**User Story:** As a platform developer, I want the NamingGenerator to produce names for AppConfig and drift detection resources, so that all resource naming remains centralized and deterministic.

#### Acceptance Criteria

1. THE NamingGenerator SHALL provide an `appConfigApplicationName` method returning a name following the pattern `hecaton-{stage}-platform`
2. THE NamingGenerator SHALL provide an `appConfigEnvironmentName` method returning a name following the pattern `hecaton-{stage}-{environmentName}` where environmentName defaults to the stage value
3. THE NamingGenerator SHALL provide an `appConfigProfileName` method accepting a configName parameter and returning a name following the pattern `hecaton-{stage}-{configName}-tunables`
4. THE NamingGenerator SHALL provide a `driftDetectionLambdaName` method returning a name following the pattern `hecaton-{stage}-drift-detection`
5. THE NamingGenerator SHALL provide a `bedrockLogGroupName` method returning a name following the pattern `/aws/bedrock/invocations/{stage}`

### Requirement 8: CDK Assertion Tests

**User Story:** As a platform developer, I want CDK assertion tests for all new constructs and stack additions, so that infrastructure correctness is verified before deployment.

#### Acceptance Criteria

1. WHEN the AppConfig resources are synthesized, THE test suite SHALL verify the template contains an AppConfig Application, Environment, and ConfigurationProfile with correct naming
2. WHEN the drift detection resources are synthesized, THE test suite SHALL verify the template contains an EventBridge rule matching the specified CloudTrail events, a Lambda function, and correct IAM permissions
3. WHEN the Bedrock logging resources are synthesized, THE test suite SHALL verify the template contains a CloudWatch Logs log group with the correct retention and name
4. WHEN the AgentBusChannel construct is synthesized, THE test suite SHALL verify the template contains an SQS FIFO queue, a DLQ, an EventBridge rule with the correct event pattern, and the SQS target with MessageGroupId configuration
5. WHEN the AgentBusChannel construct is synthesized with no subscriptionPatterns, THE test suite SHALL verify the rule matches all events from the sourceNamespace
6. THE test suite SHALL verify that the agent role receives sqs:ReceiveMessage, sqs:DeleteMessage, and sqs:GetQueueAttributes permissions on the signals queue
