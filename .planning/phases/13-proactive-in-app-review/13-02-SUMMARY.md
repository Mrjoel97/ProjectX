---
phase: 13-proactive-in-app-review
plan: 02
subsystem: backend
tags: [convex, cron, scheduler, notifications, evaluations, multi-tenant, bevl-03]

# Dependency graph
requires:
  - phase: 13-proactive-in-app-review
    plan: 01
    provides: "`evaluations.delta` + `runEvaluation({ withDelta: true })`, the cross-tenant `vaultDocuments.by_kind` index, and the three `@pikar/core` review constants"
  - phase: 12-business-evaluation-engine
    provides: "`runEvaluation` (the engine), `lastForThread` (carry-forward read), the append-only `evaluations` table, the refs-only `evaluation.ran` audit"
  - phase: 07-resilience-ops
    provides: "the `notifications` table + the closed `NOTIFICATION_KINDS` array whose membership gates `notifyExternal.dispatch`"
provides:
  - "`internal.proactiveReview.runWeekly` — enumerate onboarded tenants over `by_kind`, dedupe, fan out one review each via `scheduler.runAfter(0, …)`"
  - "`internal.proactiveReview.reviewOne` — the engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, notify-on-change, failure surfaced in-app"
  - "`internal.proactiveReview.insertReviewNotification` — a DIRECT `notifications` insert, structurally unable to reach a Gmail token"
  - "`crons.weekly(\"proactive-review\", monday 06:00 UTC)` — the BEVL-03 spine"
  - "A CLOSED repeat-run provenance gap in `evaluations.ts`: a re-run over unchanged documents now re-cites the same fields instead of collapsing `findingCount` toward zero"
  - "`proactiveReview.test.ts` — five behaviour cases + the SC#2 no-mailbox-token and SC#3 tenant-scoping static guards"
affects: [13-03 review card, 13-04, business-evaluation, audit-dead-letter, proactive-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cron → internalMutation enumerator → `scheduler.runAfter(0, …)` per tenant: a mutation cannot call an action inline, and the scheduler is also what isolates one tenant's failure from every other tenant's"
    - "Direct `ctx.db.insert(\"notifications\", …)` as an ENUMERATED bypass of `notifications.notify` (second user after `gmailAuth.flagExpiringTokens`) — a notification about a channel must not depend on that channel"
    - "Two independent barriers for one security property: the module never calls the choke point AND the kind is absent from the closed registry the choke point checks first"
    - "Value-vs-citation separation in a re-derivable provenance map: first-write-wins on the VALUE, re-record on every restatement for the CITATION"
    - "Comment-stripped static source guards — the module can document the API it must never call without tripping its own scanner"

key-files:
  created:
    - packages/backend/convex/proactiveReview.ts
    - packages/backend/convex/proactiveReview.test.ts
  modified:
    - packages/backend/convex/crons.ts
    - packages/backend/convex/evaluations.ts
    - docs/playbooks/business-evaluation.md
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "PINNED THREAD + CLOSE THE PROVENANCE GAP (option b), not a fresh weekly thread id (option a). The pinned `REVIEW_THREAD_ID` is load-bearing in two directions: `lastForThread` is indexed on `(tenantId, threadId)`, so a date-derived id would reset the Scorecard every week and re-ask figures the user already answered (it breaks Phase-12's LOCKED store half), and 13-03 renders 'the' review thread as a single stable surface. So the engine was fixed instead: `fillVault` now records a CITATION whenever a grounded document restates a field, even when the slot is already filled by carry-forward."
  - "Value and citation are SEPARATE rules inside `fillVault`. The VALUE stays first-write-wins (carried / user-provided / earlier doc beats a later doc — the anti-re-ask contract is untouched); the CITATION is re-recorded on every restatement, with `provenance.has(path)` keeping a pre-seeded `user-provided` cite from being downgraded to a vault cite. The two `already set → skip` short-circuits above it (the `currentOffers.length === 0` pre-check and the `FINANCIAL_PATTERNS` `continue`) were removed for the same reason — each one skipped the citation, not just the write."
  - "No new audit eventType. `evaluation.ran` already records the run; a `review.delivered` row would duplicate it and add a second §4 surface for nothing. Asserted: the audit rows for a reviewed tenant are exactly `[\"evaluation.ran\"]`."
  - "`runWeekly` enumerates over `vaultDocuments.by_kind` — onboarded ⇒ reviewed. A `business_profile` doc is exactly what onboarding commits, so its existence IS the predicate; a `.collect()` over `by_tenant` would read every document's `text` blob and this table holds book-sized uploads."
  - "The static guards live in the SAME file as the behaviour tests and scan a COMMENT-STRIPPED copy of the source. The module deliberately documents `notifications.notify` as the thing it must never call; a guard a comment can trip is a guard that teaches people to delete comments."
  - "Test-file DB reads use `.filter()` rather than `.withIndex()`: convex-test's `t.run` hands back a GENERIC data model, so `.withIndex` does not typecheck there (the pre-existing class of 52 backend test-file typecheck errors). Production scoping is asserted on the module SOURCE by the SC#3 guard instead — which is the stronger assertion anyway."

patterns-established:
  - "Enumerated-exception lists over ad-hoc bypasses: the direct-insert notification path is now documented in `audit-dead-letter.md` as a closed two-member list, with the structural reason both members share"
  - "A repeat-run regression test as the guard for a derived-state collapse: `notifies only on change` asserts run 2 has the SAME finding count as run 1 and an empty delta, so the provenance gap cannot silently reopen"

requirements-completed: [BEVL-03]

# Metrics
duration: ~40min
completed: 2026-07-25
---

# Phase 13 Plan 02: The Weekly Proactive Review Cron Summary

**A Monday-06:00-UTC Convex cron enumerates onboarded tenants over the cross-tenant `by_kind` index, fans out one isolated review per tenant, runs the Phase-12 engine on that tenant's STABLE review thread with a delta, and writes an in-app notification only when something actually changed — through a direct `notifications` insert that cannot reach a Gmail token, plus the engine fix that makes a repeat run on a pinned thread honest.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-25T17:08Z
- **Completed:** 2026-07-25T17:48Z
- **Tasks:** 3/3
- **Files modified:** 6 (2 created) + regenerated `graphify-out/`

## Accomplishments

- **BEVL-03's spine is live and cannot break on the Google 7-day testing token.** `crons.weekly("proactive-review", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 })` → `runWeekly` → one `reviewOne` per onboarded tenant → an `evaluations` card on `REVIEW_THREAD_ID` + a conditional `weekly_review` notification. `grep -n "notify\|gmail" proactiveReview.ts` returns comments only.
- **The wave-1 carry-forward concern is RESOLVED, not worked around.** The plan's literal instruction (pin `REVIEW_THREAD_ID`) was kept because it is correct; the defect it exposed was fixed at its root in the engine. See Decisions and Deviations.
- **The notify-on-change contract is proven honest, not merely quiet.** `notifies only on change` asserts two evaluation rows after two identical weeks but exactly ONE notification — AND that run 2 carries the same verdict, the same finding count, and `{ newFindings: 0, gapsClosed: [], gapsOpened: [] }`. That test was CONFIRMED red before the engine fix (a second notification fired off a false "gaps closed").
- **Two independent SC#2 barriers, both asserted.** The module imports no mailbox module and never names `notifications.notify`; and `NOTIFICATION_KINDS` still contains neither review kind, so `notifyExternal.dispatch` would return at `if (!KINDS.has(kind)) return;` before `freshAccessToken` even if the path changed. The guard also asserts the POSITIVE half (`ctx.db.insert("notifications"` is present), so a module that stopped notifying could not pass by doing nothing.
- **SC#3 is enforced on source, because it cannot be enforced by the wrappers.** A cron has no `ctx.auth`, so `tenantQuery`/`tenantMutation` are structurally uncallable. The guard walks every `ctx.db.query(...)` in the module, requires a `withIndex` whose first `q.eq` is `"tenantId"`, allows exactly ONE `by_kind` exception (pinned by count so a second unscoped scan cannot be added silently), and requires a `tenantId` in every insert's object literal.
- **Zero new typecheck errors and zero network in tests.** Backend `tsc --noEmit` is unchanged at the pre-existing 52 test-file errors; `rag.search` throws on the unset `OPENAI_API_KEY` and the engine fails open, while the tenant's own profile doc still reaches the corpus through `internal.vault.profileSeedDocs` (a plain DB read).

## Task Commits

1. **Task 1: `proactiveReview.ts` + the weekly cron registration** (TDD) — `13b5d73` (test, RED: 8/8 failed) → `0cb48f6` (feat, GREEN: 5/5 behaviour, includes the Rule-1 engine fix)
2. **Task 2: SC#2 / SC#3 static guards** — `f248c9c` (test, 8/8)
3. **Task 3: Playbooks, graph refresh, wave gate** — `481660c` (docs)

## Files Created/Modified

- `packages/backend/convex/proactiveReview.ts` **(new, 127 lines)** — `runWeekly` (`by_kind` enumerate + dedupe + `runAfter(0, …)` fan-out), `reviewOne` (`lastForThread` → `runEvaluation({ withDelta: true })` on `REVIEW_THREAD_ID` → conditional notify; `catch` → `weekly_review_failed`), `insertReviewNotification` (direct `notifications` insert with a static `@pikar/core` label).
- `packages/backend/convex/proactiveReview.test.ts` **(new, 280 lines)** — 5 behaviour + 3 guard tests.
- `packages/backend/convex/crons.ts` — the third registration; `crons.weekly` deliberately over `crons.cron`, lowercase `"monday"`.
- `packages/backend/convex/evaluations.ts` — the Rule-1 provenance fix in `fillVault` plus removal of the two short-circuits above it.
- `docs/playbooks/business-evaluation.md` — new **Proactive weekly review (BEVL-03, 13-02)** section (flow diagram, 8 invariants, safe-change rules, the LOCKED manual verification procedure), the value-vs-citation rule folded into the Data-flow "Fill" step, three new Key-files entries; `Last verified` bumped to 2026-07-25 (4) recording the provenance gap as CLOSED.
- `docs/playbooks/audit-dead-letter.md` — new **Cron jobs** section (a three-row table plus the `crons.weekly`-over-`crons.cron` override and the lowercase-`dayOfWeek` trap), and a Notification-matrix bullet turning the direct-insert bypass into an enumerated two-member exception list; `Last verified` bumped.

## Decisions Made

See `key-decisions` in frontmatter. The load-bearing one, spelled out because the orchestrator asked for it explicitly:

**The pinned-thread / provenance decision → option (b): keep ONE stable `REVIEW_THREAD_ID` per tenant and close the provenance gap in the engine.**

Option (a) — a date-derived thread id per week — was rejected on two independent grounds found by reading the engine:
1. `lastForThread` is indexed on `(tenantId, threadId)`. A weekly id means every run reads `null`, so the carried Scorecard and `userProvided[]` reset every week and the review re-asks figures the user already answered. That is a direct violation of Phase-12's LOCKED store half — a worse bug than the one it dodges. It also makes `delta` permanently `undefined` (the delta requires a `last`), which deletes the very feature 13-01 built.
2. 13-03 renders "the" review thread. A rotating id means the card query has no stable target and week-over-week history fragments across N threads.

The root cause is small and local: `provenance` is rebuilt from the grounded corpus on every run and is never persisted, but `fillVault` returned EARLY when the slot was already filled by carry-forward — skipping the citation, not just the write. So run 2 over the same documents cited nothing, `findings` collapsed, the engine suppressed gaps (SC #1), and the delta reported a false `gapsClosed`. Splitting the value rule from the citation rule is a ~6-line change that makes a pinned thread honest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Repeat runs on a pinned thread collapsed `findingCount` and produced a false "gaps closed"**

- **Found during:** Task 1 (the `notifies only on change` test — the last behaviour test to go green)
- **Issue:** The Phase-12 deferred item, hit exactly as wave 1 predicted. In `runEvaluation`, `provenance` is seeded only from `userProvided[]` and otherwise rebuilt from the grounded corpus. `fillVault` bailed at `if (value == null || value === "" || !isUnset) return;` — so any field already carried forward got no citation on run 2 — and two callers above it short-circuited even earlier (`if (p.offering && scorecard.identity.currentOffers.length === 0)` and the `FINANCIAL_PATTERNS` `if (getPath(scorecard, field) != null) continue;`). Measured in-test: run 2's notification fired because `newFindings`/`gapsClosed` were non-empty over an unchanged vault.
- **Fix:** In `fillVault`, set the VALUE only when unset (unchanged semantics) but record the CITATION whenever a document restates the field, guarded by `if (!provenance.has(path))` so a pre-seeded `user-provided` cite is never downgraded to a vault cite. The two upstream short-circuits were deleted — `fillVault` now owns both rules, so no caller can skip a citation by pre-checking.
- **Files modified:** `packages/backend/convex/evaluations.ts`
- **Verification:** `proactiveReview.test.ts` 8/8 (the failing assertion was `expected [ 'weekly_review', 'weekly_review' ] to deeply equal [ 'weekly_review' ]` before the fix); `evaluations.test.ts` still 11/11 including all four delta tests and the anti-re-ask test that asserts a carried CAC is still cited `user-provided`.
- **Committed in:** `0cb48f6` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] The plan's drain idiom never started the fan-out**

- **Found during:** Task 1
- **Issue:** `finishInProgressScheduledFunctions()` (the `cockpit.test.ts:331` idiom the plan cites) only awaits jobs that have already STARTED. A `runAfter(0, …)` posted from a mutation is still `pending` when `t.mutation` resolves, so the drain returned immediately and every behaviour test saw zero evaluation rows. The documented alternative, `finishAllScheduledFunctions(vi.runAllTimers)`, deadlocks here — the review's module graph loads through dynamic imports that fake timers never let settle (`did not complete after 10000 timer pumps`).
- **Fix:** One real-timer macrotask tick between the mutation and the drain: `await new Promise((resolve) => setTimeout(resolve, 0));`. Documented on the helper so the next author does not re-derive it.
- **Files modified:** `packages/backend/convex/proactiveReview.test.ts`
- **Committed in:** `0cb48f6`

**3. [Rule 3 - Blocking] Two test-harness details the plan's interfaces block had wrong**

- **Found during:** Task 1
- **Issue:** (a) the `audit` table has no `by_tenant` index (it is `by_tenant_ts`), and (b) convex-test's `t.run` exposes a GENERIC data model, so `.withIndex(...)` on ANY table does not typecheck inside it — the plan's test spec implied indexed reads there.
- **Fix:** All three test helpers read with `.filter()` (the `evaluations.test.ts` precedent). Net effect on `tsc --noEmit`: **zero new errors** (verified by an A/B diff of the full error list — 52 pre-existing test-file errors before and after).
- **Files modified:** `packages/backend/convex/proactiveReview.test.ts`
- **Committed in:** `0cb48f6`

**4. [Rule 1 - Bug] The SC#2 guard tripped on the module's own explanatory comment**

- **Found during:** Task 2
- **Issue:** `expect(src).not.toMatch(/notifications\.notify/)` failed because `insertReviewNotification`'s doc comment names the choke point it must never call — a guard that punishes documentation.
- **Fix:** Every scan now runs against a comment-stripped copy (`code`), with an added `code.length > 500` sanity assertion so the strip cannot silently empty the input. `src.length` still guards against a rename.
- **Files modified:** `packages/backend/convex/proactiveReview.test.ts`
- **Committed in:** `f248c9c`

### Out of scope, deliberately not done

- The 52 pre-existing backend test-file typecheck errors (`import.meta.glob` on `ImportMeta`, `withIndex` inside `t.run`, `possibly undefined`) — pre-existing, unrelated to this plan, already tracked in the Phase-12 `deferred-items.md`. This plan added none.
- The pre-existing `audit.test.ts > audit.log inserts exactly one row that round-trips` failure (auditCounts component not registered) — untouched, still the sole red.
- `biome check --write` on the four touched backend files also reformatted a handful of pre-existing long lines in `crons.ts` and `evaluations.ts`. Formatting only, no semantic change; noted so the diff is not mistaken for logic.

---

**Total deviations:** 4 auto-fixed (2 × Rule 1, 2 × Rule 3).
**Impact on plan:** Deviation 1 is the plan's stated carry-forward risk, resolved at the root rather than dodged; the other three are harness/spec corrections inside files the plan already owned. No scope creep, no architectural change, no new dependency.

## Issues Encountered

**The engine's `reviewOne` takes no `query` arg, so tests cannot use the `SMOKE::` seam the plan assumed.** This turned out to be fine and better: `runEvaluation` falls through to `DEFAULT_QUERY` → `rag.search`, which throws `vault: OPENAI_API_KEY unset for embeddings` and is caught by the engine's fail-open grounding block, while `internal.vault.profileSeedDocs` (a plain indexed DB read, prepended since 12-06) still puts the tenant's own profile doc into the corpus. Zero network, deterministic, and it exercises the REAL production call shape rather than a test-only seam. No test-only argument was added to `reviewOne`.

**Test-count baseline:** backend `494/495`, sole red the documented pre-existing `audit.test.ts auditCounts` row. Wave 1 recorded `485/486`; this plan's 8 tests account for +8, and the +1 residual is a stale count in the 13-01 note, not a new test (the failure list is identical to baseline).

## User Setup Required

None. No new env vars, no schema change, no seed change. The cron registers itself on the next `convex dev` / deploy; the first run lands the following Monday at 06:00 UTC. To see it immediately: Convex dashboard → function runner → `proactiveReview:runWeekly` with `{}` → open `/dashboard/workspace`.

## Next Phase Readiness

Plan 03 (the review card) can assume:

- **One stable thread per tenant.** `REVIEW_THREAD_ID` from `@pikar/core` is the id; `api.evaluations.byThread({ threadId: REVIEW_THREAD_ID })` is the tenant-scoped read and it returns the LATEST row (`order("desc").first()`). Week-over-week history is all on that one thread.
- **`delta` is populated from the second review onward** and is `undefined` on the first (and on every on-demand cockpit evaluation). Render the "what changed" line conditionally; `newFindings` is meaningful only when `> 0`.
- **The finding count no longer shrinks week over week.** Do not build UI that compensates for a shrinking count — the engine is honest now, and `proactiveReview.test.ts > notifies only on change` will go red if that regresses.
- **Notification kinds to render:** `weekly_review` and `weekly_review_failed`. They are NOT in `NOTIFICATION_KINDS`, so `NotificationsBanner` (which renders every unread row except `gmail_reconnect`) already picks them up with their static messages. If plan 03 wants a dedicated review surface, exclude them there the way `ReconnectBanner`/`gmail_reconnect` does, or they will double-surface.
- **Do not add the review kinds to `NOTIFICATION_KINDS`** and do not route the review through `notifications.notify` — both are asserted, both would arm the mailbox.

## Self-Check: PASSED

- `packages/backend/convex/proactiveReview.ts` FOUND (127 lines; exports `runWeekly`, `reviewOne`, `insertReviewNotification`)
- `packages/backend/convex/proactiveReview.test.ts` FOUND (280 lines; 8 tests, 8 passing)
- `packages/backend/convex/crons.ts` FOUND (contains `crons.weekly(\n  "proactive-review"`, lowercase `"monday"`)
- `packages/backend/convex/evaluations.ts` FOUND (contains the `!provenance.has(path)` citation rule)
- `docs/playbooks/business-evaluation.md`, `docs/playbooks/audit-dead-letter.md` FOUND (both `Last verified` bumped to 13-02)
- Commits FOUND: `13b5d73`, `0cb48f6`, `f248c9c`, `481660c`
- Gates: `proactiveReview.test.ts` 8/8 · backend 494/495 (sole pre-existing red) · `@pikar/core` 195/195 · `@pikar/web typecheck` exit 0 · backend `tsc --noEmit` +0 new errors · `check-playbooks.mjs` exit 0

---
*Phase: 13-proactive-in-app-review*
*Completed: 2026-07-25*
