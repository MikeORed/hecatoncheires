# Requirements Document

## Introduction

The three documents in `.initial-planning/` (`Hecatoncheires.md`, `architecture.md`, `diagrams.md`) were written before most of the implementation existed. A drift comparison against the code found interface specifications that no longer describe any real file, resolved open questions still recorded as open, and diagrams that read as descriptions of a running system while actually describing unbuilt specification.

This feature is a documentation-only triage of those three documents, plus the creation of a fourth sibling document that holds the decisions record, plus one correction to `.kiro/steering/structure.md`. It applies an agreed four-rule triage framework: keep decisions and rationale, discard interface specifications rather than correcting them, aggregate resolved open questions into a decisions record, and annotate aspirational content in place with built-versus-specified labelling rather than silently correcting it.

The triage changes no source code. Where a document currently implies that half-wired or unrouted code works, the triage records that as a known-gap annotation and stops there.

## Glossary

- **Triage**: The documentation revision effort defined by this specification.
- **Planning_Docs**: The set of markdown files in the repository folder `.initial-planning/`.
- **Brief_Doc**: `.initial-planning/Hecatoncheires.md`, the project brief containing outcome, success criteria, and milestones.
- **Architecture_Doc**: `.initial-planning/architecture.md`, the monorepo and layering document.
- **Diagrams_Doc**: `.initial-planning/diagrams.md`, containing the nine numbered Mermaid diagrams.
- **Decisions_Doc**: `.initial-planning/decisions.md`, the new sibling document created by the Triage to hold the decisions record.
- **Structure_Steering_Doc**: `.kiro/steering/structure.md`.
- **Vault_Copy**: The Obsidian vault copy of the Planning_Docs, which becomes a read-only archive and is no longer synchronised.
- **Steering_Block**: An Obsidian callout opening with the exact line `> [!note] Maintaining this document`, placed immediately after a document's YAML frontmatter and before that document's first heading or body content.
- **Interface_Specification**: Prose or tabular content in the Planning_Docs that enumerates construct props, construct outputs, file inventories, handler inventories, adapter inventories, or folder decompositions.
- **Built_Marker**: An annotation that labels a diagram element, edge, or participant as implemented in the current code.
- **Specification_Marker**: An annotation that labels a diagram element, edge, or participant as designed but not implemented in the current code.
- **Known_Gap_Annotation**: An annotation recording that code referenced by a document exists but does not deliver the behaviour the document implies.
- **Deliberate_Wikilink**: One of the three frontmatter wikilink values retained on purpose: `parent:` in Architecture_Doc, `parent:` in Diagrams_Doc, `area:` in Brief_Doc.

## Requirements

### Requirement 1: Repository copies are canonical

**User Story:** As the maintainer of Hecatoncheires, I want the repository copies of the planning documents treated as the single canonical source, so that I stop reconciling two diverging copies of the same content.

#### Acceptance Criteria

1. THE Triage SHALL apply all content changes to the files under `.initial-planning/` in the repository working tree.
2. THE Triage SHALL leave the Vault_Copy untouched.
3. THE Triage SHALL preserve every existing YAML frontmatter key and value in Brief_Doc, Architecture_Doc, and Diagrams_Doc, except for the `revised` date where a document defines one.
4. THE Triage SHALL preserve each Deliberate_Wikilink exactly as written, including its surrounding quotation marks and any display alias.
5. THE Triage SHALL introduce no frontmatter key that is absent from the edited document before the Triage, including a `canonical` key.
6. THE Steering_Block of each Planning_Doc SHALL state in prose that the repository copy is the copy to edit.

### Requirement 2: Resolved questions collected in one decisions record

**User Story:** As the maintainer, I want every resolved open question collected in one place, so that decided questions stop appearing as open work in three separate documents.

#### Acceptance Criteria

1. THE Triage SHALL create the file `.initial-planning/decisions.md` as Decisions_Doc.
2. THE Decisions_Doc SHALL contain one section per recorded decision.
3. Each section of THE Decisions_Doc SHALL name the question that the decision closed.
4. THE Decisions_Doc SHALL record the grant ledger decision as DynamoDB, keyed on `configName` and `grantId`, with TTL on `expiresAt`, point-in-time recovery enabled, and `RemovalPolicy.RETAIN`.
5. THE Decisions_Doc SHALL record the previously undocumented agent registry table as a second DynamoDB table using a single-table `pk`/`sk` key schema with an inverted global secondary index named `gsi1`.
6. THE Decisions_Doc SHALL record the capability shape catalog decision as four frozen shapes carrying risk tiers, defined in `packages/core/src/config/shape-catalog.ts`.
7. THE Decisions_Doc SHALL record the Lambda topology decision as shared, with one breaker Lambda in `SharedInfraStack` invoked by the alarms of every agent.
8. THE Decisions_Doc SHALL record the permission boundary decision as a move from one shared fleet ceiling to a per-agent managed policy created inside the `AgentIdentity` construct.
9. THE Decisions_Doc SHALL record the harness abstraction decision as a move from an L3 construct named `AgentTypeHarness` to CDK stack inheritance comprising an abstract `AgentConfigStack` and a concrete `AgentCoreManagedStack`, and SHALL state that the resulting deployment unit is one CloudFormation stack per agent config.
10. THE Decisions_Doc SHALL record that the `AgentTelemetry` construct was superseded by the DynamoDB agent registry.
11. THE Triage SHALL remove every TBD list and every open-question list from Brief_Doc, Architecture_Doc, and Diagrams_Doc.
12. Brief_Doc, Architecture_Doc, and Diagrams_Doc SHALL each contain a relative markdown link to `./decisions.md`.

### Requirement 3: Interface specifications removed rather than corrected

**User Story:** As the maintainer, I want interface specifications removed rather than corrected, so that no copy of the code's shape can drift again.

#### Acceptance Criteria

1. THE Triage SHALL delete from Architecture_Doc the props and outputs listings for `AgentIdentity`, `AgentPolicyModulator`, and `AgentBusChannel`.
2. THE Triage SHALL delete from Architecture_Doc the twelve-file construct inventory.
3. THE Triage SHALL delete from Architecture_Doc the stack inventory that lists a `TelemetryStack` and omits `AgentCoreManagedStack`.
4. THE Triage SHALL delete from Architecture_Doc the nine-handler inventory.
5. THE Triage SHALL delete from Architecture_Doc the adapter inventory and the five-folder `packages/core/src/domain/` decomposition listing.
6. WHERE Architecture_Doc previously carried a deleted Interface_Specification, THE Triage SHALL replace that content with a reference to the package or folder in `packages/` that now serves as the specification.
7. THE Triage SHALL leave the resource naming convention table in Architecture_Doc unchanged.
8. THE Triage SHALL retain all decision and rationale prose in Brief_Doc, Architecture_Doc, and Diagrams_Doc, including the reasoning for the three-layer role model, the choice of IAM enforcement over an application-layer gate, and the choice of deny-by-default over an approval queue.

### Requirement 4: Diagrams 3 and 9 rewritten from the code

**User Story:** As the maintainer, I want diagrams 3 and 9 rewritten from the code, so that the two most out-of-date diagrams describe the system that exists.

#### Acceptance Criteria

1. THE Triage SHALL rewrite diagram 3 in Diagrams_Doc from the current contents of `packages/cdk/lib/constructs/`, `packages/cdk/lib/stacks/`, and `packages/api/src/handlers/`.
2. THE Triage SHALL rewrite diagram 9 in Diagrams_Doc from the current contents of `packages/cdk/lib/stacks/shared-infra.stack.ts` and the breaker handler in `packages/api/src/handlers/`.
3. Diagram 9 SHALL include the DynamoDB agent registry table as a participant in the circuit breaker path.
4. THE Triage SHALL remove from diagram 9 every edge depicting a threshold read from AppConfig.
5. Diagram 9 SHALL state that alarm thresholds are synth-time constants originating in the seed configuration JSON.
6. THE rewritten diagrams 3 and 9 SHALL use Mermaid syntax that renders in both Obsidian and GitHub markdown preview.

### Requirement 5: Remaining diagrams annotated rather than corrected

**User Story:** As the maintainer, I want every diagram to carry a status annotation, so that the difference between what was designed and what was built stays visible.

#### Acceptance Criteria

1. THE Triage SHALL annotate every diagram in Diagrams_Doc, and SHALL retain the original diagram content of diagrams 1, 2, 4, 5, 6, 7, and 8.
2. Each annotation SHALL apply a Built_Marker or a Specification_Marker to the diagram elements it covers.
3. THE annotation of diagram 2 SHALL state that the resting operating policy is `Deny *`, and SHALL state that no model invocation is possible until a `core-invocation` grant exists.
4. THE annotation of diagram 4 SHALL state that the diagram text describes the breaker revoking the invocation shape, and SHALL state that `packages/api/src/use-cases/trip-breaker.ts` writes a full deny-all policy instead.
5. THE annotation of diagram 5 SHALL identify which of the depicted edges is implemented.
6. THE annotation of diagram 6 SHALL state that the participant labelled "Policy Modulator" is API Gateway fronting a grant-shape Lambda.
7. THE annotation of diagram 7 SHALL state that the per-agent leg is implemented, that the shared signals bus is not, and that `AgentBusChannel` is unreachable from `packages/cdk/bin/app.ts` because no seed configuration supplies a signals bus ARN.
8. THE Triage SHALL use one consistent annotation format across every annotated diagram.

### Requirement 6: Known code gaps recorded where a document implies working behaviour

**User Story:** As the maintainer, I want known code gaps recorded where a document implies working behaviour, so that a reader is not misled by a document that is otherwise accurate.

#### Acceptance Criteria

1. WHERE a Planning_Doc states or implies that operational thresholds change without a deployment, THE Triage SHALL add a Known_Gap_Annotation stating that AppConfig tunables are written at deploy time and that no code reads them.
2. THE Triage SHALL record that the `appconfig` and `cloudwatch` adapter folders in `packages/api/src/adapters/` contain only a `.gitkeep` file.
3. THE Triage SHALL confine each Known_Gap_Annotation to a statement of the current gap.
4. THE Triage SHALL make no change to any file under `packages/`.

### Requirement 7: Each document carries its own maintenance rules

**User Story:** As the maintainer, I want each planning document to carry its own maintenance rules, so that the next person editing it knows the constraints without reading this spec.

#### Acceptance Criteria

1. THE Triage SHALL add a Steering_Block to Brief_Doc, Architecture_Doc, Diagrams_Doc, and Decisions_Doc.
2. Each Steering_Block SHALL open with the exact line `> [!note] Maintaining this document`.
3. Each Steering_Block SHALL appear immediately after the closing `---` of its document's frontmatter and before that document's first heading or body content.
4. THE Steering_Block of Brief_Doc SHALL state a review cadence tied to the document's milestones.
5. THE Steering_Block of Architecture_Doc SHALL state that Interface_Specification content is not to be reintroduced and that the code in `packages/` is the specification.
6. THE Steering_Block of Diagrams_Doc SHALL state that Built_Marker and Specification_Marker labelling is to be kept accurate as implementation advances.
7. THE Steering_Block of Decisions_Doc SHALL state that the document grows by appending new decisions and that a closed decision is superseded by a new section rather than edited in place.

### Requirement 8: Stale role-name pattern corrected in structure steering

**User Story:** As the maintainer, I want the stale role-name pattern in the structure steering file corrected, so that the steering file and the code agree.

#### Acceptance Criteria

1. THE Triage SHALL replace the IAM role naming pattern in Structure_Steering_Doc with `hecaton-{stage}-{configName}-agent-role`.
2. THE Triage SHALL change no other naming pattern in Structure_Steering_Doc.

### Requirement 9: Documents render correctly in Obsidian and on GitHub

**User Story:** As the maintainer, I want the edited documents to render correctly in both tools I read them in, so that the triage output is usable in Obsidian and on GitHub.

#### Acceptance Criteria

1. THE Planning_Docs SHALL each parse as valid YAML frontmatter followed by markdown body content after the Triage.
2. Every Mermaid code fence in Diagrams_Doc SHALL parse without a syntax error after the Triage.
3. Every relative markdown link between Planning_Docs SHALL resolve to an existing file in `.initial-planning/` after the Triage.
4. IF a Planning_Doc references a path under `packages/`, THEN THE Triage SHALL confirm that the referenced path exists in the repository.
