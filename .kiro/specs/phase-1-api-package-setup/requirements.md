# Requirements Document

## Introduction

This document specifies the requirements for the `packages/api` runtime layer of the Hecatoncheires governance platform — Phase 1 scope. It covers DynamoDB, IAM, and EventBridge adapters; the grant-shape, revoke-shape, trip-breaker, query-fleet-state, and onboard-agent use-cases; Lambda handlers for HTTP and CloudWatch Alarm triggers; request/response DTOs with Zod validation; adapter port interfaces; and the standard response envelope with error mapping.

All domain logic (shape resolution, policy assembly, validators) is consumed from `@hecaton/core`. The API layer orchestrates those domain functions into workflows and owns the I/O boundary (AWS SDK calls, event parsing, response formatting).

## Glossary

| Term | Definition |
|---|---|
| Handler | Lambda entry-point function that parses an AWS event, delegates to a use-case, and formats the AWS response. Contains no business logic or AWS SDK calls. |
| Use_Case | Orchestration function that composes adapter calls and core domain functions into a single workflow (e.g., validate → write → reassemble → emit). |
| Adapter | Module that implements a port interface by calling an AWS SDK client. The only code in the API layer touching AWS services. |
| Port | TypeScript interface defining the contract between a use-case and an adapter. Use-cases depend on ports, never on adapter implementations. |
| Grant_Ledger_Adapter | Adapter providing CRUD access to the DynamoDB grant ledger table (PK=configName, SK=grantId). |
| Operating_Policy_Adapter | Adapter that writes or deletes the inline operating policy on an agent IAM role via `putRolePolicy` / `deleteRolePolicy`. |
| Bus_Emitter_Adapter | Adapter that publishes structured events to the ops EventBridge bus. |
| Request_DTO | Zod schema defining the shape of an inbound request payload after parsing from the AWS event. |
| Response_DTO | Typed object representing the outbound response body (success envelope or error envelope). |
| Mapper | Pure function converting between adapter DTOs and core domain objects (`toDomain`, `toResponse`, `toPersistence`, `fromPersistence`). |
| Response_Envelope | Standard JSON response format: `{ success: true, data }` or `{ success: false, error: { code, message, details } }`. |
| Shape_Catalog | Frozen array of capability shape templates from `@hecaton/core` used to resolve grants into IAM statements. |
| Operating_Policy | Single inline IAM policy on an agent role, deny-by-default at rest, rewritten to grant capabilities. |
| Breaker | The coarsest revocation — overwrites the operating policy with a deny-all statement, pulling invocation permission entirely. |

## Requirements

### Requirement 1: Port Interfaces (Adapter Abstractions)

**User Story:** As a developer, I want use-cases to depend on abstract port interfaces rather than concrete adapter implementations, so that the system follows clean architecture and adapters are testable in isolation.

#### Acceptance Criteria

1. THE Api_Layer SHALL define a `GrantLedgerPort` interface with methods: `putGrant(grant: GrantRecord): Promise<void>`, `deleteGrant(configName: string, grantId: string): Promise<void>`, `queryGrantsByConfig(configName: string): Promise<GrantRecord[]>`, and `scanAllConfigs(): Promise<GrantRecord[]>`.
2. THE Api_Layer SHALL define an `OperatingPolicyPort` interface with methods: `writePolicy(roleName: string, policyName: string, policyDocument: IamPolicyDocument): Promise<void>` and `deletePolicy(roleName: string, policyName: string): Promise<void>`.
3. THE Api_Layer SHALL define a `BusEmitterPort` interface with a method: `emit(event: BusEvent): Promise<void>` where `BusEvent` contains `source`, `detailType`, `detail` (serializable object), and optional `correlationId`.
4. THE Api_Layer SHALL export all port interfaces from the package barrel (`public-api.ts`).

### Requirement 2: DynamoDB Grant Ledger Adapter

**User Story:** As the platform, I want a DynamoDB adapter for the grant ledger, so that grant records can be persisted and queried by agent configuration name.

#### Acceptance Criteria

1. THE Grant_Ledger_Adapter SHALL implement the `GrantLedgerPort` interface.
2. WHEN `putGrant` is called, THE Grant_Ledger_Adapter SHALL write the grant record to the DynamoDB table using partition key `configName` and sort key `grantId`.
3. WHEN `deleteGrant` is called, THE Grant_Ledger_Adapter SHALL delete the item with the specified `configName` and `grantId` from the DynamoDB table.
4. WHEN `queryGrantsByConfig` is called, THE Grant_Ledger_Adapter SHALL query the table using partition key `configName` and return all matching grant records mapped to domain objects.
5. WHEN `scanAllConfigs` is called, THE Grant_Ledger_Adapter SHALL scan the full table and return all grant records mapped to domain objects.
6. THE Grant_Ledger_Adapter SHALL use a `toPersistence` mapper to convert domain `GrantRecord` objects to DynamoDB item format (string-typed attributes).
7. THE Grant_Ledger_Adapter SHALL use a `fromPersistence` mapper to convert DynamoDB items back to domain `GrantRecord` objects.
8. IF a DynamoDB operation fails, THEN THE Grant_Ledger_Adapter SHALL wrap the SDK error in an `InternalError` with the original error in `details`.

### Requirement 3: IAM Operating Policy Adapter

**User Story:** As the platform, I want an IAM adapter for the operating policy, so that capability grants and breaker trips can rewrite the inline policy on agent roles.

#### Acceptance Criteria

1. THE Operating_Policy_Adapter SHALL implement the `OperatingPolicyPort` interface.
2. WHEN `writePolicy` is called, THE Operating_Policy_Adapter SHALL call IAM `putRolePolicy` with the role name, policy name, and JSON-serialized policy document.
3. WHEN `writePolicy` is called, THE Operating_Policy_Adapter MAY skip the `putRolePolicy` call if the existing policy is identical to the requested policy document.
4. WHEN `deletePolicy` is called, THE Operating_Policy_Adapter SHALL call IAM `deleteRolePolicy` with the role name and policy name.
5. IF an IAM operation fails, THEN THE Operating_Policy_Adapter SHALL wrap the SDK error in an `InternalError` with the original error in `details`.
6. THE Operating_Policy_Adapter SHALL accept the operating policy name as a constructor parameter with a default value of `hecaton-operating-policy`.

### Requirement 4: EventBridge Bus Emitter Adapter

**User Story:** As the platform, I want an EventBridge adapter for the ops bus, so that governance events (grant-changed, capability-changed, breaker-tripped) are published for downstream consumers.

#### Acceptance Criteria

1. THE Bus_Emitter_Adapter SHALL implement the `BusEmitterPort` interface.
2. WHEN `emit` is called, THE Bus_Emitter_Adapter SHALL call EventBridge `putEvents` with a single entry containing the bus ARN, source, detail-type, and JSON-serialized detail.
3. IF the `correlationId` field is present on the event, THEN THE Bus_Emitter_Adapter SHALL include it in the event detail payload.
4. IF the EventBridge `putEvents` response reports `FailedEntryCount > 0`, THEN THE Bus_Emitter_Adapter SHALL retry the `putEvents` call with exponential backoff before throwing an `InternalError` with the failure reason in `details`.
5. IF an EventBridge SDK call fails after the `putEvents` retry logic is exhausted, THEN THE Bus_Emitter_Adapter SHALL wrap the SDK error in an `InternalError` with the original error in `details`.
6. THE Bus_Emitter_Adapter SHALL accept the event bus ARN as a constructor parameter.

### Requirement 5: Grant-Shape Use-Case

**User Story:** As an operator, I want to grant a capability shape to an agent configuration, so that the agent's operating policy is updated to allow the granted actions.

#### Acceptance Criteria

1. WHEN the Grant_Shape use-case is invoked with a valid grant request, THE Use_Case SHALL validate the grant using `validateGrant` from `@hecaton/core`.
2. IF grant validation fails, THEN THE Use_Case SHALL return the validation error without writing to the ledger.
3. WHEN validation passes, THE Use_Case SHALL write the grant record to the ledger via the `GrantLedgerPort`.
4. WHEN the grant is written, THE Use_Case SHALL query all grants for the same `configName` from the ledger.
5. WHEN all grants are retrieved, THE Use_Case SHALL call `assemblePolicy` from `@hecaton/core` with the grants and the shape catalog.
6. WHEN the policy is assembled, THE Use_Case SHALL validate the policy size using `validatePolicySize` from `@hecaton/core`.
7. IF the assembled policy exceeds the size limit, THEN THE Use_Case SHALL delete the newly written grant from the ledger and return a `ValidationError` indicating the policy size limit was exceeded.
8. WHEN the policy size is valid, THE Use_Case SHALL write the assembled policy to the agent role via the `OperatingPolicyPort`.
9. WHEN the policy is written, THE Use_Case SHALL attempt to emit a `grant-changed` event via the `BusEmitterPort` containing the `configName`, `grantId`, `shapeName`, and action `granted`. IF the event emission fails, THEN THE Use_Case SHALL complete successfully regardless — event emission is best-effort and SHALL NOT cause the operation to fail.
10. THE Use_Case SHALL return the created grant record on success.

### Requirement 6: Revoke-Shape Use-Case

**User Story:** As an operator, I want to revoke a capability shape from an agent configuration, so that the agent's operating policy is updated to remove the revoked actions.

#### Acceptance Criteria

1. WHEN the Revoke_Shape use-case is invoked, THE Use_Case SHALL delete the grant from the ledger via the `GrantLedgerPort` using `configName` and `grantId`.
2. WHEN the grant is deleted, THE Use_Case SHALL query all remaining grants for the same `configName` from the ledger.
3. WHEN remaining grants are retrieved, THE Use_Case SHALL call `assemblePolicy` from `@hecaton/core` with the remaining grants and the shape catalog.
4. WHEN the policy is assembled, THE Use_Case SHALL write the assembled policy to the agent role via the `OperatingPolicyPort`.
5. WHEN the policy is written, THE Use_Case SHALL attempt to emit a `grant-changed` event via the `BusEmitterPort` containing the `configName`, `grantId`, and action `revoked`. IF the event emission fails, THEN THE Use_Case SHALL complete successfully regardless — event emission is best-effort and SHALL NOT cause the operation to fail.
6. THE Use_Case SHALL return a confirmation object containing `configName`, `grantId`, and `operation` set to `'revoked'` on success.

### Requirement 7: Trip-Breaker Use-Case

**User Story:** As the platform, I want the circuit breaker to overwrite the operating policy with a deny-all statement when a threshold alarm fires, so that runaway agents are halted immediately.

#### Acceptance Criteria

1. WHEN the Trip_Breaker use-case is invoked, THE Use_Case SHALL write a deny-all policy document (`{ "Version": "2012-10-17", "Statement": [{ "Effect": "Deny", "Action": "*", "Resource": "*" }] }`) to the agent role via the `OperatingPolicyPort`.
2. WHEN the deny-all policy is written, THE Use_Case SHALL attempt to emit a `breaker-tripped` event via the `BusEmitterPort` containing the `configName`, `roleName`, and `reason`. IF the event emission fails, THEN THE Use_Case SHALL complete successfully regardless — event emission is best-effort and SHALL NOT cause the operation to fail.
3. THE Use_Case SHALL accept `configName`, `roleName`, and `reason` as input parameters.
4. THE Use_Case SHALL return a confirmation object containing `configName`, `roleName`, `operation` set to `'breaker-tripped'`, and `trippedAt` set to the ISO 8601 timestamp of when the trip occurred.
5. THE Use_Case SHALL NOT query the grant ledger — the breaker is an emergency path that overwrites the policy directly.

### Requirement 8: Query-Fleet-State Use-Case

**User Story:** As an operator, I want to query the fleet state showing all active grants across all configurations, so that I have a consolidated view of what agents are allowed to do.

#### Acceptance Criteria

1. WHEN the Query_Fleet_State use-case is invoked, THE Use_Case SHALL scan all grant records from the ledger via the `GrantLedgerPort`.
2. THE Use_Case SHALL group the returned grants by `configName`.
3. THE Use_Case SHALL return the grouped grants as a record mapping `configName` to an array of grants.
4. IF the ledger contains no grants (determined via a limit-1 query or count check without a full scan), THEN THE Use_Case SHALL return an empty record without performing a full table scan.

### Requirement 9: Onboard-Agent Use-Case

**User Story:** As an operator, I want to onboard a new agent configuration by writing its initial deny-all operating policy, so that the agent starts in a safe deny-by-default state.

#### Acceptance Criteria

1. WHEN the Onboard_Agent use-case is invoked with a `configName` and `roleName`, THE Use_Case SHALL write the deny-all policy document to the agent role via the `OperatingPolicyPort`.
2. IF the policy write operation fails, THEN THE Use_Case SHALL throw the error immediately to the caller without returning any confirmation.
3. WHEN the policy is written, THE Use_Case SHALL emit a `capability-changed` event via the `BusEmitterPort` containing the `configName` and action `onboarded`. IF the event emission fails, THEN THE Use_Case SHALL treat this as a critical failure and throw the error to the caller — event emission for onboard-agent is NOT best-effort.
4. THE Use_Case SHALL return a confirmation with the `configName` only after both the policy write and event emission have succeeded.

### Requirement 10: HTTP Request DTOs

**User Story:** As a developer, I want request payloads validated with Zod schemas at the handler boundary, so that invalid input is rejected before reaching the use-case layer.

#### Acceptance Criteria

1. THE Api_Layer SHALL define a `GrantShapeRequestSchema` (Zod) validating fields: `configName` (ConfigNamePattern), `roleName` (non-empty string), `shapeName` (non-empty string), `parameters` (record of string to string), `grantedBy` (non-empty string), and optional `expiresAt` (ISO 8601 datetime string).
2. THE Api_Layer SHALL define a `RevokeShapeRequestSchema` (Zod) validating fields: `configName` (ConfigNamePattern), `roleName` (non-empty string), and `grantId` (UUIDv7 pattern).
3. THE Api_Layer SHALL define an `OnboardAgentRequestSchema` (Zod) validating fields: `configName` (ConfigNamePattern) and `roleName` (non-empty string).
4. IF a request body fails validation, THEN THE Handler SHALL return HTTP status `400` with error code `VALIDATION_ERROR` in the error envelope. THE Handler SHALL always use `VALIDATION_ERROR` as the error code for any validation failure regardless of whether Zod issue details are available. WHEN Zod issue details are available, they SHALL be included in the `details` field; WHEN they are not available, THE Handler SHALL still return the `VALIDATION_ERROR` code with a descriptive message and no `details`.

### Requirement 11: Response Envelope

**User Story:** As an API consumer, I want all responses to follow a consistent envelope format, so that success and error responses are predictable to parse.

#### Acceptance Criteria

1. THE Api_Layer SHALL format all successful responses as `{ "success": true, "data": <payload> }`.
2. THE Api_Layer SHALL format all error responses as `{ "success": false, "error": { "code": "<ERROR_CODE>", "message": "<human-readable message>", "details": <optional object> } }`.
3. THE Api_Layer SHALL define a utility function `successResponse(statusCode, data)` that builds the API Gateway proxy response object with the success envelope.
4. THE Api_Layer SHALL define a utility function `errorResponse(statusCode, code, message, details?)` that builds the API Gateway proxy response object with the error envelope.

### Requirement 12: Error Code to HTTP Status Mapping

**User Story:** As a developer, I want domain error codes mapped to HTTP status codes at the handler layer, so that the API returns semantically correct HTTP responses.

#### Acceptance Criteria

1. THE Handler_Layer SHALL map error code `VALIDATION_ERROR` to HTTP status `400`.
2. THE Handler_Layer SHALL map error code `INVALID_SHAPE_PARAMETERS` to HTTP status `400`.
3. THE Handler_Layer SHALL map error code `SHAPE_NOT_FOUND` to HTTP status `404`.
4. THE Handler_Layer SHALL map error code `CONFIG_NOT_FOUND` to HTTP status `404`.
5. THE Handler_Layer SHALL map error code `GRANT_CONFLICT` to HTTP status `409`.
6. THE Handler_Layer SHALL map error code `INTERNAL_ERROR` to HTTP status `500`.
7. IF an error code is not in the mapping, THEN THE Handler_Layer SHALL default to HTTP status `500`.

### Requirement 13: Grant-Shape HTTP Handler

**User Story:** As an operator, I want to call a POST endpoint to grant a capability shape, so that I can manage agent permissions via the API.

#### Acceptance Criteria

1. WHEN the grant-shape.http handler receives an API Gateway proxy event, THE Handler SHALL parse the request body using `GrantShapeRequestSchema`.
2. WHEN parsing succeeds, THE Handler SHALL map the validated DTO to a domain `GrantRecord` using a `toDomain` mapper (auto-generating `grantId` and setting `grantedAt` to the current ISO timestamp).
3. WHEN the domain object is prepared, THE Handler SHALL invoke the Grant_Shape use-case.
4. WHEN the use-case succeeds, THE Handler SHALL return HTTP status `201` with the created grant in the success envelope.
5. IF the use-case returns a domain error, THEN THE Handler SHALL return the mapped HTTP status with the error envelope.
6. IF the use-case fails for non-domain reasons (infrastructure failures, timeouts), THEN THE Handler SHALL return HTTP status `500` with error code `INTERNAL_ERROR` in the error envelope.

### Requirement 14: Revoke-Shape HTTP Handler

**User Story:** As an operator, I want to call a POST endpoint to revoke a capability shape, so that I can remove agent permissions via the API.

#### Acceptance Criteria

1. WHEN the revoke-shape.http handler receives an API Gateway proxy event, THE Handler SHALL parse the request body using `RevokeShapeRequestSchema`.
2. WHEN parsing succeeds, THE Handler SHALL invoke the Revoke_Shape use-case with the parsed `configName`, `roleName`, and `grantId`.
3. WHEN the use-case succeeds, THE Handler SHALL return HTTP status `200` with the confirmation in the success envelope.
4. IF the use-case returns a domain error, THEN THE Handler SHALL return the mapped HTTP status with the error envelope.
5. IF the use-case fails for non-domain reasons, THEN THE Handler SHALL return HTTP status `500` with error code `INTERNAL_ERROR` in the error envelope.

### Requirement 15: Breaker-Trip Alarm Handler

**User Story:** As the platform, I want a handler that responds to CloudWatch Alarm state changes, so that the circuit breaker fires automatically when thresholds are breached.

#### Acceptance Criteria

1. WHEN the breaker-trip.alarm handler receives a CloudWatch Alarm state change event with `newStateValue` of `ALARM`, THE Handler SHALL extract `configName` and `roleName` from the alarm's dimensions or tags.
2. WHEN a valid alarm trigger is identified, THE Handler SHALL invoke the Trip_Breaker use-case with the `configName`, `roleName`, and `reason` extracted from the alarm name and state reason.
3. IF the alarm state change is not a transition to `ALARM` (e.g., `OK` or `INSUFFICIENT_DATA`), THEN THE Handler SHALL return without invoking the use-case.
4. IF the use-case succeeds, THEN THE Handler SHALL return a success acknowledgment.
5. IF the alarm event cannot be parsed (missing configName or roleName), THEN THE Handler SHALL log the error and return without throwing (alarm handlers must not retry on parse failures).

### Requirement 16: Query-Fleet-State HTTP Handler

**User Story:** As an operator, I want to call a GET endpoint to view the fleet state, so that I can see all active grants across configurations.

#### Acceptance Criteria

1. WHEN the query-fleet-state.http handler receives an API Gateway proxy event, THE Handler SHALL invoke the Query_Fleet_State use-case with no parameters.
2. WHEN the use-case succeeds, THE Handler SHALL return HTTP status `200` with the grouped grants in the success envelope.
3. IF the use-case throws an error, THEN THE Handler SHALL return the mapped HTTP status with the error envelope.

### Requirement 17: Onboard-Agent HTTP Handler

**User Story:** As an operator, I want to call a POST endpoint to onboard a new agent configuration, so that it starts with a deny-all operating policy.

#### Acceptance Criteria

1. WHEN the onboard-agent.http handler receives an API Gateway proxy event, THE Handler SHALL parse the request body using `OnboardAgentRequestSchema`.
2. WHEN parsing succeeds, THE Handler SHALL invoke the Onboard_Agent use-case with the parsed `configName` and `roleName`.
3. WHEN the use-case succeeds, THE Handler SHALL return HTTP status `201` with the confirmation in the success envelope.
4. IF the request body cannot be parsed (malformed JSON or schema validation failure), THEN THE Handler SHALL return the error using the standard error envelope format with error code `VALIDATION_ERROR` and HTTP status `400`, consistent with domain error responses.
5. IF the use-case returns a domain error, THEN THE Handler SHALL return the mapped HTTP status with the error envelope.

### Requirement 18: DynamoDB Persistence DTOs and Mappers

**User Story:** As a developer, I want pure mapper functions between DynamoDB item format and domain objects, so that the persistence boundary is explicit and testable.

#### Acceptance Criteria

1. THE Api_Layer SHALL define a `toPersistence` mapper that converts a domain `GrantRecord` to a DynamoDB item (all values as DynamoDB `AttributeValue` types with string marshalling).
2. THE Api_Layer SHALL define a `fromPersistence` mapper that converts a DynamoDB item back to a domain `GrantRecord`.
3. FOR ALL valid `GrantRecord` objects, converting via `toPersistence` then `fromPersistence` SHALL produce an object equivalent to the original (round-trip property).
4. IF a DynamoDB item is missing required fields, THEN THE `fromPersistence` mapper SHALL throw a `ValidationError`.

### Requirement 19: EventBridge Event DTOs

**User Story:** As a developer, I want structured event types for the ops bus, so that published events are consistent and parseable by downstream consumers.

#### Acceptance Criteria

1. THE Api_Layer SHALL define event detail types for: `grant-changed` (containing `configName`, `grantId`, `shapeName`, `action`, `timestamp`), `capability-changed` (containing `configName`, `action`, `timestamp`), and `breaker-tripped` (containing `configName`, `roleName`, `reason`, `timestamp`).
2. THE Api_Layer SHALL use source value `hecatoncheires.api` for all emitted events.
3. THE Api_Layer SHALL use detail-type values: `GrantChanged`, `CapabilityChanged`, `BreakerTripped`.

### Requirement 20: Handler Dependency Injection

**User Story:** As a developer, I want handlers to receive adapter instances via a factory, so that adapters can be swapped for testing and the handler remains free of construction logic.

#### Acceptance Criteria

1. WHEN a handler is invoked, THE Handler SHALL obtain adapter instances from a dependency container or factory function rather than constructing them inline.
2. THE Api_Layer SHALL define a `createDependencies` factory that instantiates all adapters with environment variable configuration (table name, bus ARN, etc.).
3. THE Api_Layer SHALL read the following environment variables: `GRANT_LEDGER_TABLE_NAME`, `OPS_BUS_ARN`, and `OPERATING_POLICY_NAME`.
4. IF a required environment variable is missing, THEN THE `createDependencies` factory SHALL throw an `InternalError` at handler cold-start.
5. THE Api_Layer SHALL lazy-evaluate the `createDependencies` factory on first handler invocation rather than at module load time, so that the module can be imported without the factory being called when handlers are not invoked (e.g., during testing or development).
