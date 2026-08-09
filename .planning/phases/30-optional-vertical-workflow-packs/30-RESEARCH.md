# Phase 30: Optional Vertical Workflow Packs - Research

**Researched:** 2026-08-05
**Requirements:** VERT-01, VERT-02, VERT-03, VERT-04
**Depends on:** Phase 29 native pack/search/authoring substrate and behavioral evidence from Phases 27-29
**Confidence:** High for repository architecture, safety boundaries and sequencing; medium for which packs should be exposed first because that is intentionally evidence-dependent.

## Executive Finding

Phase 30 should add six independently gated native pack definitions, not six new agent systems and
not a marketplace. The reusable substrate must already exist from Phases 27-29: immutable pack
provenance, candidate versioning, operation-to-tool policy, outcome evals, exposure/rollback state,
cross-source citations and refs/counts-only telemetry. Phase 30 adds vertical policy, templates,
outcome contracts and UAT fixtures on top of that substrate.

Build all six packs dark, but expose at most one or two in the first wave. Selection must be a pure,
explainable function of confirmed tier/profile facts, available native capabilities and actual
Phase 27-29 behavior. A pack with no relevant persona signal or repeat workflow demand remains
hidden. Missing connector capability makes a connector-backed variant blocked; it never weakens the
file/Vault-first workflow and never widens a tool grant.

The safest initial products are narrow artifact workflows:

- Legal: contract issue spotting against a user-confirmed playbook, with counsel review required.
- HR: structured hiring/onboarding materials, never candidate ranking or employment decisions.
- Product: a cited PRD/roadmap brief from user and Vault evidence.
- Design: screenshot/artifact critique plus an accessibility review, not a compliance certificate.
- Engineering: architecture/incident runbook review, with no repository or production mutation.
- Data: deterministic CSV/XLSX profiling and a cited report, with no warehouse execution.

Bio Research is not a dormant seventh pack. It is an explicit excluded state with named re-entry
criteria and no source manifest, seed, discovery rule, skill row, connector or tool route.

## Repository Findings

1. `packages/core/src/specialists.ts` already makes the security split explicit: a specialist is a
   registry-owned skill body plus a code-owned static tool set. The ordinary specialist grant is
   `searchVault` only; research is separately restricted. Phase 30 must preserve this shape.
2. `packages/backend/convex/skills.ts` has one activation choke point. A candidate gated skill needs
   passing evidence, while rollback to a previously active version is exempt. Pack activation and
   disable/rollback must compose with this seam instead of creating another status machine.
3. The present `insertCandidate` only accepts names in the static `GATED_SKILLS` list and registry
   rows are global. Phase 29 must therefore land the tenant/native-pack candidate contract before
   Phase 30 plans bind to it. Phase 30 must not independently improvise a second candidate table.
4. `deriveTier` in `packages/core/src/businessProfile.ts` is deterministic and cannot derive
   enterprise; `tenantProfile.saveFacts` accepts facts, not a caller-supplied tier. Relevance may
   consume this tier, but cannot write it or use it to grant tools.
5. Vault extraction already supports CSV/XLSX and SheetJS is already installed. The Data pack should
   reuse that parser/extraction stack and add pure-TypeScript dataset validation rather than Python,
   arbitrary notebook execution or a new upload plane.
6. Phase 18's created-document path and Phase 26 Content projections are the shared output plane.
   Vertical artifacts must keep their pack/version/provenance refs while remaining ordinary Vault/
   Content artifacts; disabling a pack must not delete them.
7. Current terminal telemetry is request-oriented. Phase 27's shared workflow telemetry must land
   before Phase 30 so verticals add only bounded status/count dimensions, not another event store.
8. The upstream Anthropic packages are workflow references. Their READMEs explicitly assume Claude/
   Cowork, slash commands, local files and MCP connectors. None of those assumptions is a compatible
   Pikar runtime boundary.

## Standard Stack

Use the native stack already committed or required by Phases 27-29:

| Concern | Required implementation |
|---|---|
| Pack definition | Phase 29's native immutable pack/template contract, one stable pack id per vertical |
| Prompt/body | Existing versioned skill registry; adapted provider-neutral body published as candidate |
| Capability | Closed code-owned operation/tool policy in pure TypeScript; no DB-written tool arrays |
| Relevance | Pure TypeScript over confirmed `tenantProfiles` facts, Blueprint facts, connected-capability ids and behavioral aggregates |
| Grounding | Phase 29 native cited search plus existing Blueprint/Vault; no vertical memory store |
| Artifact output | Existing created-document/Vault/Content path with pack and version provenance |
| External actions | Existing plan -> single Approve -> generalized executor; first release has no vertical write connectors |
| CSV/XLSX | Existing Vault recognition/extraction and pinned SheetJS package; pure-TypeScript normalized dataset/profile functions |
| Validation | Existing package tests, eval evidence gate, authenticated responsive browser UAT and playbook watcher |
| Measurement | Phase 27 refs/counts-only pack telemetry plus pack-specific outcome/status dimensions |

Do not add a plugin SDK, MCP client, workflow DSL, Python execution service, second vector store,
second artifact table, vertical router or a new approval system.

## Architecture Patterns

### One manifest, independently releasable packs

Each vertical should be a `VerticalPackDefinition` in pure TypeScript with a closed id, stable
workflow id, relevance policy, required native capabilities, connector gates, risk class,
disclaimer id, output-contract id and active template reference. The definition contains capability
requirements, never executable functions or caller-editable tool names.

The backend resolves four independent states:

- `hidden`: no confirmed profile/tier/behavioral relevance.
- `available`: relevant and all native/file-first requirements are ready.
- `blocked`: relevant, but a named capability/source/review prerequisite is missing.
- `disabled`: previously exposed version was killed or rolled back; existing artifacts remain.

Every non-hidden response includes bounded reason codes. The UI translates codes into plain copy;
the model does not invent availability explanations.

### Relevance is guidance, never authority

Compute relevance from:

1. confirmed tenant tier and Blueprint/profile facts;
2. actual workflow usage/search/upload patterns from Phases 27-29;
3. explicitly connected native capability ids;
4. pack-specific minimum evidence thresholds.

The result can rank or hide templates only. The selected specialist/tool grant must be resolved from
the same code-owned policy regardless of tier. Add a parity test proving all tiers receive the same
tool array for a given workflow. Do not use free-text keyword matching alone to infer a legal, HR or
scientific persona.

### Native operation matrix

Every workflow operation is classified at build time as:

- `native_read`: existing tenant-scoped read/search/file operation;
- `native_artifact`: internal Vault/Content creation with no external side effect;
- `plan_gated_write`: possible only through the approved-plan executor;
- `connector_blocked`: absent until a named server-side suitability gate passes; or
- `forbidden`: cannot be requested by this pack.

The pack body may describe an operation, but runtime tool construction uses only the code-owned
matrix. Connector absence is structural: do not register a placeholder write tool that merely
promises not to execute.

### Shared evidence and artifact contract

Every result must carry:

- pack id and exact active template/version;
- source/provenance manifest ref and modification notice ref;
- source refs/citations and a coverage/partial state;
- risk/disclaimer id and review requirement;
- structured outcome kind and artifact ref;
- no raw source content in audit or telemetry.

High-stakes packs require an `assistive` output flag and a visible `review_required` status. The
flag belongs in the output contract and card projection, not only in prompt prose.

## Vertical Workflow Contracts

### Legal — Contract Issue-Spotting Pack

First workflow: upload/paste a contract, identify clauses, compare them with a confirmed tenant
playbook, cite the contract/playbook passages, and produce an issue list plus suggested discussion
points. Use `unknown_jurisdiction`, `missing_playbook`, `unreadable_contract` and
`insufficient_evidence` as first-class outcomes.

Safeguards:

- Label the result as issue spotting and playbook comparison, not legal advice.
- Require jurisdiction and the user's side of the agreement; never assume U.S. defaults from the
  upstream plugin.
- Consequential choices and redlines require qualified counsel review.
- No signature, filing, legal-system write, templated external response or autonomous GREEN approval.

The upstream Legal plugin is useful for clause categories and escalation concepts, but its local
`.claude/legal.local.md`, slash commands, U.S. example defaults and MCP systems must be replaced by
confirmed Pikar Blueprint/Vault sources and explicit missing-source states.

### HR — Hiring and Onboarding Pack

First workflow: generate a role brief, structured interview plan/scorecard and onboarding checklist
from user/Vault inputs. Performance review, compensation analysis and people analytics remain dark
until their provenance and qualified-review contracts are separately proven.

Safeguards:

- Never infer protected attributes or proxies, rank applicants, recommend hire/fire/promotion/pay,
  or make an autonomous employment decision.
- Keep candidate evidence attributable to user-provided job criteria; flag unsupported criteria.
- Compensation and performance outputs require qualified HR/legal review and explicit data sources.
- No ATS/HRIS writes, offer send, employment-state change or employee notification.

### Product — PRD and Roadmap Brief Pack

First workflow: turn a problem statement plus Vault/search evidence into a PRD containing users,
problem, evidence, requirements, non-goals, success measures, risks, dependencies and open questions.
A roadmap variant may prioritize only when the user supplies criteria; it must expose assumptions and
never fabricate effort, market size or customer evidence.

External project-management writes are connector-blocked. The first release creates/revises only
Pikar artifacts.

### Design — Design and Accessibility Critique Pack

First workflow: review uploaded screenshots/files and confirmed brand guidance for usability,
hierarchy, consistency, UX copy and observable accessibility issues. Output findings by evidence,
severity, confidence and remediation suggestion.

Safeguards:

- Call it a review, not a WCAG certification or complete assistive-technology audit.
- Distinguish directly observable findings from checks requiring DOM, contrast calculation,
  keyboard testing or screen-reader testing.
- Do not claim Figma/component-system coverage without a gated adapter and source evidence.
- No design-system mutation or publishing.

### Engineering — Architecture and Incident Runbook Pack

First workflow: from pasted/uploaded architecture, logs and Vault documents, create an ADR review,
incident brief/runbook or deployment-readiness checklist. Separate evidence, hypothesis and unknown.

Safeguards:

- No source-control, issue-tracker, monitoring, deployment or production tool in the initial grant.
- No claim that tests ran, code was reviewed or an incident was mitigated unless Pikar has evidence.
- Security findings are assistive; high-impact remediation requires an engineer/security reviewer.
- Production changes always remain outside this phase.

### Data — File-First Dataset Validation Pack

First workflow: accept one bounded CSV/XLSX, normalize schema/types, calculate a deterministic
profile, identify data-quality issues, and produce a cited report/artifact. The model may explain
the computed profile and suggest follow-up questions; it may not calculate or silently repair data.

The pure-TypeScript profile should include row/column counts, inferred types with confidence,
missing/invalid counts, numeric ranges, date coverage, categorical cardinality under a cap,
duplicate-row count and every truncation/parse warning. Preserve sheet/range/file provenance.

Safeguards:

- Bound file bytes, sheets, rows, columns, cell text and output cardinality before analysis.
- Reject formulas/macros/external links as executable content; read cached cell values only where
  the existing parser contract safely supports them and state limitations.
- Mixed currency/timezone/unit semantics remain separate or unknown, never coerced silently.
- Statistical claims require deterministic functions and fixtures; no LLM arithmetic.
- Warehouse SQL execution is absent. Query drafting, if later offered, is an artifact only until a
  dedicated read-only adapter/security/terms gate passes.

## Evidence-Based Exposure and Sequencing

Do not hard-code Legal or HR as the first wave just because the templates exist. Use a pre-exposure
decision report over Phase 27-29 aggregates. A pack qualifies only when:

- at least one confirmed persona/profile rule matches;
- a relevant workflow/search/upload behavior crosses a documented minimum sample threshold;
- every required native capability and source is ready;
- its candidate eval and authenticated UAT pass;
- its expected risk/review presentation is accepted by the owner.

Rank qualified packs by `expected useful outcomes * observed demand * source readiness`, then reduce
for review burden, unsupported-claim rate, cost and latency. Expose at most two. If the sample is too
small, keep all packs dark and collect intent through existing workspace prompts; do not use install
count or fabricate a winner.

Implementation order should still minimize engineering risk:

1. Freeze shared vertical contracts, reason codes, output/risk fields, kill switches and telemetry.
2. Implement Data file validation and Product/Design artifact-only workflows as low-write reference
   implementations, while keeping them dark until the evidence decision.
3. Implement Legal and HR with their stricter review and adversarial suites.
4. Implement Engineering artifact/review workflows.
5. Run the behavioral selection gate and expose no more than two.
6. Run independent outcome reviews; expand exposure only after repeat-use evidence.

This separates build sequencing from product exposure sequencing.

## Connector Gates

Phase 30 consumes Phase 28's suitability-gate pattern but does not inherit approval for new vendors.
HRIS/ATS, legal/CLM/e-signature, Figma/design, Git/source-control/monitoring and warehouse connectors
each require an independent server-side review covering endpoint availability, auth/scopes,
revocation, tenant isolation, data processing/licensing, rate limits, replay/caching, sandbox and
commercial terms.

Until a gate passes:

- show the native file/Vault workflow when it remains useful;
- report the connector-backed variant as blocked with a named unlock;
- do not load upstream `.mcp.json`;
- do not request write scopes "for later";
- do not put raw connector output into a tool-bearing loop.

When a read adapter eventually lands, normalize a bounded projection with stable refs, freshness,
coverage and partial-state metadata. Treat every string as untrusted data. Writes require a later
phase and the approved-plan executor.

## Independent Versioning, Disable and Rollback

Each vertical has its own pack id, template/skill version, active exposure record, eval evidence,
UAT evidence and kill switch. A global `verticals_enabled` flag may stop all discovery, but it cannot
be the only rollback mechanism.

Disable means:

- stop recommendation and new starts for that pack;
- allow existing immutable artifacts to remain readable;
- preserve audit/provenance/eval evidence;
- cancel no unrelated workflow;
- avoid deleting or rewriting Blueprint/Vault memory;
- permit rollback to the previously active pack/skill version without requiring a fresh eval.

In-flight external writes are not present in this phase. If a later connector adds them, disable
semantics must be revisited with idempotency and terminal-state rules.

## Telemetry and Success Measures

Reuse the Phase 27 pack events and add only closed dimensions such as `packId`, `workflowId`,
`version`, `outcome`, `sourceCount`, `citationCount`, `reviewRequired`, `partialReason`, `costBucket`
and `latencyBucket`. Never include filenames, people, employers, contract clauses, dataset values,
prompts or generated prose.

Per pack measure:

- recommendation shown/accepted and reason-code distribution;
- time to first useful artifact;
- workflow completion and repeat use;
- source/citation coverage and unsupported-claim signals;
- human review/edit/reject rate;
- blocked/missing-capability rate;
- cost and latency;
- disable/rollback rate.

Deprecate or hide packs with no sustained behavioral use. Do not respond by adding connectors.

## Validation Architecture

### Test layers

1. **Pure contract tests** — total pack-id tables, relevance decisions, reason codes, risk classes,
   connector gates, capability parity across tiers and deterministic Data profiling. Mutation-test
   the tier/tool-authority separation and Bio absence.
2. **Registry/provenance tests** — exact upstream commit/file/hash/license/modification manifest;
   candidate-only publish; version immutability; per-pack activation; previous-version rollback;
   independent disable with retained artifacts.
3. **Capability tests** — exact operation-to-tool set for every workflow; forbidden and blocked tools
   structurally absent; injected source instructions cannot call plan/write/send/connector tools.
4. **Outcome-state evals** — assert structured outcome, citations, artifact/plan state, disclaimers,
   review requirements and refusals, never exact prose. Pin every run to candidate versions.
5. **Backend integration/isolation** — two tenants with different profiles/connections; no cross-
   tenant discovery, source, artifact, candidate, telemetry or disable leakage; audit payload exact
   key-set checks remain refs/counts-only.
6. **Authenticated responsive UAT** — desktop and mobile discovery reasons; available/blocked/hidden/
   disabled states; one successful and one partial/refused workflow per vertical; artifact remains
   after disable; no navigation/catalogue exposure before evidence.
7. **Live connector tests** — none for the initial packs. Any later adapter needs sandbox/controlled
   live read-only proof, re-auth/revocation, rate-limit/partial behavior and two-tenant isolation.

### Required eval fixtures by vertical

| Pack | Positive | Missing/partial | Adversarial/high-stakes |
|---|---|---|---|
| Legal | cited contract/playbook comparison | no playbook, unknown jurisdiction, unreadable clause | contract text orders a send/sign; request for definitive legal advice |
| HR | job/interview/onboarding artifact | missing role criteria/source | protected-attribute inference, applicant ranking, hire/fire/pay decision |
| Product | cited PRD with open questions | sparse evidence/no success metric | source text invents customer demand or asks for project-system mutation |
| Design | screenshot critique with observable evidence | no brand guide/DOM unavailable | claim of WCAG certification or hidden Figma access |
| Engineering | ADR/runbook with evidence vs hypothesis | incomplete logs/architecture | injected deploy command, claim tests ran, production mutation request |
| Data | deterministic profile matches fixture | truncation/mixed types/multiple sheets | formula/macro/external-link payload, LLM-number mismatch, warehouse write |

### Release gate

A pack is discoverable only when all are true:

- provenance and modification manifest verified;
- operation matrix reviewed and exact-tool test green;
- candidate has passing outcome/adversarial eval evidence;
- authenticated responsive UAT evidence recorded;
- disclaimer/output contract accepted;
- telemetry emits no raw content;
- pack-specific disable and rollback drill passes;
- evidence-based relevance threshold passes.

Failure of one pack blocks only that pack. A global repository gate still runs after integration:
pure package tests, backend tests, typechecks, production web build, Biome baseline check,
playbook watcher and graph update/fixup during execution.

## Suggested Plan and File Ownership

Use a serial shared-contract wave, disjoint vertical lanes, then serial integration. Exact Phase 29
paths must be consumed rather than guessed; the names below describe ownership boundaries.

1. **30-01 Shared vertical contracts and Bio exclusion** — owns the new pure-core vertical manifest,
   relevance/reason/risk/output types and tests; one schema owner only if Phase 29 requires additive
   fields; owns the new vertical-packs playbook/watch registration.
2. **30-02 Discovery/read model and independent exposure controls** — owns the thin Convex adapter,
   tenant/profile/capability composition, telemetry hooks and discovery projection tests.
3. **30-03 Data pack** — owns Data template/reference files, deterministic dataset package/tests and
   Data eval fixtures; no shared registry/schema edit.
4. **30-04 Product + Design packs** — owns their template/reference/output/eval files only.
5. **30-05 Legal pack** — owns Legal template/reference/disclaimer/output/eval files only.
6. **30-06 HR pack** — owns HR template/reference/disclaimer/output/eval files only.
7. **30-07 Engineering pack** — owns Engineering template/reference/output/eval files only.
8. **30-08 Registry integration and candidate publication** — sole owner of shared seed/registry
   mirrors/manifests; mechanically verifies all six bodies and publishes candidates, never active.
9. **30-09 Authenticated UAT, selection and exposure** — owns discovery UI, browser fixtures,
   evidence report and the at-most-two exposure decision.
10. **30-10 Phase gate and rollback drills** — owns consolidated playbook verification, all-pack
    disable/rollback tests, Bio absence scan and final requirements evidence.

Do not parallelize edits to `schema.ts`, the shared pack manifest, seed/registry mirrors,
`GATED_SKILLS`, discovery UI or playbook/watch files. Vertical content/eval lanes may run in parallel
only after 30-01 freezes their contracts.

## Don't Hand-Roll

- Do not build a Claude plugin or MCP compatibility layer.
- Do not create six routers, memories, vector indexes, artifact stores or approval systems.
- Do not let templates or tenant preferences store tool names/capability grants.
- Do not write a CSV/XLSX parser; reuse the pinned existing parsing stack.
- Do not use model arithmetic for dataset statistics or risk scores.
- Do not create a generic policy engine for six fixed relevance definitions; use a total typed table.
- Do not invent a new eval runner or telemetry store; extend the Phase 27-29 contracts.
- Do not copy upstream connectors, U.S. legal defaults or Cowork local-file assumptions.

## Common Pitfalls

1. Treating `blocked` as `hidden`, which prevents relevant users from understanding the missing
   source/capability; or treating every absent connector as a reason to show a catalogue.
2. Using tier as a capability boundary. Relevance tests must prove the same workflow tool grant for
   every tier.
3. Gating only the prompt disclaimer. High-stakes status/review requirements must be schema/output
   fields rendered by code.
4. Calling an operation read-only when it persists a row, schedules work, spends on generation or
   mutates plan state. Classify behavior, not labels.
5. Allowing Legal defaults to imply jurisdiction, HR text to infer protected traits, Design to
   claim compliance, Engineering to claim execution, or Data to repair/compute via prose.
6. Reusing extracted spreadsheet prose as if it were a validated dataset. Data needs a bounded
   typed projection and deterministic profiling before explanation.
7. One global vertical kill switch without per-pack rollback, or disabling by deleting artifacts.
8. Editing shared registry mirrors from six parallel lanes, creating version/hash drift.
9. Seeding Bio Research "for later." Structural absence is the requirement.
10. Measuring installs instead of completed, cited, reviewed and repeated outcomes.

## Code Examples

```ts
type VerticalState = "hidden" | "available" | "blocked" | "disabled";

type VerticalPackDefinition = Readonly<{
  id: "legal" | "hr" | "product" | "design" | "engineering" | "data";
  workflowId: string;
  risk: "standard" | "high_stakes";
  requiredCapabilities: readonly NativeCapabilityId[];
  blockedConnectors: readonly ConnectorGateId[];
  outputContract: VerticalOutputContractId;
  disclaimer: VerticalDisclaimerId;
}>;
```

```ts
// Relevance changes presentation only. Capability resolution never receives tier.
const recommendation = recommendVerticals({ tier, profile, capabilities, evidence });
const tools = toolsForVerticalWorkflow(workflowId);
```

```ts
type DataProfile = Readonly<{
  rowCount: number;
  columnCount: number;
  truncated: boolean;
  warnings: readonly DataWarningCode[];
  columns: readonly ColumnProfile[];
  duplicateRowCount: number;
}>;
// The model receives this computed object plus refs; it never receives authority to recompute it.
```

## Bio Research Exclusion

Phase 30 must prove absence with a closed-union/manifest test and a source scan: no `bio`,
`life-science` or scientific vertical id in pack definitions, registry seeds, routes, discovery,
connectors or tool policies. Documentation may name the exclusion and its re-entry gate only.

Reconsideration requires all of the following before a new roadmap phase is created:

- named life-sciences persona and observed behavioral demand;
- accountable scientific validation owner;
- literature/data licensing and retention review;
- scientific evidence/citation and reproducibility design;
- compute/sandbox and biosecurity misuse controls;
- regulated-risk, privacy and jurisdiction assessment;
- dedicated requirements, research, plan and live validation architecture.

## Sources

- Anthropic knowledge-work plugins repository: https://github.com/anthropics/knowledge-work-plugins
- Legal workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/legal
- HR workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/human-resources
- Product workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/product-management
- Design workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/design
- Engineering workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/engineering
- Data workflow reference: https://github.com/anthropics/knowledge-work-plugins/tree/main/data
- Apache-2.0 license: https://github.com/anthropics/knowledge-work-plugins/blob/main/LICENSE

The upstream sources support workflow discovery only. Compatibility, safety and implementation
claims above are derived from Pikar's repository contracts and must be revalidated against the exact
commit pinned by Phase 27 before any adapted body is published.
