# Implementation Plan: planning-doc-triage

## Overview

This is a documentation edit across five files. The design document already carries the finished text for nearly every change: all four steering blocks, all seven decision sections, both rewritten Mermaid fences, all nine diagram annotations, both known-gap callouts, and every interface-specification replacement. So most tasks below are transcription from the design into the target file, not authoring. Where a task does require judgement, it says so.

Task order follows the design's "Edit sequencing" section. That order exists to keep every relative link valid at each intermediate state: the decisions record is created first because nothing links to it yet and its own outbound links already resolve, then the documents that link to it, then the steering file, then verification. Deviating from the order leaves a dead `./decisions.md` link in a committed state.

The programming language question does not apply. No code is written and no file under `packages/` changes.

Scope boundaries that hold for every task:

The triage makes no change to any file under `packages/`. The design records seven real code gaps as documentation annotations: the deny-all policy written where the invocation shape should be revoked, the missing grant expiry sweep, `onboard-agent.http.ts` having no Lambda and no route, the SNS topic having no subscription, AppConfig tunables written at deploy time and read by nothing, `AgentBusChannel` unreachable from `bin/app.ts`, and the Bedrock invocation log group written to but consumed by nothing. Two of them are demanded by requirements 6.1, 6.2 and 5.7 rather than being optional extras. Each is recorded and nothing more. There is no task to fix any of them.

The resource naming convention table in `architecture.md` stays byte for byte. The three deliberate frontmatter wikilinks stay exactly as written: `parent:` in `architecture.md`, `parent:` in `diagrams.md`, `area:` in `Hecatoncheires.md`. No new frontmatter key is added anywhere, including `canonical:`. Only `revised` changes, and `architecture.md` is the sole document that defines it, so it is the sole frontmatter value that changes.

Everything written into the four planning documents follows the natural-writing steering at `c:\Users\michael\.kiro\steering\natural-writing-global.md`, which matches all `*.md` files. The design text already complies. Task 7.9 checks the result, because the pre-existing prose in these files was not written under that rule and several passages get touched.

## Tasks

- [x] 1. Create the decisions record
  - [x] 1.1 Create `.initial-planning/decisions.md` with frontmatter, steering block, header and intro
    - Transcribe the frontmatter block from the design's "Decisions record" section, four keys (`tags`, `created`, `parent`, `status`), no others
    - Set `created` to the date the file lands if that is later than `2026-08-25`
    - Transcribe the Decisions_Doc steering block, opening with the exact line `> [!note] Maintaining this document`, placed immediately after the closing `---` and before the `# Decisions` heading
    - Transcribe the `# Decisions` header, the two-sentence intro, and the `Related:` line with its three relative links
    - _Requirements: 1.5, 1.6, 2.1, 2.12, 7.1, 7.2, 7.3, 7.7_

  - [x] 1.2 Transcribe decision sections 1 and 2
    - Section 1, the capability shape catalog as four frozen shapes carrying risk tiers
    - Section 2, the grant ledger as DynamoDB keyed on `configName` and `grantId`
    - Both omit the `Supersedes:` field, because both replaced nothing. Field order is `Question:`, `Decision:`, `Decided:`, `Code:`
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

  - [x] 1.3 Transcribe decision sections 3 to 7
    - Section 3, per-agent permission boundary created inside `AgentIdentity`
    - Section 4, harness abstraction as CDK stack inheritance, one CloudFormation stack per agent config
    - Section 5, the agent registry table with the inverted `gsi1` index
    - Section 6, one shared breaker Lambda in `SharedInfraStack`
    - Section 7, `AgentTelemetry` superseded by the agent registry
    - All five carry `Supersedes:` as the fifth field. Sections stay in this order, oldest decision first
    - _Requirements: 2.2, 2.3, 2.5, 2.7, 2.8, 2.9, 2.10_

- [x] 2. Edit `.initial-planning/architecture.md`
  - [x] 2.1 Add the steering block and update the `revised` date
    - Transcribe the Architecture_Doc steering block, placed immediately after the closing `---` and before the `# Project architecture` heading
    - Set `revised` to the date the edit lands. Change no other frontmatter key or value, including `version: 2` and the `parent:` wikilink
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 7.1, 7.2, 7.3, 7.5_

  - [x] 2.2 Replace the monorepo layout directory tree
    - Delete the tree, which carries the twelve-file construct inventory, the stack inventory naming `telemetry.stack.ts`, the nine-handler inventory, the adapter inventory, and the five-folder `domain/` decomposition
    - Transcribe the replacement four-row package table and the `packages/core/src/` pointer from the design's "Monorepo layout" subsection
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.3 Replace the `## Stacks (packages/cdk)` section
    - Delete all three subsections, including the shared-infrastructure bullet list carrying a TBD and the `TelemetryStack` entry
    - Transcribe the replacement prose, which keeps the deployment cardinality decision, links to `./decisions.md`, and ends with the `packages/cdk/lib/stacks/` pointer
    - _Requirements: 2.11, 2.12, 3.3, 3.6_

  - [x] 2.4 Rework the construct interfaces section
    - Delete all eight props and outputs code blocks: the three for constructs that exist, and the five for `AgentTelemetry`, `AgentTypeHarness`, `AgentCoreManagedHarness`, `OpenClawHarness`, and `AgentCoreRuntimeHarness`, none of which is a file in the repository
    - Rename the section to `## Constructs (packages/cdk)` and transcribe the replacement from the design, which retains the condition-key rationale, the harness-varying trust policy, the one-IAM-mutation-engine argument, and the FIFO ordering reason
    - Include the `> [!warning] Known gap` callout on the emergency path writing a deny-all policy and the SNS topic having no subscription. It states the gap and stops there, with no remedy
    - _Requirements: 3.1, 3.6, 3.8, 6.3_

  - [x] 2.5 Make the three edits in the configuration schemas section
    - Keep both JSON blocks as written. A configuration schema is not an interface specification under the glossary
    - Reword the `> **Note:**` blockquote to drop the dead `OpenClawHarnessProps.eventBridgeChannel` type name while keeping its decision, using the replacement sentence in the design
    - Replace the `(DynamoDB, data architecture TBD)` phrase with the decisions link, using the replacement sentence in the design
    - Add the `> [!warning] Known gap` callout directly under the runtime tunables block, covering the deploy-time-only AppConfig write, the synth-time alarm thresholds, and the two adapter folders holding only a `.gitkeep`
    - _Requirements: 2.11, 2.12, 6.1, 6.2, 6.3_

  - [x] 2.6 Make the three path corrections
    - In the role model section, repoint the policy-document assembly sentence from `packages/core/src/domain/capability/` to `packages/core/src/shared/algorithms/`
    - In the testing strategy section, reroot the co-location example tree at `packages/core/src/shared/algorithms/`, leaving the tree otherwise unchanged
    - In the deployment flow block, delete the line deploying `Hecaton-Dev-Telemetry`, keeping the other three lines and the `--all` alternative
    - _Requirements: 3.3, 9.4_

  - [x] 2.7 Replace the `## Open questions` section
    - Delete the seven-entry list
    - Transcribe the replacement `## Decisions` section, one line, carrying this document's decisions link
    - The frontend framework question survives in prose under `## packages/web status` and is not restated
    - _Requirements: 2.11, 2.12_

  - [x] 2.8 Sweep the design's section-by-section disposition table
    - Walk all 22 rows and confirm each section reached its stated disposition, including the fourteen rows marked keep
    - Confirm `## Naming conventions` is byte for byte unchanged, and that `## Phase 1 scope`, `## Next steps`, `## Error handling and response contract`, and the agent configuration JSON block are untouched, per the design's "Left as written" subsection
    - _Requirements: 3.7, 3.8_

- [x] 3. Checkpoint after the architecture document
  - Confirm the architecture document renders, its frontmatter still parses, and every `./decisions.md` link in it resolves. Ask the user if questions arise.

- [x] 4. Edit `.initial-planning/diagrams.md`
  - [x] 4.1 Add the steering block and the intro decisions link
    - Transcribe the Diagrams_Doc steering block, placed immediately after the closing `---` and before the `# Architecture diagrams` heading
    - Transcribe the replacement intro line under `# Architecture diagrams` from the design's "Diagrams document" scope subsection
    - This document defines no `revised` key. Do not add one
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.12, 7.1, 7.2, 7.3, 7.6_

  - [x] 4.2 Replace the diagram 3 Mermaid fence
    - Transcribe the replacement `classDiagram` from the design in full, keeping the existing heading and lead line
    - The rewrite is a transcription of `packages/cdk/lib/constructs/`, `packages/cdk/lib/stacks/`, and `packages/api/src/handlers/`. Confirm each named identifier against those folders as you write it
    - _Requirements: 4.1, 4.6_

  - [x] 4.3 Replace the diagram 9 Mermaid fence, heading, and lead line
    - Transcribe the replacement `flowchart TB` from the design in full
    - Change the heading to `## 9. Data flow overview (as deployed)` and the lead line to the sentence given in the design, since "steady state after Phase 3" no longer describes the content
    - Confirm the fence contains the agent registry participant in the breaker path, no edge from an AppConfig node to an alarm or a Lambda, and the labelled seed-to-alarms edge stating thresholds are synth-time constants
    - Subgraph titles use the quoted form the other eight diagrams use
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.4 Annotate diagrams 3 and 9
    - Transcribe both `Status: built` callouts, each placed immediately above its fence
    - Written after the rewrites so both describe final content
    - _Requirements: 5.8, 6.3_

  - [x] 4.5 Annotate diagrams 1, 2, 4, and 5
    - Transcribe the four callouts from the design verbatim, each immediately above its existing fence and after any existing prose under the heading
    - Do not open any fence for editing. The diagram 2 annotation carries the `Deny *` resting state, and the diagram 4 annotation names `packages/api/src/use-cases/trip-breaker.ts` as the file writing the deny-all policy
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 6.3_

  - [x] 4.6 Annotate diagrams 6, 7, and 8
    - Transcribe the three callouts from the design verbatim, each immediately above its existing fence. The diagram 6 annotation goes after its three sentences of rationale
    - Do not open any fence for editing. The diagram 6 annotation identifies the "Policy Modulator" participant as API Gateway fronting a grant-shape Lambda, and the diagram 7 annotation records `AgentBusChannel` as unreachable from `packages/cdk/bin/app.ts`
    - _Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 6.3_

- [x] 5. Edit `.initial-planning/Hecatoncheires.md`
  - [x] 5.1 Add the steering block above the Definition callout
    - Transcribe the Brief_Doc steering block, placed immediately after the closing `---` and above the existing `> [!info] Definition` callout, which follows unchanged
    - The block states the milestone-tied review cadence. This document defines no `revised` key. Do not add one
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 7.1, 7.2, 7.3, 7.4_

  - [x] 5.2 Retire the closed TBD in the Phase 1 task line
    - Replace `- [ ] Grant ledger (DynamoDB likely, data architecture TBD) for live capability-shape state` with the line given in the design, which carries the decisions link in place of the TBD phrase and keeps the trailing clause
    - Leave the `TBD` cells in the milestone table's date column alone. Those dates are genuinely unset
    - Do not reconcile any checkbox state
    - _Requirements: 2.11, 2.12_

  - [x] 5.3 Add the note under the `## Tasks` heading
    - Transcribe the one-line note, placed directly under the heading and above the first task list
    - _Requirements: 2.12_

  - [x] 5.4 Add the decisions entry to the `### In this repository` list
    - Transcribe the third list entry alongside the two existing ones
    - _Requirements: 2.12_

- [x] 6. Correct the structure steering file
  - [x] 6.1 Replace the IAM role naming pattern cell in `.kiro/steering/structure.md`
    - Change `hecaton-{configName}-agent-role` to `hecaton-{stage}-{configName}-agent-role`
    - Change no other row, including the inference profile row, which carries the same unstaged form and stays as written
    - Ordered last, so a failure here cannot leave the planning documents half-edited
    - _Requirements: 8.1, 8.2_

- [x] 7. Verification
  - [x] 7.1 Verify frontmatter preservation against `git show HEAD:<path>`
    - Extract the block between the first two `---` lines of each of the four planning documents and parse it as YAML followed by non-empty body content
    - For `architecture.md`, `diagrams.md`, and `Hecatoncheires.md`, compare the key set and every value against `git show HEAD:<path>`. Every value must be byte-identical except `revised` in `architecture.md`
    - Confirm the three deliberate wikilinks survived with their quotation marks and the `AI Expertise` display alias, and that no key was added
    - **Property 1: Frontmatter survives the triage intact**
    - **Validates: Requirements 1.3, 1.4, 1.5, 9.1**

  - [x] 7.2 Verify every relative link resolves
    - Collect every `](./...)` target in the four planning documents and resolve each against `.initial-planning/`
    - Every target must exist. This check is what the edit ordering was chosen to satisfy
    - **Property 6: Every relative link between Planning_Docs resolves**
    - **Validates: Requirements 2.12, 9.3**

  - [x] 7.3 Verify every backticked `packages/` path exists on disk
    - Collect every backticked string beginning `packages/` from the four planning documents and test each against the repository
    - Run the same collection against the pre-triage documents from `git show HEAD:<path>` and confirm the three known failures are the only ones, so nothing new was introduced
    - **Property 7: Every referenced repository path exists**
    - **Validates: Requirements 9.4**

  - [x] 7.4 Verify every identifier in the rewritten diagrams maps to a real file
    - For each Hecatoncheires construct class, stack class, and handler filename named inside the diagram 3 and diagram 9 fences, confirm an implementing file exists under `packages/`
    - Grouping nodes and `aws-cdk-lib` type names are outside the set. See Property 8 for the exempt list, which includes `ApiHandlers` and every member type in the class bodies
    - This is the check that catches a transcription slip in either rewrite, since a wrong class name renders fine
    - **Property 8: Every identifier in the rewritten diagrams maps to a real file**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 7.5 Verify all nine Mermaid fences parse
    - Parse every Mermaid fence body in `diagrams.md`, the seven untouched ones as well as the two rewritten ones
    - `npx @mermaid-js/mermaid-cli` parses them from the command line without being added to `package.json`. Confirm the render in Obsidian preview and on GitHub as well, since requirement 4.6 names both tools
    - **Property 5: Every Mermaid fence parses**
    - **Validates: Requirements 4.6, 9.2**

  - [x] 7.6 Verify the seven annotated fence bodies are byte-identical to their pre-triage form
    - For diagrams 1, 2, 4, 5, 6, 7, and 8, compare each fence body against the same body in `git show HEAD:.initial-planning/diagrams.md`
    - The `git diff` on `diagrams.md` should show additions above fences and changes only inside the diagram 3 and diagram 9 fences. Any hunk inside another fence is a defect
    - **Property 4: Annotated diagrams keep their Mermaid bodies byte for byte**
    - **Validates: Requirements 5.1**

  - [x] 7.7 Verify steering block placement and annotation grammar
    - In each of the four planning documents, confirm the first non-blank line after the closing frontmatter delimiter is byte-identical to `> [!note] Maintaining this document`, and that the callout states the repository copy is the one to edit
    - For all nine status annotations, confirm the title is `Status: ` followed by `built`, `partly built`, or `specification`, that exactly one `> Built: ` line and one `> Specification: ` line appear in that order, that at most one `> Gap: ` line appears and it is last, and that no other lead-in appears
    - Confirm no annotation uses the inline-bold list-header shape and that paragraph breaks inside steering blocks are bare `>` lines
    - **Property 2: Every Planning_Doc opens with a conforming Steering_Block**
    - **Property 3: Every diagram annotation matches one grammar**
    - **Validates: Requirements 1.6, 5.2, 5.8, 7.1, 7.2, 7.3**

  - [x] 7.8 Verify the deletions took and no TBD list survives
    - Search `architecture.md` for identifiers unique to the deleted interface specifications, including `AgentTelemetry`, `AgentTypeHarness`, `AgentCoreManagedHarness`, `OpenClawHarness`, `AgentCoreRuntimeHarness`, `TelemetryStack`, and `telemetry.stack.ts`. None may remain
    - Confirm each section that previously carried deleted content now contains at least one backticked `packages/` path that exists
    - Confirm no list item in the three pre-existing documents contains the token `TBD`, and no heading names an open-questions or TBD section. The milestone table date cells are table cells, not list items, and are exempt
    - **Property 9: No deleted Interface_Specification survives, and every host section carries a pointer**
    - **Property 10: No TBD list or open-question list survives**
    - **Validates: Requirements 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 7.9 Verify the decision sections match the template and the natural-writing rule holds
    - For every section in `decisions.md`, confirm a `Question:` line phrased as a question, a `Decision:` line, a `Decided:` line holding a `YYYY-MM-DD` date, and a `Code:` line holding at least one backticked `packages/` path that exists
    - Scan every passage written or touched in the four planning documents for em dashes, curly quotes and curly apostrophes, Title Case headings, and the `- **Header:** text` list shape. All four counts must be zero in the new and edited text
    - Pre-existing prose left untouched is out of scope for this scan
    - **Property 11: Every Decisions_Doc section matches the template**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 7.10 Verify the working-tree diff touches exactly five files
    - `git status --short` must list exactly `.initial-planning/decisions.md`, `.initial-planning/architecture.md`, `.initial-planning/diagrams.md`, `.initial-planning/Hecatoncheires.md`, and `.kiro/steering/structure.md`
    - No path in the diff may begin with `packages/`, and the Obsidian vault copy must be untouched
    - **Property 12: The Triage touches only the five intended files**
    - **Validates: Requirements 1.1, 1.2, 6.4**

- [x] 8. Final checkpoint
  - Confirm every verification task in section 7 passed. Ask the user if questions arise.

## Notes

No task is marked optional. The verification work is not a formality here: three of its checks found real defects while the design was being written, and six of the twelve correctness properties quantify over sets where one missed instance reads as fine and renders wrong. Skipping any of them would leave the triage unverified rather than faster.

There are no automated test tasks, because there is no code under test. The properties are checked against document text and the git index instead, which is what tasks 7.1 to 7.10 do. The checks are run in place rather than saved as a script, since adding a script file would break Property 12.

Nearly every task is transcription from the design. Where a task says transcribe, copy the drafted text rather than paraphrasing it. The design's wording was checked against the code and against the writing rule; a paraphrase reopens both questions.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4"] },
    { "id": 7, "tasks": ["2.5"] },
    { "id": 8, "tasks": ["2.6"] },
    { "id": 9, "tasks": ["2.7"] },
    { "id": 10, "tasks": ["2.8"] },
    { "id": 11, "tasks": ["4.1"] },
    { "id": 12, "tasks": ["4.2"] },
    { "id": 13, "tasks": ["4.3"] },
    { "id": 14, "tasks": ["4.4"] },
    { "id": 15, "tasks": ["4.5"] },
    { "id": 16, "tasks": ["4.6"] },
    { "id": 17, "tasks": ["5.1"] },
    { "id": 18, "tasks": ["5.2"] },
    { "id": 19, "tasks": ["5.3"] },
    { "id": 20, "tasks": ["5.4"] },
    { "id": 21, "tasks": ["6.1"] },
    { "id": 22, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10"] }
  ]
}
```
