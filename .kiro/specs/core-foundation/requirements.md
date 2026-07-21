# Requirements Document

## Introduction

This document specifies the requirements for `@hecaton/core` Foundation — the pure domain layer (Layer 0) of the Hecatoncheires governance platform. This layer defines all schemas, types, entity factories, domain errors, constants, configuration templates, and validators that the rest of the system builds upon. It has no I/O, no AWS SDK dependencies, and is testable purely by passing data and asserting return values.

## Glossary

- **Agent_Configuration**: A validated domain object describing an agent's identity, model binding, guardrail binding, and owner.
- **Runtime_Tunables**: A validated domain object containing threshold values and feature flags that control platform behavior at runtime without redeployment.
- **Capability_Shape**: A risk-tier bundle of IAM statement templates that, when resolved with parameters, produces IAM policy statements granting specific AWS permissions.
- **Shape_Template**: A parameterized definition that accepts context (configName, resource ARNs) and produces IAM statement JSON.
- **Grant_Record**: A domain object representing a currently active capability grant for a specific agent configuration, including shape name, parameters, timestamps, and optional expiry.
- **Operating_Policy**: The single inline IAM policy assembled from all currently granted shapes for a given agent configuration. Deny-by-default when no shapes are granted.
- **Config_Name**: A string identifier for an agent configuration, used as the key in naming conventions and resource identification.
- **Schema**: A Zod schema definition that serves as the source of truth for both type inference and runtime validation.
- **Entity_Factory**: A function that accepts raw input, validates it against a schema, and returns a validated domain object or throws a domain error.
- **Validator**: A pure function performing cross-field, structural, or referential validation beyond what a single schema can express.
- **Domain_Error**: A typed error class carrying a machine-readable code and a human-readable message for error categorization at the API boundary.

## Requirements

### Requirement 1: Agent Configuration Schema and Entity

**User Story:** As a platform developer, I want a validated Agent Configuration domain object, so that all downstream consumers can trust configuration data is structurally and semantically correct.

#### Acceptance Criteria

1. THE Agent_Configuration_Schema SHALL validate that configName is a non-empty string matching the pattern `^[a-z][a-z0-9-]*[a-z0-9]$` with a maximum length of 40 characters.
2. THE Agent_Configuration_Schema SHALL validate that agentType is one of the literal values: `agentcore-managed`, `openclaw`, or `agentcore-runtime`.
3. THE Agent_Configuration_Schema SHALL validate that modelId is a non-empty string.
4. THE Agent_Configuration_Schema SHALL validate that guardrailId is a non-empty string.
5. THE Agent_Configuration_Schema SHALL validate that guardrailVersion is a non-empty string, defaulting to `DRAFT` when not provided.
6. THE Agent_Configuration_Schema SHALL validate that owner is a non-empty string identifying the owning principal (typically a team identifier).
7. WHEN valid input is provided, THE Agent_Configuration_Factory SHALL return a frozen, validated Agent_Configuration object.
8. WHEN invalid input is provided, THE Agent_Configuration_Factory SHALL throw a ValidationError containing the specific field failures.

> **Identity strategy:** Agent_Configuration uses `configName` as its natural key. No synthetic ID is required — configName is the unique, human-readable identifier used in naming conventions, resource tagging, and all cross-system references.

> **Deferred:** Signal subscriptions (EventBridge detailType + source patterns) are a delivery concern specific to the OpenClaw harness type. They will be defined as part of the OpenClaw harness-specific configuration schema rather than the base Agent_Configuration. See the OpenClaw harness spec (future phase).

### Requirement 2: Runtime Tunables Schema and Entity

**User Story:** As a platform developer, I want a validated Runtime Tunables domain object, so that threshold and feature flag values are guaranteed to be within acceptable ranges.

#### Acceptance Criteria

1. THE Runtime_Tunables_Schema SHALL validate that thresholds.outputTokensPerHour is a positive integer.
2. THE Runtime_Tunables_Schema SHALL validate that thresholds.guardrailBlocksPer10Min is a positive integer.
3. THE Runtime_Tunables_Schema SHALL validate that thresholds.guardrailObservationsPerHour is a positive integer.
4. THE Runtime_Tunables_Schema SHALL validate that featureFlags.pipelineSpeedBreaker is a boolean value.
5. THE Runtime_Tunables_Schema SHALL validate that featureFlags.timeBoxedGrants is a boolean value.
6. WHEN valid input is provided, THE Runtime_Tunables_Factory SHALL return a frozen, validated Runtime_Tunables object.
7. WHEN invalid input is provided, THE Runtime_Tunables_Factory SHALL throw a ValidationError containing the specific field failures.

### Requirement 3: Capability Shape Schema and Resolution

**User Story:** As a platform developer, I want capability shapes defined as parameterized templates, so that the policy modulator can resolve them into concrete IAM statements for any agent configuration.

#### Acceptance Criteria

1. THE Shape_Template_Schema SHALL validate that each shape has a unique shapeName string identifier.
2. THE Shape_Template_Schema SHALL validate that each shape has a riskTier value of `low`, `medium`, `high`, or `critical`.
3. THE Shape_Template_Schema SHALL validate that each shape declares its required parameters as an array of parameter name strings.
4. THE Shape_Template_Schema SHALL validate that each shape contains a statements array of IAM statement templates with parameterized resource ARN placeholders.
5. WHEN a Shape_Template is resolved with valid parameters, THE Shape_Resolver SHALL substitute all placeholders and return concrete IAM statement objects.
6. WHEN a Shape_Template is resolved with missing or invalid parameters, THE Shape_Resolver SHALL throw an InvalidShapeParametersError listing the missing parameters.
7. WHEN a shapeName is requested that does not exist in the catalog, THE Shape_Resolver SHALL throw a ShapeNotFoundError containing the requested shape name.

### Requirement 4: Grant Record Schema and Entity

**User Story:** As a platform developer, I want a validated Grant Record domain object, so that the grant ledger entries are structurally correct and carry all required metadata.

#### Acceptance Criteria

1. THE Grant_Record_Schema SHALL validate that grantId is a valid UUIDv7 string (generated via the Id_Generator when not provided).
2. THE Grant_Record_Schema SHALL validate that configName matches the Agent_Configuration configName pattern.
3. THE Grant_Record_Schema SHALL validate that shapeName is a non-empty string referencing a known capability shape.
4. THE Grant_Record_Schema SHALL validate that parameters is a record of string key-value pairs.
5. THE Grant_Record_Schema SHALL validate that grantedAt is a valid ISO 8601 timestamp string.
6. THE Grant_Record_Schema SHALL validate that grantedBy is a non-empty string identifying the granting principal.
7. THE Grant_Record_Schema SHALL validate that expiresAt, when present, is a valid ISO 8601 timestamp string that is later than grantedAt.
8. WHEN valid input is provided, THE Grant_Record_Factory SHALL return a frozen, validated Grant_Record object with a grantId assigned (generated if not supplied).
9. WHEN invalid input is provided, THE Grant_Record_Factory SHALL throw a ValidationError containing the specific field failures.

> **Identity strategy:** Grant_Record uses a UUIDv7 `grantId` as its primary key for DynamoDB storage, idempotent revocation, and event correlation. The combination of `configName + shapeName + parameters` serves as a uniqueness constraint (enforced by Grant_Set_Validator) but not as the record key.

### Requirement 5: Operating Policy Assembly

**User Story:** As a platform developer, I want a pure function that assembles an IAM policy document from a set of granted shapes, so that the policy modulator can rewrite the operating policy deterministically.

#### Acceptance Criteria

1. WHEN given an empty set of grants, THE Policy_Assembler SHALL produce a policy document containing a single explicit Deny statement for all actions (deny-by-default resting state).
2. WHEN given one or more grants, THE Policy_Assembler SHALL resolve each grant's shape template with its parameters and combine all resulting statements into a single valid IAM policy document.
3. THE Policy_Assembler SHALL produce a policy document that conforms to the AWS IAM policy JSON structure with Version, Statement array, and valid Effect/Action/Resource fields.
4. WHEN two grants produce overlapping statements, THE Policy_Assembler SHALL include both statements without deduplication (IAM union semantics).

### Requirement 6: Domain Error Classes

**User Story:** As a platform developer, I want typed domain error classes with machine-readable codes, so that API handlers can map domain failures to appropriate HTTP responses.

#### Acceptance Criteria

1. THE Domain_Error module SHALL export a ShapeNotFoundError class with code `SHAPE_NOT_FOUND`.
2. THE Domain_Error module SHALL export an InvalidShapeParametersError class with code `INVALID_SHAPE_PARAMETERS`.
3. THE Domain_Error module SHALL export a GrantConflictError class with code `GRANT_CONFLICT`.
4. THE Domain_Error module SHALL export a ConfigNotFoundError class with code `CONFIG_NOT_FOUND`.
5. THE Domain_Error module SHALL export a ValidationError class with code `VALIDATION_ERROR`.
6. THE Domain_Error module SHALL export an InternalError class with code `INTERNAL_ERROR`.
7. THE Domain_Error base class SHALL carry a `code` property, a `message` property, and an optional `details` record.

> **Note:** Domain errors do not carry transport-specific status codes (HTTP, gRPC, etc.). Status mapping is the responsibility of the adapter layer in `@hecaton/api`, which maintains a `code → status` map appropriate to each access pattern (e.g. HTTP status codes for REST handlers, gRPC status codes for future transports).

### Requirement 7: Naming Convention Constants and Generators

**User Story:** As a platform developer, I want deterministic resource name generation from a configName and stage, so that all packages produce consistent, environment-aware AWS resource names.

#### Acceptance Criteria

1. THE Naming_Generator SHALL require a `stage` parameter (a non-empty string, e.g. `dev`, `sit`, `pre`, `prd`, or an arbitrary feature branch identifier).
2. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce an IAM role name following the pattern `hecaton-{stage}-{configName}-agent-role`.
3. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce an inference profile name following the pattern `hecaton-{stage}-{configName}-profile`.
4. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce a guardrail name following the pattern `hecaton-{stage}-{configName}-guardrail`.
5. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce alarm names following the patterns `hecaton-{stage}-{configName}-token-alarm`, `hecaton-{stage}-{configName}-block-alarm`, and `hecaton-{stage}-{configName}-observation-alarm`.
6. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce queue names following the patterns `hecaton-{stage}-{configName}-signals.fifo` and `hecaton-{stage}-{configName}-signals-dlq.fifo`.
7. WHEN given a valid handler name and stage, THE Naming_Generator SHALL produce a Lambda function name following the pattern `hecaton-{stage}-{handlerName}`.
8. WHEN given a valid configName, stage, and purpose, THE Naming_Generator SHALL produce an EventBridge rule name following the pattern `hecaton-{stage}-{configName}-{purpose}`.
9. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce a CfnHarness name following the pattern `hecaton-{stage}-{configName}-harness`.
10. WHEN given a valid stage and purpose (or configName), THE Naming_Generator SHALL produce a stack name following the pattern `Hecaton-{Stage}-{Purpose}` (e.g. `Hecaton-Dev-SharedInfra`, `Hecaton-Dev-SreOps`).
11. WHEN given a valid stage, THE Naming_Generator SHALL produce a DynamoDB table name following the pattern `hecaton-{stage}-grant-ledger`.
12. WHEN given a valid configName and stage, THE Naming_Generator SHALL produce resource tags containing `hecatoncheires:managed = true`, `hecatoncheires:config = {configName}`, and `hecatoncheires:stage = {stage}`.
13. THE Naming_Generator SHALL accept a phase parameter and include `hecatoncheires:phase = {phase}` in the generated tags.
14. THE Naming_Generator SHALL accept a harnessType parameter and include `hecatoncheires:harness-type = {harnessType}` in the generated tags.
15. THE stage parameter SHALL accept arbitrary non-empty strings to support feature branch deployments (e.g. `feat-xyz`).

### Requirement 8: Cross-field and Structural Validators

**User Story:** As a platform developer, I want validators that check relationships between fields and structural constraints that single schemas cannot express, so that invalid domain states are caught early.

#### Acceptance Criteria

1. WHEN a Grant_Record references a shapeName, THE Grant_Validator SHALL verify the shapeName exists in the provided shape catalog.
2. WHEN a Grant_Record provides parameters, THE Grant_Validator SHALL verify all required parameters declared by the referenced shape are present.
3. WHEN a Grant_Record has an expiresAt value that is earlier than or equal to grantedAt, THE Grant_Validator SHALL return a validation failure.
4. WHEN multiple Grant_Records for the same configName reference the same shapeName with the same parameters, THE Grant_Set_Validator SHALL detect the conflict and return a GrantConflictError.
5. WHEN an assembled policy document exceeds the AWS inline policy size limit, THE Policy_Size_Validator SHALL return a validation failure with the actual size and the limit.

### Requirement 9: Shape Catalog Configuration

**User Story:** As a platform developer, I want a built-in catalog of capability shape templates, so that the platform ships with the core invocation shape and common utility shapes ready to use.

#### Acceptance Criteria

1. THE Shape_Catalog SHALL include a `core-invocation` shape that grants Bedrock model invocation permissions scoped to a specific inference profile ARN.
2. THE Shape_Catalog SHALL include an `s3-prefix-read` shape that grants S3 GetObject and ListBucket permissions scoped to a parameterized prefix.
3. THE Shape_Catalog SHALL include an `s3-prefix-write` shape that grants S3 PutObject permissions scoped to a parameterized prefix.
4. THE Shape_Catalog SHALL include a `cloudwatch-logs-read` shape that grants CloudWatch Logs read permissions scoped to a parameterized log group.
5. EACH shape in the catalog SHALL declare its riskTier, requiredParameters, and statement templates.
6. THE Shape_Catalog SHALL be exported as a frozen array accessible from the public API barrel.

> **Deferred:** The frozen, code-defined catalog is the Phase 1 approach. Extensibility (user-defined shapes loaded from a configuration store or DynamoDB) is deferred to a later phase. The schema and resolution logic in core will remain the foundation for any future catalog source.

### Requirement 10: Identity Generation Utility

**User Story:** As a platform developer, I want a centralized ID generation utility that produces UUIDv7 identifiers, so that all entities across the platform use time-ordered, K-sortable identifiers consistently.

#### Acceptance Criteria

1. THE Id_Generator SHALL export a `generateId()` function that returns a UUIDv7-compliant string.
2. THE generated identifiers SHALL conform to the UUID format `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx` where the version nibble is `7`.
3. THE generated identifiers SHALL be K-sortable by creation time due to the embedded timestamp prefix.
4. THE Id_Schema SHALL validate that a given string conforms to the UUIDv7 format.
5. ALL entity schemas that include an `id` field SHALL reference the Id_Schema for validation.
6. THE Id_Generator SHALL be exported from the public API barrel as part of the utilities module.

### Requirement 11: Public API Barrel Export

**User Story:** As a consumer of `@hecaton/core`, I want a single barrel export that exposes all schemas, types, factories, errors, constants, and validators, so that I can import everything through the package name without reaching into internals.

#### Acceptance Criteria

1. THE Public_API barrel SHALL export all Zod schemas from the schemas module.
2. THE Public_API barrel SHALL export all inferred TypeScript types from the types module.
3. THE Public_API barrel SHALL export all entity factory functions from the entity module.
4. THE Public_API barrel SHALL export all domain error classes from the errors module.
5. THE Public_API barrel SHALL export all constants and naming generators from the constants module.
6. THE Public_API barrel SHALL export the shape catalog from the config module.
7. THE Public_API barrel SHALL export all validator functions from the validators module.
8. THE Public_API barrel SHALL export the Id_Generator utility from the utilities module.
9. WHEN a consumer imports from `@hecaton/core`, THE import SHALL resolve to the public-api barrel without exposing internal module paths.
