---
phase: 13-proactive-in-app-review
plan: 01
subsystem: database
tags: [convex, schema, evaluations, delta, diagnose, notifications, playbooks]

# Dependency graph
requires:
  - phase: 12-business-evaluation-engine
    provides: "the append-only `evaluations` table, `runEvaluation` (carry-forward → ground → diagnose → insertEvaluation), `lastForThread`, and the `SMOKE::` offline grounding seam the delta tests ride"
  - phase: 07-resilience-ops
    provides: "`notificationTemplates.ts` — the §4 static-label firewall the three review constants join, and the closed `NOTIFICATION_KINDS` array they deliberately stay out of"
provides:
  - "`evaluations.delta` — an optional `{ newFindings, gapsClosed, gapsOpened }` row field, the 'what changed since last time' line the weekly review card renders"
  - "`runEvaluation({ withDelta: true })` — the delta computed IN-ENGINE (before insertEvaluation, from values already in memory) and returned as a fourth result field"
  - "`vaultDocuments.by_kind` — the ONE deliberately cross-tenant index, so the cron can enumerate onboarded tenants without reading any document's `text` blob"
  - "`REVIEW_THREAD_ID` / `REVIEW_READY_MESSAGE` / `REVIEW_FAILED_MESSAGE` exported from `@pikar/core`"
  - "playbook coverage for `proactiveReview.ts` / `proactiveReview.test.ts` registered ahead of the files existing, so plan 02 cannot be blocked mid-flight by the §9 Stop hook"
affects: [13-02 weekly cron/fan-out, 13-03 review card, 13-04, proactive-review, business-evaluation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delta-in-engine: a derived 'what changed' value is computed inside the action that already holds both sides in scope, then flows through the SINGLE insert surface — never a follow-up patch of an append-only table"
    - "Opt-in derived field: `withDelta` gates the computation so the same engine serves both the on-demand (no delta) and the cron (delta) caller with one code path"
    - "Explicit return annotation on any Convex action whose return is derived from a `ctx.runQuery` result (Pitfall 9 circular-inference guard)"
    - "Pre-registering a not-yet-existing path in `watch.json` (the hook matches by prefix, never checks existence) to de-risk the next plan"

key-files:
  created: []
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/evaluations.test.ts
    - packages/core/src/notificationTemplates.ts
    - docs/playbooks/watch.json
    - docs/playbooks/business-evaluation.md
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "Gap identity is `${route}/${playbook}`, NOT `route` alone — diagnose() emits only three routes and several distinct prescriptions share each, so a route-only key would report a real move (e.g. 'No offer worth buying yet' → 'Offer is a commodity', both offer-architect) as 'no change'. `playbook` is a code-owned literal, never LLM prose, so it is safe to key on in a way the human-readable `label` is not."
  - "The delta is computed INSIDE runEvaluation, immediately before insertEvaluation — the `evaluations` table is append-only (insertEvaluation is its only write surface), and the engine already holds `last`, `findings` and `gaps` in one scope, so the delta is pure arithmetic over values already in memory: zero extra reads, zero extra writes."
  - "The two review kinds are DELIBERATELY absent from NOTIFICATION_KINDS. That absence is the security property: notifyExternal.dispatch returns at `if (!KINDS.has(kind)) return;` BEFORE freshAccessToken, so an unregistered kind can never reach a Gmail token. The proactive review is in-app only."
  - "`vaultDocuments.by_kind` is the one deliberately cross-tenant index in the repo — read by a single caller (plan 02's fan-out) and yielding tenant ids only, never content. The alternative (a .collect() over a table holding book-sized uploads) walks into the 16 MiB / 32k-doc read cap."
  - "`newFindings` is clamped at 0 — a DROP in finding count is not 'new findings'. This also keeps the known repeat-run provenance collapse (12-05 deferred item) from rendering as a negative number."
  - "(Rule 1) Any Convex action returning a value derived from a `ctx.runQuery` result needs an EXPLICIT return-type annotation, or the return resolves through `internal` → `api.d.ts` → back to itself and TypeScript silently degrades the WHOLE generated API to `any`/`{}`."

patterns-established:
  - "Delta-in-engine over patch-after: derived comparison values are produced where both sides are already in scope and written through the existing single insert surface"
  - "Pitfall-9 guard: explicit `Promise<{...}>` on the handler + a named type for any runQuery-derived return field"

requirements-completed: [BEVL-03]

# Metrics
duration: ~22min
completed: 2026-07-25
---

# Phase 13 Plan 01: Proactive Review Foundations Summary

**The weekly review's data foundation: an optional in-engine `evaluations.delta` ("what changed" — gaps opened/closed keyed on `route/playbook`, plus a clamped new-findings count), a cross-tenant `vaultDocuments.by_kind` index for cheap tenant enumeration, and the three shared review constants — so plan 02's cron can be pure orchestration.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-25T15:57Z
- **Completed:** 2026-07-25T16:19Z
- **Tasks:** 3/3
- **Files modified:** 7 (+ regenerated `graphify-out/`)

## Accomplishments

- **`evaluations.delta` exists and is computed where it costs nothing.** `runEvaluation` gained `withDelta: v.optional(v.boolean())`; when set AND a previous row exists, it derives `{ newFindings, gapsClosed, gapsOpened }` from `last`/`findings`/`gaps` — all three already in scope one line above the insert — and passes it through `insertEvaluation` (the append-only table's single write surface; no `patch` was added). It is also returned, so plan 02's `reviewOne` never re-reads to learn what moved.
- **Gap identity settled at `route/playbook`.** Asserted on the KEY STRING in a test that walks a real diagnosis from Gate 1 (`offer-architect/02-build-offer`) down to Gate 2 (`money-model-designer/06-assemble`) — a route-only key would still have looked "changed" here, but the pair is what survives the intra-route moves diagnose() can make.
- **Tenant enumeration is now cheap.** `vaultDocuments.by_kind` — the ONE deliberately cross-tenant index in the repo, currently zero callers (verified by grep), to be read by plan 02's fan-out for tenant ids only.
- **The review's static strings landed in the §4 firewall file WITHOUT arming the mailbox.** `REVIEW_THREAD_ID` / `REVIEW_READY_MESSAGE` / `REVIEW_FAILED_MESSAGE` export from `@pikar/core`; `NOTIFICATION_KINDS` is byte-identical and `notificationTemplates.test.ts` still passes element-by-element.
- **Plan 02 is unblockable by the Stop hook** — `proactiveReview.ts` / `proactiveReview.test.ts` are pre-registered under `business-evaluation.md` in `watch.json` (the hook matches by path prefix and never checks existence).
- **Caught and fixed a Pitfall-9 type collapse before it shipped** (see Deviations).

## Task Commits

1. **Task 1: Schema fields, shared review constants, playbook registration** — `be3095f` (feat)
2. **Task 2: Compute the delta inside runEvaluation** (TDD) — `ade2782` (test, RED: 3 of 4 failed on `Validator error: Unexpected field withDelta`) → `43fd499` (feat, GREEN: 4/4 delta, 11/11 file)
3. **Task 3: Playbooks, graph refresh, wave gate** — `319bc23` (fix — includes the Rule-1 Pitfall-9 fix)

## Files Created/Modified

- `packages/backend/convex/schema.ts` — optional `evaluations.delta` object field (no migration); `vaultDocuments.by_kind` index with the cross-tenant rationale comment.
- `packages/backend/convex/evaluations.ts` — `withDelta` arg, the `EvaluationDelta` named type, in-engine delta computation, `delta` added to `insertEvaluation`'s args + call, both return branches given one shape, explicit handler return annotation.
- `packages/backend/convex/evaluations.test.ts` — 4 new `delta`-named tests + `profileDocText(withFinancials, withOffering)` so a profile can honestly carry no offering.
- `packages/core/src/notificationTemplates.ts` — the three review constants with the "why these are NOT notification kinds" contract comment.
- `docs/playbooks/watch.json` — `proactiveReview.ts` / `.test.ts` under `business-evaluation.md`.
- `docs/playbooks/business-evaluation.md` — new `## "What changed" — the evaluations.delta field` section; `Last verified` bumped to 2026-07-25 (3).
- `docs/playbooks/audit-dead-letter.md` — notification-matrix bullet recording the three constants and why the review kinds stay outside `NOTIFICATION_KINDS`; `Last verified` bumped.

## Decisions Made

See `key-decisions` in frontmatter. The load-bearing ones: gap identity is the `route/playbook` pair; the delta is computed in-engine rather than patched on (append-only table + everything already in scope); the review's absence from `NOTIFICATION_KINDS` is a security guarantee, not an omission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Returning the delta collapsed the entire generated Convex API type to `any`/`{}`**

- **Found during:** Task 3 (the wave gate — `pnpm --filter @pikar/web typecheck`)
- **Issue:** The plan's task-2 step 4 has `runEvaluation` RETURN `delta`, and `delta` is derived from `last` (an `internal.evaluations.lastForThread` result). With the return type left to inference, the action's type resolves through `internal` → `_generated/api.d.ts`'s `fullApi` → back to `runEvaluation` itself. TypeScript detects the cycle, silently degrades the whole generated API surface, and **90 errors** appear across `apps/web` (`TS7006` implicit-any on every `useQuery` callback param, `TS2322 Type '{}' is not assignable to ReactNode`, …) in files this plan never touched. This is exactly the Pitfall 9 class the plan warned about, but one rung deeper than the union-return the plan guarded against — sharing one return shape across both branches was necessary and not sufficient. A/B confirmed: `git checkout 9890bd4 -- schema.ts evaluations.ts notificationTemplates.ts` → typecheck exit 0; restore → 90 errors.
- **Fix:** Named the shape (`type EvaluationDelta = { newFindings: number; gapsClosed: string[]; gapsOpened: string[] }`), annotated the local `const delta: EvaluationDelta | undefined`, and gave the handler an explicit `): Promise<{ verdict: "gaps" | "healthy" | "insufficient"; findingCount: number; gapCount: number; delta: EvaluationDelta | undefined }>`. The annotation breaks the cycle: the return no longer needs the query's inferred type to resolve. A comment on `EvaluationDelta` records the failure mode and the measurement so it is not "cleaned up" later.
- **Files modified:** `packages/backend/convex/evaluations.ts`
- **Verification:** `pnpm --filter @pikar/web typecheck` → exit 0 (was 90 errors); `evaluations.test.ts` still 11/11.
- **Committed in:** `319bc23` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 × Rule 1).
**Impact on plan:** Necessary for correctness — the plan's own task-2 instruction as written broke the web build. No scope creep; the fix is 8 lines of type annotation inside the file task 2 already owned.

## Issues Encountered

**The plan's test-4 spec ("an unchanged re-run → newFindings === 0 AND both gap arrays empty") is unsatisfiable with a vault-grounded fixture**, because of the repeat-evaluation provenance gap logged as a Phase-12 deferred item: carry-forward preserves scorecard VALUES but not their PROVENANCE, so a second run over the same doc re-cites nothing, `findings.length` drops to 0, the engine suppresses gaps (SC #1), and `gapsClosed` comes back non-empty. Resolved without changing the spec by building the "unchanged" fixture out of a **user-provided** figure instead (`recordScorecardAnswer` seeds a carrier row; `provenance` is re-seeded from `userProvided[]` on every run, so the citation is stable across runs). Both halves of the plan's assertion then hold honestly: run 1 vs the carrier row gives `newFindings > 0`, run 2 vs run 1 gives `newFindings === 0` with both gap arrays empty. This is a test-design workaround, not a fix — the provenance gap remains open and is still recorded in `business-evaluation.md` and `12-.../deferred-items.md`.

**Baseline check:** backend `485/486` — the sole red is the documented pre-existing `audit.test.ts > audit.log inserts exactly one row that round-trips` (auditCounts component not registered), unchanged from the 12-05 baseline of 474/475 (+11 tests, +4 of them this plan's delta tests). Not in scope, not touched.

## User Setup Required

None — no external service configuration, no new env vars, no seed changes. The schema change is an optional field + a new index, so `convex dev` applies it with no migration.

## Next Phase Readiness

Plan 02 (the weekly cron) can be pure orchestration — every fact it needs now exists:

- call `internal.evaluations.runEvaluation({ tenantId, threadId: REVIEW_THREAD_ID, withDelta: true })` and read the delta straight off the return (or off the persisted row via `byThread`);
- enumerate onboarded tenants over `vaultDocuments.by_kind` (zero other callers today — plan 02 will be the first);
- use `REVIEW_READY_MESSAGE` / `REVIEW_FAILED_MESSAGE` as in-app-only labels; do NOT add them to `NOTIFICATION_KINDS`;
- `docs/playbooks/watch.json` already covers `proactiveReview.ts`, so the Stop hook will accept the new module as long as `business-evaluation.md` is touched in the same turn.

**Carry-forward concern:** the repeat-evaluation provenance collapse now matters more than it did — a weekly review runs repeatedly on ONE pinned thread (`REVIEW_THREAD_ID`), which is exactly the shape that collapses `findingCount`. STATE.md currently records "Phase 13's proactive review runs on its own thread, so it is unaffected"; that is only true of tenant isolation, not of repeat runs. Plan 02/03 should either run each weekly review in a fresh thread id or close the provenance gap, or the card will show a shrinking finding count week over week.

## Self-Check: PASSED

- `packages/backend/convex/schema.ts` FOUND (contains `by_kind`, `delta: v.optional(v.object`)
- `packages/backend/convex/evaluations.ts` FOUND (contains `withDelta`, `insertEvaluation` … `delta`)
- `packages/core/src/notificationTemplates.ts` FOUND (contains `REVIEW_THREAD_ID`)
- `docs/playbooks/watch.json` FOUND (contains `proactiveReview.ts`)
- `docs/playbooks/business-evaluation.md`, `docs/playbooks/audit-dead-letter.md` FOUND (both `Last verified` bumped)
- Commits FOUND: `be3095f`, `ade2782`, `43fd499`, `319bc23`

---
*Phase: 13-proactive-in-app-review*
*Completed: 2026-07-25*
</content>
</invoke>
