# Phase 27 Research: Curated Knowledge-Work Pack Pilot

**Phase:** 27 — Curated Knowledge-Work Pack Pilot  
**Requirements:** PACK-01, PACK-02, PACK-03, PACK-04  
**Researched:** 2026-08-05  
**Mode:** implementation/ecosystem  
**Confidence:** High for the local Pikar architecture; medium for the final upstream file set until an exact upstream commit is pinned during execution.

## Research Question

What do we need to know to plan this phase well?

Phase 27 is not a plugin-installation phase. It is a proof that six externally inspired workflows can run through Pikar's existing governed agent, skill registry, memory, artifact, approval, and audit boundaries. The implementation should add a small native pack contract, six registry-owned bodies, code-owned grants, pack-specific eval fixtures, a dual eval/browser exposure gate, and refs/counts-only outcome telemetry. It should not add an MCP client, a second router, a second agent loop, a second memory store, or a second output plane.

The highest-risk planning issue is not prompt adaptation. It is activation semantics. `seedSkills` deliberately bootstrap-activates the first version of every skill, including gated skills. PACK-03 instead requires every imported body to land as a candidate and remain undiscoverable until outcome evals and authenticated browser UAT pass. The pilot therefore needs an explicit first-candidate publishing path and a pack-specific second evidence gate; simply adding six constants to `GATED_SKILLS` is insufficient and would violate the phase on a fresh deployment.

## Executive Recommendation

Implement each workflow as a registry-owned Pikar skill executed through the existing `runAgentLoop`/`runSpecialistTurn` machinery with a code-owned allow-list. Add a small pure-TypeScript `workflowPacks` registry beside the specialist registry, or extend the specialist specification with a `kind: "workflow_pack"`; do not create another runtime. The Executive Agent remains the only natural-language router. A quick-start or Command Center suggestion supplies a normal user turn that selects a pack; it does not bypass routing or approval.

Use six skill rows because each workflow must be independently versioned, evaluated, rolled back, measured, and disabled:

- `pack-business-pulse`
- `pack-campaign-plan`
- `pack-customer-complaint`
- `pack-sales-call-prep`
- `pack-process-sop`
- `pack-brand-review`

All six belong in a closed `WORKFLOW_PACK_SKILLS` set and in `GATED_SKILLS`, but only after the eval runner can actually invoke the candidate pack body. Publish their first versions through a candidate-only seam, not the `rows.length === 0 -> active` bootstrap branch.

## Standard Stack

Use what is already installed and proven:

| Concern | Existing Pikar seam | Phase 27 use |
|---|---|---|
| Prompt/body storage | `skills` table, `loadSkill`, `getSkillVersion`, immutable version rows | Six independently versioned pack bodies |
| Activation/rollback | `activateSkillVersion`, `activateCandidate`, `recordEvalEvidence` | Retain one choke point; add pack browser-evidence check only for candidate activation; rollback stays status-exempt |
| Agent execution | `runAgentLoop` and `runSpecialistTurn` in `packages/backend/convex/llm.ts` | Run pack bodies in the one existing loop |
| Capability containment | `toolNames === undefined ? built : filtered-record` | Construct a pack's exact tool record; withheld tools are absent, not merely discouraged |
| Registry pattern | `packages/core/src/specialists.ts` + ADR-007 | Pure TS pack metadata and code-owned grants |
| Business context | confirmed Business Blueprint turn spine and `vaultGroundHydrated.spine` | Standing tenant context; no new memory store |
| Tenant knowledge | `searchVault`, Vault source cards, citations | Ground claims and artifacts in the existing Vault |
| Web research | Phase 16 research specialist/web research tool | Campaign and sales research only after Phase 16's live gate is genuinely closed |
| Inbox | `listInbox`/`briefInbox`, `replyToMessage`, toolless digest/reply paths | Complaint context and draft-only response; never raw body in a tool-bearing loop |
| Calendar | Phase 17 read/stage tools and approved `externalAction` arm | Sales call context and optional event proposal; no direct create |
| Artifacts | Phase 18 `createDocument`, Output card, Vault-created document rows | SOP, campaign, brand-review, call-prep artifacts; no duplicate artifact store |
| Source summaries | Phase 26 bounded summary APIs and deterministic Command Center composition | Business Pulse reads summaries, not raw page tables |
| Evals | `run-eval-golden.mjs`, pinned `skillVersions`, state assertions, cost cap | Add pack fixture driver and outcome assertions; never compare prose |
| Browser UAT | existing authenticated Playwright harness and responsive product-page gates | Candidate-preview route/seed plus desktop/mobile cases before exposure |
| Audit | insert-only `audit`, refs/counts-only payloads | State-changing pack events only; no prompt/output copies |
| Outcome metrics | new append-only pack event plane | Do not overload request-terminal `telemetry`, which requires a `requestId` and is write-once |

Do not add a dependency. Markdown, JSON, Node's built-in crypto/hash support, existing Convex tables/functions, Vitest, and Playwright are sufficient.

## Upstream Source and Provenance

Anthropic describes the repository as file-based plugins composed of Markdown skills/workflows plus connector configuration. The root repository is Apache-2.0 licensed and explicitly presents these workflows as generic starting points to customize. Sources:

- Repository: <https://github.com/anthropics/knowledge-work-plugins>
- Small Business overview: <https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business>
- Small Business skills: <https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business/skills>
- Marketing skills: <https://github.com/anthropics/knowledge-work-plugins/tree/main/marketing/skills>
- License: <https://github.com/anthropics/knowledge-work-plugins/blob/main/LICENSE>

The upstream repository moves. Research must not record `main` as the source version. The first execution task must resolve one exact 40-character commit SHA, then inventory the tree at that SHA. Candidate source roots are:

| Pikar workflow | Candidate upstream source roots to inventory at the pinned SHA | What to adapt | What not to copy |
|---|---|---|---|
| Business Pulse | `small-business/skills/business-pulse/`, `monday-brief/`, `friday-brief/` | coverage/priority/degraded-source patterns | Small Business router and connector calls |
| Campaign Plan | `marketing/skills/campaign-plan/`, `small-business/skills/run-campaign/`, `content-strategy/` | campaign brief, audience, channel, measurement structure | HubSpot/Canva execution claims |
| Customer Complaint Response | `small-business/skills/handle-complaint/`, `ticket-deflector/`, `customer-pulse/`; relevant customer-support draft/research skills | acknowledge/investigate/draft/operational-learning sequence | refund execution and connector-specific mutations |
| Sales Call Prep | sales call-prep skill/command at the pinned tree | account/person context, questions, risks, follow-up structure | CRM fields and pipeline facts not present in Phase 27 |
| Process/SOP Builder | operations process/SOP skill/command at the pinned tree | interview-to-process-map/SOP/RACI/risk structure | external task-system writes |
| Brand Review | `marketing/skills/brand-review/` | brand criteria, evidence, mismatch and recommendation contract | assumption that a connector or filesystem contains a brand kit |

The manifest, not this table, is authoritative. The execution task must fail if an expected path does not exist at the pinned SHA; it must not silently substitute a similarly named current-main file.

### Required provenance artifact

Commit a canonical manifest such as `third_party/knowledge-work-plugins/manifest.json` with one entry per Pikar workflow:

```json
{
  "repository": "https://github.com/anthropics/knowledge-work-plugins",
  "commit": "<40-char SHA>",
  "license": "Apache-2.0",
  "workflows": {
    "business-pulse": {
      "sourceFiles": [
        { "path": "small-business/skills/business-pulse/SKILL.md", "sha256": "..." }
      ],
      "adaptedBody": "packages/contracts/src/skills/packBusinessPulse.md",
      "adaptedSha256": "...",
      "modified": true,
      "modificationSummary": "Rewritten for Pikar's provider-neutral tools, Blueprint/Vault context, partial-source states, and plan gate."
    }
  }
}
```

Also commit the Apache-2.0 license text and a `THIRD_PARTY_NOTICES.md` entry naming Anthropic, the repository, pinned commit, selected paths, and that Pikar modified the material. If the pinned tree contains a `NOTICE` file or per-file notices, preserve them. Apache-2.0 permits modification and redistribution, but Section 4 obligations still require retaining the license, notices, and prominent modification statements.

Use a local verification script that hashes the committed selected-source snapshot and adapted bodies and compares them with the manifest. It must not fetch `main`, publish a candidate, activate a skill, or run on a schedule. An upstream update is a manual GSD change: choose a new SHA, produce a human-readable diff, update the snapshot/manifest/notices, adapt the body, publish a new candidate, rerun gates, then activate explicitly.

## Architecture Patterns

### 1. One loop, one router, code-owned pack registry

The local architecture already proves the required pattern:

- `runAgentLoop` accepts an optional `toolNames` allow-list.
- When present, the returned tool record is physically filtered.
- `[]` yields an empty record; it is not treated like `undefined`.
- `runSpecialistTurn` loads the pinned/active registry body fail-closed and calls the same loop.
- ADR-007 places skill text in the DB and capability authority in code.

Create one pure registry with a closed workflow id, skill name, allowed operations/tool names, output contract, and preflight requirements. The registry may live beside `specialists.ts`, but should not be expressed as another prompt router.

```ts
export const WORKFLOW_PACKS = {
  "business-pulse": {
    skillName: "pack-business-pulse",
    tools: ["readBusinessPulseInputs", "searchVault"],
    output: "briefing",
  },
  // ...five totality-bound entries
} as const satisfies Record<WorkflowPackId, WorkflowPackSpec>;
```

The Executive Agent chooses a workflow; the registry only validates and resolves that choice. An unknown id returns a governed `unknown_pack` stop. Do not default to Business Pulse or a generic workflow.

### 2. Complete operation-to-tool matrix

PACK-03 is stronger than a list of tools. The matrix must enumerate every operation mentioned by a body and classify it as `existing`, `missing`, or `forbidden`. Put the matrix in pure TypeScript and generate documentation/tests from it so prose and grants cannot drift.

Recommended initial matrix:

| Workflow | Existing operations | Explicitly missing/degraded in Phase 27 | Forbidden |
|---|---|---|---|
| Business Pulse | Phase 26 summaries; Blueprint; Vault citations; bounded inbox/calendar summaries if available | HubSpot, QuickBooks, Stripe/PayPal source sections; absent sources become named partial state | raw cross-table scans, arbitrary connector reads, sends/writes |
| Campaign Plan | latest Growth OS/evaluation context; Vault; web research; content artifact creation | CRM audience/pipeline, live sales/accounting performance, Canva/HubSpot execution | campaign send, paid media launch, CRM mutation, fabricated performance data |
| Complaint Response | pasted input; server-resolved inbox message; toolless body digest/draft; staged reply plan | order/refund/ticket history without Phase 28 connectors | refund, send, forwarding, CRM/ticket mutation, injected-body tool choice |
| Sales Call Prep | Blueprint/Vault; web research; inbox digest; calendar read; call-prep artifact | HubSpot account/deal/pipeline facts | CRM mutation, calendar creation without plan approval, outreach send |
| Process/SOP Builder | uploaded/voice brief already extracted; Vault search; document creation | task-system import/publishing | external task creation, invented owners/deadlines, arbitrary filesystem writes |
| Brand Review | confirmed Blueprint brand facts; Vault brand docs; uploaded artifact; document creation | generic review when confirmed brand guidance is absent, named as a limitation | inventing brand rules, publishing/editing external assets, connector writes |

The tool grant must be derived from the existing-operation column, never parsed from a skill body. Tests should assert exact equality between the registry allow-list and expected tool keys. Missing and forbidden operations should be named in code-owned result enums so a model cannot relabel a refusal as success.

### 3. Untrusted-content fence and toolless ingestion

Reuse the two already proven boundaries:

- Vault/web excerpts may inform a proposal only after a visible untrusted-data fence and can never select or parameterize a write tool.
- Raw email/message bodies only enter toolless, schema-validated digest/draft calls. The tool-bearing loop receives bounded structured summaries, labels, refs, and counts.

Complaint Response is the sharpest case. It should compose the existing `replyToMessage` path rather than return a raw email body into a pack loop. Campaign and Sales research should reuse Phase 16's source fence and insufficient-evidence verdict. A fetched page, Vault document, attachment, or inbox message cannot widen the pack id, tool set, plan kind, recipients, or approval state.

### 4. Candidate-first and dual evidence activation

The current skills table has `status` and eval `evidence`; bodies are immutable. Extend it minimally with immutable provenance and separate browser evidence, for example optional canonical JSON strings:

- `provenance`: source repository, exact commit, selected path hashes, adapted-body hash, license id, modification notice hash.
- `browserEvidence`: run id, tested skill version, authenticated flag, viewport count, cases passed/total, timestamp, deployment ref; no screenshot bytes, page text, tenant name, or generated prose.

Add a candidate-only pack publisher that supports an unseeded skill and always inserts `status: "candidate"`. It should be idempotent against the newest body+provenance hash. Do not route first publication through `seedSkills`' bootstrap-active branch.

Strengthen the one activation choke point:

```ts
if (isWorkflowPackSkill(name) && target.status === "candidate") {
  requirePassingEval(target.evidence, name, version);
  requirePassingBrowserGate(target.browserEvidence, name, version);
  requireValidPinnedProvenance(target.provenance, target.body);
}
```

Archived/rolled-back targets remain exempt, preserving emergency rollback. The code-owned grant registry is version-independent, so rollback changes the body only and never expands tools.

### 5. Discovery without a catalogue

The phase context permits a small workspace quick-start, Command Center suggestion, or both. Prefer both using one data source:

- Command Center may suggest at most one relevant pack from deterministic source-summary/profile inputs.
- Workspace may show six compact quick starts only when their skill has an active version and the pack's preflight is honest.
- A missing capability does not hide the workflow if a meaningful degraded path exists; it displays the missing source and the narrower outcome.
- No separate `/plugins`, marketplace, install flow, or tenant-controlled grant UI.

An active skill row is the exposure flag. The first candidate has no active version, so ordinary discovery queries return nothing. Browser testing a candidate uses an owner/test-only pinned preview seam and cannot make it visible to normal users.

### 6. Reuse output planes

Map workflow results onto existing artifacts/cards:

- Business Pulse -> briefing/report card composed from Phase 26 summaries.
- Campaign Plan -> created document/content artifact plus optional proposed follow-up plan.
- Complaint Response -> draft/PLAN card; zero sends before approval.
- Sales Call Prep -> created document or Output card; optional calendar proposal goes through `externalAction`.
- Process/SOP Builder -> Vault/Content artifact.
- Brand Review -> Vault/Content artifact with cited findings and a limitation state.

Do not add a `packOutputs` blob store. A small run/event row may point to existing artifact/plan ids, but content remains in the existing planes.

## Telemetry and Outcome Measures

The existing `telemetry` table is one write-once terminal row per `requests` row. Specialist and internal-artifact workflows intentionally create no request rows. Extending that table would either fabricate request rows or break its semantics. Add a separate append-only `workflowPackEvents` table with bounded indexes such as `(tenantId, createdAt)`, `(tenantId, packId, createdAt)`, and `(tenantId, runId)`.

Closed event vocabulary:

- `recommendation_shown`
- `recommendation_accepted`
- `run_started`
- `preflight_completed`
- `plan_proposed`
- `plan_approved`
- `plan_edited`
- `plan_rejected`
- `capability_missing`
- `artifact_created`
- `run_completed`
- `run_failed`

Allowed fields are refs, enums, booleans, counts, durations, and costs only: `tenantId`, `packId`, `runId`, `skillVersion`, optional `threadId`/`planId`/`artifactId`, event, completion outcome, `sourceExpectedCount`, `sourceAvailableCount`, `preflightMissingCount`, `runtimeMissingCount`, `claimCount`, `citedClaimCount`, `unsupportedClaimCount`, `costUsd`, `durationMs`, and `createdAt`. Never store prompts, input text, citations' excerpts/URLs, generated prose, customer names, financial values, or connector bodies.

Metric definitions must be code-owned:

- Time to first useful outcome: earliest `run_completed(outcome=useful)` minus tenant onboarding completion time; report unknown when onboarding timestamp is unavailable.
- Recommendation acceptance: accepted/shown for the same recommendation id and pack.
- Plan decisions: counts of approve/edit/reject events linked to a pack run; hook the existing plan decision mutations using an optional `packRunId` on the plan.
- Missing-connector surprise: runs where `runtimeMissingCount > preflightMissingCount`; planned/announced missing sources are not surprises.
- Citation coverage: `citedClaimCount / claimCount`, with zero-claim reported as not applicable rather than 100%.
- Unsupported-claim rate: `unsupportedClaimCount / claimCount`, again with an explicit not-applicable state.
- Completion outcome: closed enum (`useful`, `partial`, `blocked`, `refused`, `failed`, `no_findings`).
- Cost and latency: sum model cost returned by the one loop and wall-clock duration at the pack-run boundary.

Install count is intentionally absent.

## Workflow-Specific Adaptation Notes

### Business Pulse

Compose the bounded Phase 26 page-summary contracts and deterministic home-priority logic. Do not query Approvals, Finance, Content, Reports, or Pipeline raw tables from the skill. The model may synthesize narrative from a code-built snapshot, but the next move/binding constraint should remain the deterministic Phase 26 result. Connector-backed cash/pipeline/customer sections are unavailable until Phase 28 and must be labelled absent, not estimated.

### Campaign Plan

Compose the latest Growth OS/evaluation context, Blueprint, Vault, Phase 16 research, and Phase 18 artifact path. Output is a campaign brief with objective, audience assumptions, evidence, message, channels, assets, experiment, and measurement plan. It must not claim that CRM audiences, Canva assets, HubSpot campaigns, or paid media were created. If Phase 16's live gate remains incomplete when Phase 27 executes, web-grounded market claims stay disabled and the workflow produces a tenant-context-only plan with a named limitation.

### Customer Complaint Response

Support pasted text without any connector. For mailbox context, reuse the existing server-side resolver and toolless reply drafter. The workflow may draft and propose; it may not send, refund, forward, update a ticket, or mutate CRM. The operational-fix section is a recommendation/artifact, not an automatic process change.

### Sales Call Prep

Use user/Vault/Blueprint/web/inbox/calendar context. Without Phase 28 CRM data, explicitly omit deal stage, value, activity history, and pipeline claims. Call preparation remains useful as a cited brief: objectives, known facts, unknowns, questions, risks, and follow-up options. Calendar creation remains plan-gated.

### Process/SOP Builder

Input files and voice briefs should enter through the already-shipped extraction/transcription paths. The pack organizes bounded source material into purpose, scope, trigger, prerequisites, steps, decisions, exceptions, owners, controls, measures, and revision history, then saves through the existing artifact path. Unknown owners/timings remain placeholders or questions; the model must not invent them.

### Brand Review

Confirmed tenant brand guidance wins. Search Blueprint/Vault for it and cite it. When no confirmed guidance exists, return `generic_review` with a visible limitation and distinguish general craft/accessibility observations from brand-conformance claims. The pack reviews; it does not edit or publish media.

## Don't Hand-Roll

- Do not implement or install Claude/Cowork's plugin runtime, slash commands, sub-agents, or `.mcp.json` loading.
- Do not build a second agent loop; use `runAgentLoop` with a different body and filtered record.
- Do not build a second router; the Executive Agent remains the front door.
- Do not create a second memory plane; use Blueprint, Vault, and bounded source summaries.
- Do not create a second artifact/output table; use Content/Vault, plans, cards, and existing action arms.
- Do not parse tool grants out of Markdown or store grants in Convex rows.
- Do not duplicate email-body handling; reuse the toolless digest/reply boundary.
- Do not duplicate web research or connector clients.
- Do not place pack events in the insert-only audit table as a metrics store, and do not fabricate `requests` rows to fit terminal telemetry.
- Do not invent a prose-scoring eval. Assert persisted state, tools, plans, artifacts, evidence counts, and refusals.
- Do not auto-fetch upstream `main`, auto-publish, or auto-activate.

## Common Pitfalls

### Bootstrap activation bypasses the phase gate

Adding a gated skill to `seedSkills` is not enough: first seed becomes active. Use candidate-only first publication and test an empty registry.

### Gating a skill the runner cannot execute deadlocks it

The repository already keeps several skills ungated because the golden runner cannot reach their path. Add the pack fixture driver before adding the six names to `GATED_SKILLS`, and prove each candidate body is the body actually loaded.

### Browser visibility is not the same as active skill state

A candidate can be eval-green yet visually unusable. Conversely, an active skill hidden only by client code remains API-reachable. Pack candidate activation should require recorded browser evidence, leaving no active version until both gates pass.

### Prompt wording is not capability containment

“Do not send” in a body is useful defense in depth, but the actual guarantee is the filtered tool record. Test exact key sets and invoke a withheld tool in a control case.

### Read-shaped tools may write

`evaluateBusiness` persists an evaluation and audit row. Classify operations by behavior, not names. Business Pulse should consume Phase 26 summaries and existing evaluation projections instead of rerunning engines invisibly.

### Partial results become fabricated completeness

Every source adapter needs `available | partial | unavailable | stale` and coverage counts. A missing source must survive into the output contract and telemetry.

### Citation metrics become vacuous

Zero claims is not 100% cited. Pair coverage ratios with `claimCount > 0`, and include fixtures with supported and unsupported claims.

### Upstream path drift invalidates provenance

GitHub `main` links are browsing aids, not provenance. Pin a SHA, hash bytes, and fail on a missing path or hash mismatch.

### Shared skill streams collide

The repository has repeatedly parked work because `cockpit-agent` has one candidate stream. Prefer six independent pack skills and avoid editing `cockpit-agent` six times. If one router teaching edit is necessary, perform it once after all six routes and fixtures exist, in a single gated candidate.

### Phase dependencies may still be only implementation-complete

Phase 16, 17, 18, 19, 25, and 26 have explicit live/owner gates. Planning must use actual completion evidence at Phase 27 execution time. A dependency named in the roadmap is not automatically safe because code exists.

## File Ownership and Suggested Plan Boundaries

Keep collision-heavy shared files in early, single-owner plans.

| Boundary | Likely files | Ownership rule |
|---|---|---|
| Provenance | `third_party/knowledge-work-plugins/**`, `THIRD_PARTY_NOTICES.md`, one hash/check script | No runtime/code changes |
| Pure pack contract | new `packages/core/src/workflowPacks.ts` + tests/export | Own all ids, matrices, grants, outcomes, preflight states in one table |
| Skill contract/schema | `packages/contracts/src/skill.ts`, six `.md`/derived bodies, `schema.ts` | One plan owns all shared literals and optional fields |
| Registry gate | `skills.ts`, `skills.test.ts`, authorization/import guards | One candidate publisher; one activation choke point; no body patching |
| Runtime | `llm.ts`, pack adapter module, focused tests | One loop; exact tool filtering; no `cockpit-agent` edit yet |
| Eval harness | `run-eval-golden.mjs`, eval cases, smoke/assert readers | Build the driver before gating names |
| Telemetry | new pack event adapter/table + projections/tests; minimal hooks in plan mutations | Append-only refs/counts only; bounded read model |
| Discovery/UI | workspace quick starts/Command Center suggestion, pack cards, Playwright | Land last; candidate preview owner/test-only; exposure after evidence |
| Playbooks | `agent-runtime.md`, `skill-registry.md`, `cockpit.md`, dashboards/telemetry playbook and `watch.json` | Each plan updates only the playbook it owns; do not discharge foreign watcher debt |

Suggested implementation sequence:

1. Pin/snapshot upstream, attribution, manifest and hash checker.
2. Freeze pack ids, operation matrix, output/preflight/outcome contracts, schema fields and indexes.
3. Add candidate-only publishing, provenance validation, browser evidence and dual-gate activation.
4. Add the same-loop pack runner, exact code-owned grants, honest preflight and append-only pack events.
5. Extend the golden runner with a pinned pack driver and shared adversarial fixtures.
6. Adapt Business Pulse and Campaign Plan.
7. Adapt Complaint Response and Sales Call Prep.
8. Adapt Process/SOP Builder and Brand Review.
9. Add deterministic recommendation/discovery plus outcome projections.
10. Run all six eval gates, authenticated desktop/mobile browser gates, record evidence, activate, and verify rollback/disable behavior.

## Code Examples

### Structural grant check

```ts
const tools = Object.fromEntries(
  Object.entries(buildCockpitTools(/* existing ctx */)).filter(([name]) =>
    spec.tools.includes(name),
  ),
);
```

Keep the existing `toolNames === undefined` distinction. A pack always supplies an array; no pack should inherit the Executive Agent's full record.

### Honest preflight

```ts
type SourceState = "available" | "partial" | "unavailable" | "stale";
type PackPreflight = {
  runnable: boolean;
  sources: Record<PackSource, SourceState>;
  missingRequired: PackSource[];
  missingOptional: PackSource[];
  promisedOutcome: "full" | "partial" | "blocked";
};
```

Compute this in code before the model call. The prompt receives the result; it does not decide which sources exist.

### Browser evidence

```ts
type BrowserGateEvidence = {
  runner: "playwright:pack";
  runId: string;
  pass: boolean;
  skillVersions: Record<string, number>;
  authenticated: true;
  viewports: number;
  casesPassed: number;
  casesTotal: number;
  deploymentRef: string;
  ts: number;
};
```

No screenshot path, DOM text, tenant identity, or generated content belongs in the skill row.

## Validation Architecture

### Validation layers

| Layer | What it proves | Harness | Gate |
|---|---|---|---|
| L0 provenance | exact SHA/path/hash/body/license linkage; manual update only | Node hash checker + manifest tests | Every manifest entry and adapted body hash matches; no `main`/floating ref |
| L1 pure contracts | six-id totality; operation classification; grants; output/preflight/outcome enums | `packages/core` Vitest | Every operation classified exactly once; grants equal existing operations; forbidden writes absent |
| L2 registry | first publish is candidate; immutable body/provenance; eval+browser required; rollback exempt | `skills.test.ts` / convex-test | Empty registry never activates; evidence pins exact version; candidate cannot bypass either gate |
| L3 runtime containment | same loop; exact filtered tools; unknown pack refusal; injection cannot actuate | mock model + real `runAgentLoop`/pack wrapper | Withheld tool unavailable; zero send/external-write/request rows before approval |
| L4 workflow outcomes | artifacts/plans/source states/citations/refusals for each workflow | extended golden runner with candidate pins | State assertions only; cost cap; all six candidates driven on their actual path |
| L5 tenant/log safety | cross-tenant isolation; no raw content in audit/telemetry/events | convex-test two-tenant + needle scans | Non-empty control partitions; needles absent from audit, DLQ, terminal telemetry and pack events |
| L6 integration | existing Blueprint/Vault/research/inbox/calendar/content/summary seams compose | focused integration tests + SMOKE cases | No duplicate store/router/loop; expected existing ids/cards/plan states result |
| L7 authenticated UX | discoverability, partial/blocked states, candidate invisibility, responsive cards, approval handoff | Playwright authenticated desktop + mobile/tablet | Candidate hidden normally; owner preview works; active visible only after recorded passing evidence |
| L8 live phase gate | real model behavior and deployed UI | pinned `eval:golden`, connected browser/UAT | Six green eval runs, six browser gates, evidence read back, activation and rollback verified |

### Requirement-to-test map

| Requirement | Required proof |
|---|---|
| PACK-01 | manifest SHA/path/hash tests; license/notice presence; modification statement; simulated upstream change creates diff but no DB mutation; source/body hash mismatch refuses publication |
| PACK-02 | each workflow fixture produces its specified existing artifact/card/plan; static/graph checks show no plugin loader, MCP runtime, second loop/router/memory/output table |
| PACK-03 | total operation matrix; exact grant equality; withheld-tool invocation fails; injection cases; missing/sparse/cross-tenant cases; first-candidate state; eval and browser evidence both required |
| PACK-04 | event key allow-list and needle scans; metric projection fixtures; zero-denominator/unknown coverage behavior; cost/duration attribution; tenant isolation and bounded windows |

### Minimum eval fixture set

Each workflow needs at least:

- happy path with adequate tenant context;
- sparse Blueprint/profile;
- required/optional source unavailable;
- partial source set with visible limitation;
- planted prompt injection in Vault/web/inbox content;
- attempted prohibited tool/write;
- cross-tenant source-id collision;
- citation-supported and unsupported-claim outcomes;
- cost/step ceiling with honest partial result;
- no-findings/no-action outcome where applicable.

Workflow-specific assertions:

- Business Pulse: reads composed Phase 26 summary; deterministic recommended move retained; absent finance/pipeline named.
- Campaign: artifact created; no CRM/Canva/send rows; external market claims have sources or unsupported verdict.
- Complaint: draft/plan staged; zero sends/refunds; attacker recipient absent; raw body needle absent from logs/events.
- Sales Prep: prep artifact exists; no invented deal fields; calendar write only after plan approval.
- SOP: Vault/Content artifact exists; unknown owners remain unknown; no external task-system writes.
- Brand Review: confirmed brand facts cited; missing guidance yields `generic_review`, not false conformance.

### Browser/UAT matrix

Run authenticated cases at minimum desktop and narrow mobile widths:

1. No active pack versions: no quick start or recommendation is discoverable.
2. Candidate with eval evidence only: still hidden.
3. Candidate owner preview: real card/partial/blocked/loading/error states render without exposing it to a normal tenant.
4. Browser evidence recorded and candidate activated: relevant quick start/suggestion appears.
5. Each workflow runs once through its real card/artifact/plan surface.
6. Complaint/calendar/external-action path visibly stops at the Plan card before any side effect.
7. Rollback to prior active version works and does not change the code-owned tool set.
8. Disable/absence returns discovery to hidden without deleting artifacts or events.

### Mutation and non-vacuity checks

At least these mutations must be observed red before the gate is trusted:

- first pack seed changed from `candidate` to `active`;
- browser-evidence check removed;
- provenance version pin changed to a different version;
- one forbidden tool added to a pack grant;
- empty allow-list treated as full tools;
- injection fixture's attacker action allowed;
- citation count forced equal to claim count;
- runtime missing source not counted as a surprise;
- tenant predicate removed from pack event query;
- raw generated text inserted into a pack event.

### Commands to plan for

Exact test paths will be finalized by planning, but the phase gate should include:

```text
pnpm --filter @pikar/core test
pnpm --filter @pikar/contracts test
pnpm --filter @pikar/backend test
pnpm --filter @pikar/backend eval:golden -- --skill <pack>@<version>
pnpm --filter @pikar/web typecheck
pnpm --filter @pikar/web build
pnpm --filter @pikar/web test:e2e -- <pack spec>
node scripts/check-playbooks.mjs
```

The live eval commands must use versions read back from the deployment after candidate publication. Never assume `v1`; optimizer/candidate activity can consume version numbers, and a fresh deployment's bootstrap behavior is exactly the trap this phase is changing for pack skills.

## Dependencies and Readiness Gates

Before execution reaches integration/exposure:

- Phase 25 must provide the private-beta identity baseline the roadmap names.
- Phase 26 Business Pulse summaries and Command Center deterministic priority must be complete and browser-approved.
- Phase 16 must be model-gate complete before pack claims web research as available.
- Phase 17 calendar reads/staging and owner UAT must be complete before Sales Call Prep advertises calendar context/action.
- Phase 18 artifact path and Output-card browser gate must be complete before SOP/Campaign/Brand outputs rely on it.
- Phase 19 is required only for any native contact/follow-up features; the Phase 27 baseline remains useful without CRM and must not imply it.

Treat each as a named preflight gate, not a blanket reason to stop all work. Provenance, pure contracts, candidate gating, matrix tests, telemetry, and no-connector degraded fixtures can be built independently.

## Open Planning Decisions

These are implementation choices, not user decisions, and can be settled during plan creation:

- Extend `SpecialistSpec` with pack metadata or create a sibling pure registry. Prefer a sibling type if extending `SpecialistRoute` would let Growth `diagnose()` emit pack routes accidentally; reuse the same resolver/loop mechanics either way.
- Store canonical provenance/browser evidence as optional JSON strings on skill rows or normalized nested fields. Prefer JSON if it keeps schema widening small, but validate and canonicalize before insert.
- Quick start, Command Center suggestion, or both. Prefer both backed by one bounded discovery query.

Do not leave open: candidate-first publication, exact code-owned grants, dual eval/browser activation, no floating upstream refs, and append-only refs/counts-only pack events. Those are requirements, not discretionary design details.

## Planning Conclusion

Phase 27 should be planned as governance substrate first, six adaptations second, exposure last. The bodies are the easy part. The load-bearing work is a reproducible upstream manifest, a candidate path that cannot bootstrap active, an eval driver that truly executes each candidate, exact structural grants, honest partial-source contracts, a separate safe outcome-event plane, and a browser evidence check inside the same activation choke point. With those pieces, all six workflows are ordinary native Pikar behavior: one Executive Agent, one loop, one Blueprint/Vault memory, one plan gate, and the existing artifact surfaces.

