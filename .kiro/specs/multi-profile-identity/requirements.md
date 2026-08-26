# Requirements Document

## Introduction

This feature evolves the Hecatoncheires agent identity model from a 1:1 agent-to-inference-profile relationship to a 1:many relationship. An agent configuration holds an ordered array of model bindings, each producing its own inference profile resource with independent per-profile alarm thresholds. The circuit breaker remains agent-level via a composite alarm. Grant records for the `core-invocation` shape become profile-agnostic — profile ARNs are resolved at policy assembly time from the agent registry rather than stored as grant parameters. Each inference profile is exclusively owned by a single agent (invariant enforced at deployment and registry write time).

## Glossary

- **Agent_Configuration**: The domain object describing an agent's identity, model bindings, guardrail binding, harness type, and ownership within the platform.
- **Model_Binding**: A sub-object within Agent_Configuration that associates a Bedrock model ID with a human-readable label and optional per-profile alarm thresholds.
- **Inference_Profile**: An AWS Bedrock `CfnApplicationInferenceProfile` resource created per model binding, scoping token usage and cost attribution.
- **Profile_Exclusivity**: The invariant that each inference profile maps to exactly one agent configuration. No two agents may share a profile.
- **Permission_Boundary**: The per-agent IAM managed policy that sets the absolute ceiling for all actions an agent role may perform.
- **Core_Invocation_Shape**: The capability shape template in the shape catalog that grants Bedrock invocation permissions.
- **Policy_Assembly**: The algorithm that resolves grant records against the shape catalog and agent registry to produce a concrete IAM policy document.
- **Composite_Alarm**: A CloudWatch composite alarm that enters ALARM state when any of its child (per-profile) alarms breach, triggering the agent-level circuit breaker.
- **Agent_Registry**: The DynamoDB table storing per-agent metadata including profile records, role name, and agent type.
- **Grant_Record**: A domain object binding a capability shape (with parameters) to an agent configuration.
- **AgentPolicyModulator**: The CDK construct responsible for creating CloudWatch alarms and seeding the agent registry.
- **AgentIdentity**: The CDK construct encapsulating the three-layer IAM role model for a single agent.

## Requirements

### Requirement 1: Model Bindings Schema

**User Story:** As a platform operator, I want to define multiple model bindings per agent configuration, so that an agent can invoke different Bedrock models through dedicated inference profiles.

#### Acceptance Criteria

1. THE Agent_Configuration schema SHALL accept a `modelBindings` field containing an ordered array of Model_Binding objects.
2. WHEN a Model_Binding is provided, THE Agent_Configuration schema SHALL require a non-empty `modelId` string and a non-empty `label` string on each binding.
3. WHEN a Model_Binding includes a `thresholds` object, THE Agent_Configuration schema SHALL validate that `outputTokensPerHour` is a positive integer.
4. THE Agent_Configuration schema SHALL require at least one Model_Binding in the `modelBindings` array.
5. THE Agent_Configuration schema SHALL reject duplicate `label` values within the same `modelBindings` array.
6. THE Agent_Configuration schema SHALL constrain `label` to lowercase alphanumeric characters and hyphens, with a maximum length of 30 characters.

### Requirement 2: Profile Exclusivity Invariant

**User Story:** As a platform operator, I want the system to enforce that each inference profile belongs to exactly one agent, so that cost attribution and safety boundaries remain unambiguous.

#### Acceptance Criteria

1. WHEN a new agent configuration is registered, THE Agent_Registry write operation SHALL verify that none of the profile ARNs in the new record already exist in any other agent's profile records.
2. IF a profile ARN collision is detected during registry write, THEN THE Agent_Registry SHALL reject the write and return a Profile_Exclusivity violation error identifying the conflicting agent and profile.
3. THE Agent_Registry exclusivity check SHALL use a DynamoDB transactional write to ensure atomicity between the collision check and the record insertion.

### Requirement 3: CDK Multi-Profile Resource Creation

**User Story:** As a platform operator deploying an agent stack, I want the CDK to create one inference profile resource per model binding, so that each model has independent cost and usage attribution.

#### Acceptance Criteria

1. WHEN an AgentConfigStack is synthesized, THE AgentConfigStack SHALL create one `CfnApplicationInferenceProfile` resource for each entry in the `modelBindings` array.
2. THE AgentConfigStack SHALL name each inference profile using the pattern `hecaton-{configName}-{label}-profile`.
3. THE AgentConfigStack SHALL tag each inference profile with the standard `hecatoncheires:managed`, `hecatoncheires:config`, and `hecatoncheires:phase` tags.
4. THE AgentConfigStack SHALL expose all profile ARNs as an array available to downstream constructs.

### Requirement 4: Permission Boundary Multi-Profile Condition

**User Story:** As a platform operator, I want the permission boundary to enforce that agents can only invoke models through their assigned set of inference profiles, so that model access remains tightly scoped regardless of how many profiles an agent holds.

#### Acceptance Criteria

1. THE AgentIdentity construct SHALL set the `bedrock:InferenceProfileArn` condition on the `BedrockInference` permission boundary statement using the `ForAnyValue:StringEquals` operator with the full array of the agent's profile ARNs.
2. WHEN an agent has a single model binding, THE AgentIdentity construct SHALL produce a condition functionally equivalent to a `StringEquals` single-value condition.
3. THE AgentIdentity construct SHALL include all profile ARNs from the `modelBindings` array in the permission boundary condition, regardless of how many bindings exist.

### Requirement 5: Per-Profile Alarms with Composite Agent-Level Alarm

**User Story:** As a platform operator, I want per-profile alarms for observability alongside an agent-level composite alarm for circuit breaking, so that I can diagnose which profile is misbehaving while still halting the entire agent when any threshold is breached.

#### Acceptance Criteria

1. WHEN an AgentPolicyModulator is constructed, THE AgentPolicyModulator SHALL create a token-usage alarm for each inference profile in the agent's model bindings.
2. WHEN a Model_Binding includes per-profile `thresholds`, THE AgentPolicyModulator SHALL use those thresholds for that profile's alarms instead of the agent-level defaults.
3. THE AgentPolicyModulator SHALL create a single CloudWatch composite alarm per agent that enters ALARM state when any child profile alarm is in ALARM state.
4. THE AgentPolicyModulator composite alarm SHALL trigger the shared Breaker Lambda as its alarm action.
5. THE AgentPolicyModulator SHALL name each per-profile alarm using the pattern `hecaton-{stage}-{configName}-{label}-{alarmType}`.
6. THE AgentPolicyModulator SHALL expose both the per-profile alarms and the composite alarm as typed outputs.

### Requirement 6: Grant Profile Decoupling

**User Story:** As a platform operator, I want grants for the `core-invocation` shape to be profile-agnostic, so that granting invocation capability does not require knowing or specifying which profiles the agent holds.

#### Acceptance Criteria

1. THE Core_Invocation_Shape template in the shape catalog SHALL have an empty `requiredParameters` array.
2. WHEN Policy_Assembly resolves a `core-invocation` grant, THE Policy_Assembly algorithm SHALL retrieve the agent's profile ARNs from the Agent_Registry rather than from the grant's `parameters` field.
3. THE Policy_Assembly algorithm SHALL produce IAM statements with a `Resource` field containing all of the agent's profile ARNs when resolving a `core-invocation` grant.
4. IF the Agent_Registry returns an empty profile list for an agent during `core-invocation` resolution, THEN THE Policy_Assembly algorithm SHALL produce a deny-all statement for that grant instead of an allow with an empty resource set.

### Requirement 7: Agent Registry Multi-Profile Storage

**User Story:** As a platform operator, I want the agent registry to store all of an agent's profile records, so that downstream systems can resolve profile ARNs for policy assembly and observability.

#### Acceptance Criteria

1. THE Agent_Registry record for each agent SHALL include a `profiles` array containing one entry per model binding with fields: `profileArn`, `profileEntityId`, `modelId`, and `label`.
2. WHEN the RegistrySeed custom resource executes, THE RegistrySeed handler SHALL write profile records for all model bindings in the agent configuration.
3. WHEN a model binding is removed from the agent configuration and the stack is updated, THE RegistrySeed handler SHALL remove the corresponding profile record from the registry.
4. THE Agent_Registry `profiles` array SHALL maintain the same ordering as the `modelBindings` array in the agent configuration.

### Requirement 8: Validation Constraints

**User Story:** As a platform operator, I want strong validation at both schema and CDK levels, so that invalid multi-profile configurations are caught early with clear error messages.

#### Acceptance Criteria

1. IF the `modelBindings` array contains more than 5 entries, THEN THE Agent_Configuration schema SHALL reject the input with a validation error stating the maximum number of bindings.
2. IF a `label` value does not match the pattern of lowercase letters, digits, and hyphens starting with a letter, THEN THE Agent_Configuration schema SHALL reject the input with a descriptive validation error.
3. WHEN the AgentConfigStack validates its props, THE AgentConfigStack SHALL verify that each `modelId` in the `modelBindings` array is a non-empty string.
4. IF the AgentConfigStack receives an empty `modelBindings` array, THEN THE AgentConfigStack SHALL throw an error indicating that at least one model binding is required.
