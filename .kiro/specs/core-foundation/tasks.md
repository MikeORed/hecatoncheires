# Implementation Plan: @hecaton/core Foundation

## Overview

Implement the pure domain layer (Layer 0) for the Hecatoncheires governance platform. This covers schemas, types, entity factories, domain errors, naming generators, shape catalog, shape resolution, policy assembly, validators, ID generation, and the public API barrel. All code lives in `packages/core/src/` using TypeScript with Zod for validation, Vitest for testing, and fast-check for property-based tests.

## Tasks

- [x] 1. Set up errors module and utilities
  - [x] 1.1 Implement domain error classes
    - Create `src/errors/domain-error.ts` with the abstract `DomainError` base class
    - Create `src/errors/validation-error.ts`, `src/errors/shape-not-found-error.ts`, `src/errors/invalid-shape-parameters-error.ts`, `src/errors/grant-conflict-error.ts`, `src/errors/config-not-found-error.ts`, `src/errors/internal-error.ts`
    - Create `src/errors/index.ts` barrel re-exporting all error classes
    - Each error must extend `DomainError`, have a readonly `code` property, accept `message` and optional `details: Record<string, unknown>`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 1.2 Implement ID generator utility
    - Create `src/utilities/id-generator.ts` implementing UUIDv7 generation (timestamp + random bits, version nibble `7`, variant bits `10xx`)
    - Create `src/utilities/index.ts` barrel
    - The function `generateId()` must return a valid UUIDv7 string that is K-sortable by creation time
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [x] 1.3 Write property tests for ID generator
    - **Property 17: ID generator produces valid UUIDv7 format**
    - **Property 18: ID generator produces time-sortable identifiers**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x] 2. Implement schemas and types modules
  - [x] 2.1 Implement ID schema
    - Create `src/schemas/id.schema.ts` with `IdSchema` validating UUIDv7 regex pattern
    - _Requirements: 10.4, 10.5_

  - [x] 2.2 Implement Agent Configuration schema
    - Create `src/schemas/agent-configuration.schema.ts` with `AgentConfigurationSchema` Zod object
    - Enforce configName pattern `^[a-z][a-z0-9-][a-z0-9]$`, max 40 chars, agentType enum, non-empty modelId/guardrailId/owner, guardrailVersion default to `DRAFT`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.3 Implement Runtime Tunables schema
    - Create `src/schemas/runtime-tunables.schema.ts` with `RuntimeTunablesSchema` Zod object
    - Enforce positive integers for thresholds, booleans for feature flags
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.4 Implement IAM policy and statement schemas
    - Create `src/schemas/iam-policy.schema.ts` with `IamStatementSchema` and `IamPolicyDocumentSchema`
    - Version literal `2012-10-17`, Statement array min 1, Effect enum, Action/Resource as string or string[]
    - _Requirements: 5.3_

  - [x] 2.5 Implement Shape Template schema
    - Create `src/schemas/shape-template.schema.ts` with `ShapeTemplateSchema` and `IamStatementTemplateSchema`
    - Validate shapeName, riskTier enum, requiredParameters array, statements array
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.6 Implement Grant Record schema
    - Create `src/schemas/grant-record.schema.ts` with `GrantRecordSchema`
    - grantId optional (UUIDv7 via IdSchema), configName pattern, shapeName non-empty, parameters record, grantedAt/grantedBy/expiresAt
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 2.7 Create schemas index barrel and types module
    - Create `src/schemas/index.ts` re-exporting all schemas
    - Create `src/types/index.ts` with inferred types: `AgentConfiguration`, `RuntimeTunables`, `ShapeTemplate`, `GrantRecord`, `IamPolicyDocument`, `IamStatement`
    - _Requirements: 11.1, 11.2_

- [x] 3. Implement entity factories
  - [x] 3.1 Implement Agent Configuration factory
    - Create `src/entity/agent-configuration.factory.ts`
    - Parse input with `AgentConfigurationSchema.safeParse`, throw `ValidationError` on failure, return `Object.freeze(result.data)` on success
    - _Requirements: 1.7, 1.8_

  - [x] 3.2 Implement Runtime Tunables factory
    - Create `src/entity/runtime-tunables.factory.ts`
    - Same pattern: safeParse, throw ValidationError or return frozen object
    - _Requirements: 2.6, 2.7_

  - [x] 3.3 Implement Grant Record factory
    - Create `src/entity/grant-record.factory.ts`
    - Parse input, auto-generate grantId via `generateId()` if not provided, throw ValidationError on failure, return frozen object
    - _Requirements: 4.8, 4.9_

  - [x] 3.4 Create entity index barrel
    - Create `src/entity/index.ts` re-exporting all factories
    - _Requirements: 11.3_

  - [x] 3.5 Write property tests for entity factories
    - **Property 1: Factory produces frozen, equivalent output for valid input**
    - **Property 2: Factory rejects all invalid input with ValidationError**
    - **Property 3: GuardrailVersion defaults to DRAFT when omitted**
    - **Property 4: Grant Record factory auto-generates a valid UUIDv7 grantId**
    - **Validates: Requirements 1.7, 1.8, 2.6, 2.7, 4.8, 4.9, 1.5, 4.1, 10.1, 10.2**

- [ ] 4. Checkpoint - Core entities verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement constants, config, and naming
  - [ ] 5.1 Implement AWS limits constants
    - Create `src/constants/limits.ts` with `AWS_INLINE_POLICY_SIZE_LIMIT = 10240` and any other relevant AWS limits
    - _Requirements: 8.5_

  - [ ] 5.2 Implement NamingGenerator class
    - Create `src/constants/naming.ts` with the `NamingGenerator` class
    - Constructor takes `stage` (non-empty string, throws ValidationError otherwise)
    - Implement methods: `roleName`, `profileName`, `guardrailName`, `alarmNames`, `queueNames`, `lambdaName`, `ruleName`, `harnessName`, `stackName`, `tableName`, `tags`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15_

  - [ ] 5.3 Create constants index barrel
    - Create `src/constants/index.ts` re-exporting limits and NamingGenerator
    - _Requirements: 11.5_

  - [ ] 5.4 Implement shape catalog configuration
    - Create `src/config/shape-catalog.ts` with `SHAPE_CATALOG` frozen array containing built-in shapes: `core-invocation`, `s3-prefix-read`, `s3-prefix-write`, `cloudwatch-logs-read`
    - Each shape must have correct riskTier, requiredParameters, and IAM statement templates with `${param}` placeholders
    - Create `src/config/index.ts` barrel
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 11.6_

  - [ ] 5.5 Write property tests for NamingGenerator
    - **Property 10: Naming generator produces pattern-conforming resource names**
    - **Property 11: Naming generator rejects empty or whitespace-only stage**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15**

- [ ] 6. Implement shared algorithms (shape resolution and policy assembly)
  - [ ] 6.1 Implement shape resolution algorithm
    - Create `src/shared/algorithms/resolve-shape.ts`
    - Function `resolveShape(template: ShapeTemplate, parameters: Record<string, string>): IamStatement[]`
    - Substitute all `${paramName}` placeholders in Resource fields
    - Throw `InvalidShapeParametersError` if required parameters are missing
    - _Requirements: 3.5, 3.6_

  - [ ] 6.2 Implement policy assembly algorithm
    - Create `src/shared/algorithms/assemble-policy.ts`
    - Function `assemblePolicy(grants: GrantRecord[], catalog: readonly ShapeTemplate[]): IamPolicyDocument`
    - Empty grants → deny-by-default (single Deny * statement)
    - Non-empty → resolve each grant's shape, union all statements without deduplication
    - Throw `ShapeNotFoundError` for unknown shape names
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 3.7_

  - [ ] 6.3 Create shared algorithms index barrel
    - Create `src/shared/algorithms/index.ts` re-exporting `resolveShape` and `assemblePolicy`
    - _Requirements: 11.8_

  - [ ] 6.4 Write property tests for shape resolution
    - **Property 5: Shape resolution substitutes all placeholders**
    - **Property 6: Shape resolution rejects incomplete parameter sets**
    - **Property 7: Shape resolution rejects unknown shape names**
    - **Validates: Requirements 3.5, 3.6, 3.7**

  - [ ] 6.5 Write property tests for policy assembly
    - **Property 8: Policy assembly preserves all resolved statements without deduplication**
    - **Property 9: Policy assembly always produces a valid IAM policy structure**
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [ ] 7. Checkpoint - Algorithms verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement validators
  - [ ] 8.1 Implement grant validator
    - Create `src/validators/grant.validator.ts`
    - Function `validateGrant(grant: GrantRecord, catalog: readonly ShapeTemplate[]): ValidationResult`
    - Check shapeName exists in catalog, all required parameters present, expiresAt > grantedAt if present
    - Return `{ valid: true }` or `{ valid: false, error: DomainError }`
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 8.2 Implement grant set validator
    - Create `src/validators/grant-set.validator.ts`
    - Function `validateGrantSet(grants: GrantRecord[]): ValidationResult`
    - Detect duplicate grants (same configName + shapeName + parameters deep equality) and return `GrantConflictError`
    - _Requirements: 8.4_

  - [ ] 8.3 Implement policy size validator
    - Create `src/validators/policy-size.validator.ts`
    - Function `validatePolicySize(policy: IamPolicyDocument): ValidationResult`
    - Check JSON serialization size against `AWS_INLINE_POLICY_SIZE_LIMIT` (10,240 bytes)
    - _Requirements: 8.5_

  - [ ] 8.4 Create validators index barrel
    - Create `src/validators/index.ts` re-exporting all validators
    - _Requirements: 11.7_

  - [ ] 8.5 Write property tests for validators
    - **Property 12: Grant validator rejects references to unknown shapes**
    - **Property 13: Grant validator rejects incomplete parameter sets**
    - **Property 14: Grant validator rejects invalid expiry timestamps**
    - **Property 15: Grant set validator detects duplicate grants**
    - **Property 16: Policy size validator rejects oversized policies**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 4.7**

- [ ] 9. Implement test generators and wire public API
  - [ ] 9.1 Implement fast-check arbitraries (test generators)
    - Create `src/test-generators/agent-configuration.arb.ts`, `runtime-tunables.arb.ts`, `grant-record.arb.ts`, `shape-template.arb.ts`
    - Create `src/test-generators/index.ts` barrel
    - Each arbitrary produces valid instances conforming to their respective schemas
    - Include combinators for generating invalid variants where needed by property tests

  - [ ] 9.2 Wire public API barrel
    - Update `src/public-api.ts` to re-export from all module barrels: schemas, types, entity, errors, constants, config, validators, shared/algorithms, utilities
    - Ensure no internal module paths are exposed — consumers import only from `@hecaton/core`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [ ] 9.3 Add fast-check dev dependency
    - Add `fast-check` to devDependencies in `packages/core/package.json`
    - Run install to update lockfile

- [ ] 10. Final checkpoint - Full verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (18 properties total)
- Unit tests validate specific examples and edge cases
- The design specifies TypeScript with Zod, Vitest, and fast-check — all tasks use these technologies
- All source files use `.ts` extension with ESM module resolution (`.js` extensions in imports per the project's `"type": "module"` config)
- The `domain/capability/` directory from the existing structure is unused by this spec — the design places shape-related code under `config/` and `shared/algorithms/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 2, "tasks": ["2.7", "5.1"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "5.2"] },
    { "id": 4, "tasks": ["3.4", "3.5", "5.3", "5.4"] },
    { "id": 5, "tasks": ["5.5", "6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "8.5", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] }
  ]
}
```
