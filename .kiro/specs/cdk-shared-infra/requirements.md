# Requirements Document

## Introduction

This document specifies the requirements for the CDK Shared Infrastructure and Agent Identity layer of the Hecatoncheires governance platform. It covers the SharedInfraStack (account-level shared resources), the AgentConfigStack base class (per-agent configuration), the AgentIdentity construct (three-layer IAM role model), the CDK app entry point, a required upstream core change, and synthesis-time error handling.

## Glossary

| Term | Definition |
|---|---|
| SharedInfraStack | CDK stack deployed once per account/stage containing shared resources (EventBridge bus, SNS topic, DynamoDB table, API Gateway) |
| AgentConfigStack | Abstract CDK stack base class instantiated per agent configuration |
| AgentIdentity | CDK construct encapsulating the three-layer IAM role model for a single agent |
| Permission Boundary | Per-agent IAM managed policy that acts as the absolute ceiling for all role permissions |
| Operating Policy | Inline policy on the agent role, deny-by-default at rest, rewritten by the modulator to grant capabilities |
| Base Policy | Inline policy providing floor permissions (logging, profile introspection) |
| NamingGenerator | Utility from `@hecaton/core` that produces consistent resource names for a given stage/configName |
| ConfigNamePattern | Regex from `@hecaton/core` that validates agent configuration names |
| Inference Profile | Bedrock `CfnApplicationInferenceProfile` resource binding an agent to a specific model |
| Guardrail | Bedrock guardrail resource enforcing content safety policies on agent inference |
| Default Guardrail Config | Typed configuration object defining default content filters and denied topics, owned by SharedInfraStack |

## Requirements

### 1. SharedInfraStack

#### 1.1 EventBridge Bus

- 1.1.1 The SharedInfraStack shall create an EventBridge custom event bus named using `NamingGenerator` patterns for the target stage.
- 1.1.2 The SharedInfraStack shall create a 7-day archive on the ops EventBridge bus for event replay capability.

#### 1.2 SNS Topic

- 1.2.1 The SharedInfraStack shall create an SNS notification topic for operational alerts, named using `NamingGenerator` patterns.

#### 1.3 Grant Ledger Table

- 1.3.1 The SharedInfraStack shall create a DynamoDB table with partition key `configName` (String) and sort key `grantId` (String).
- 1.3.2 The SharedInfraStack shall configure the grant ledger table with PAY_PER_REQUEST (on-demand) billing mode.
- 1.3.3 The SharedInfraStack shall enable point-in-time recovery on the grant ledger table.
- 1.3.4 The SharedInfraStack shall configure a TTL attribute named `expiresAt` on the grant ledger table.
- 1.3.5 The SharedInfraStack shall set the grant ledger table removal policy to RETAIN.
- 1.3.6 The SharedInfraStack shall name the grant ledger table using `NamingGenerator` patterns for the target stage.

#### 1.4 API Gateway

- 1.4.1 The SharedInfraStack shall create an API Gateway REST API shell with `apiKeyRequired: true` at the stage level. No routes or methods are defined in this phase.
- 1.4.2 The SharedInfraStack shall name the API Gateway using `NamingGenerator` patterns for the target stage.

#### 1.5 Tagging & Naming

- 1.5.1 The SharedInfraStack shall apply standard tags (`hecatoncheires:managed=true`, `hecatoncheires:stage={stage}`, `hecatoncheires:phase=1`) to all resources via `cdk.Tags.of(this)`.
- 1.5.2 The SharedInfraStack shall generate all resource names using `NamingGenerator` from `@hecaton/core`.

#### 1.6 Cross-Stack Outputs

- 1.6.1 The SharedInfraStack shall export CfnOutputs for: opsBusArn, snsTopicArn, grantLedgerTableName, grantLedgerTableArn, apiGatewayId, and apiGatewayUrl.
- 1.6.2 The SharedInfraStack shall expose typed construct references (opsBus, snsTopic, grantLedgerTable, apiGateway, defaultGuardrailConfig) for in-app cross-stack consumption.

#### 1.7 Default Guardrail Configuration

- 1.7.1 The SharedInfraStack shall define a default guardrail policy configuration (content filters, denied topics) as a typed object.
- 1.7.2 The SharedInfraStack shall expose the default guardrail config as a typed construct reference for consumption by AgentConfigStacks.
- 1.7.3 The default guardrail config shall NOT create an AWS resource — it is configuration data only.

### 2. AgentConfigStack

#### 2.1 Configuration Validation

- 2.1.1 When constructing an AgentConfigStack, the stack shall validate `configName` against `ConfigNamePattern` from `@hecaton/core` at synthesis time.
- 2.1.2 If `configName` does not match `ConfigNamePattern`, the AgentConfigStack shall throw a synthesis error with a clear message.

#### 2.2 Inference Profile

- 2.2.1 The AgentConfigStack shall create a `CfnApplicationInferenceProfile` resource before AgentIdentity instantiation.
- 2.2.2 The AgentConfigStack shall tag the inference profile with cost attribution tags including `hecatoncheires:config={configName}`.
- 2.2.3 The AgentConfigStack shall name the inference profile using `NamingGenerator` patterns.
- 2.2.4 If `modelId` is empty, the AgentConfigStack shall fail synthesis with a descriptive error message.

#### 2.3 Guardrail

- 2.3.1 The AgentConfigStack shall create a Bedrock guardrail resource using the default guardrail config passed from SharedInfraStack, merged with any per-agent overrides.
- 2.3.2 The guardrail shall be created before AgentIdentity instantiation so that `guardrailId` is available as a CDK token.
- 2.3.3 The AgentConfigStack shall name the guardrail using `NamingGenerator` patterns.

#### 2.4 Identity Instantiation

- 2.4.1 The AgentConfigStack shall instantiate an AgentIdentity construct, passing `profileArn` and `guardrailId` from the previously-created inference profile and guardrail resources.
- 2.4.2 The AgentConfigStack shall populate the `identity` field with the AgentIdentity outputs (role, permissionBoundaryArn) after construction completes, making it available to subclass constructors.

#### 2.5 Tagging

- 2.5.1 The AgentConfigStack shall apply standard tags (`hecatoncheires:managed=true`, `hecatoncheires:config={configName}`, `hecatoncheires:stage={stage}`, `hecatoncheires:phase=1`) to the stack and all child resources.

### 3. AgentIdentity Construct

#### 3.3 Permission Boundary

- 3.3.1 The AgentIdentity construct shall create a per-agent IAM managed policy as the permission boundary, residing in the same stack as the role.
- 3.3.2 The permission boundary shall include an Allow statement for Bedrock inference actions (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:Converse`, `bedrock:ConverseStream`) conditioned on `bedrock:InferenceProfileArn` matching the agent's profile ARN and `bedrock:GuardrailIdentifier` matching the agent's guardrail ID.
- 3.3.3 The permission boundary shall include an Allow statement for `bedrock:ApplyGuardrail` conditioned on `bedrock:GuardrailIdentifier` matching the agent's guardrail ID.
- 3.3.4 The permission boundary shall include an Allow statement for `bedrock:GetInferenceProfile` conditioned on `aws:ResourceTag/hecatoncheires:managed` equaling `true`.
- 3.3.5 The permission boundary shall include Allow statements for CloudWatch Logs write actions (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`) scoped to `arn:aws:logs:*:*:log-group:/aws/bedrock/*`.
- 3.3.6 The permission boundary shall include Allow statements for CloudWatch Logs read actions (`logs:GetLogEvents`, `logs:FilterLogEvents`, `logs:DescribeLogGroups`, `logs:DescribeLogStreams`) scoped to `arn:aws:logs:*:*:log-group:/aws/bedrock/*`.
- 3.3.7 The permission boundary shall include an Allow statement for S3 actions (`s3:GetObject`, `s3:PutObject`, `s3:ListBucket`) scoped to resources `arn:aws:s3:::hecaton-*` and `arn:aws:s3:::hecaton-*/*` only.
- 3.3.8 The permission boundary shall not use `*` as a resource for any S3 statement.
- 3.3.9 The permission boundary shall resolve condition key values (`bedrock:InferenceProfileArn`, `bedrock:GuardrailIdentifier`) using the `profileArn` and `guardrailId` passed as props to AgentIdentity.

#### 3.4 IAM Role & Trust Policy

- 3.4.1 If `agentType` is `agentcore-managed` or `agentcore-runtime`, the AgentIdentity construct shall create an IAM role trusting `bedrock-agentcore.amazonaws.com` as the service principal.
- 3.4.2 If `agentType` is `openclaw`, the AgentIdentity construct shall create an IAM role trusting the IAM principal specified by `externalPrincipalArn`.
- 3.4.3 The IAM role shall trust exactly one principal — no additional principals shall be included in the trust policy.
- 3.4.4 The AgentIdentity construct shall attach the per-agent permission boundary to the IAM role.
- 3.4.5 The AgentIdentity construct shall name the IAM role using `NamingGenerator` patterns.

#### 3.5 Base Policy

- 3.5.1 The AgentIdentity construct shall attach a base inline policy to the role containing Allow for `logs:CreateLogStream` and `logs:PutLogEvents` scoped to `/aws/bedrock/*` log groups.
- 3.5.2 The base inline policy shall contain Allow for `bedrock:GetInferenceProfile` conditioned on `aws:ResourceTag/hecatoncheires:managed` equaling `true`.
- 3.5.3 The base inline policy shall not contain any Bedrock inference actions (`InvokeModel`, `InvokeModelWithResponseStream`, `Converse`, `ConverseStream`).

#### 3.6 Operating Policy

- 3.6.1 The AgentIdentity construct shall attach an operating inline policy containing exactly one statement: `{"Effect":"Deny","Action":"*","Resource":"*"}`.
- 3.6.2 The operating policy shall serve as the deny-by-default resting state, to be rewritten by the modulator in later phases.

#### 3.7 Outputs

- 3.7.1 The AgentIdentity construct shall expose outputs: `role` (IRole) and `permissionBoundaryArn`.
- 3.7.2 All output values shall be non-null after construction completes.

### 4. CDK App Entry Point

#### 4.1 Stage Resolution

- 4.1.1 The CDK app entry point shall resolve the target stage from CDK context (`app.node.tryGetContext('stage')`), defaulting to `dev` if not provided.
- 4.1.2 The CDK app entry point shall resolve `env` (account, region) from `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` environment variables.

#### 4.2 Stack Instantiation

- 4.2.1 The CDK app entry point shall instantiate one SharedInfraStack per stage with stack ID `Hecaton-{Stage}-SharedInfra`.
- 4.2.2 The CDK app entry point shall instantiate one AgentConfigStack per agent configuration with stack ID `Hecaton-{Stage}-AgentConfig-{ConfigName}`.
- 4.2.3 The CDK app entry point shall pass SharedInfraStack outputs (opsBus, snsTopic, grantLedgerTable, defaultGuardrailConfig) to each AgentConfigStack as cross-stack references.

### 5. Upstream Core Change

#### 5.1 core-invocation Shape Update

- 5.1.1 The `core-invocation` shape in `@hecaton/core` shall include all four Bedrock inference actions: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:Converse`, and `bedrock:ConverseStream`.
- 5.1.2 The `core-invocation` shape shall use `${inferenceProfileArn}` as the resource for all four inference actions.

#### 5.2 NamingGenerator Extension

- 5.2.1 The NamingGenerator shall add a `busName()` method producing pattern `hecaton-{stage}-ops-bus`.
- 5.2.2 The NamingGenerator shall add a `snsTopicName()` method producing pattern `hecaton-{stage}-notifications`.
- 5.2.3 The NamingGenerator shall add an `apiGatewayName()` method producing pattern `hecaton-{stage}-api`.

### 6. Error Handling

#### 6.1 Synthesis-Time Validation

- 6.1.1 If `configName` does not match `ConfigNamePattern`, synthesis shall fail with a descriptive error message before any resources are created.
- 6.1.2 If `agentType` is `openclaw` and `externalPrincipalArn` is empty or undefined, synthesis shall fail with a descriptive error message.
- 6.1.3 If `stage` is empty or missing from CDK context, synthesis shall fail with a descriptive error message.

---

## Deferred Items

| Item | Reason |
|---|---|
| EventBridge alarm-forwarding rule event pattern | Deferred to the event work spec — the event pattern has not been defined yet |
| SNS topic encryption (KMS) | Future enhancement |
| Tag management standardization across CDK | Follow-up spec |

---

## Traceability to Correctness Properties

| Requirement | Correctness Property |
|---|---|
| 1.5.2, 2.2.3, 2.3.3, 3.4.5, 5.2.1, 5.2.2, 5.2.3 | Property 1: Resource naming consistency |
| 3.4.1, 3.4.2, 3.4.3 | Property 2: Trust policy correctness per agent type |
| 1.5.1, 2.5.1 | Property 3: Tag propagation completeness |
| 3.3.1, 3.4.4 | Property 4: Permission boundary attachment |
| 3.6.1 | Property 5: Deny-by-default operating policy |
| 3.3.2, 3.3.9 | Property 6: Condition key enforcement on Bedrock actions |
| 3.3.2 | Property 7: Bedrock inference action completeness |
| 3.3.7, 3.3.8 | Property 8: S3 resource scoping |
| 6.1.2 | Property 9: External principal validation for openclaw |
| 2.4.2, 3.7.2 | Property 10: AgentConfigStack identity availability |
| 3.3.1, 3.4.4, 2.2.1, 2.3.1, 2.4.1 | Property 11: Resource co-location (boundary + role in AgentIdentity; profile + guardrail + identity in AgentConfigStack) |
