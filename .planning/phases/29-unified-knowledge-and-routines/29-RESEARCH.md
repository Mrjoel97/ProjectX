# Phase 29: Unified Knowledge and Routines - Research

**Researched:** 2026-08-05  
**Requirements:** KNOW-01, ROUT-01, ROUT-02  
**Mode:** implementation/ecosystem  
**Confidence:** High for the native-search and manual-routine design; medium for recurrence because the phase explicitly makes it conditional on decisions and live proof.

## Research Summary

Phase 29 should ship two unconditional capabilities and one conditional capability:

1. A tenant-scoped, bounded, cited search coordinator over native Pikar adapters.
2. A form/schema-driven customization layer over Phase 21's approved workflow templates, plus a pinned manual rerun.
3. Recurrence only after a separately recorded decision and proof gate passes. If any recurrence row is unresolved, the phase still completes with the pinned manual workflow and must not create a routine scheduler.

The architectural center is a **toolless search pipeline**, not another agent router. A code-owned coordinator asks a schema-validated toolless planner for bounded per-source queries, runs only the native adapters that code registered, deduplicates in pure TypeScript, and asks a second toolless structured call to produce claims that cite evidence IDs. Code then rejects unknown citations, computes authority/freshness/confidence, preserves conflicts and lands the result on the content plane. Tool-bearing agents receive counts/status only. This applies the strictest trust class across a mixed result: Drive, Gmail, CRM and support content is third-party/untrusted even though Vault currently has the narrower ADR-006 trusted-as-own exception.

Phase 21 is a hard dependency, not a documentation reference. Before implementation, the planner/executor must inspect its shipped tenant candidate schema, resolver, activation API, eval evidence and pin representation. Current repository code still has the older global `skills` registry described by ADR-003; `skills.insertCandidate` is internal, accepts a free body, and writes global rows without `tenantId`. Phase 29 must consume Phase 21's tenant seam, not bolt tenant customizations onto those global product rows or weaken owner/eval gates.

## Standard Stack

Use the existing stack and patterns:

- Pure contracts and deterministic logic in `packages/core/src/` (CLAUDE.md section 1).
- Thin tenant-scoped Convex adapters through `convex/lib/functions.ts`; identity-less scheduled/internal work carries an explicit `tenantId` and scopes every read/write.
- Existing AI SDK structured-generation pattern in `packages/backend/convex/llm.ts`. Keep toolless calls there: the repository records a TypeScript circular-inference cliff when adding more `"use node"` modules.
- Existing `@convex-dev/rag@0.7.5` hybrid Vault retrieval through `vaultGroundHydrated`; do not replace the RAG component or re-embed the corpus.
- Existing provider adapters and token plane: `gmail.ts`/`gmailAuth.ts`, the Phase 20.1 Drive read seam, and landed Phase 28 CRM/support projections. No arbitrary MCP client.
- Existing skill candidate/eval activation seam from Phase 21 and the Phase 3.6 golden-runner evidence model.
- Convex scheduled functions (`runAt`, returned `_scheduled_functions` id, `ctx.scheduler.cancel`) only if recurrence passes its gate. Schedule from a mutation so arming and state are atomic. Scheduled mutations are retried/exactly-once by Convex; actions are at-most-once and therefore need an explicit durable run state and retry policy.
- If recurrence ships, use `@js-temporal/polyfill` for IANA wall-time/DST calculation after a focused Convex-runtime spike. Node v24.7.0 in this workspace has no global `Temporal`, and no timezone/recurrence library is installed. Do not hand-roll timezone offsets with `Date`/`Intl` arithmetic.

No broad search framework, vector database, plugin runtime, cron parser or new agent loop is required.

## Existing Seams to Reuse

### Vault

`vaultGroundHydrated` already supplies the right bounded retrieval primitive:

- hybrid search, limit 8 and score threshold 0.2;
- explicit tenant namespace;
- tenant-scoped graph expansion with a hop cap;
- seed and graph-neighbor folder sealing;
- per-document 1,500-character and total 8,000-character hydration budgets;
- parallel `docIds`, titles and matched chunks;
- long-document hydration from matched passages rather than document openings.

Do not put the Business Blueprint `spine` into search evidence. The current code deliberately keeps it outside result arrays so it cannot fabricate a result, count or citation.

Extend the tenant-owned metadata projection only as needed to obtain stable document type/source timestamps. Reuse `vaultDocuments.retrievedAt` for stored web research and `createdAt`/provider modification time for ordinary artifacts. Vault citations should retain document IDs/titles and, where a quoted passage is shown, use the Phase 14 rule: cap and normalize the excerpt, verify it is a substring of the evidence text, and drop an invalid excerpt rather than the whole claim.

### Drive

The existing Drive rail already establishes the token/scope ordering and honest availability states: token row -> `drive.readonly` scope -> refresh -> provider call. The folder browser is bounded and distinguishes `not_connected`, `reauth`, `refresh_failed`, truncation and unreadable files. Phase 29 should consume the Phase 20.1 **read-only search** endpoint, not the folder import path and not paid ingestion.

Require the Drive adapter to return a stable file ID, label, MIME/type, provider `modifiedTime`, retrieval time, match/snippet, and truncation/availability state. Keep shared-drive flags on every list/search. Validate any value interpolated into Drive's `q=` language; URL encoding does not prevent query-language injection.

### Gmail

The current Gmail seams demonstrate the correct bounds:

- tenant-keyed token lookup/refresh with non-throwing `not_connected`/`reauth` results;
- metadata-first reads (`format=metadata`) and hard caps (20 for contact search, 50 for briefing lists);
- body reads only for a selected bounded subset, each truncated;
- provider query escaping;
- refs/counts-only `mailbox.searched`/`mailbox.listed` audit events;
- raw bodies never enter a tool-bearing loop.

Unified search needs a new read-only knowledge-query function rather than reusing `gmail.search`, which is specifically a correspondent/contact resolver. It should search message/thread metadata with a hard result cap, then hydrate only the planner-selected top subset. Those bodies go directly to the toolless synthesis call. Never return a Gmail body, sender, subject or synthesized digest through a tool result or audit payload.

### CRM/support sources

Use only landed Phase 28 native projections with their existing tenant and availability contracts. Each adapter must declare its own bound, authority class and freshness field. Absence of a Phase 28 adapter is `unavailable/not_landed`, not an empty successful result. Do not make Phase 29 responsible for new provider OAuth or suitability review.

### Research evidence and citations

Reuse Phase 16's evidence semantics instead of equating a citation list with truth. A stored `web_research` Vault document can say `No web search was performed`, `No web sources were retrieved`, or `insufficient_evidence`; source count and search-call count are distinct. Web-derived Vault evidence should retain a lower `third_party_research` authority class even though it is retrieved from the Vault adapter.

## Architecture Patterns

### 1. Closed native-source registry

Define the source registry in code, not in a skill body or tenant row. A minimal pure contract should include:

```ts
type KnowledgeSource = "vault" | "drive" | "gmail" | "crm" | "support";
type SourceState =
  | { status: "available"; returned: number; truncated: boolean }
  | { status: "unavailable"; reason: "not_connected" | "reauth" | "not_landed" | "provider_error" }
  | { status: "partial"; returned: number; reason: "cap" | "provider_error" };

type Evidence = {
  evidenceId: string;             // server-minted, local to the run
  source: KnowledgeSource;
  sourceRef: string;              // stable provider/native ref
  label: string;                  // content plane only
  text: string;                   // bounded, synthesis plane only
  authority: "tenant_owned" | "system_of_record" | "correspondence" | "third_party_research";
  sourceUpdatedAt?: number;
  retrievedAt: number;
};
```

The model may select from the registered source enum; it never supplies an adapter, URL, MCP server, tool name, tenant ID, result limit or authority class.

### 2. Bounded query decomposition

Use a toolless, schema-validated planner whose output is limited to one short query per selected source plus optional date/entity filters from closed schemas. Clamp everything again in code:

- maximum five sources;
- one query per source in the first release;
- query length cap;
- adapter-owned result and character caps;
- no remote URLs or raw provider query language from the model;
- static fallback: if the planner fails, query Vault with the user's question and mark other sources `unplanned`, rather than silently claiming a full search.

Run safe independent reads with `Promise.allSettled`. Convert every rejection into a named `SourceState`; one provider failure must not erase successful sources or become a global `no results` statement.

### 3. Deterministic deduplication and scoring

Deduplicate exact identities first (`source + sourceRef`) and exact normalized content hashes second. Do not ask a model to merge semantically similar records; that can erase disagreement. Group possible cross-source duplicates as related evidence but retain every source reference.

Authority, freshness and confidence are code-owned:

- authority is a fixed adapter/type mapping, with special handling for Vault `web_research` documents;
- freshness is source-updated age plus retrieval time, never a date guessed from prose;
- confidence is a closed label (`unsupported | low | medium | high`), not a fake probability. Compute it from usable cited evidence count, authority, freshness, source availability and contradiction flags. Any conflict caps confidence and remains visible.

### 4. Toolless synthesis with citation validation

The synthesizer receives fenced evidence objects and returns a strict structure such as:

```ts
type SearchSynthesis = {
  summary: string;
  claims: Array<{
    text: string;
    evidenceIds: string[];
    excerpt?: string;
    conflictEvidenceIds?: string[];
  }>;
  unanswered: string[];
};
```

After generation, pure code must:

- drop claims with no known evidence ID or mark them unsupported;
- reject model-invented IDs;
- substring-verify optional excerpts;
- preserve conflicting evidence in the rendered result;
- attach authority/freshness/confidence from the evidence table, never from model output;
- show source availability/partial coverage beside the answer.

Land the answer and citation projection on a tenant-scoped content-plane row/card. The tool-bearing cockpit receives only a sentence such as “Search complete; 4 claims from 3 of 5 sources are shown,” plus availability counts. This mirrors Inbox Briefing: untrusted bodies enter a toolless call and useful prose is shown to the user without becoming a tool-selecting context.

### 5. Workflow-pack customization

Turn Phase 21's blank/free-body surface into approved-template customization:

- Each Phase 27 pack template exposes a versioned `customizationSchema` whose fields are closed and typed (terminology, tone, thresholds, source preferences and bounded instruction sections).
- The API accepts `{templateId, templateVersion, baseCandidateVersion, values}`. It does not accept a skill name, tool list, executable code, secret, remote URL, MCP config or arbitrary metadata.
- Pure code validates values and deterministically renders the candidate body from the exact approved template version.
- Optimistic concurrency rejects a save based on a stale base version; never silently merge two authors' edits.
- The resulting immutable tenant candidate records template lineage, source/upstream manifest from Phase 27, author, normalized customization diff/hash, eval evidence, previous active version and rollback target.
- Runtime resolution remains `tenant active customization -> approved product template`; code-owned specialist/tool registries stay unchanged.
- Candidate activation reuses Phase 21's eval choke point. No candidate self-activates, and rollback to a previously active tenant version remains available.

Outcome evals must assert tool/plan/artifact state and citation behavior, not wording. A template that can ingest external content needs held-out injection fixtures the author never sees. Authenticated browser UAT remains a second independent gate before exposure.

### 6. Manual pinned routine baseline

The unconditional ROUT-02 deliverable is a pinned workflow record/representation that captures exact `templateId`, active tenant candidate version, customization hash, source preferences and safe input defaults. “Run again” sends a fresh cockpit request through the existing `sendCockpitMessage` path. It must never replay an old plan or bypass current approval, connection readiness, budget, tool registry or active-version checks.

Every manual run performs a fresh connection-readiness check and names blocked sources before spending. Track repeat use by pinned-workflow ID and run correlation ID, never by storing the prompt in telemetry.

## Recurrence Decision and Proof Gate

Do not add `routines`/`routineRuns`, a dynamic scheduler or recurrence UI until all rows below have a recorded decision, automated proof and required live evidence. The recommended decisions are:

| Gate | Recommended decision/proof |
|---|---|
| Approval | Standing approval covers read-only retrieval and in-app artifact preparation only. Every external write/send still materializes a proposed plan for per-run approval. A truly unattended byte-identical send requires a separate ADR and is outside the default Phase 29 release. |
| Material changes | Template version, candidate version, recipients/destinations, action type, source set, threshold, cadence/timezone or output contract invalidates standing approval and pauses the routine. Tone-only changes still create a new immutable candidate and must pass eval before use. |
| OAuth | Preflight before every run. `not_connected`/`reauth` sets the run to `awaiting_reauth`, pauses the routine and notifies. Reconnect never auto-catches up; the user explicitly resumes. This is necessary because the current product has no reconnect-resume sweep and intentionally leaves held rows in place. |
| Time/DST | Store an IANA timezone and a closed local recurrence rule, not UTC cron text. Compute the next occurrence from local wall time after each run. Spring gap uses the next valid instant; fall overlap uses the first occurrence once. Show the resolved next absolute time. |
| Missed runs | Skip by default and record `missed/skipped`; never burst-catch-up external work. A user may manually run now. |
| Run identity | Unique key from `{routineId, scheduledLocalOccurrence, templateVersion}`. Claim in one mutation before scheduling work. A duplicate claim is an idempotent no-op. |
| Overlap | One active run per routine. A due tick encountering `claimed/running/awaiting_approval` skips and records overlap; it does not queue an unbounded backlog. |
| Retry | Bounded retries only for classified transient internal/provider failures, using the same run ID and exponential delay. No retry for auth, validation, budget, user pause or permanent provider refusal. External terminals remain provider-idempotent and plan-gated. |
| Cost | Reserve the complete bounded run estimate before the first paid planner/synthesis call. Refuse intact when unavailable; settle once by CAS. |
| Pause/revoke/delete | Pause is immediate state plus cancellation of the pending scheduled function. A callback re-reads status/version after claiming and before scheduling any action. Delete is a tombstone/revoke, not removal of audit/run history. |
| Notifications/audit | Notify due, awaiting approval, reauth, skipped/missed, failed and paused states. Audit only routine/run refs, closed reason codes, counts and timestamps. |

If the gate passes, use **self-scheduling one-shot mutations**, not one global static cron per user. A transaction claims the next occurrence, stores the returned scheduler ID and computes/arms the following occurrence. The run action reads the durable claim and may be retried only through a mutation-controlled state machine. Static Convex cron schedules are UTC and skip overlapping executions globally; they do not provide per-tenant IANA semantics or per-routine lifecycle controls.

## Telemetry and Success Measures

Add purpose-built refs/counts-only events or bounded aggregate readers; do not overload the existing terminal request telemetry row.

Search events should include: search run ref, question hash, requested/available/partial/unavailable source counts, evidence count, cited-claim count, unsupported-claim count, conflict count, duration, token/cost totals and outcome code. Per-source events may contain the source enum, result count, capped/truncated boolean, latency and closed availability reason—never labels, snippets, sender, subject, file names, URLs or prose.

Pack/routine events should include: pin/template/candidate/run refs, manual-versus-scheduled, readiness counts, completion/refusal code, plan decision (`approved|edited|rejected|pending`), repeat-run ordinal, duration and cost. Time-to-first-useful-outcome should join onboarding time to the first successful workflow outcome by refs; recommendation acceptance and missing-connector surprise rate should use existing recommendation/plan decisions plus readiness codes.

## File Ownership and Likely Change Set

Keep ownership narrow and validate actual Phase 21/28 filenames before planning:

- `packages/core/src/knowledgeSearch.ts` + test: source/result contracts, caps, dedupe, evidence validation, conflict/authority/freshness/confidence calculation and rendering helpers.
- `packages/core/src/workflowCustomization.ts` + test: schema validation, deterministic template rendering, material-change classification and lineage/diff hashes.
- `packages/backend/convex/knowledgeSearch.ts` + test: coordinator, tenant result persistence, source availability and refs-only audit/telemetry.
- `packages/backend/convex/llm.ts` + focused tests: the two toolless structured planner/synthesizer actions only; no new tool-bearing call.
- Existing source modules (`vaultGround.ts`, the Phase 20.1 Drive module, `gmail.ts`, and landed CRM/support projection modules): small bounded read adapters/projections only. Their write/import/send paths stay untouched.
- Phase 21 authoring modules and UI: replace the free-body experience with approved template fields while reusing its candidate/eval/rollback API.
- `packages/backend/convex/schema.ts`: land all Phase 29 optional/new-table widening once, early, because it is the repository's highest-collision file. Likely rows are bounded search-result/content-plane state and customization/pin lineage. Add recurrence tables only in a later conditional plan after the decision gate passes.
- Workspace/search and workflow-pack UI under `apps/web/app/(app)/dashboard/`: cited result card/search entry, source gaps, customization form and manual Run again. Read `docs/design/BRAND.md` before UI work and keep navigation disabled until connected browser verification.
- Update/register the owning playbooks (`vault.md`, `cockpit.md`, `skill-registry.md`, provider playbooks and a new knowledge-search/routines playbook if no existing owner fits). A standing-approval or recurrence decision requires a new ADR; do not edit accepted ADRs.

Avoid making Phase 29 own Phase 28 provider OAuth code, global skill-registry semantics, the generalized action executor or a second output store.

## Recommended Plan Sequencing

1. **Dependency audit and contract freeze.** Verify Phase 21 and Phase 28 shipped seams, freeze native source/evidence/availability/customization contracts in pure TypeScript, and land the single schema/playbook registration widening. If Phase 21's tenant seam is absent, stop ROUT-01 as dependency-blocked rather than adapting global rows.
2. **Source adapters.** Add/normalize bounded Vault, Drive, Gmail and landed CRM/support reads with explicit availability and trust metadata. Test each independently and two-tenant.
3. **Search coordinator and toolless LLM calls.** Add planner, parallel fan-out, deterministic dedupe/scoring, structured synthesis and post-validation. Land a content-plane result with citations and no prose in audit.
4. **Search UI and authenticated gate.** Expose one workspace search, honest loading/partial/unavailable/conflict states and citation drill-ins. Run adversarial and connected browser tests before navigation exposure.
5. **Workflow customization substrate.** Add approved schemas/rendering and Phase 21 candidate lineage/diff integration; retain code-owned tools and eval activation.
6. **Pack UI, evals and manual pin.** Add outcome fixtures, authenticated UAT, activation/rollback and manual Run again with readiness preflight. This completes ROUT-01 and the safe ROUT-02 baseline.
7. **Recurrence decision plan (conditional).** Record the standing-approval/OAuth/time/missed-run decisions and run the runtime/date/provider spikes. If any row fails, write a deferral record and omit plans 8-9.
8. **Routine engine (conditional).** Only after plan 7 passes: pure schedule/material-change logic, schema state machine, self-scheduling claim/retry/cancel path and cost reservation.
9. **Routine UI/live gate (conditional).** Pause/resume/revoke, next-run/DST display, readiness state, authenticated race tests and live OAuth/DST/missed-run proof.

Search and customization can proceed independently after the dependency/contract plan, but both must converge before the manual pinned-workflow gate. Recurrence is last and isolated so deferral does not leave inert schema/UI or prevent Phase 29 completion.

## Don't Hand-Roll

- Timezone offsets, DST ambiguity or recurrence conversion with `Date` arithmetic. Use Temporal polyfill if recurrence passes.
- A generic MCP client, connector marketplace or tenant-supplied adapter.
- A second agent router/loop or a search agent with write tools.
- Semantic dedupe that deletes conflicting source records.
- Confidence probabilities authored by the LLM.
- A second skill activation path or candidate status flip.
- Raw prompt editing as the workflow-pack customization model.
- Scheduler retries around external side effects without a durable run ID and terminal check.
- A catch-up queue for missed runs.
- A parallel analytics/log plane containing source content.

## Common Pitfalls

1. **Treating unavailable as empty.** A reauth/provider failure must not become “nothing exists.”
2. **Mixed-source trust downgrade is omitted.** ADR-006 permits user-owned Vault chunks in the loop, but it does not permit Gmail/Drive/CRM text there. The mixed pipeline must use the stricter toolless boundary.
3. **Citations are labels only.** Validate evidence IDs and excerpts; a model-written title is not provenance.
4. **The Blueprint becomes a search hit.** Keep `spine` separate from evidence/counts.
5. **Gmail search reuses the contact resolver.** It cannot answer knowledge questions and has different privacy/hydration needs.
6. **Global skills become tenant data.** Current ADR-003 rows are global. Consume Phase 21's tenant overlay/resolver; do not add `tenantId` ad hoc to one current global path.
7. **Candidate eval deadlock.** Every customizable template needs a runner/fixture that can actually reach its outcome before it is placed behind `GATED_SKILLS`-style activation.
8. **A pinned rerun replays a plan.** It must create a fresh request and cross current gates.
9. **UTC cron is mistaken for local recurrence.** Static cron does not resolve per-tenant DST or pause/revoke semantics.
10. **Cancel is assumed to stop in-progress work.** Convex cancellation cannot stop an action already running; recheck routine state before every terminal and make terminals idempotent.
11. **Reconnect silently resumes or catches up.** The existing system explicitly lacks a reconnect-resume sweep. Require explicit resume and skip missed occurrences.
12. **Telemetry leaks content.** Labels, excerpts, subjects, filenames and URLs belong only on the tenant content plane.
13. **Unbounded fan-out.** Every adapter needs result, page, byte/character and timeout bounds before `Promise.allSettled`.
14. **Phase 28 is assumed complete.** Landed-source detection is runtime/compile-time truth, not roadmap optimism.

## Validation Architecture

Validation should be layered so each security and honesty claim has a cheapest authoritative proof.

### Pure domain tests

In `packages/core`:

- planner-output clamping and rejection of unknown sources/URLs/tool fields;
- exact-ID and exact-hash dedupe without conflict loss;
- authority mapping, web-research downgrade, freshness bands and confidence caps;
- unknown/missing citation removal, excerpt substring verification and unsupported-claim counts;
- partial/unavailable source aggregation and “no results” only when every available source returned zero;
- customization-schema validation, deterministic body rendering, stale-base conflict and material-change classification;
- pinned-rerun identity/version behavior;
- if recurrence passes: Temporal daily/weekly/monthly next occurrence for fixed-offset, `America/New_York` and `Europe/Berlin` spring/fall transitions; missed-run skip; stable run key; overlap and retry classifiers.

Mutation-test at least the unknown-citation rejection, source-unavailable honesty, code-owned authority and material-change reapproval rules.

### Adapter and Convex tests

- Two-tenant tests for every source adapter, search result, candidate/pin and conditional routine table/index.
- Vault sealed-folder exclusion and hydration caps remain green.
- Drive shared-drive parameters, scope-before-refresh, query-language escaping, cap/truncation and no import/paid-path calls.
- Gmail metadata-first cap, selected-body-only hydration, truncation, reauth, zero mailbox writes and body absence from tool/audit planes.
- CRM/support source unavailable when not landed/connected and provider partial failures.
- `Promise.allSettled` test where one source throws and cited results from others survive.
- Citation post-validator tests with a synthesizer that invents IDs, quotes a non-substring and hides a conflict.
- Idempotent result persistence and exactly one refs-only search audit/telemetry outcome.
- Phase 21 integration: candidate-only write, immutable versions, tenant resolver isolation, eval-evidence exact-version pin, rollback exemption and tool registry byte/shape parity.
- Manual Run again produces a new request/correlation and never reuses an approved plan.

If recurrence passes, add fake-timer scheduler tests using `convex-test` scheduled-function support:

- atomic arm plus scheduler ID persistence;
- duplicate due callbacks create one run;
- two concurrent claims yield one owner;
- pause/cancel before fire; callback-after-pause no-ops;
- pause while action has started prevents later terminals/external scheduling;
- auth expiry -> `awaiting_reauth` + auto-pause + one notification;
- reconnect does not catch up; explicit resume computes the next future occurrence;
- missed and overlapping runs record closed skip reasons;
- bounded transient retry retains one run ID; permanent/budget/auth failures do not retry;
- cost reserve/settle is CAS-idempotent.

### Static structural scans

- Planner/synthesizer `generateObject` calls contain no `tools:` and no call to `buildCockpitTools`.
- Unified search tool returns no evidence text, synthesized prose, sender, subject, URL or filename.
- External source bodies/snippets never enter `agentSteps`, `audit`, `deadLetters` or telemetry.
- Search adapters contain only read HTTP methods/endpoints; import/send/mutation functions are unreachable.
- Workflow template/customization rows contain no tool grant field, executable field, secret or MCP/remote-server field.
- `SPECIALISTS`/tool grants are unchanged unless a separately reviewed code change explicitly adds a native read tool.
- No new raw Convex builders outside the allow-list and every public read/write uses tenant/owner wrappers.

### Outcome evals and adversarial fixtures

For each approved workflow template and the unified-search behavior, held-out fixtures should assert state:

- correct source-selection/readiness outcome;
- citation coverage and zero unknown citations;
- no unsupported confident claim;
- injected Gmail/Drive/CRM instruction is described/ignored and causes no tool/action/plan mutation;
- conflict is displayed rather than averaged away;
- unavailable connector is named before useful output;
- candidate version executed is the one recorded in eval evidence;
- no real send/import/provider write can occur in eval tenants and the run cost cap is hard.

### Authenticated browser gates

Run connected Playwright/UAT only after backend gates pass:

- one search with Vault + at least one connected external source, citation drill-in, freshness/authority labels and honest partial-source banner;
- no-result versus unavailable-source visual distinction;
- conflict and unsupported-claim presentation;
- customize approved pack -> candidate -> failing/passing eval state -> activate -> rollback;
- pin -> manual Run again -> fresh plan and readiness check;
- two identities prove result/candidate/pin isolation;
- navigation remains disabled until these pass.

If recurrence is enabled, live evidence must additionally include a real OAuth expiry/reauth path, pause/cancel race, provider-readiness failure, one DST-boundary simulation against the production schedule code and confirmation that an external write still waits at the per-run plan gate. Record measured times/run IDs, not prose-only “passed” claims.

### Phase acceptance evidence

The phase validation document should map KNOW-01/ROUT-01/ROUT-02 to automated commands, fixture IDs, browser evidence and manual-only rows. ROUT-02 passes without recurrence when the manual pin works and the recurrence decision/proof matrix explicitly records deferral. It must never be marked as recurring merely because a cron or schema row exists.

## Sources and Confidence

Primary local evidence:

- `CLAUDE.md` architecture, registry, audit and graphify rules.
- `29-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`.
- `vaultGround.ts`, `vaultDrive.ts`, `gmail.ts`, `research.ts`, `llm.ts`, `skills.ts`, `skill.ts`, `telemetry.ts`, `proactiveReview.ts`, `cockpit.ts`, `schema.ts`.
- ADR-003 (global product skill registry) and ADR-006 (Vault trusted-as-own boundary).
- `.planning/design/scheduled-send.md` (standing-instruction decision remains open).

External primary references:

- Anthropic knowledge-work plugins repository and Enterprise Search/Productivity patterns: `https://github.com/anthropics/knowledge-work-plugins`.
- Convex scheduled functions and cancellation semantics: `https://docs.convex.dev/scheduling/scheduled-functions`.
- Convex cron UTC/overlap semantics: `https://docs.convex.dev/scheduling/cron-jobs`.
- Convex scheduler API guarantees: `https://docs.convex.dev/api/interfaces/server.Scheduler`.

High-confidence negative findings are code-backed: current skills are global; current Gmail search is contact-specific; current proactive review is fixed UTC and OAuth-free; current reconnect path does not resume `awaiting_reauth`; and Node in this workspace exposes no global Temporal. Recurrence design remains medium-confidence until the Phase 21/28 dependencies exist and the Temporal/Convex/provider live gates run.

## RESEARCH COMPLETE
