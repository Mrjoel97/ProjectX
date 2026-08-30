---
phase: 29-unified-knowledge-and-routines
plan: 06
subsystem: knowledge-search
tags: [coordinator, fan-out, run-level-clamp, citations, redaction, tenant-isolation, mutation-testing]

# Dependency graph
requires:
  - phase: 29-01
    provides: "@pikar/core/knowledgeSearch — dedupeEvidence, clampEvidence(scope), aggregateCoverage, searchConfidence, redactedSearchEvent, unavailableRead, KNOWLEDGE_ADAPTERS/NOT_LANDED_SOURCES, and the knowledgeSearches content-plane table"
  - phase: 29-02
    provides: "knowledgeVaultDrive.searchVaultKnowledge / searchDriveKnowledge"
  - phase: 29-03
    provides: "knowledgeExternalSources.readInboxKnowledge / readCrmKnowledge, gmail.knowledgeQuery, hubspot.readHubSpotDataset"
  - phase: 29-04
    provides: "knowledgeLlm.planKnowledgeSearch / synthesizeKnowledge — toolless, gated, post-validated"
  - phase: 02-tenant-seam
    provides: "lib/functions.tenantAction / tenantQuery — the identity the coordinator's tenantId comes from"
  - phase: 03-guardrails
    provides: "guardrails.preCall / recordSpend, reached through the two model calls"
provides:
  - "packages/backend/convex/knowledgeSearch.ts — the tenant coordinator: authenticate, hash, plan, fan out, settle, dedupe, RUN-CLAMP, synthesize, validate, persist, measure"
  - "api.knowledgeSearch.search (tenantAction) + api.knowledgeSearch.listByThread (tenantQuery) — the surface plan 29-09's KnowledgeSearchPanel calls"
  - "KNOWLEDGE_ADAPTER_ACTIONS — the closed source -> action registry, cross-checked against @pikar/core's landedness registry in both directions"
  - "adapterOutcome — the one settlement of a Promise.allSettled result; a rejection is provider_error, never an empty read"
  - "the `knowledge.searched` audit event, registered in AUDIT_VIEWER_EVENTS with all 22 refs/counts keys"
  - "packages/backend/convex/knowledgeSearch.test.ts — 26 behavioural tests against the real adapters and the real handlers, all $0"
affects: [29-09 knowledge search panel, 29-13 phase close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The run-level clamp binds over the UNION and every per-source state is MINTED AFTER the cut, so no state can overstate what reached synthesis"
    - "The dedupe baseline (not the adapter's own count) decides `partial` — collapsing an exact duplicate is not a loss"
    - "A rejected Promise.allSettled arm is an unexpected BUG surfaced as provider_error and counted, never the normal failure path"
    - "A capability deliberately NOT built is enforced as an absence with a positive-control source scan, not asserted in a header comment"
    - "Never derive a type from `internal.*` inside a module that is itself in the api graph — it closes a cycle and collapses inference repo-wide"

key-files:
  created:
    - packages/backend/convex/knowledgeSearch.ts
    - packages/backend/convex/knowledgeSearch.test.ts
  modified:
    - packages/backend/convex/llmRedaction.test.ts
    - packages/backend/convex/knowledgeLlm.ts
    - packages/backend/convex/_generated/api.d.ts
    - packages/core/src/knowledgeSearch.ts
    - packages/contracts/src/auditProjection.ts
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "NO cockpit tool. The plan said 'if exposed'; it is not, and the tool-bearing loop cannot reach ANY knowledge module — strictly stronger than the counts-only contract the plan allowed for. A tool needs a cockpit-agent skill BODY change (CLAUDE.md §5), which is eval-gated work this plan could not certify with no live deployment and no budget."
  - "NO telemetry row. telemetry.writeTerminal is hard-bound to requestId: v.id('requests'); a search has no request row and minting one to satisfy a foreign key would be a fabricated delivery-plane row. The measurement rides the one audit event, and the binding is now pinned by a test."
  - "telemetry.ts and llm.ts are NAMED in the plan's files_modified and are DELIBERATELY UNCHANGED. Both decisions are enforced by tests in llmRedaction.test.ts rather than left as prose."
  - "Cost is carried on the log plane as REFS (planRunRef / synthRunRef, the guardrails.recordSpend correlation ids), not as a restated number this row did not compute."
  - "The synthesizer is NOT called when the clamped corpus is empty — nothing to cite means nothing a model could honestly write, and it costs nothing."
  - "The second clamp inside synthesizeKnowledge STAYS. It is an action-boundary trust check on an unbounded argument, it is idempotent, and removing it would open a hole the coordinator cannot close for other callers."
  - "packages/contracts/src/auditProjection.ts was edited (a required coupling of a new eventType) even though no wave-3 plan owns it; docs/playbooks/audit-dead-letter.md is bumped in the same commit per CLAUDE.md §9."

requirements-completed: [KNOW-01]

# Metrics
duration: ~110min
completed: 2026-08-28
---

# Phase 29 Plan 06: Cited Cross-Source Knowledge Search Summary

**One authenticated question fans out to only code-registered adapters, survives any single source failing, has its combined evidence deduped and clamped ONCE before a model is paid, and lands as one cited content-plane row beside one refs-only audit event — with an unreachable source and an empty one kept structurally distinct at every step.**

## What was built

### `packages/backend/convex/knowledgeSearch.ts` (new)

A thin adapter (CLAUDE.md §1). It owns no honesty rule of its own — `clampSearchPlan`,
`dedupeEvidence`, `clampEvidence`, `validateSynthesis`, `authorityFor`, `freshnessFor`,
`searchConfidence`, `aggregateCoverage` and `redactedSearchEvent` all live in `@pikar/core` and are
mutation-tested there. What it owns is the ORDER:

```
tenantAction (tenantId from the authenticated wrapper, never an argument)
  -> contentHash(question)                       the log plane's only view of the question
  -> internal.knowledgeLlm.planKnowledgeSearch   budget gate inside; its stop returns as DATA
  -> Promise.allSettled over KNOWLEDGE_ADAPTER_ACTIONS[source]
  -> adapterOutcome per entry                    a rejection becomes unavailable/provider_error
  -> dedupeEvidence                              exact duplicates collapse; conflicts are kept
  -> clampEvidence(corpus, "run")                THE RUN-LEVEL CLAMP, before anything is billed
  -> remintState per source                      every `returned` re-derived from what survived
  -> internal.knowledgeLlm.synthesizeKnowledge   skipped entirely when the corpus is empty
  -> aggregateCoverage + searchConfidence        code-owned, never model-supplied
  -> internal.knowledgeSearch.record             one bounded knowledgeSearches row
  -> internal.audit.log "knowledge.searched"     redactedSearchEvent + 8 run refs/counts
```

Public surface: `search` (`tenantAction`) and `listByThread` (`tenantQuery`, `by_thread` =
`[tenantId, threadId]`). That is what 29-09's `KnowledgeSearchPanel` will call.

### The debt wave 2 deferred to this plan, by name

- **The run-level clamp landed here.** The adapters clamp at `scope: "source"` because an adapter
  that cannot see the other four cannot spend a shared budget honestly. The coordinator is the
  first place the union exists, so `maxEvidenceTotal` and `totalEvidenceCharCap` bind here — before
  `synthesizeKnowledge` and therefore before anything is billed — and the per-source states are
  minted **after** the cut.
- **Both `ponytail:` comments naming 29-06 are gone**, from `@pikar/core/knowledgeSearch.ts`'s
  `EvidenceScope` docstring and from `knowledgeLlm.synthesizeKnowledge`. Both now record the landed
  shape, including why the second clamp stays.
- **`knowledgeLlm.ts`'s "⚠ FOR PLAN 29-06" note** on `vEvidence.authority` now records that the
  coordinator took the first option (carry each adapter's evidence through unmodified) and names
  the test that can falsify it.

### `remintState` — and why the baseline is the deduped corpus

A row absorbed as an **exact duplicate** is the same record read twice, not something a cap took
away, so collapsing it must not turn a complete read into a partial one. `remintState` therefore
compares the surviving count against the **deduped** corpus, not against the adapter's original
`returned`. Only a row lost to a run bound produces `partial/cap`, and `provider_error` still
outranks `cap` (the `settleRead` ordering).

### `adapterOutcome` — a rejection is a bug, and says so

Since the wave-2 blocker fix every adapter returns its governed `unavailable` state as **data**. So
`Promise.allSettled`'s rejected arm means something threw that was not supposed to. It becomes
`unavailable/provider_error` — a named gap carrying zero rows, because `unavailableRead` is the only
constructor of that arm and the arm has no `returned` field — and it is counted into
`adapterCrashCount` on the audit event so the bug is visible. One rejection never erases another
source's evidence.

### All-empty vs all-unavailable

`searchedGapCount` counts gaps among the sources a read was **actually attempted** against, read off
the **re-minted** states. Zero with sources present means "we looked and there is nothing"; three
means "we could not look, and here is why for each". The stored `sources` array carries every one of
the five knowledge sources exactly once, including the ones nobody planned (`unplanned`) and the one
with no landed adapter (`not_landed`) — a source missing from the row would be a silent gap.

## Verification — the exact commands I ran, and their real output

The plan's two verify commands are no-ops (`pnpm --filter … test -- <filters>` swallows the `--`;
`node scripts/check-playbooks.mjs` bare hangs on stdin and signals by printing). I used the
corrected forms.

```
cd packages/backend && pnpm vitest run knowledgeSearch knowledgeVaultDrive knowledgeExternalSources knowledgeLlm
  ✓ convex/knowledgeVaultDrive.test.ts       (47 tests)
  ✓ convex/knowledgeSearch.test.ts           (26 tests)
  ✓ convex/knowledgeLlm.test.ts              (48 tests)
  ✓ convex/knowledgeExternalSources.test.ts  (45 tests)
  Test Files  4 passed (4)      Tests  166 passed (166)

cd packages/backend && pnpm vitest run llmRedaction
  Tests  67 passed (67)        (63 before this plan, +4)

cd packages/backend && pnpm vitest run          # FULL suite
  Test Files  1 failed | 111 passed (112)
  Tests       1 failed | 3100 passed (3101)
  FAIL convex/env.test.ts > every consumed name is classified
    -> QUICKBOOKS_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI
  That is the KNOWN RED named in the brief (Phase 28's in-flight 28-06). NOT MINE, NOT TOUCHED.
  Baseline was 111 files / 3033 tests; this plan adds one file and 26 + 4 + 38 tests
  (26 coordinator, 4 redaction scans, and reportsGovernance/contracts counts unchanged).

cd packages/backend  && pnpm typecheck     -> clean (0 errors)
cd packages/core     && pnpm typecheck     -> clean;  pnpm vitest run -> 45 files / 1455 passed
cd packages/contracts&& pnpm typecheck     -> clean;  pnpm vitest run ->  6 files /   99 passed

echo '{}' | node scripts/check-playbooks.mjs check
  -> EMPTY STDOUT on the dirty tree, both times (before each commit). No "decision":"block".

npx biome check <my 6 touched .ts files>
  -> clean. llmRedaction.test.ts still reports its 5 PRE-EXISTING diagnostics; I confirmed by
     `git stash` that the identical 5 exist at HEAD, only their line numbers shift.
```

Baselines quoted in the brief: core 45/1437 -> **45/1455** (the +18 are 29-05's, committed before
me; core's own count was 1437 in the brief and 1455 at the HEAD I started from). contracts 6/99 —
unchanged. revenue untouched.

## Mutations applied, observed RED, reverted — 16

**Implementation (10, `knowledgeSearch.ts`):**

| # | Mutation | Test that went RED |
|---|---|---|
| 1 | `clampEvidence(corpus, "run")` -> `"source"` | both run-clamp tests (2 failed) |
| 2 | `remintState(...)` -> `state` (mint before the cut) | "the source cut at the UNION is PARTIAL/cap" |
| 3 | a rejected adapter -> `{available, returned: 0}` | "a REJECTED adapter promise is provider_error" |
| 4 | `if (evidence.length > 0)` -> `if (true)` | "NO MODEL IS PAID FOR AN ANSWER WITH NO EVIDENCE" |
| 5 | `question` added to the audit payload | the five-needle governance test |
| 6 | `planned.skipped` dropped from `states` | 4 tests (totality, needles, fallback, stored row) |
| 7 | `ctx.tenantId` -> a literal tenant | 7+ tests including two-tenant isolation |
| 8 | `searchedGapCount` from the PRE-clamp reads | "the source cut at the UNION is PARTIAL/cap" |
| 9 | declared `conflictEvidenceIds` dropped | "evidence that DISAGREES is carried into the row" |
| 10 | `"support-desk"` given an adapter | "a source is null here EXACTLY when @pikar/core says…" |

**Static scans (6, `llmRedaction.test.ts`):** `question` on the payload; a second `audit.log` site;
the `knowledge.searched` eventType anchor renamed (**the vacuous-scan control** — the positive
control fired, so the scan cannot pass by finding nothing); a `telemetry.` reference inside the
coordinator; `telemetry.writeTerminal`'s `requestId: v.id("requests")` loosened to `v.string()`;
`const _k = internal.knowledgeSearch;` added to `llm.ts`. All six RED, tree restored green after.

## Two real defects the tests caught (not synthetic mutations)

1. **`searchedGapCount` was computed from the PRE-clamp `reads`.** A source that answered fully at
   its own adapter and then lost rows to the run budget reported **zero gaps over a partial answer**
   — the exact before/after-the-clamp mistake `remintState` exists to prevent, committed one field
   over. Now derived from the re-minted states, restricted to the sources actually attempted.
2. **`type AdapterRef = typeof internal.knowledgeVaultDrive.searchVaultKnowledge` collapsed
   inference repo-wide.** `internal` is derived from `fullApi`, which now includes this module, so
   the reference closes a cycle: measured **0 `tsc` errors before, 379 after**, nearly all
   `implicitly has an 'any' type` in unrelated files. It is a hand-written `FunctionReference` now,
   which keeps the same compile-time contract over the four adapters' signatures.

A third, caught while writing the tests rather than by them: an early draft of the run-clamp test
used **eight** `SMOKE::` vault seeds. Eight 32-character Convex ids exceed
`SEARCH_CAPS.queryCharCap` (200), so `clampSearchPlan` refused the vault entirely and the test
silently measured a run in which the vault was never searched. Five is the ceiling; it is now
written into both the test and the playbook.

## Adversarial fixtures — all eight the task guidance asked for

| Fixture | How it is driven | Asserted outcome |
|---|---|---|
| mixed success | vault seeded + no `gmailTokens` | `vault available/1` **and** `inbox unavailable/not_connected` in one row; the claim survives |
| all-empty | Gmail lists nothing, Drive lists nothing | every searched source `available/0`, `searchedGapCount === 0`, confidence `unsupported`, synthesizer never called |
| all-unavailable | no token rows at all | every state `unavailable`, none carries `returned`, `searchedGapCount === 3` |
| partial | 5×1500-char vault docs + 8 Drive rows | vault stays `available/5`, drive `partial/cap/3` — minted after the union cut |
| reauth | a `gmailTokens` row without the Drive scope | `drive unavailable/reauth` beside `inbox available/1` |
| provider-error | Gmail list stubbed HTTP 500 | `inbox unavailable/provider_error`, and `"returned" in state === false` |
| injected instruction in evidence | a doc body and a mail body both carrying "IGNORE ALL PREVIOUS INSTRUCTIONS…" | it reaches the **synthesis prompt the handler actually built**, inside a nonce fence; it reaches neither the planner prompt nor any audit payload |
| two-tenant isolation | B asks the same question naming A's document id | `evidenceCount === 0` for B, A's text absent from B's whole result, and `listByThread` returns a different row per tenant |

Plus an **unauthenticated** case (`rejects.toThrow(/UNAUTHENTICATED/)`) and a **governed stop**
(kill switch -> `{ok: false, reason: "kill_switch"}` and **zero** `knowledgeSearches` rows).

The tests run against the **real** adapters and the **real** planner/synthesizer handlers — only
`generateObject` is intercepted, so the registry load, `guardrails.preCall`, `scanText`, the prompt
assembly, `priceUsage` and the spend ledger all execute. The five needles and the fence assertions
read what the **handler produced**, never a value the test computed (trap 1).

## Deviations from the plan text

1. **`llm.ts`: named in `files_modified`, deliberately UNCHANGED.** No cockpit tool was added. The
   plan itself said "*if* exposed as a cockpit read tool"; the user surface is 29-09's
   `KnowledgeSearchPanel`. A tool would need a grant in the tool-bearing loop **and** a
   `cockpit-agent` skill-BODY edit to make the model aware of it (CLAUDE.md §5 — prompts are
   registry rows), which is eval-gated work with no live deployment and no budget. Not exposing it
   is strictly stronger than the plan's counts-only contract: the loop receives nothing at all. The
   absence is enforced by a positive-controlled scan over `llm.ts`, not by a comment.
2. **`telemetry.ts`: named in `files_modified`, deliberately UNCHANGED.** `writeTerminal` is
   hard-bound to `requestId: v.id("requests")`. A search has no `requests` row; the measurement
   rides the audit event. The binding is now pinned by a test, so a future widening is a deliberate
   act.
3. **`audit.ts`: named in `files_modified`, UNCHANGED — nothing needed changing.** `internal.audit.log`
   already takes `eventType: v.string()` and `payload: v.any()` (ponytail rung 2). What the new
   event *did* need was registration in `AUDIT_VIEWER_EVENTS`, which lives in
   `packages/contracts/src/auditProjection.ts`.
4. **Two files edited that no wave-3 plan owns**, both required couplings:
   `packages/contracts/src/auditProjection.ts` (`knowledge.searched` + all 22 keys — without it
   `reportsGovernance.test.ts` fails and the audit viewer drops the event), and
   `docs/playbooks/audit-dead-letter.md` (CLAUDE.md §9, same commit, `Last verified` bumped).
5. **`packages/core/src/knowledgeSearch.ts` and `packages/backend/convex/knowledgeLlm.ts` edited**
   (comments only) to remove the two `ponytail:` deferrals that named this plan. Assigned to me
   explicitly by the orchestrator addendum.
6. **`packages/backend/convex/_generated/api.d.ts` hand-edited** (two lines) to register the new
   module. `pnpm codegen` refuses without `CONVEX_DEPLOYMENT`; this is the same hand edit 29-02,
   29-03 and 29-04 each made.

## Things I could not complete, and limits stated rather than hidden

1. **`dedupeEvidence`'s same-ref-different-text CONFLICT arm has no behavioural test, because no
   landed adapter can produce it.** It needs one `(source, sourceRef)` read twice in a single run;
   `vault.ownedDocsMeta` returns each document once, and Drive file ids, Gmail message ids and
   HubSpot deal ids are unique within a page. The coordinator does carry `conflicting` rows into the
   corpus, but a mutation of that line would stay green and I am not claiming otherwise. **The
   conflict a user actually sees is the one the synthesizer DECLARES** through `conflictEvidenceIds`,
   which `validateSynthesis` re-checks — and that path is tested in both directions (a declared
   conflict lands on the stored row; a declared conflict citing an unminted id is stripped and
   counted as an invented citation). Recorded in the playbook as limit 1.
2. **`SEARCH_CAPS.maxEvidenceTotal` (24 rows) is unreachable in an offline test.** Max offline
   evidence is 5 (vault, query-cap-bound) + 5 (`gmail.KNOWLEDGE_BODY_CAP`) + 8 (Drive) = 18. The
   run-clamp tests therefore bind on `totalEvidenceCharCap`, which IS reachable; the row cap's own
   enforcement is mutation-tested inside `@pikar/core`. Recorded as limit 2.
3. **`adapterOutcome`'s REJECTED branch has no reachable driver** — all four adapters catch. It is
   exercised directly. What binds the function to the handler is its FULFILLED branch, which every
   behavioural test in this feature runs through. Stated in the code, the playbook and here.
4. **No live verification.** Nothing in this plan ran against a deployment, a real Gmail/Drive/
   HubSpot account or a real model. Every test is `$0` and offline. Live proof belongs to 29-09's
   Playwright spec.
5. **Claim-level authority/freshness rollups are not stored as columns.** `knowledgeSearches.claims`
   carries per-evidence `authority` and `freshness` (the schema 29-01 froze), so the claim rollup is
   derivable with `weakestAuthority` / `oldestFreshness`. I did not widen the schema for it —
   `schema.ts` is `_unassigned` and the derivation is exact.

## Changes another plan owns that I left undone

- **None blocking.** I touched no file listed under 29-05's ownership.
- **`docs/playbooks/production-beta.md` still owes a bump for Phase 28's `lib/env.ts` change** —
  flagged in the brief as not mine; still open.
- **`convex/env.test.ts` is red on `QUICKBOOKS_*`** — Phase 28's in-flight 28-06. Not touched
  (`git log` confirms I did not cause it).
- **`docs/playbooks/knowledge-search-routines.md` carried an uncommitted "Plan 29-05, Task 1"
  section** left in the shared worktree by the 29-05 lane, which has since closed (`9ee6152`) without
  committing it. Git stages per file, so it rode along in my commit `dd19874`, **unaltered**, and the
  commit message says so. Nothing else of theirs was staged.

## Commits

| Commit | What |
|---|---|
| `d1f95b3` | `test(29-06)`: the coordinator's honesty contract, before the coordinator exists (RED) |
| `367be90` | `feat(29-06)`: one question, a bounded native fan-out, one cited answer |
| `dd19874` | `test(29-06)`: the two planes, enforced by scan rather than by comment |

`git diff --stat HEAD -- "*.ts"` was empty after each — no partial `git add` shipped a HEAD that
does not compile.

## Self-Check: PASSED

All named files exist on disk; all three commit hashes resolve; the new module is registered in
`_generated/api.d.ts`, the new event in `AUDIT_VIEWER_EVENTS`, and both playbooks carry a 29-06
`Last verified` entry. Verified 2026-08-28.
