# Requirements Document

## Introduction

This feature delivers Bundle A of Hecatoncheires Phase 1 remaining work: the AgentPolicyModulator CDK construct and API Gateway method wiring. The modulator is the breaker and capability control engine that creates CloudWatch alarms, a modulator Lambda, and orchestrates operating policy rewrites on agent roles. The API Gateway wiring connects existing Lambda handlers to the API Gateway shell with API key authentication.

## Glossary

- **agentId**: A UUIDv7 identifier serving as the external-facing primary key for an agent configuration. Generated server-side on first registration (either via CDK deploy or onboard-agent API call). Clients use agentId in all API interactions; internal details (configName, roleName, profileEntityId) are resolved via the Agent_Registry.
- **Breaker_Lambda**: The single shared Lambda function that handles CloudWatch alarm events for all agent configurations. It resolves the inference profile entity ID from the alarm dimensions to the target agent's configName and roleName via the Agent_Registry, then writes a deny-all operating policy.
- **Agent_Registry**: A DynamoDB table (`hecaton-{stage}-agent-registry`) using single-table design with overloaded keys. Stores agent configuration metadata and provides reverse-lookup from inference profile entity ID to configName and roleName. Designed for future extensibility (fleet queries, lifecycle state, telemetry resolution).
- **Operating_Policy**: The single inline IAM policy on an agent role that the Breaker_Lambda rewrites. Deny-by-default at rest; Allow statements assembled from active grants.
- **Grant_Ledger**: The DynamoDB table storing active capability grants per agent configuration (partition key: configName, sort key: grantId).
- **Shape_Catalog**: The immutable registry of capability shape templates in `@hecaton/core` that map shape names to IAM statement templates.
- **Breaker_Trip**: An emergency path triggered by a CloudWatch alarm entering ALARM state. The shared Breaker_Lambda resolves the alarm's inference profile dimension to the agent's configName and roleName via the Agent_Registry, then writes a deny-all operating policy.
- **AgentPolicyModulator_Construct**: The CDK L3 construct that composes CloudWatch alarms for a single agent configuration. The alarms target the shared Breaker_Lambda in SharedInfraStack. The construct also writes the agent's registry record (metadata + profile reverse-lookup) to the Agent_Registry table.
- **API_Gateway_Shell**: The existing API Gateway resource in SharedInfraStack. This bundle upgrades it from L1 CfnRestApi to L2 RestApi to enable proper method integration, deployment stages, and usage plan management.
- **Usage_Plan**: An API Gateway usage plan with an associated API key used for Phase 1 authentication.
- **NodejsFunction**: The CDK construct that bundles TypeScript Lambda handlers using esbuild.
- **Ops_Bus**: The custom EventBridge bus for operational events, created by SharedInfraStack.
- **SNS_Topic**: The notification topic created by SharedInfraStack, used for breaker trip alerts.
- **SharedInfraStack**: The account-level CDK stack providing foundational resources (ops bus, SNS topic, grant ledger table, agent registry table, API Gateway shell, and the shared Breaker_Lambda).
- **AgentConfigStack**: The abstract per-agent CDK stack that creates the inference profile, guardrail, and AgentIdentity construct.
- **NamingGenerator**: The deterministic name generator in `@hecaton/core` that produces consistent resource names from stage and configName.
- **RegistrySeed_Lambda**: A thin custom resource Lambda deployed by the AgentPolicyModulator_Construct that handles Agent_Registry record lifecycle (create, update, delete). On create, it generates a UUIDv7 agentId and writes all registry records via DynamoDB TransactWriteItems. On update, it reads the existing agentId, cleans up stale profile reverse-lookup records, and rewrites records with updated values. On delete, it removes all records for the agent.

## Requirements

### Requirement 1: CloudWatch Alarm Creation

**User Story:** As a platform operator, I want per-agent CloudWatch alarms that monitor token usage and guardrail violation rates, so that runaway agents trigger automatic breaker trips.

#### Acceptance Criteria

1. WHEN an AgentPolicyModulator_Construct is instantiated, THE AgentPolicyModulator_Construct SHALL create a CloudWatch metric alarm named `hecaton-{stage}-{configName}-token-alarm` that evaluates the Sum statistic of the `OutputTokenCount` metric in the `AWS/Bedrock` namespace over a 1-hour period (3600 seconds), using ComparisonOperator GreaterThanOrEqualToThreshold against the `outputTokensPerHour` threshold from the construct props, with 1 evaluation period and 1 datapoint to alarm.
2. WHEN an AgentPolicyModulator_Construct is instantiated, THE AgentPolicyModulator_Construct SHALL create a CloudWatch metric alarm named `hecaton-{stage}-{configName}-block-alarm` that evaluates the Sum statistic of the `GuardrailBlocked` metric in the `AWS/Bedrock` namespace over a 10-minute period (600 seconds), using ComparisonOperator GreaterThanOrEqualToThreshold against the `guardrailBlocksPer10Min` threshold from the construct props, with 1 evaluation period and 1 datapoint to alarm.
3. WHEN an AgentPolicyModulator_Construct is instantiated, THE AgentPolicyModulator_Construct SHALL create a CloudWatch metric alarm named `hecaton-{stage}-{configName}-observation-alarm` that evaluates the Sum statistic of the `GuardrailObserved` metric in the `AWS/Bedrock` namespace over a 1-hour period (3600 seconds), using ComparisonOperator GreaterThanOrEqualToThreshold against the `guardrailObservationsPerHour` threshold from the construct props, with 1 evaluation period and 1 datapoint to alarm.
4. THE AgentPolicyModulator_Construct SHALL configure each alarm with a metric dimension filtering on the inference profile entity ID (`InferenceProfileId`) corresponding to the agent's assigned inference profile, so that alarm evaluation is scoped to metrics generated by the governed agent only.
5. WHEN any of the three alarms transitions to ALARM state, THE alarm SHALL invoke the shared Breaker_Lambda (deployed in SharedInfraStack) as its alarm action target.
6. THE AgentPolicyModulator_Construct SHALL configure each alarm with treatMissingData set to `notBreaching`, so that alarms do not fire during periods of agent inactivity or before the first metric data arrives.
7. THE AgentPolicyModulator_Construct SHALL add a resource-based policy (Lambda permission) on the Breaker_Lambda granting `lambda:InvokeFunction` to the CloudWatch service principal (`lambda.amazonaws.com`), scoped to the alarm ARNs created by this construct, so that alarms in the AgentConfigStack can invoke the Breaker_Lambda in SharedInfraStack across stack boundaries.

### Requirement 2: Grant/Revoke Use-Case Behavior

**User Story:** As a platform operator, I want the operating policy to be reassembled and written when grants change, so that agent permissions stay in sync with the grant ledger.

#### Acceptance Criteria

1. WHEN the grant-shape or revoke-shape handler receives a request, THE handler SHALL resolve the agentId to configName and roleName by querying the Agent_Registry.
2. WHEN the handler has resolved the agent's identity, THE handler SHALL query the Grant_Ledger for all active grants for the resolved configName.
3. WHEN the Grant_Ledger returns one or more grants, THE handler SHALL resolve each grant against the Shape_Catalog and assemble a complete IAM policy document that conforms to the IamPolicyDocument schema and does not exceed 10,240 bytes (UTF-8 serialized JSON).
4. WHEN the assembled policy document passes schema and size validation, THE handler SHALL write the policy to the agent role using IAM PutRolePolicy with the policy name `hecaton-operating-policy`.
5. WHEN the Grant_Ledger returns zero grants for the configName, THE handler SHALL write a deny-all operating policy containing a single statement (Effect: Deny, Action: *, Resource: *) using IAM PutRolePolicy with the policy name `hecaton-operating-policy`.
6. WHEN the policy write succeeds, THE handler SHALL emit a GrantChanged event to the Ops_Bus on a best-effort basis, containing at minimum the agentId, configName, grantId, shapeName, action performed, and an ISO-8601 timestamp.
7. IF the assembled policy exceeds 10,240 bytes, THEN THE handler SHALL reject the operation, roll back the newly written grant from the Grant_Ledger, and return an error indicating the policy size limit was exceeded.
8. IF the GrantChanged event emission fails, THEN THE handler SHALL complete the operation successfully without propagating the emission error.
9. IF a grant references a shapeName not present in the Shape_Catalog during policy assembly, THEN THE handler SHALL abort the operation and return an error indicating the unknown shape name.
10. IF the Agent_Registry lookup fails to resolve the agentId, THEN THE handler SHALL return an error response indicating the agent was not found.

### Requirement 3: Breaker Lambda — Breaker Trip Path

**User Story:** As a platform operator, I want the breaker trip to immediately revoke agent invocation permission without querying the ledger, so that runaway agents are halted within minutes.

#### Acceptance Criteria

1. WHEN the Breaker_Lambda receives a CloudWatch alarm state change event with `newStateValue` of ALARM, THE Breaker_Lambda SHALL extract the inference profile entity ID from the alarm's metric dimensions.
2. WHEN the Breaker_Lambda extracts a valid inference profile entity ID, THE Breaker_Lambda SHALL query the Agent_Registry to resolve the profileEntityId to the agent's configName and roleName.
3. WHEN the Agent_Registry returns a valid configName and roleName, THE Breaker_Lambda SHALL write a deny-all inline operating policy (Version "2012-10-17", single Statement with Effect "Deny", Action "*", Resource "*") to the agent role identified by the resolved roleName, using the policy name from the OPERATING_POLICY_NAME environment variable, without querying the Grant_Ledger.
4. WHEN the Breaker_Lambda completes a breaker trip policy write, THE Breaker_Lambda SHALL emit a breaker-tripped event to the Ops_Bus with detailType "BreakerTripped" containing configName, roleName, alarm name, reason, and an ISO 8601 timestamp, on a best-effort basis (emission failure SHALL NOT cause the Lambda invocation to fail).
5. WHEN the Breaker_Lambda completes a breaker trip policy write, THE Breaker_Lambda SHALL publish a notification to the SNS_Topic containing the configName, alarm name, and reason, on a best-effort basis (publish failure SHALL NOT cause the Lambda invocation to fail).
6. IF the alarm event does not contain an extractable inference profile entity ID in its metric dimensions, THEN THE Breaker_Lambda SHALL log the full event payload at ERROR level and return successfully without throwing (preventing Lambda retry).
7. IF the Agent_Registry lookup fails to resolve the profile entity ID to a configName and roleName, THEN THE Breaker_Lambda SHALL log the unresolvable profile ID at ERROR level and return successfully without throwing.
8. WHEN the Breaker_Lambda receives a state transition with value OK or INSUFFICIENT_DATA, THE Breaker_Lambda SHALL return successfully without invoking any use-case or writing any policy.
9. IF the deny-all policy write to IAM fails, THEN THE Breaker_Lambda SHALL propagate the error (throw), allowing the Lambda runtime to retry the invocation according to the configured retry policy.
10. WHEN the Breaker_Lambda completes a breaker trip policy write, THE Breaker_Lambda SHALL update the agent's metadata record in the Agent_Registry, setting `breakerState` to "tripped", `status` to "breaker-tripped", and `updatedAt` to the current ISO 8601 timestamp.

### Requirement 4: Breaker Lambda IAM Permissions

**User Story:** As a platform operator, I want the breaker Lambda to have precisely scoped permissions, so that it can perform its duties without excessive privilege.

#### Acceptance Criteria

1. THE SharedInfraStack SHALL grant the Breaker_Lambda read and update access to the Agent_Registry table (dynamodb:Query, dynamodb:GetItem, dynamodb:UpdateItem) scoped to the table ARN and its index ARNs.
2. THE SharedInfraStack SHALL grant the Breaker_Lambda permission to write the operating policy on agent roles (iam:PutRolePolicy) scoped to roles matching the ARN pattern `arn:aws:iam::{account}:role/hecaton-{stage}-*-agent-role`.
3. THE SharedInfraStack SHALL grant the Breaker_Lambda permission to emit events to the Ops_Bus (events:PutEvents) scoped to the bus ARN.
4. THE SharedInfraStack SHALL grant the Breaker_Lambda permission to publish to the SNS_Topic (sns:Publish) scoped to the topic ARN.
5. THE SharedInfraStack SHALL configure the Breaker_Lambda execution role with CloudWatch Logs write permissions (logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents) scoped to the Lambda's own log group ARN.
6. THE SharedInfraStack SHALL NOT grant the Breaker_Lambda execution role any policy statement with a wildcard (*) resource except for the role ARN pattern in criterion 2.

### Requirement 5: Breaker Lambda Bundling and Configuration

**User Story:** As a developer, I want the breaker Lambda to be bundled and configured using the same patterns as existing handlers, so that infrastructure remains consistent.

#### Acceptance Criteria

1. THE SharedInfraStack SHALL deploy the Breaker_Lambda using CDK NodejsFunction with the handler entry point at `packages/api/src/handlers/breaker-trip.alarm.ts`.
2. THE SharedInfraStack SHALL configure the Breaker_Lambda with environment variables: AGENT_REGISTRY_TABLE_NAME, OPS_BUS_ARN, SNS_TOPIC_ARN, and OPERATING_POLICY_NAME.
3. THE SharedInfraStack SHALL name the Breaker_Lambda using the NamingGenerator pattern `hecaton-{stage}-breaker-trip`.
4. THE SharedInfraStack SHALL apply standard Hecatoncheires tags to the Breaker_Lambda: hecatoncheires:managed, hecatoncheires:stage, hecatoncheires:phase.
5. THE SharedInfraStack SHALL configure the Breaker_Lambda with Node.js 20 runtime, a timeout of 30 seconds, memory size of 256 MB, and architecture set to arm64 (Graviton2).

### Requirement 6: AgentPolicyModulator Construct Outputs

**User Story:** As a CDK stack author, I want the AgentPolicyModulator construct to expose its resources as typed outputs, so that other constructs and stacks can reference them.

#### Acceptance Criteria

1. THE AgentPolicyModulator_Construct SHALL expose the three CloudWatch alarms as `tokenAlarm`, `blockAlarm`, and `observationAlarm` (each typed as `cloudwatch.IAlarm`) in a readonly `outputs` property typed as a named exported `AgentPolicyModulatorOutputs` interface.
2. THE AgentPolicyModulator_Construct SHALL accept its props through a typed exported `AgentPolicyModulatorProps` interface including: `configName` (string), `profileEntityId` (string), `profileArn` (string), `modelId` (string), `agentRole` (iam.IRole), `agentType` (string), `guardrailId` (string), `breakerLambda` (lambda.IFunction), `agentRegistryTable` (dynamodb.ITable), `stage` (string), and `thresholds` (an object with `outputTokensPerHour`, `guardrailBlocksPer10Min`, and `guardrailObservationsPerHour`, each a positive integer).
3. WHEN construction completes, THE AgentPolicyModulator_Construct SHALL have populated all fields in `outputs` with non-null values such that consuming constructs can reference them without additional null checks.
4. IF `configName` is an empty string, `profileEntityId` is an empty string, or `thresholds` contains a value that is not a positive integer, THEN THE AgentPolicyModulator_Construct SHALL throw a descriptive error during CDK synthesis.
5. THE AgentPolicyModulator_Construct SHALL deploy a thin custom resource Lambda (RegistrySeed_Lambda) using the CDK Provider framework that manages Agent_Registry records across the stack lifecycle (create, update, delete).
6. ON CREATE, THE RegistrySeed_Lambda SHALL generate a UUIDv7 agentId, then write all three registry records (agent metadata, profile reverse-lookup, config reverse-lookup) in a single DynamoDB TransactWriteItems call with a condition expression (`attribute_not_exists(pk)`) on the metadata record to ensure idempotency on retries.
7. ON CREATE, THE RegistrySeed_Lambda SHALL return the generated agentId as a custom resource output attribute so that CDK can surface it as a CfnOutput or pass it to other constructs.
8. ON UPDATE, THE RegistrySeed_Lambda SHALL read the existing agent metadata record to retrieve the current agentId and the previous profileEntityId, then: (a) delete the old profile reverse-lookup record if profileEntityId changed, (b) write updated metadata, profile reverse-lookup, and config reverse-lookup records using TransactWriteItems with the preserved agentId.
9. ON DELETE, THE RegistrySeed_Lambda SHALL delete all three registry records (metadata, profile reverse-lookup, config reverse-lookup) for the agent using TransactWriteItems, ensuring clean deprovisioning.
10. THE RegistrySeed_Lambda SHALL write the following fields in the agent metadata record (PK = `AGENT#{agentId}`, SK = `#META`): agentId (UUIDv7, generated once on first deploy), configName, roleName (derived from `agentRole.roleName`), profileEntityId, profileArn, agentType, modelId, guardrailId, status (set to "active"), breakerState (set to "armed"), createdAt (ISO 8601 timestamp, set only on create, preserved on update), and updatedAt (ISO 8601 timestamp, set on every write).
11. THE RegistrySeed_Lambda SHALL write the following fields in the profile reverse-lookup record (PK = `PROFILE#{profileEntityId}`, SK = `AGENT#{agentId}`): agentId, configName, and roleName.
12. THE RegistrySeed_Lambda SHALL write the following fields in the config reverse-lookup record (PK = `CONFIG#{configName}`, SK = `AGENT#{agentId}`): agentId.
13. THE AgentPolicyModulator_Construct SHALL configure the RegistrySeed_Lambda with an IAM policy granting dynamodb:PutItem, dynamodb:GetItem, dynamodb:DeleteItem, and dynamodb:TransactWriteItems scoped to the Agent_Registry table ARN.
14. THE AgentPolicyModulator_Construct SHALL configure the RegistrySeed_Lambda with Node.js 20 runtime, arm64 architecture, 128 MB memory, and 30-second timeout.
15. THE AgentPolicyModulator_Construct SHALL expose the generated `agentId` as a CfnOutput named `{stackId}-agentId` so operators and automation can discover the external identifier for a CDK-deployed agent.

### Requirement 7: API Gateway Method Wiring

**User Story:** As a platform operator, I want the Lambda handlers exposed via API Gateway endpoints, so that I can manage agent capabilities through HTTP requests.

#### Acceptance Criteria

1. WHEN the CDK stack is synthesized, THE CDK_Stack SHALL create an API Gateway POST method at the `/grants` resource path integrated with the grant-shape.http Lambda handler using AWS_PROXY integration type.
2. WHEN the CDK stack is synthesized, THE CDK_Stack SHALL create an API Gateway DELETE method at the `/grants` resource path integrated with the revoke-shape.http Lambda handler using AWS_PROXY integration type.
3. WHEN the CDK stack is synthesized, THE CDK_Stack SHALL create an API Gateway GET method at the `/fleet` resource path integrated with the query-fleet-state.http Lambda handler using AWS_PROXY integration type.
4. THE CDK_Stack SHALL NOT expose the onboard-agent.http endpoint in Phase 1. Agent registration is handled exclusively via CDK deployment (RegistrySeed_Lambda). The onboard-agent endpoint will be introduced in Phase 4 (self-service provisioning) when API-based agent creation is supported.
5. THE CDK_Stack SHALL deploy each HTTP handler Lambda using CDK NodejsFunction with the entry point at the corresponding handler file in `packages/api/src/handlers/`, configured with Node.js 20 runtime, 256 MB memory, arm64 architecture, and 30-second timeout.
6. THE CDK_Stack SHALL create a single API Gateway deployment and stage (named after the deployment stage, e.g. "dev") so that all endpoints are accessible via a single base URL.
7. THE CDK_Stack SHALL upgrade the API Gateway from the existing L1 CfnRestApi to an L2 RestApi construct to enable proper method integration, automatic deployment management, and usage plan association via CDK's built-in APIs.

### Requirement 8: API Gateway Authentication

**User Story:** As a platform operator, I want the API to be protected by an API key, so that only authorized callers can manage agent capabilities.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create an API Gateway usage plan associated with the REST API and its deployment stage, with no throttle or quota limits configured (unlimited usage within AWS service defaults).
2. THE CDK_Stack SHALL create an API key and associate it with the usage plan.
3. THE CDK_Stack SHALL configure all API Gateway methods defined in the stack to require an API key (`apiKeyRequired: true`), so that API Gateway rejects requests missing a valid `x-api-key` header before they reach the Lambda handler.
4. THE CDK_Stack SHALL export the API key value as a CloudFormation output named following the existing stack export pattern (`{stackId}-apiKeyValue`), so operators can retrieve it via `aws cloudformation describe-stacks` after deployment.
5. IF a request is received without a valid `x-api-key` header, THEN THE API_Gateway SHALL return an HTTP 403 response without invoking the downstream Lambda function.

### Requirement 9: HTTP Handler Lambda Permissions

**User Story:** As a developer, I want each HTTP handler Lambda to have the IAM permissions needed to access its dependencies, so that runtime calls to DynamoDB, IAM, and EventBridge succeed.

#### Acceptance Criteria

1. THE CDK_Stack SHALL grant the grant-shape.http Lambda read and write access to the Grant_Ledger table (dynamodb:PutItem, dynamodb:Query, dynamodb:DeleteItem) scoped to the table ARN.
2. THE CDK_Stack SHALL grant the grant-shape.http and revoke-shape.http Lambdas permission to write IAM policies on agent roles (iam:PutRolePolicy) scoped to roles matching the ARN pattern `arn:aws:iam::{account}:role/hecaton-{stage}-*-agent-role`.
3. THE CDK_Stack SHALL grant all HTTP handler Lambdas permission to emit events to the Ops_Bus (events:PutEvents) scoped to the bus ARN.
4. THE CDK_Stack SHALL configure the grant-shape.http, revoke-shape.http, and query-fleet-state.http handler Lambdas with environment variables: GRANT_LEDGER_TABLE_NAME, OPS_BUS_ARN, OPERATING_POLICY_NAME, and AGENT_REGISTRY_TABLE_NAME.
5. THE CDK_Stack SHALL grant the revoke-shape.http Lambda read and write access to the Grant_Ledger table (dynamodb:Query, dynamodb:DeleteItem) scoped to the table ARN.
6. THE CDK_Stack SHALL grant the query-fleet-state.http Lambda read access to the Grant_Ledger table (dynamodb:Scan) scoped to the table ARN.
7. THE CDK_Stack SHALL grant the grant-shape.http, revoke-shape.http, and query-fleet-state.http Lambdas read access to the Agent_Registry table (dynamodb:Query, dynamodb:GetItem) scoped to the table ARN, so they can resolve agentId to internal details when processing requests.

### Requirement 10: CDK Assertion Tests

**User Story:** As a developer, I want CDK assertion tests for both the AgentPolicyModulator construct and the API Gateway wiring, so that infrastructure changes are validated before deployment.

#### Acceptance Criteria

1. WHEN the AgentPolicyModulator construct test suite runs, THE test suite SHALL verify that the synthesized template contains exactly three `AWS::CloudWatch::Alarm` resources with correct MetricName values (`OutputTokenCount`, `GuardrailBlocked`, `GuardrailObserved`), correct Namespace (`AWS/Bedrock`), and correct Period values (3600, 600, 3600 respectively).
2. WHEN the AgentPolicyModulator construct test suite runs, THE test suite SHALL verify that the synthesized template contains a custom resource (`AWS::CloudFormation::CustomResource`) with properties including configName, profileEntityId, roleName, agentType, and guardrailId.
3. WHEN the AgentPolicyModulator construct test suite runs, THE test suite SHALL verify that the RegistrySeed_Lambda's IAM policy grants dynamodb:PutItem, dynamodb:GetItem, dynamodb:DeleteItem, and dynamodb:TransactWriteItems scoped to the Agent_Registry table ARN.
4. WHEN the AgentPolicyModulator construct test suite runs, THE test suite SHALL verify that each alarm's AlarmActions property references the Breaker_Lambda ARN (cross-stack reference).
5. WHEN the API Gateway wiring test suite runs, THE test suite SHALL verify that the synthesized template contains `AWS::ApiGateway::Method` resources for POST /grants, DELETE /grants, and GET /fleet, each with Integration.Type AWS_PROXY.
6. WHEN the API Gateway wiring test suite runs, THE test suite SHALL verify that a `AWS::ApiGateway::UsagePlan`, `AWS::ApiGateway::ApiKey`, and `AWS::ApiGateway::UsagePlanKey` exist in the synthesized template.
7. WHEN the API Gateway wiring test suite runs, THE test suite SHALL verify that all `AWS::ApiGateway::Method` resources have `ApiKeyRequired` set to true.
8. WHEN the API Gateway wiring test suite runs, THE test suite SHALL verify that the synthesized template contains an `AWS::ApiGateway::RestApi` resource (L2 construct output) with the correct name from NamingGenerator and `ApiKeySourceType` set to `HEADER`.
9. WHEN the SharedInfraStack test suite runs, THE test suite SHALL verify that the synthesized template contains an `AWS::DynamoDB::Table` resource for the agent registry with correct key schema (pk/sk), PAY_PER_REQUEST billing, PITR enabled, and a GSI named `gsi1`.
10. WHEN the SharedInfraStack test suite runs, THE test suite SHALL verify that the Breaker_Lambda has environment variables AGENT_REGISTRY_TABLE_NAME, OPS_BUS_ARN, SNS_TOPIC_ARN, and OPERATING_POLICY_NAME.

### Requirement 11: Breaker Lambda Handler Entry Point

**User Story:** As a developer, I want the breaker handler to follow the same handler pattern as existing API handlers, so that code conventions remain consistent.

#### Acceptance Criteria

1. WHEN the Breaker_Lambda receives a CloudWatch alarm event, THE handler SHALL parse the event and extract the inference profile entity ID from the alarm's metric dimensions.
2. WHEN the handler extracts a valid profile entity ID, THE handler SHALL query the Agent_Registry table with PK = `PROFILE#{profileEntityId}` to resolve the agentId, configName, and roleName.
3. WHEN the Agent_Registry returns a valid record, THE handler SHALL call the trip-breaker use-case with the resolved configName and roleName.
4. IF the alarm event does not contain an extractable inference profile entity ID, THEN THE handler SHALL log the event at ERROR level and return successfully without throwing.
5. IF the Agent_Registry lookup returns no record for the profile entity ID, THEN THE handler SHALL log the unresolvable ID at ERROR level and return successfully without throwing.
6. WHEN the Breaker_Lambda receives a non-ALARM state transition (OK or INSUFFICIENT_DATA), THE handler SHALL return successfully without processing.
7. THE Breaker_Lambda handler SHALL obtain its adapter instances by calling a getDependencies() factory (which may be the existing one extended with an AgentRegistryPort, or a separate factory for this handler).
8. IF a use-case invoked by the Breaker_Lambda raises a domain error, THEN THE handler SHALL log the error context including the profile entity ID, configName, and roleName, and SHALL propagate the error so that Lambda's built-in retry mechanism can re-invoke the handler.
9. THE `packages/api` package SHALL define an `AgentRegistryPort` interface in `src/ports/agent-registry.port.ts` with methods: `getByAgentId(agentId: string)`, `getByProfileEntityId(profileEntityId: string)`, `getByConfigName(configName: string)`, and `updateBreakerState(agentId: string, breakerState: string, status: string)`, where the get methods return the resolved agent details (agentId, configName, roleName, profileEntityId, profileArn, agentType, modelId, guardrailId, status, breakerState) or null if not found, and `updateBreakerState` writes the new state + updatedAt to the metadata record.
10. THE `packages/api` package SHALL implement an `AgentRegistryAdapter` in `src/adapters/dynamo/agent-registry.adapter.ts` that implements `AgentRegistryPort` using DynamoDB GetItem calls against the Agent_Registry table with the appropriate PK patterns.
11. THE `Dependencies` interface in `src/shared/dependencies.ts` SHALL be extended with an `agentRegistry: AgentRegistryPort` field, and the `getDependencies()` factory SHALL instantiate the `AgentRegistryAdapter` using the AGENT_REGISTRY_TABLE_NAME environment variable.

### Requirement 12: Resource Naming and Tagging

**User Story:** As a platform operator, I want all new resources to follow the established naming and tagging conventions, so that governance tooling can discover and manage them.

#### Acceptance Criteria

1. THE AgentPolicyModulator_Construct SHALL name all resources using the NamingGenerator from `@hecaton/core` with the configured stage and configName, calling the appropriate method for each resource type (alarmNames for alarms).
2. THE AgentPolicyModulator_Construct SHALL apply tags using `cdk.Tags.of(this).add()` with the values returned by `NamingGenerator.tags(configName, { phase: '1' })`, ensuring hecatoncheires:managed, hecatoncheires:config, hecatoncheires:stage, and hecatoncheires:phase are set on all created resources and their children.
3. THE CDK_Stack SHALL name all API Gateway handler Lambdas using the NamingGenerator pattern `hecaton-{stage}-{handlerName}` by calling `naming.lambdaName(handlerName)`.
4. THE CDK_Stack SHALL apply standard Hecatoncheires tags to all API Gateway handler Lambda resources using `NamingGenerator.tags()`.
5. THE SharedInfraStack SHALL name the Agent_Registry table using the NamingGenerator and apply standard tags via `cdk.Tags.of()`.

### Requirement 13: Agent Registry Table

**User Story:** As a platform operator, I want a persistent registry of agent configurations with reverse-lookup by inference profile, so that the breaker Lambda can resolve which agent to halt when an alarm fires.

#### Acceptance Criteria

1. THE SharedInfraStack SHALL create a DynamoDB table named `hecaton-{stage}-agent-registry` with partition key `pk` (String) and sort key `sk` (String), using PAY_PER_REQUEST billing mode and point-in-time recovery enabled.
2. THE Agent_Registry table SHALL support the following record types using overloaded keys:
   - Agent metadata: PK = `AGENT#{agentId}`, SK = `#META` — stores agentId, configName, roleName, profileEntityId, profileArn, agentType, modelId, guardrailId, status, breakerState, createdAt, updatedAt.
   - Profile reverse-lookup: PK = `PROFILE#{profileEntityId}`, SK = `AGENT#{agentId}` — stores agentId, configName, and roleName for breaker resolution.
   - Config reverse-lookup: PK = `CONFIG#{configName}`, SK = `AGENT#{agentId}` — stores agentId for internal-to-external identity resolution.
3. THE SharedInfraStack SHALL create a Global Secondary Index named `gsi1` with partition key `sk` and sort key `pk` to enable fleet queries (e.g., list all agents by querying SK = `#META`).
4. THE Agent_Registry table SHALL have removalPolicy set to RETAIN to prevent accidental data loss.
5. THE SharedInfraStack SHALL export the Agent_Registry table name and ARN as CloudFormation outputs for cross-stack consumption.
6. THE SharedInfraStack SHALL apply standard Hecatoncheires tags (hecatoncheires:managed, hecatoncheires:stage, hecatoncheires:phase) to the Agent_Registry table.
7. THE Agent_Registry table key schema SHALL be designed to accommodate future record types (fleet lifecycle events, telemetry mappings, capability snapshots) without requiring table recreation or GSI additions.

### Requirement 14: Inference Profile Entity ID Surfacing

**User Story:** As a CDK stack author, I want the AgentConfigStack to expose the inference profile entity ID alongside the existing ARN, so that downstream constructs (alarms, registry, telemetry) can reference the identifier Bedrock uses in CloudWatch metrics and invocation logs.

#### Acceptance Criteria

1. THE AgentConfigStack SHALL expose the inference profile entity ID (from `CfnApplicationInferenceProfile.attrInferenceProfileId`) as a new property accessible to subclasses and consuming constructs.
2. THE AgentConfigStack SHALL pass the `profileEntityId`, `profileArn` (from `CfnApplicationInferenceProfile.attrInferenceProfileArn`), and `modelId` (from its own props) to the AgentPolicyModulator_Construct via its props, so the construct can configure alarm dimensions and write complete registry records.
3. THE AgentConfigStack SHALL export the `profileEntityId` as a CloudFormation output named following the existing stack export pattern (`{stackId}-profileEntityId`), so that cross-stack consumers (telemetry pipeline, enrichment Lambda) can reference it without coupling to the config stack's internals.
4. THE `profileEntityId` value SHALL be derived from `CfnApplicationInferenceProfile.attrInferenceProfileId` which is the Bedrock-internal identifier that appears in CloudWatch metric dimensions and invocation log records.
5. THE `@hecaton/core` NamingGenerator class SHALL be extended with an `agentRegistryTableName()` method that returns `hecaton-{stage}-agent-registry`, following the same pattern as the existing `tableName()` method for the grant ledger.

### Requirement 15: Agent Identity Resolution via Registry

**User Story:** As a platform operator, I want to interact with the API using an opaque agent identifier rather than internal details like role names or ARNs, so that the internal addressing scheme remains an implementation detail.

#### Acceptance Criteria

1. THE system SHALL use `agentId` (UUIDv7) as the external-facing primary identifier for an agent configuration. Clients send `agentId` in API requests; internal details (configName, roleName, profileEntityId) are resolved via the Agent_Registry.
2. WHEN an agent is deployed via CDK, THE RegistrySeed_Lambda SHALL generate a UUIDv7 as the `agentId` on first deployment and surface it as a stack output. Future Phase 4 self-service provisioning will generate agentId via the onboard-agent API endpoint.
3. THE Agent_Registry SHALL store agentId as a field in the agent metadata record (PK = `AGENT#{agentId}`, SK = `#META`) and expose it for lookup.
4. THE Agent_Registry SHALL include a reverse-lookup record PK = `CONFIG#{configName}`, SK = `AGENT#{agentId}` so that internal consumers can resolve configName to agentId when needed.
5. THE grant-shape.http and revoke-shape.http request DTOs SHALL accept `agentId` (UUIDv7) as the agent identifier in the request body, replacing any direct use of configName or roleName by the client.
6. THE query-fleet-state.http response SHALL include for each agent: agentId, configName, agentType, modelId, status, breakerState, and the list of active grants, so clients have a complete view of fleet posture.
7. WHEN a handler receives an `agentId`, THE handler SHALL query the Agent_Registry (PK = `AGENT#{agentId}`, SK = `#META`) to resolve the configName, roleName, and profileEntityId before invoking the use-case.
8. IF the registry lookup returns no record for the provided agentId, THEN THE handler SHALL return an HTTP 404 response with error code `AGENT_NOT_FOUND`.
