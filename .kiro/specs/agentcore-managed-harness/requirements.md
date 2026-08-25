# Requirements Document

## Introduction

The AgentCore Managed Harness feature implements the concrete CDK construct and stack subclass that deploys an AWS BedrockAgentCore CfnHarness resource fully wired to the Hecatoncheires governance plane. This is Phase 1 Step 9 — the critical-path deliverable that proves identity enforcement, cost circuit breakers, and capability control work end-to-end on a live agent. The harness represents a config-driven, AWS-hosted agent loop where the platform provides the governed execution role and enforces runtime boundaries through the three-layer IAM model.

## Glossary

- **CfnHarness**: The AWS CloudFormation resource (`AWS::BedrockAgentCore::Harness`) from `aws-cdk-lib/aws-bedrockagentcore` that provisions a managed agentic loop in AWS.
- **AgentCoreManagedStack**: The concrete subclass of `AgentConfigStack` that extends the abstract base with CfnHarness creation and optional signal channel wiring.
- **AgentConfigStack**: The existing abstract CDK stack base class that handles inference profile, guardrail, AgentIdentity, AgentPolicyModulator, and AppConfig profile creation for each agent configuration.
- **Governed_Role**: The IAM role produced by the AgentIdentity construct, carrying the three-layer model (permission boundary, base policy, operating policy).
- **Harness_Native_Limits**: Per-invocation caps set directly on the CfnHarness resource (maxIterations, maxTokens, timeoutSeconds) that serve as first-line defense.
- **Platform_Modulator**: The Hecatoncheires second-line defense comprising CloudWatch alarms and the centralized breaker Lambda that modulates the operating policy.
- **Seed_Configuration**: A JSON file in `lib/config/seeds/` defining all parameters needed to instantiate an AgentCoreManagedStack for a specific agent.
- **NamingGenerator**: The core utility class that produces deterministic, stage-aware resource names for all Hecatoncheires AWS resources.
- **Signal_Channel**: The per-agent SQS FIFO queue and EventBridge rule (via AgentBusChannel construct) for event augmentation signal delivery.
- **HarnessBedrockModelConfig**: The CfnHarness nested property configuring which Bedrock model the harness uses, including modelId, maxTokens, and temperature.
- **HarnessToolProperty**: The CfnHarness nested property defining a tool available to the agent (type, name, config).
- **HarnessSkillProperty**: The CfnHarness nested property defining a skill source (awsSkills paths, git, S3, or filesystem path).
- **System_Prompt**: The ordered list of content blocks passed to CfnHarness `systemPrompt` that define the agent's behavioral instructions.

## Requirements

### Requirement 1: CfnHarness Resource Creation

**User Story:** As a platform operator, I want the AgentCoreManagedStack to create a CfnHarness resource that runs a managed agent loop using my governed execution role, so that the agent operates within the platform's IAM boundary model.

#### Acceptance Criteria

1. WHEN an AgentCoreManagedStack is synthesized with valid props (configName matching ConfigNamePattern, non-empty modelId, and all required SharedInfra cross-stack references), THE AgentCoreManagedStack SHALL create exactly one `AWS::BedrockAgentCore::Harness` resource in the CloudFormation template.
2. THE AgentCoreManagedStack SHALL set the CfnHarness `executionRoleArn` property to the ARN of the IAM role produced by the AgentIdentity construct's `outputs.role`.
3. THE AgentCoreManagedStack SHALL set the CfnHarness `harnessName` property to the value returned by `NamingGenerator.harnessName(configName)`, which follows the pattern `hecaton-{stage}-{configName}-harness`.
4. THE AgentCoreManagedStack SHALL set the CfnHarness `model.bedrockModelConfig.modelId` property to the `modelId` string provided in stack props.
5. WHEN a systemPrompt string is provided in stack props, THE AgentCoreManagedStack SHALL set the CfnHarness `systemPrompt` property to an array containing exactly one `HarnessSystemContentBlockProperty` with its `text` field set to the provided system prompt string.
6. IF no systemPrompt is provided in stack props, THEN THE AgentCoreManagedStack SHALL omit the `systemPrompt` property from the CfnHarness resource (leaving it undefined).
7. THE AgentCoreManagedStack SHALL apply the following tags to the CfnHarness resource: `hecatoncheires:managed` set to `'true'`, `hecatoncheires:config` set to the configName prop value, `hecatoncheires:stage` set to the stage prop value, `hecatoncheires:phase` set to `'1'`, and `hecatoncheires:harness-type` set to `'agentcore-managed'`.

#### Correctness Properties

- **P1.1 (Resource Uniqueness):** For any valid configuration, synthesis produces exactly one `AWS::BedrockAgentCore::Harness` resource.
- **P1.2 (Role Binding Integrity):** The `executionRoleArn` in the synthesized template always references the same role that carries the permission boundary.
- **P1.3 (Name Determinism):** For any given (stage, configName) pair, the harnessName output is deterministic and matches the NamingGenerator pattern.

### Requirement 2: Harness-Native Limits Configuration

**User Story:** As a platform operator, I want to configure per-invocation limits on the managed harness as first-line defense, so that a single agent invocation cannot consume unbounded resources before the platform breaker fires.

#### Acceptance Criteria

1. WHEN `maxIterations` is provided in harness configuration with a positive integer value from 1 to 1000, THE AgentCoreManagedStack SHALL set the CfnHarness `maxIterations` property to the provided value.
2. WHEN `maxIterations` is not provided, THE AgentCoreManagedStack SHALL omit the `maxIterations` property from the CfnHarness resource, allowing the service default to apply.
3. WHEN `maxTokens` is provided in harness configuration with a positive integer value from 1 to 128000, THE AgentCoreManagedStack SHALL set the CfnHarness `model.bedrockModelConfig.maxTokens` property to the provided value.
4. WHEN `maxTokens` is not provided, THE AgentCoreManagedStack SHALL omit the `maxTokens` property from the model config, allowing the service default to apply.
5. WHEN `timeoutSeconds` is provided in harness configuration with a positive integer value from 1 to 3600, THE AgentCoreManagedStack SHALL set the CfnHarness `timeoutSeconds` property to the provided value.
6. WHEN `timeoutSeconds` is not provided, THE AgentCoreManagedStack SHALL omit the `timeoutSeconds` property from the CfnHarness resource, allowing the service default to apply.
7. IF any provided limit value is not a positive integer or falls outside its valid range, THEN THE AgentCoreManagedStack SHALL throw a descriptive error during synthesis indicating which property failed validation and the acceptable range.
8. WHEN any combination of `maxIterations`, `maxTokens`, and `timeoutSeconds` are provided together, THE AgentCoreManagedStack SHALL apply each provided limit independently to its respective CfnHarness property.

#### Correctness Properties

- **P2.1 (Omission Safety):** If a limit is not provided, the synthesized template does not contain that property — it never defaults to an arbitrary value.
- **P2.2 (Independence):** Setting one limit does not affect the presence or value of any other limit in the template.

### Requirement 3: Tool and Skill Configuration

**User Story:** As a platform operator, I want to define tools and skills available to the managed agent, so that the harness provides specific capabilities to the agent within its governance boundaries.

#### Acceptance Criteria

1. WHEN `tools` is provided as a non-empty array in harness configuration, THE AgentCoreManagedStack SHALL set the CfnHarness `tools` property to an array of HarnessToolProperty objects where each input tool entry maps 1:1 to an output element preserving the `type`, `name`, and tool-specific configuration fields.
2. WHEN `tools` is not provided or is an empty array, THE AgentCoreManagedStack SHALL omit the `tools` property from the CfnHarness resource.
3. WHEN `allowedTools` is provided as a non-empty array in harness configuration, THE AgentCoreManagedStack SHALL set the CfnHarness `allowedTools` property to the provided string array with each element preserved in order.
4. WHEN `allowedTools` is not provided or is an empty array, THE AgentCoreManagedStack SHALL omit the `allowedTools` property from the CfnHarness resource.
5. WHEN `skills` is provided as a non-empty array in harness configuration, THE AgentCoreManagedStack SHALL set the CfnHarness `skills` property to an array of HarnessSkillProperty objects where each input skill entry maps 1:1 to an output element preserving the skill source type and location fields.
6. WHEN `skills` is not provided or is an empty array, THE AgentCoreManagedStack SHALL omit the `skills` property from the CfnHarness resource.
7. WHEN any combination of `tools`, `allowedTools`, and `skills` is provided, THE AgentCoreManagedStack SHALL configure each property independently such that the presence or absence of one does not affect the others.

#### Correctness Properties

- **P3.1 (Order Preservation):** The order of tools, allowedTools, and skills in the synthesized template matches the order provided in configuration.
- **P3.2 (Independence):** The presence or absence of tools does not affect skills, and vice versa.

### Requirement 4: Governance Composition Verification

**User Story:** As a platform operator, I want the AgentCoreManagedStack to guarantee that the CfnHarness resource uses the same governed role that carries the permission boundary, base policy, and deny-by-default operating policy, so that no agent can bypass IAM governance.

#### Acceptance Criteria

1. WHEN the AgentCoreManagedStack is synthesized, THE AgentCoreManagedStack SHALL produce a CloudFormation template where the CfnHarness resource declares a DependsOn relationship on the AgentIdentity IAM role logical ID, ensuring the role (with its permission boundary, base policy, and operating policy) is fully constructed before the harness resource is created.
2. THE AgentCoreManagedStack SHALL create a CfnOutput with an export name following the pattern `{stackId}-harnessArn` whose value is the CfnHarness resource ARN, enabling cross-stack reference and operational tooling to locate the harness.
3. THE AgentCoreManagedStack SHALL expose a read-only `harnessName` property of type `string` on the stack instance, whose value matches the NamingGenerator pattern `hecaton-{stage}-{configName}-harness`, for programmatic access by test and operational tooling.
4. WHEN the AgentCoreManagedStack is synthesized, THE AgentCoreManagedStack SHALL produce a template where the CfnHarness `executionRoleArn` property value is a CloudFormation reference (Ref or GetAtt) to the same IAM role resource that has all three governance layers attached: (a) a permission boundary managed policy, (b) a base inline policy, and (c) the deny-by-default operating inline policy.
5. IF the AgentCoreManagedStack is instantiated with an `agentType` value other than `agentcore-managed`, THEN THE AgentCoreManagedStack SHALL throw an error during construction indicating that CfnHarness creation is only valid for the `agentcore-managed` harness type.

#### Correctness Properties

- **P4.1 (Governance Invariant):** In every valid synthesis, the CfnHarness executionRoleArn references a role with a permission boundary attached.
- **P4.2 (Type Safety):** Construction fails deterministically for any agentType != 'agentcore-managed'.

### Requirement 5: Signal Channel Integration

**User Story:** As a platform operator, I want to optionally attach a signal delivery channel to the managed harness, so that the agent can participate in event-driven workflows via the signals EventBridge bus.

#### Acceptance Criteria

1. WHEN `signalChannel` configuration is provided with a `signalsBusArn` (valid ARN string) and `sourceNamespace` (non-empty string), THE AgentCoreManagedStack SHALL instantiate the AgentBusChannel construct passing `configName`, `signalsBusArn`, `sourceNamespace`, the Governed_Role, and `stage` from the stack props.
2. WHEN `signalChannel` configuration is not provided (undefined or omitted from props), THE AgentCoreManagedStack SHALL not instantiate the AgentBusChannel construct and SHALL not create any SQS queue, DLQ, or EventBridge rule resources for signal delivery.
3. WHEN the AgentBusChannel is instantiated, THE AgentCoreManagedStack SHALL pass the signal queue URL to the CfnHarness via an environment variable with key `SIGNAL_QUEUE_URL`.
4. WHEN the AgentBusChannel is instantiated, THE AgentCoreManagedStack SHALL expose the signal channel outputs (signalsQueue, deadLetterQueue, rule) as a readonly `signalChannel` property on the stack instance, typed as `AgentBusChannelOutputs | undefined`.
5. WHEN `signalChannel` configuration includes optional `subscriptionPatterns`, THE AgentCoreManagedStack SHALL pass those patterns to the AgentBusChannel construct for event filtering.

#### Correctness Properties

- **P5.1 (Opt-in Only):** If signalChannel is not provided, zero signal-related resources appear in the synthesized template.
- **P5.2 (Queue URL Binding):** When signal channel is active, the SIGNAL_QUEUE_URL environment variable references the queue created in the same stack.

### Requirement 6: Seed Configuration File

**User Story:** As a platform operator, I want a seed configuration JSON file that defines all parameters for a test managed agent, so that I can deploy and verify governance end-to-end without manual configuration.

#### Acceptance Criteria

1. THE Seed_Configuration file SHALL exist at `packages/cdk/lib/config/seeds/example-agentcore-managed.json`.
2. THE Seed_Configuration file SHALL contain valid JSON parseable by the TypeScript interface that defines AgentCoreManagedStack props, such that importing and passing the parsed object to the stack constructor does not produce a type error.
3. THE Seed_Configuration file SHALL include all required fields: `configName`, `agentType` (set to `agentcore-managed`), `modelId`, `thresholds` (containing `outputTokensPerHour`, `guardrailBlocksPer10Min`, and `guardrailObservationsPerHour`), and `harnessConfig` (containing at least `systemPrompt`).
4. THE Seed_Configuration file SHALL use a configName that is 2–40 characters long and passes the `ConfigNamePattern` validation (matches `^[a-z][a-z0-9-]*[a-z0-9]$`).
5. THE Seed_Configuration file SHALL define threshold values where each value is a positive integer and all values are at most one-tenth of the expected production values (e.g., `outputTokensPerHour` no greater than 1000, `guardrailBlocksPer10Min` no greater than 5, `guardrailObservationsPerHour` no greater than 50), so that circuit breakers trigger quickly during development verification.

#### Correctness Properties

- **P6.1 (Parsability):** The JSON file parses without error and type-checks against the stack props interface.
- **P6.2 (ConfigName Validity):** The configName passes ConfigNamePattern validation.

### Requirement 7: Concrete Stack Instantiation in CDK App

**User Story:** As a platform operator, I want a concrete AgentCoreManagedStack instantiated in the CDK app entry point using the seed configuration, so that I can deploy an actual governed agent with `cdk deploy`.

#### Acceptance Criteria

1. THE CDK app entry point (`bin/app.ts`) SHALL import and instantiate exactly one AgentCoreManagedStack per seed configuration JSON file found in `lib/config/seeds/` that has `agentType` set to `agentcore-managed`.
2. THE CDK app entry point SHALL pass the SharedInfraStack outputs (opsBus, snsTopic, grantLedgerTable, defaultGuardrailConfig, breakerLambda, agentRegistryTable, appConfigAppId, appConfigEnvId) to the AgentCoreManagedStack via the `sharedInfra` props object.
3. THE CDK app entry point SHALL name the stack using the `Hecaton-{Stage}-{ConfigName}` pattern, where `{Stage}` is the stage context value with the first letter capitalized and `{ConfigName}` is the `configName` from the seed file with words capitalized (e.g., `Hecaton-Dev-TestManaged` for stage `dev` and configName `test-managed`).
4. THE CDK app entry point SHALL pass the `agentType` property as the literal string `agentcore-managed` to the AgentCoreManagedStack props.
5. WHEN `cdk synth` is run against the CDK app, THE CDK app SHALL exit with code 0 and produce valid CloudFormation JSON templates in the `cdk.out/` directory for both the SharedInfraStack and the AgentCoreManagedStack.
6. THE CDK app entry point SHALL add an explicit CDK dependency from the AgentCoreManagedStack to the SharedInfraStack so that the SharedInfraStack is always deployed before the AgentCoreManagedStack.
7. IF the seed configuration file cannot be read or parsed as valid JSON, THEN THE CDK app SHALL fail synthesis with an error message indicating the file path and the parse failure reason.

#### Correctness Properties

- **P7.1 (Deployment Order):** SharedInfraStack is always deployed before AgentCoreManagedStack.
- **P7.2 (Template Validity):** `cdk synth` produces valid JSON CloudFormation templates without errors.

### Requirement 8: Input Validation

**User Story:** As a platform operator, I want the AgentCoreManagedStack to validate harness configuration at synthesis time, so that invalid configurations fail early with clear error messages rather than at deploy time.

#### Acceptance Criteria

1. IF `systemPrompt` is not provided, is an empty string, or contains only whitespace characters, THEN THE AgentCoreManagedStack SHALL throw a synthesis error with a message indicating the field name and that systemPrompt must be a non-empty, non-whitespace string.
2. IF `maxIterations` is provided and is not an integer greater than zero, THEN THE AgentCoreManagedStack SHALL throw a synthesis error with a message indicating the field name, the constraint (must be a positive integer), and the rejected value.
3. IF `maxTokens` is provided and is not an integer greater than zero, THEN THE AgentCoreManagedStack SHALL throw a synthesis error with a message indicating the field name, the constraint (must be a positive integer), and the rejected value.
4. IF `timeoutSeconds` is provided and is not an integer greater than zero, THEN THE AgentCoreManagedStack SHALL throw a synthesis error with a message indicating the field name, the constraint (must be a positive integer), and the rejected value.
5. IF `tools` contains an entry where the `type` field is missing or is an empty string, THEN THE AgentCoreManagedStack SHALL throw a synthesis error with a message indicating the zero-based index of the invalid tool entry and that tool type is required and must be non-empty.
6. IF any validation check fails, THEN THE AgentCoreManagedStack SHALL throw the error before creating any CloudFormation resources in the stack.
7. IF multiple fields are invalid, THEN THE AgentCoreManagedStack SHALL report the first failing validation encountered and halt synthesis.

#### Correctness Properties

- **P8.1 (Fail-Fast):** Validation errors are thrown before any resource creation occurs.
- **P8.2 (Deterministic Ordering):** The same set of invalid inputs always produces the same error message.

### Requirement 9: CDK Assertion Tests

**User Story:** As a developer, I want CDK assertion tests that verify the synthesized CloudFormation template contains correctly configured CfnHarness resources, so that regressions in governance wiring are caught before deployment.

#### Acceptance Criteria

1. WHEN an AgentCoreManagedStack is synthesized with valid props (configName, stage, modelId, systemPrompt, and thresholds), THE test suite SHALL verify that the resulting CloudFormation template contains exactly one `AWS::BedrockAgentCore::Harness` resource using `Template.resourceCountIs`.
2. THE test suite SHALL verify that the CfnHarness `executionRoleArn` property resolves to the ARN of the IAM role created by the AgentIdentity construct in the same stack, using `Template.hasResourceProperties` with a `Match.objectLike` matcher that follows the CloudFormation `Fn::GetAtt` reference to the role's logical ID.
3. THE test suite SHALL verify that the CfnHarness `harnessName` property equals the value returned by `new NamingGenerator(stage).harnessName(configName)` (pattern: `hecaton-{stage}-{configName}-harness`) for the stage and configName used in the test stack props.
4. WHEN optional properties (maxIterations, maxTokens, timeoutSeconds, tools, skills, allowedTools) are not provided in harness configuration, THE test suite SHALL verify that the corresponding properties are absent from the synthesized `AWS::BedrockAgentCore::Harness` resource using `Match.absent()` for each property individually.
5. WHEN optional properties are provided in harness configuration (maxIterations set to a positive integer, maxTokens set to a positive integer, timeoutSeconds set to a positive integer, tools set to a non-empty array of HarnessToolProperty objects, skills set to a non-empty array of HarnessSkillProperty objects, allowedTools set to a non-empty string array), THE test suite SHALL verify each property appears in the synthesized template with the exact value provided in the configuration.
6. THE test suite SHALL verify that the CfnHarness resource carries all five standard Hecatoncheires tags: `hecatoncheires:managed=true`, `hecatoncheires:config={configName}`, `hecatoncheires:stage={stage}`, `hecatoncheires:phase=1`, and `hecatoncheires:harness-type=agentcore-managed`.
7. IF invalid configuration is provided (systemPrompt is an empty string, or maxIterations is a negative integer), THEN THE test suite SHALL verify that stack synthesis throws an error whose message contains a substring identifying the invalid field and the reason for rejection.
8. THE test suite SHALL verify that when signalChannel configuration is provided (signalsBusArn and sourceNamespace), the template contains exactly one `AWS::SQS::Queue` resource with FIFO naming, exactly one dead-letter `AWS::SQS::Queue`, and exactly one `AWS::Events::Rule` targeting the signal queue; and when signalChannel configuration is omitted, the template contains zero resources of each of those three types attributable to signal channel wiring.
9. THE test suite SHALL use a shared helper function (following the existing `createTestStacks` pattern) to synthesize an AgentCoreManagedStack with configurable overrides, returning the `Template` instance for assertion, so that each test case specifies only the configuration variant under test.

#### Correctness Properties

- **P9.1 (Coverage):** Every CfnHarness property listed in Requirements 1–5 has at least one positive and one negative test case.
- **P9.2 (Test Isolation):** Each test case uses its own synthesized template to avoid cross-test interference.

### Requirement 10: Successful CDK Synthesis

**User Story:** As a developer, I want the complete CDK app (SharedInfraStack + AgentCoreManagedStack) to synthesize without errors, so that I can verify the full governance stack is deployable.

#### Acceptance Criteria

1. WHEN `pnpm --filter @hecaton/cdk synth` is executed, THE CDK app SHALL exit with code 0 and produce JSON-parseable CloudFormation template files in the `cdk.out/` directory for both the SharedInfraStack and the AgentCoreManagedStack.
2. WHEN the AgentCoreManagedStack is synthesized, THE synthesized template SHALL contain at least one resource of each of the following CloudFormation types: `AWS::Bedrock::ApplicationInferenceProfile`, `AWS::Bedrock::Guardrail`, `AWS::IAM::Role` (with a permission boundary attached), `AWS::CloudWatch::Alarm`, `AWS::AppConfig::ConfigurationProfile`, and `AWS::BedrockAgentCore::Harness`.
3. THE synthesized AgentCoreManagedStack template SHALL not contain circular `DependsOn` references between resources (verified by successful synthesis and absence of CDK circular-dependency errors).
4. THE synthesized AgentCoreManagedStack template SHALL set physical resource names (the `Name` or equivalent naming property on each resource) using the NamingGenerator `hecaton-{stage}-{configName}-{suffix}` pattern, where `{stage}` is the deployment stage, `{configName}` is the agent config name from the seed file, and `{suffix}` is the resource-type-specific suffix (e.g., `agent-role`, `profile`, `guardrail`, `harness`, `token-alarm`).
5. WHEN the AgentCoreManagedStack references outputs from the SharedInfraStack (opsBus, snsTopic, grantLedgerTable, breakerLambda, agentRegistryTable, appConfigAppId, appConfigEnvId), THE CDK app SHALL resolve all cross-stack references without unresolved token errors during synthesis.

#### Correctness Properties

- **P10.1 (Synthesis Completeness):** Every resource created by the parent AgentConfigStack is also present in the AgentCoreManagedStack template.
- **P10.2 (No Circular Dependencies):** CDK synthesis exits cleanly without cycle detection errors.
