# Implementation Plan: Phase 1 API Package Setup

## Overview

Implement the `packages/api` runtime layer following clean architecture: port interfaces, adapters (DynamoDB, IAM, EventBridge), use-cases (grant-shape, revoke-shape, trip-breaker, query-fleet-state, onboard-agent), HTTP/alarm handlers, request/response DTOs with Zod validation, mapper functions, response envelope utilities, error mapping, and the dependency injection factory. All code is TypeScript ESM targeting Node.js 20 with Vitest for testing and fast-check for property-based tests.

## Tasks

- [ ] 1. Define port interfaces and shared infrastructure
  - [ ] 1.1 Create port interfaces (GrantLedgerPort, OperatingPolicyPort, BusEmitterPort)
    - Create `src/ports/grant-ledger.port.ts` with the `GrantLedgerPort` interface (putGrant, deleteGrant, queryGrantsByConfig, scanAllConfigs)
    - Create `src/ports/operating-policy.port.ts` with the `OperatingPolicyPort` interface (writePolicy, deletePolicy)
    - Create `src/ports/bus-emitter.port.ts` with the `BusEvent` type and `BusEmitterPort` interface (emit)
    - Create `src/ports/index.ts` barrel re-exporting all port interfaces
    - Update `src/public-api.ts` to export all port interfaces
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Create response envelope utilities and error status map
    - Create `src/adapters/http/dto/responses/envelope.ts` with `successResponse(statusCode, data)` and `errorResponse(statusCode, code, message, details?)` functions returning `APIGatewayProxyResult`
    - Create `src/adapters/http/error-status-map.ts` mapping error codes to HTTP status codes (VALIDATION_ERROR→400, INVALID_SHAPE_PARAMETERS→400, SHAPE_NOT_FOUND→404, CONFIG_NOT_FOUND→404, GRANT_CONFLICT→409, INTERNAL_ERROR→500)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ] 1.3 Write property tests for response envelope utilities
    - **Property 3: Success envelope structure** — for any status code and JSON-serializable data, `successResponse` produces a response where parsed body has `success === true` and `data` equals input
    - **Property 4: Error envelope structure** — for any status code, code string, message, and optional details, `errorResponse` produces a response where parsed body has `success === false` with correct error fields
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [ ] 1.4 Create the dependency injection factory
    - Create `src/shared/dependencies.ts` with `getDependencies()` lazy factory, `resetDependencies()` for test support, and `requireEnv()` helper
    - Read environment variables: `GRANT_LEDGER_TABLE_NAME`, `OPS_BUS_ARN`, `OPERATING_POLICY_NAME`
    - Throw `InternalError` if required env vars are missing
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [ ] 2. Implement DTOs and mapper functions
  - [ ] 2.1 Create HTTP request DTO schemas (Zod)
    - Create `src/adapters/http/dto/requests/grant-shape.request.ts` with `GrantShapeRequestSchema` (configName, roleName, shapeName, parameters, grantedBy, optional expiresAt)
    - Create `src/adapters/http/dto/requests/revoke-shape.request.ts` with `RevokeShapeRequestSchema` (configName, roleName, grantId as UUIDv7)
    - Create `src/adapters/http/dto/requests/onboard-agent.request.ts` with `OnboardAgentRequestSchema` (configName, roleName)
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 2.2 Create HTTP response mappers
    - Create `src/adapters/http/dto/mappers/grant-shape.mapper.ts` with `toDomain(dto): GrantRecord` (generates grantId UUIDv7 + grantedAt timestamp) and `toResponse(grant): Record<string, unknown>`
    - Create `src/adapters/http/dto/mappers/revoke-shape.mapper.ts` with `toResponse` mapper
    - Create `src/adapters/http/dto/mappers/onboard-agent.mapper.ts` with `toResponse` mapper
    - _Requirements: 13.2_

  - [ ] 2.3 Write property test for HTTP-to-domain mapper
    - **Property 2: HTTP-to-domain mapper correctness** — for any valid `GrantShapeRequest`, `toDomain` produces a `GrantRecord` passing schema validation with valid UUIDv7 grantId, valid ISO 8601 grantedAt, and all input fields preserved
    - **Validates: Requirements 13.2**

  - [ ] 2.4 Create DynamoDB persistence mappers
    - Create `src/adapters/dynamo/dto/grant-record.mapper.ts` with `toPersistence(grant): Record<string, AttributeValue>` and `fromPersistence(item): GrantRecord`
    - Serialize `parameters` as JSON string, handle optional `expiresAt`
    - Throw `ValidationError` on missing required fields in `fromPersistence`
    - _Requirements: 18.1, 18.2, 18.4, 2.6, 2.7_

  - [ ] 2.5 Write property test for DynamoDB mapper round-trip
    - **Property 1: Persistence mapper round-trip** — for any valid `GrantRecord`, `toPersistence` then `fromPersistence` produces an equivalent object
    - **Validates: Requirements 18.3, 2.6, 2.7**

  - [ ] 2.6 Create EventBridge event DTOs and mappers
    - Create `src/adapters/eventbridge/dto/event.mapper.ts` with types `GrantChangedDetail`, `CapabilityChangedDetail`, `BreakerTrippedDetail` and mapper functions `toGrantChangedEvent`, `toCapabilityChangedEvent`, `toBreakerTrippedEvent`
    - Source: `'hecatoncheires.api'`, detail-types: `'GrantChanged'`, `'CapabilityChanged'`, `'BreakerTripped'`
    - _Requirements: 19.1, 19.2, 19.3_

  - [ ] 2.7 Write property test for event mapper output consistency
    - **Property 5: Event mapper output consistency** — for any valid event detail, the mapper produces a `BusEvent` with source `'hecatoncheires.api'` and correct detail-type
    - **Validates: Requirements 19.2, 19.3**

- [ ] 3. Implement adapters
  - [ ] 3.1 Implement DynamoDB Grant Ledger adapter
    - Create `src/adapters/dynamo/grant-ledger.adapter.ts` implementing `GrantLedgerPort`
    - Implement `putGrant` (PutItemCommand), `deleteGrant` (DeleteItemCommand), `queryGrantsByConfig` (QueryCommand with PK=configName), `scanAllConfigs` (ScanCommand)
    - Use `toPersistence`/`fromPersistence` mappers for data conversion
    - Wrap SDK errors in `InternalError`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ] 3.2 Implement IAM Operating Policy adapter
    - Create `src/adapters/iam/operating-policy.adapter.ts` implementing `OperatingPolicyPort`
    - Implement `writePolicy` (PutRolePolicyCommand) and `deletePolicy` (DeleteRolePolicyCommand)
    - Accept `defaultPolicyName` constructor parameter with default `'hecaton-operating-policy'`
    - Wrap SDK errors in `InternalError`
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

  - [ ] 3.3 Implement EventBridge Bus Emitter adapter
    - Create `src/adapters/eventbridge/bus-emitter.adapter.ts` implementing `BusEmitterPort`
    - Implement `emit` with PutEventsCommand, include `correlationId` in detail if present
    - Implement retry with exponential backoff when `FailedEntryCount > 0` (max 3 retries)
    - Wrap SDK errors in `InternalError` after retries exhausted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ] 3.4 Write unit tests for adapters
    - Test DynamoDB adapter sends correct commands and handles errors
    - Test IAM adapter sends correct commands and handles errors
    - Test EventBridge adapter retry logic on FailedEntryCount > 0
    - _Requirements: 2.8, 3.5, 4.4, 4.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement use-cases
  - [ ] 5.1 Implement grant-shape use-case
    - Create `src/use-cases/grant-shape.ts`
    - Validate grant via `validateGrant` from `@hecaton/core`, return error on failure without ledger write
    - Write grant → query all grants → assemble policy → validate size
    - If size exceeded: delete newly written grant, throw `ValidationError`
    - Write policy → emit `grant-changed` event (best-effort) → return grant record
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ] 5.2 Implement revoke-shape use-case
    - Create `src/use-cases/revoke-shape.ts`
    - Delete grant → query remaining → assemble policy → write policy → emit event (best-effort) → return confirmation
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 5.3 Implement trip-breaker use-case
    - Create `src/use-cases/trip-breaker.ts`
    - Write deny-all policy (`Effect: Deny, Action: *, Resource: *`) → emit `breaker-tripped` event (best-effort) → return confirmation with `trippedAt` timestamp
    - No ledger query — emergency path
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.4 Implement query-fleet-state use-case
    - Create `src/use-cases/query-fleet-state.ts`
    - Scan all grants → group by `configName` → return grouped record
    - Return empty record if ledger is empty
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 5.5 Implement onboard-agent use-case
    - Create `src/use-cases/onboard-agent.ts`
    - Write deny-all policy → emit `capability-changed` event (CRITICAL — throws on failure)
    - Return confirmation only after both succeed
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 5.6 Write property tests for use-cases
    - **Property 6: Invalid grant rejection without ledger write** — for any GrantRecord failing validateGrant, use-case returns error and putGrant is never called
    - **Property 7: Best-effort emission independence** — for grant-shape, revoke-shape, and trip-breaker, if emit throws, use-case still completes successfully
    - **Property 8: Fleet-state grouping correctness** — for any set of GrantRecords, result keys match all configNames, values contain exactly their grants, and union equals input
    - **Property 10: Onboard-agent critical emission failure propagation** — if emit throws during onboard-agent, the error propagates to caller
    - **Validates: Requirements 5.1, 5.2, 5.9, 6.5, 7.2, 8.2, 8.3, 9.3**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Lambda handlers
  - [ ] 7.1 Implement grant-shape HTTP handler
    - Create `src/handlers/grant-shape.http.ts`
    - Parse body with `GrantShapeRequestSchema`, map to domain via `toDomain`, invoke grant-shape use-case
    - Return 201 on success, map domain errors via `errorStatusMap`, return 500 for unknown errors
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 10.4_

  - [ ] 7.2 Implement revoke-shape HTTP handler
    - Create `src/handlers/revoke-shape.http.ts`
    - Parse body with `RevokeShapeRequestSchema`, invoke revoke-shape use-case
    - Return 200 on success, map errors appropriately
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 10.4_

  - [ ] 7.3 Implement breaker-trip alarm handler
    - Create `src/handlers/breaker-trip.alarm.ts`
    - Check for ALARM state transition, extract configName/roleName from alarm dimensions
    - No-op for non-ALARM states, log and return on parse failures (no throw)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ] 7.4 Implement query-fleet-state HTTP handler
    - Create `src/handlers/query-fleet-state.http.ts`
    - Invoke query-fleet-state use-case, return 200 with grouped grants
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ] 7.5 Implement onboard-agent HTTP handler
    - Create `src/handlers/onboard-agent.http.ts`
    - Parse body with `OnboardAgentRequestSchema`, invoke onboard-agent use-case
    - Return 201 on success, 400 VALIDATION_ERROR on parse failure
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 7.6 Write property tests for handler validation behavior
    - **Property 9: Validation failure produces 400 VALIDATION_ERROR** — for any request body failing Zod validation, the handler returns status 400 with error code `'VALIDATION_ERROR'`
    - Test across grant-shape, revoke-shape, and onboard-agent handlers
    - **Validates: Requirements 10.4**

  - [ ] 7.7 Write unit tests for handlers
    - Test happy-path delegation for each handler
    - Test error mapping for domain errors
    - Test alarm handler no-op for non-ALARM states
    - Test alarm handler silent return on parse failures
    - _Requirements: 13.4, 13.5, 13.6, 14.4, 14.5, 15.3, 15.5, 20.1_

- [ ] 8. Wire up barrel exports and finalize public API
  - [ ] 8.1 Update public-api.ts barrel export
    - Ensure `src/public-api.ts` exports all port interfaces and response envelope utilities
    - Verify no deep subpath imports are required by consumers
    - _Requirements: 1.4, 11.3, 11.4_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and SDK call patterns
- All adapters use constructor injection for AWS SDK clients, enabling mock injection in tests
- The `getDependencies()` factory is lazy-evaluated — safe to import without triggering SDK initialization
- Use `@hecaton/core` test generators (`arbGrantRecord`, `arbConfigName`, etc.) in property tests where available

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6"] },
    { "id": 3, "tasks": ["2.3", "2.5", "2.7", "3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 5, "tasks": ["5.6", "7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["7.6", "7.7", "8.1"] }
  ]
}
```
