# Requirements Document

## Introduction

Tag consolidation standardizes the resource tagging vocabulary across the Hecatoncheires CDK infrastructure. Today the tag helper in `packages/core/src/constants/naming.ts` emits an optional `hecatoncheires:phase` tag and a `hecatoncheires:harness-type` tag, and stacks and constructs apply tags through a mix of the generic `tags()`/`tagsToCfn()` helper, hand-rolled CloudFormation tag arrays, and redundant construct-level tag loops.

This feature removes the `hecatoncheires:phase` tag entirely, renames `hecatoncheires:harness-type` to `hecatoncheires:agent-type` (carrying the raw enum value), and replaces the generic tag helpers with two purpose-specific helper pairs: one for per-agent resources (`agentTags`/`agentTagsToCfn`) and one for shared infrastructure (`sharedTags`/`sharedTagsToCfn`). Stacks are refactored to apply the correct tag set once at stack scope so tags propagate to nested resources, and redundant construct-level tag loops are removed. The workspace steering/structure document is updated to reflect the new tag vocabulary.

Account-level tagging features (cost allocation tag activation, invocation logging, synthesis-time warnings, preflight checks) are explicitly out of scope and tracked separately in the README TODO.

## Glossary

- **Tag_Helper**: The tag-generation methods on `NamingGenerator` in `packages/core/src/constants/naming.ts`.
- **NamingGenerator**: The deterministic resource name and tag generator class in core.
- **Agent_Tag_Set**: The full set of tags applied to per-agent resources: `hecatoncheires:managed`, `hecatoncheires:stage`, `hecatoncheires:config`, and `hecatoncheires:agent-type`.
- **Shared_Tag_Set**: The reduced set of tags applied to shared infrastructure resources: `hecatoncheires:managed` and `hecatoncheires:stage` (omitting `hecatoncheires:config` and `hecatoncheires:agent-type`).
- **Agent_Type**: The raw enum value identifying an agent harness type; one of `agentcore-managed`, `openclaw`, or `agentcore-runtime`.
- **Agent_Type_Tag**: The tag with key `hecatoncheires:agent-type` carrying an Agent_Type value.
- **AgentConfigStack**: The per-agent configuration stack that provisions Bedrock inference profiles, a guardrail, and AppConfig resources for a single agent config.
- **AgentcoreManagedStack**: The stack that provisions the AgentCore-managed harness (`CfnHarness`) for an agent.
- **SharedInfraStack**: The stack that provisions account-shared infrastructure, including the AppConfig application (`CfnApplication`).
- **AgentIdentity**: The construct that provisions per-agent IAM identity resources.
- **AgentPolicyModulator**: The construct that provisions the modulated operating policy resources.
- **AgentBusChannel**: The construct that provisions the per-agent SQS FIFO signal channel.
- **Structure_Doc**: The workspace steering/structure document that lists the standard resource tags.

## Requirements

### Requirement 1: Core Tag Helper Refactor

**User Story:** As a platform developer, I want a purpose-specific tag helper API in core, so that agent and shared resources receive the correct tag sets without an ambiguous generic helper.

#### Acceptance Criteria

1. THE Tag_Helper SHALL expose a method `agentTags(configName, { agentType })` that returns a record containing `hecatoncheires:managed` set to `'true'`, `hecatoncheires:stage` set to the generator stage, `hecatoncheires:config` set to the configName, and `hecatoncheires:agent-type` set to the agentType value.
2. THE Tag_Helper SHALL expose a method `sharedTags()` that returns a record containing `hecatoncheires:managed` set to `'true'` and `hecatoncheires:stage` set to the generator stage.
3. THE Tag_Helper SHALL expose a method `agentTagsToCfn(configName, { agentType })` that returns the Agent_Tag_Set as an array of `{ key, value }` entries suitable for L1 construct `tags` props.
4. THE Tag_Helper SHALL expose a method `sharedTagsToCfn()` that returns the Shared_Tag_Set as an array of `{ key, value }` entries suitable for L1 construct `tags` props.
5. THE Tag_Helper SHALL omit the `hecatoncheires:config` key and the `hecatoncheires:agent-type` key from the output of `sharedTags` and `sharedTagsToCfn`.
6. THE Tag_Helper SHALL exclude any `hecatoncheires:phase` key from the output of every tag method.
7. THE Tag_Helper SHALL remove the `tags()` method and the `tagsToCfn()` method.
8. THE Tag_Helper SHALL provide no backward-compatibility wrapper for the removed `tags()` or `tagsToCfn()` methods.
9. THE Agent_Type_Tag SHALL carry the raw Agent_Type enum value without transformation.

### Requirement 2: AgentConfigStack Tagging

**User Story:** As an operator, I want AgentConfigStack resources to carry the full agent tag set including agent-type, so that per-agent Bedrock, guardrail, and AppConfig resources are attributable to their config and harness type.

#### Acceptance Criteria

1. WHEN AgentConfigStack applies resource tags, THE AgentConfigStack SHALL source those tags from the `agentTags` Tag_Helper method.
2. THE AgentConfigStack SHALL apply the Agent_Tag_Set once at stack scope so that the tags propagate to nested resources.
3. WHEN the Agent_Tag_Set is applied at stack scope, THE AgentConfigStack SHALL cause the `hecatoncheires:agent-type` tag to reach the Bedrock inference profile resources.
4. WHERE an L1 construct requires `tags` props on Bedrock inference profile, guardrail, or AppConfig resources, THE AgentConfigStack SHALL source those props from the `agentTagsToCfn` Tag_Helper method.
5. THE AgentConfigStack SHALL remove all `hecatoncheires:phase` tag literals.

### Requirement 3: AgentcoreManagedStack Tagging

**User Story:** As a platform developer, I want AgentcoreManagedStack to derive agent-type from props rather than a hardcoded value, so that the harness tag reflects the actual agent type.

#### Acceptance Criteria

1. WHEN AgentcoreManagedStack sets the Agent_Type_Tag on the `CfnHarness` resource, THE AgentcoreManagedStack SHALL source the Agent_Type value from `props.agentType` or SHALL rely on the propagated stack-scope Agent_Tag_Set.
2. THE AgentcoreManagedStack SHALL apply no hardcoded Agent_Type literal value.
3. THE AgentcoreManagedStack SHALL remove all `hecatoncheires:phase` tag literals.

### Requirement 4: SharedInfraStack Tagging

**User Story:** As an operator, I want shared infrastructure to carry only the shared tag set, so that shared resources are never attributed to a single agent config or agent type.

#### Acceptance Criteria

1. WHEN SharedInfraStack applies resource tags, THE SharedInfraStack SHALL source those tags from the `sharedTags` Tag_Helper method.
2. WHERE the AppConfig `CfnApplication` resource requires tag props, THE SharedInfraStack SHALL source those props from the `sharedTagsToCfn` Tag_Helper method instead of a hand-rolled `CfnTag` array.
3. THE SharedInfraStack SHALL remove all `hecatoncheires:phase` tag literals.

### Requirement 5: Construct-Level Tag Loop Removal

**User Story:** As a platform developer, I want redundant construct-level tag loops removed, so that tag application is centralized at stack scope and not duplicated.

#### Acceptance Criteria

1. THE AgentIdentity construct SHALL remove the redundant construct-level tag loop that duplicates the stack-scope Agent_Tag_Set.
2. THE AgentPolicyModulator construct SHALL remove the redundant construct-level tag loop that duplicates the stack-scope Agent_Tag_Set.
3. THE AgentBusChannel construct SHALL remove the redundant construct-level tag loop that duplicates the stack-scope Agent_Tag_Set.
4. WHEN construct-level tag loops are removed, THE AgentConfigStack SHALL continue to propagate the Agent_Tag_Set to the resources previously tagged by those constructs.

### Requirement 6: Tagging Invariants

**User Story:** As an operator, I want the tagging invariants preserved, so that attribution boundaries between shared and per-agent resources remain correct.

#### Acceptance Criteria

1. THE SharedInfraStack SHALL apply no `hecatoncheires:config` tag to shared infrastructure resources.
2. THE Agent_Type_Tag SHALL be applied to per-agent resources only and SHALL NOT be applied to shared infrastructure resources.
3. WHEN a resource is referenced across stacks, THE referencing stack SHALL retain the tags of the resource's owning stack.
4. THE `hecatoncheires:stage` tag SHALL be applied to both per-agent resources and shared infrastructure resources.
5. THE `hecatoncheires:managed` tag SHALL be set to `'true'` on both per-agent resources and shared infrastructure resources.

### Requirement 7: Test Updates

**User Story:** As a platform developer, I want the tests updated to match the new tag vocabulary, so that the test suite verifies the consolidated tagging behavior.

#### Acceptance Criteria

1. THE `naming.test.ts` suite SHALL remove assertions for the `hecatoncheires:phase` tag and the `hecatoncheires:harness-type` tag and SHALL assert the `agentTags`, `sharedTags`, `agentTagsToCfn`, and `sharedTagsToCfn` behavior.
2. THE `naming.property.test.ts` suite SHALL remove properties referencing `hecatoncheires:phase` or `hecatoncheires:harness-type` and SHALL cover the new helper methods.
3. THE `shared-infra.stack.test.ts` suite SHALL remove assertions for the `hecatoncheires:phase` tag and SHALL assert that shared resources omit `hecatoncheires:config` and `hecatoncheires:agent-type`.
4. THE `agent-config.stack.test.ts` suite SHALL remove assertions for the `hecatoncheires:phase` tag and the `hecatoncheires:harness-type` tag and SHALL add coverage asserting that the `hecatoncheires:agent-type` tag reaches the Bedrock inference profile resources.
5. THE `agent-bus-channel.construct.test.ts` suite SHALL remove assertions for the `hecatoncheires:phase` tag and the `hecatoncheires:harness-type` tag.

### Requirement 8: Structure Document Update

**User Story:** As a contributor, I want the steering/structure document to reflect the current tag vocabulary, so that the documentation matches the implementation.

#### Acceptance Criteria

1. THE Structure_Doc SHALL remove `hecatoncheires:phase` from the standard-tag list.
2. THE Structure_Doc SHALL replace `hecatoncheires:harness-type` with `hecatoncheires:agent-type` in the standard-tag list.

### Requirement 9: Verification

**User Story:** As a platform developer, I want the workspace build, tests, and lint to pass, so that the tag consolidation is verifiably complete.

#### Acceptance Criteria

1. WHEN `pnpm build` runs from the workspace root, THE build SHALL complete without errors.
2. WHEN `pnpm test` runs from the workspace root, THE test suite SHALL pass.
3. WHEN `pnpm lint` runs from the workspace root, THE lint check SHALL pass.

## Non-Goals

The following account-level features are explicitly out of scope for this feature and are tracked separately in the README TODO:

1. Cost allocation tag activation.
2. Bedrock invocation logging configuration.
3. Synthesis-time (synth) tagging warnings.
4. Preflight tag validation checks.
