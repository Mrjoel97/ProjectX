---
phase: 27-curated-knowledge-work-pack-pilot
plan: 07
status: complete
completed: 2026-08-23
requirements: [PACK-02, PACK-03, PACK-04]
files_modified:
  - packages/backend/convex/workflowPackBinding.ts        # NEW
  - packages/backend/convex/workflowPackBinding.test.ts   # NEW
  - packages/backend/convex/workflowPackOutcomes.ts       # NEW
  - packages/backend/convex/workflowPackOutcomes.test.ts  # NEW
  - packages/backend/convex/cockpit.ts
  - packages/backend/convex/schema.ts                     # DEVIATION (one index)
  - packages/backend/convex/onboarding.ts                 # DEVIATION (one export)
  - docs/playbooks/cockpit.md
  - docs/playbooks/workflow-packs.md
  - docs/playbooks/onboarding.md                          # DEVIATION (follows the export)
---

# 27-07 — Bind the packs onto the real agent seam, and measure real runs

**The six packs are now executable and still dark.** Nothing is deployed, no pack row exists in any
deployment, and `27-08` publishes the candidates. What landed is the one executable native path:
selected pack → governed loop under a code-owned tool allow-list → governed output → measured
outcome, traced in Foglamp.

`llm.ts` is **byte-unchanged**, as the plan's scope correction asked.

## What was built

**`convex/workflowPackBinding.ts`** (`"use node"`) — the binding, not a runtime. It resolves a
closed pack id to `{ skillName, toolNames, prompt, planId }` and calls the EXISTING
`runSpecialistTurn`. Around that: the `guardrails.preCall` gate, a code-owned source preflight, the
`traced()` wrapper, the event terminals and the derived outcome. `runWorkflowPack` is the production
`internalAction`; `__runWorkflowPackWithScript` is its offline twin (the `dispatch.ts` precedent) and
swaps ONLY the model, so the suite drives the real path rather than a copy of it.

**`convex/cockpit.startWorkflowPack`** — `sendCockpitMessage`'s shape with one substitution. Same
thread, same single `plans` row, same `thinking` trace floor, same safe error reply, same `finally`.
`ensureThreadAndPlan` is extracted verbatim and shared by both so they reach the same row.

**`convex/workflowPackOutcomes.forTenant`** — a bounded tenant-derived report applying 27-03's eight
pure metrics, joined to `spendEvents` for cost and `agentSteps` for latency.

## Decisions worth carrying

**`runId` IS the correlation id.** It is passed as the loop's `turnId`, so `spendEvents` and
`agentSteps` both carry it and the projection JOINS instead of re-emitting. The pack plane still has
no cost and no latency field. **One caveat is in the code:** `runAgentLoop` charges under
`agentloop:<runId>:a<attempt>` (plus a `:search` sibling), NOT the bare id — `ledgerCorrelationIds`
rebuilds those four, and the journey test asserts the projection's total EQUALS the ledger's own rows
so a format change in `llm.ts` reddens rather than silently reporting no cost.

**Preflight probes only the connection-gated planes** (inbox, drive, calendar, finance-inputs).
`vault` and `web` need no grant, and an empty vault is a result the tool itself reports and the body
already has to state honestly — a second "is it empty" probe would duplicate that on every run. What
preflight is FOR is the gap a tool cannot report gracefully: a mailbox that was never connected,
which otherwise surfaces mid-run as a tool error after the money is spent.

**Plan decisions are attributed to the run that STAGED the plan, never to the thread.** A pack run
and an Executive Agent turn share the thread's single `plans` row. `cockpit.ts` emits
`plan_approved` / `plan_rejected` / `plan_edited` only when a `plan_proposed` pack event exists for
that row, and `plan_proposed` only while a pack run is still in flight. So an analysis-only pack can
never be credited with a later email approval on the same thread. The approve emission sits AFTER
the CAS flip and after every governed stop above it — emitting at the top of `executePlan` would
count `gmail_not_connected`, `no_postal_address` and `all_recipients_suppressed` as approvals.

**`useful` is the narrowest outcome arm**, because it is what `timeToFirstUsefulOutcome` — the
pilot's headline measure — counts. Finished, non-empty, not truncated, no `declareUnsupported`, and
every reachable plane answered. Everything short of that is `partial`, which is honest and not a
failure; most pilot runs are partial by construction.

**An unknown pack id records NOTHING.** `workflowPackEvents.packId` is a closed union, so a refusal
has no pack to be filed under. The test asserts the plane stays empty, not that an "unknown" row
appears.

## How the tool grant is proven — and why the first version of that test was a lie

The central assertion is behavioural. A scripted model asks for all 19 tools (every tool some pack
holds, plus every tool no pack may hold), and the `agentSteps` rows say which the loop actually
found: `ai@7` rejects a call to a name that is not a key of the record BEFORE `execute`, so
`onToolExecutionStart` never fires for an absent tool. The observed set is compared, both directions,
with `toolsForWorkflowPack`.

Two things had to be fixed before that test meant anything, and both are the failure mode this phase
keeps re-teaching:

1. **The first version read `NoSuchToolError`'s "Available tools:" message.** `ai@7` does not throw
   it out of the loop — it turns the call into a `tool-error` part and carries on. The probe
   "passed" by never failing.
2. **The probe was one 19-call script, and `stopWhen: stepCountIs(8)` truncated it after the
   seventh.** Every tool past it read as ABSENT — a green "exactly its grant" over a run that
   stopped a third of the way through. It is now chunked at six calls sharing one `turnId`.

The same script runs first through the EXECUTIVE record (`__runCockpitAgentWithScript`, no
allow-list) as a **control**: it proves every probe input is valid and every forbidden tool DOES
execute when present, so its absence in a pack run is absence from the record rather than a rejected
argument. Without that control every negative was unfalsifiable.

## Two of my own tests were vacuous and were fixed

Caught by mutation testing, not by reading:

- **"another tenant's ledger row on the same correlation id is not counted"** seeded the BARE run id,
  which the join never looks up — it passed against an implementation with no tenant check at all.
  Now seeds `agentloop:<runId>:a0`. Dropping the tenant filter turns it RED.
- **"an executive plan on the same thread is credited to nobody"** never reached the CAS flip: no
  `gmailTokens`, no postal address, so `executePlan` refused and nothing was emitted whatever the
  attribution rule was. It now seeds both, asserts `approved.ok === true`, and additionally asserts
  no `plan_proposed` row (which `planDecisions` does not count).

**Mutations observed RED and restored:** delete `guardrails.preCall`; drop the `tenantId` filter in
`costForRun`; attribute `staged` on the newest event instead of `plan_proposed`; drop the terminal
check from `live`. Plus the two truncation/`NoSuchToolError` findings above, which were observed as
real failures rather than injected.

## Deviations from the plan

1. **`schema.ts` — one new index, `workflowPackEvents.by_tenant_plan`.** The plan-decision terminals
   must answer "was THIS plan row staged by a pack?" on every ordinary email approve too, so the
   alternative is a 500-row scan on a hot mutation path for tenants that never ran a pack. An index
   is not a write path and Convex backfills it (the reasoning `telemetry.by_tenant` already records).
   `audit_immutable` is untouched — `tenantDelete`/`tenantExport` walk the bare `by_tenant`, which
   still does not exist.
2. **`onboarding.ts` — one new export, `onboardingCompletedAt`** (plus its playbook). It returns the
   OLDEST committed profile doc, deliberately not `currentProfileDoc`'s newest: onboarding completes
   once while `/dashboard/profile` edits the same concept forever, so the newest would move the
   origin forward with every edit and report real earlier outcomes as `useful_precedes_onboarding`.
3. **`skillVersions` was threaded onto the binding** even though this plan does not use it. 27-08's
   eval runner MUST pin the exact candidate or a run certifies the ACTIVE body while the evidence row
   names the candidate — the recorded skill-version-collision defect. Two lines, `internalAction`
   only, so no model can supply it.
4. **`llm.ts` was NOT modified** (the plan allowed it "in case"). Artifacts are observed through
   `internal.vaultSources.latestCreated` instead of by editing `createDocument`.

## Known gaps — stated, not papered over

- **`citationCoverage` / `unsupportedClaimRate` report `not_applicable: no_data`.** Nothing writes
  `claimCount` / `citedClaimCount` / `unsupportedClaimCount`. Scoring a body's claims is grading, and
  the only plane that grades a pack body is 27-08's eval runner; they light up unchanged once it
  records the counts. Inventing a 100% citation rate from zero claims is exactly what 27-03's
  `not_applicable` arm exists to prevent.
- **`recommendation_shown` has no caller.** The binding emits `recommendation_accepted` when a run
  carries a `recommendationId`; the impression belongs to the surface that renders the card (27-09).
  Emitting both here would make `recommendationAcceptance` a constant 100%.
- **`artifact_created` is proven offline only in the NEGATIVE direction.** The id diff is unit-tested
  both ways and the run-level test proves a pre-existing document is not re-counted. The positive
  direction needs a real `createDocument`, which calls a model — so it belongs to 27-08's live eval
  and 27-09's browser evidence. **Do not read the green suite as covering it.**
- **`capability_missing` is ONE row per run that hit a tenant-specific gap**, not one per missing
  source. A matrix-missing source is announced up front and carried by the body — the honest-partial
  contract working, not an incident — and the table has no field to say WHICH source (CLAUDE.md §4),
  so a row per source would be an uncountable pile. The detail is the two counts on
  `preflight_completed`.
- **`PACK_DERIVED_METRIC_SOURCES.latency.index` names `by_correlation` on `agentSteps`, which does
  not exist.** That table's join is `by_turn`, which is what the projection uses. The constant is
  documentation read by nobody at runtime; left as-is rather than editing 27-03's module.

## Evidence

- `cd packages/backend && npx vitest run convex/workflowPackBinding.test.ts` — **31 passed**
- `cd packages/backend && npx vitest run convex/workflowPackOutcomes.test.ts` — **9 passed**
- 11 touched-module suites (binding, outcomes, eventLog, dispatchGuard, cockpit, cockpitTools,
  onboarding, plans, auditImmutability, isolation, importGuard) — **500 passed**
- `packages/core` — **43 files / 1174 passed**
- FULL backend suite — **99 files / 2446 passed** (two consecutive clean runs)
- Typechecks clean: backend, core, contracts
- `npx biome ci` clean over the eight touched files
- Playbooks updated and re-dated in this commit: `workflow-packs.md`, `cockpit.md`, `onboarding.md`

### One intermittent failure, characterised rather than shrugged off

Two earlier full-suite runs each hit ONE failure — `media.test.ts > "a transcript with no usable
words never buys a sandbox"`, whose `fetch` spy saw 1 call instead of 0. It is a **load-dependent
flake, not a break**, and it is in a file this plan does not touch:

- `media.test.ts` alone: 227 passed.
- `media.test.ts` + both new files: 267 passed.
- Full suite excluding `workflowPackBinding.test.ts`: 98 files / 2415 passed.
- Full suite WITH everything, instrumented to print the leaked fetch URL: **it did not reproduce**,
  twice, 2446 passed each time.

So the new binding suite (29 scripted agent-loop runs, ~19s) shifts the parallel schedule enough to
have surfaced it twice, but the leaked call was never captured and the assertion is not deterministic
either way. `vitest.config.mts` already documents this suite's load-dependent flake class and raised
`testTimeout` for the same reason. **NOT foglamp** — ruled out at the source: `Transport` arms its
flush timer only `if (config.enabled && !config.serverless)`, and `FOGLAMP_API_KEY` is unset here, so
no background fetch exists to leak. Left open and named; if it recurs, instrument `media.test.ts`'s
`fetchMock` to print the URL and run the full suite until it fires.

## Next

**27-08** publishes the six candidates with verified provenance and records exact-version eval
evidence on DEV. It is the first plan in this phase that costs money, and it is the plane that will
start writing the claim counts these measures are waiting for.
