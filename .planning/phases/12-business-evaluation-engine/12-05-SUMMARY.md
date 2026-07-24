---
phase: 12-business-evaluation-engine
plan: 05
subsystem: api
tags: [convex, evaluation, plan-spine, approve-gate, vault, memo, cards, brand]

# Dependency graph
requires:
  - phase: 12-03
    provides: "the evaluations row (gaps[] with route/playbook) + byThread"
  - phase: 12-04
    provides: "the EVALUATION card + its DISABLED 'Act on this' placeholder"
  - phase: 3.2.1
    provides: "the pinned plans lifecycle (insertPlan/resetPlan/patchPlan) + the executePlan Approve gate"
  - phase: 6
    provides: "persistBrief — the 'a generated doc is just another vault doc' + startIngest precedent"
provides:
  - "api.evaluations.actOnGap — a surfaced gap becomes a PROPOSED memo-plan through the pinned collecting→proposed spine"
  - "the MEMO TERMINAL: executePlan branches on plans.kind === 'memo' → persistNextStepMemo (a next_step_memo vault doc) instead of the gmail fan-out"
  - "plans.kind discriminator (optional literal 'memo') — Approve can now mean SAVE, not only SEND"
  - "evaluations.gaps[].reason / .proofMetric — the prescription prose the memo body reads"
  - "the LIVE 'Act on this' control on the EVALUATION card + a NEXT-STEP MEMO variant of the PLAN card"
affects:
  - "12-06 cockpit teaching + EVAL_GATE (its human-verify now covers 12-04 card states, 12-05 gap→memo→approve, and 12-06's own checks)"
  - "Phase 15 ACTN-01 generalized executor — it generalizes THIS branch; it does not widen the gmail terminal"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan-SHAPE discriminator: an optional closed literal on `plans` + one early branch in executePlan — a second terminal without a second gate"
    - "Recycle-the-row: actOnGap reuses the thread's single plans row (resetPlan → patchPlan) because plans.byThread is a .unique() read"
    - "Persist-not-send terminal: the laziest correct non-email Approve is a vault-doc insert + a status flip (no new workflow, no fan-out)"
    - "Deterministic document template (buildMemo) over the persisted row — a document the user reads, NOT an agent prompt, so §5 does not apply"
    - "Display-sort vs persisted-index: the card carries each gap's ORIGINAL row index through the leverageRank sort"

key-files:
  created:
    - packages/backend/convex/gapAction.test.ts
  modified:
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/schema.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/business-evaluation.md
    - docs/playbooks/cockpit.md

decisions:
  - "MEMO-TERMINAL (plan-authorized, taken): the proposed plan's `body` IS the memo, drafted at propose time; Approve persists it as a vaultDocuments doc-kind `next_step_memo`. NO new fan-out workflow; deliverApprovedPlan.ts is byte-unchanged (verified by diff)."
  - "The memo branch sits BEFORE the mailbox pre-check in executePlan — a memo must not require a connected Gmail, and everything below that point is the email terminal."
  - "actOnGap RECYCLES the thread's plans row instead of calling insertPlan blindly (Rule 3): plans.byThread is `.unique()`, so a second row per thread would throw for every reader of the workspace."
  - "A mid-flight/delivered plan refuses with `plan_busy` — staging a memo must never clobber an in-flight send."
  - "gaps[] gained optional reason/proofMetric rather than re-running diagnose() at act time — two derivations of the same prescription drift."
  - "PlanCard branches on kind === 'memo': the email chrome (recipients, mode, send-time picker, 'Send to N recipients') would every word be a lie on a memo."

metrics:
  duration: "~25 min"
  completed: 2026-07-25
  tasks_completed: 3
  files_created: 1
  files_modified: 7
---

# Phase 12 Plan 05: Gap → Approvable Next-Step Memo Summary

A surfaced gap now crosses the Approve gate as a concrete, grounded next-step memo: `actOnGap` stages
it as a `proposed` memo-plan through the pinned plan spine, and Approve takes a **persist terminal** —
the memo lands in the vault as a `next_step_memo` doc and never enters `gmail.send`. The review stays
read-only; "Act on this" is the only control on it that writes (two-shapes rule).

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| — | RED: failing gap-action test (4 cases) | `ab82e1f` |
| 1 | `actOnGap` → proposed memo-plan | `671f246` |
| 2 | Memo terminal on Approve + `gapAction.test.ts` green | `0c1b0b9` |
| 3 | Wire the "Act on this" control | `1d29c82` |

### Task 1 — `actOnGap` stages the memo (`671f246`)

- `plans.kind: v.optional(v.literal("memo"))` (schema) — absent = the email plan every prior phase
  built, so **no migration**. `patchPlan` accepts it; `resetPlan` **clears** it (a reset must drop the
  memo shape or the next fresh compose in that thread would silently save instead of send — the
  Pitfall-6 class one rung up).
- `evaluations.gaps[]` gained optional `reason` / `proofMetric`, written straight from `diagnose()`,
  so the memo body is a pure READ of what was diagnosed.
- `actOnGap` (tenantMutation — UI-driven, live identity, so **no internal twin needed** unlike the
  12-04 tool-loop writes) reads the latest evaluation row, refuses `gap_not_found` when there is no
  gap at that index (a healthy or thin-data evaluation has **nothing to act on** — nothing crosses
  the gate), then recycles the thread's plan row through `internal.plans.resetPlan` →
  `internal.plans.patchPlan` (`kind: "memo"`, `recipients: []`, subject, body, `status: "proposed"`).
- `buildMemo` is a deterministic template over the persisted row: the constraint, the framework, the
  prescription's own "why this first", the **cited** grounded findings, the named specialist
  (`gap.route`) + its `gap.playbook`, and the proof metric. It NAMES the specialist and does not run
  it (execution is Phase 15+), and it can assert no figure the evaluation did not ground.

### Task 2 — the memo terminal (`0c1b0b9`)

`executePlan` gained ONE early branch, placed **after** the CAS status read + `escalated` guard and
**before** the mailbox pre-check:

```
if (plan.kind === "memo") { patch status "done"; await persistNextStepMemo(ctx, plan); return { ok: true } }
```

`persistNextStepMemo` (evaluations.ts, a plain exported helper — the `startIngest` shape) inserts the
body as a `next_step_memo` `vaultDocuments` row (category `workspace-docs`, `text` verbatim — vault
CONTENT, not a log, §4) and ingests it through the same `startIngest` spine `persistBrief` uses, so
the agreed next action is groundable from then on. `deliverApprovedPlan.ts` is **byte-unchanged**
(`git diff 97afebf..HEAD -- deliverApprovedPlan.ts` → empty); no `requests` row is ever seeded for a
memo, so the gmail fan-out is structurally unreachable rather than merely unused.

### Task 3 — the live control (`1d29c82`)

`GapRow` calls `useMutation(api.evaluations.actOnGap)({ threadId, gapIndex })`. The card sorts gaps by
`leverageRank`, so it now carries each gap's **original row index** through the sort — handing the
mutation a display position would act on the wrong gap. Refusals are spoken inline (`role="alert"`):
`plan_busy` → "start a new chat", `gap_not_found` → "no longer on the latest evaluation".

`PlanCard` branches on `kind === "memo"` into a NEXT-STEP MEMO card (memo body + "Approving saves this
to your knowledge vault. Nothing is sent to anyone." + an "Approve & save" `--teal-600` white-text CTA,
BRAND §2/§6) reusing the existing `approve()` handler verbatim — one Approve gate, two promises. The
`DraftCard` is suppressed for a memo (its body is already the card above). No new surface, no new
query, no component library.

## Verification Results (actually run, 2026-07-25)

| Check | Result |
|-------|--------|
| `vitest run convex/gapAction.test.ts` | **4/4 pass** — proposed memo transition, nothing-to-act-on, memo-persisted-not-emailed (zero `requests` rows), double-approve idempotence |
| `pnpm --filter @pikar/backend test` (full) | **474/475 pass, 40/41 files.** Sole failure = the pre-existing `audit.test.ts` `auditCounts` component registration (carried-forward deferred item). Baseline was 470/471 → **+4 new tests, zero regressions** |
| `pnpm --filter web typecheck` | **exit 0**, clean |
| `pnpm --filter @pikar/backend typecheck` (touched sources) | **0 errors** in `evaluations.ts` / `cockpit.ts` / `plans.ts` / `schema.ts` / `gapAction.test.ts` (the repo-wide test-file redness is the pre-existing deferred item) |
| `node scripts/check-playbooks.mjs` | **exit 0** |
| Biome (touched files vs stashed baseline) | No new findings. `cards.tsx` actually **dropped 2 pre-existing `noArrayIndexKey`** warnings (3 → 1) as a side effect of the index-carrying sort |
| `git diff 97afebf..HEAD -- deliverApprovedPlan.ts` | **empty** — the memo does not ride the gmail terminal |

The memo-terminal test deliberately seeds **no `gmailTokens` row**: an email plan would have refused
with `gmail_not_connected` there, so a passing approve is positive proof the memo branch runs before
the mailbox pre-check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `insertPlan` for every gap-action would break the whole workspace**
- **Found during:** Task 1
- **Issue:** The plan's `key_links` specified `internal.plans.insertPlan` as the way a gap enters the
  spine. But `plans.byThread` is a `.unique()` read and `sendCockpitMessage` already inserts exactly
  one `plans` row per thread on the first turn — a second row for the same thread makes `.unique()`
  throw, i.e. the PLAN/DRAFT/REPORT cards and `executePlan`'s callers break for that thread forever.
- **Fix:** `actOnGap` RECYCLES the thread's existing row (`resetPlan` → `patchPlan`) and only calls
  `insertPlan` when the thread has none. `resetPlan` (not `patchPlan`) because `patchPlan` drops
  undefined and so can never clear a half-composed email's recipients/attachments onto the memo.
  A mid-flight or delivered row is refused outright (`plan_busy`).
- **Files modified:** `packages/backend/convex/evaluations.ts`
- **Commit:** `671f246`

**2. [Rule 2 - Missing critical] the PLAN card would have lied on a memo**
- **Found during:** Task 3
- **Issue:** The plan said "the existing PLAN card renders the proposed memo-plan". Rendered as-is
  that card shows "No recipients yet.", "Mode: individual", a send-time picker, "Sends immediately on
  approve." and "Send to 0 recipients" — every one of which is false for a memo, on the surface where
  the human gives irreversible consent. Honesty at the approval boundary is not a lazy-able concern.
- **Fix:** a `kind === "memo"` early branch inside `PlanCard` (reusing the same `approve()` handler,
  so there is still exactly ONE Approve gate) rendering the memo body + "Approving saves this to your
  knowledge vault. Nothing is sent to anyone." + "Approve & save".
- **Files modified:** `apps/web/app/(app)/dashboard/workspace/cards.tsx`
- **Commit:** `1d29c82`

**3. [Rule 1 - Bug, pre-empted] `gapIndex` would have addressed the wrong gap**
- **Found during:** Task 3
- **Issue:** `EvaluationCard` sorts gaps by `leverageRank` before rendering; the naive wiring passes
  the map position, which is the SORTED position, while `actOnGap` indexes the PERSISTED `gaps[]`.
  Today `diagnose()` emits at most one gap so the two coincide — the bug would have been latent and
  would have surfaced only when a future multi-gap diagnosis shipped, acting on the wrong constraint.
- **Fix:** carry each gap's original index through the sort
  (`gaps.map((gap, gapIndex) => …).sort(…)`), documented in `cockpit.md`.
- **Files modified:** `apps/web/app/(app)/dashboard/workspace/cards.tsx`
- **Commit:** `1d29c82`

### Scope boundaries honored

- **No gated skill was activated** and **no agent teaching was hardcoded** (§5) — `actOnGap` is a UI
  control, not a tool, so 12-06's teaching is not a prerequisite for it and none was pulled forward.
- `deliverApprovedPlan.ts` untouched; the generalized executor (ACTN-01) stays Phase 15.
- Specialist EXECUTION not pulled forward: the memo NAMES `gap.route` and cites `gap.playbook`.

## Carried-Forward Deferred Items (still open, NOT fixed here)

All pre-date this plan and remain in `deferred-items.md`:

1. **`convex/audit.test.ts` round-trip test fails** — `Component "auditCounts" is not registered`.
   Re-observed (the 1 failure of 475). Out of scope.
2. **`pnpm --filter @pikar/backend typecheck` is red (~52 errors)** — all in `*.test.ts` files.
   Production sources compile clean, including all four touched here. Out of scope.
3. **12-04's human-verify is still UNPAID debt** carried into 12-06's checkpoint. This plan adds a
   third thing to that checkpoint (see below) and does not claim any of it verified.

## Deferred Verification — carried into 12-06

Plan 12-05 is `autonomous: true` and has no checkpoint of its own, but its flow is **not live-verifiable
yet** for exactly the reasons 12-04 recorded: the cockpit agent is never taught `evaluateBusiness`
(12-06 Task 2) and all seven rubric skills are seeded-but-gated (EVAL_GATE, 12-06 Task 3), so no
EVALUATION card renders live and therefore no gap can be tapped by hand. Coverage here is
unit/convex-test over the real mutations (per the orchestrator's instruction), which exercises the
whole chain — evaluate → gap → `actOnGap` → `proposed` memo-plan → `executePlan` → persisted vault doc.

**12-06's human-verify checkpoint must now cover THREE things**, not two:
1. 12-04's card states (framework sections, H/M/L chip + citation, ≤5 ranked gaps + "more", distinct
   not-enough-data, affirmative healthy, no numeric scores);
2. **12-05's acting path** — tap "Act on this" → a NEXT-STEP MEMO card appears with an "Approve & save"
   button → approve → the memo shows up at `/dashboard/vault` and **no email is sent**;
3. 12-06's own teaching/gate verification.

## Next

Plan 12-06: teach the cockpit agent `evaluateBusiness` (a gated candidate `cockpit-agent` body edit,
§5), run the EVAL_GATE to activate the seven rubric skills, and carry the COMBINED 12-04 + 12-05 +
12-06 visual verification at its checkpoint.

## Self-Check: PASSED

Files verified present on disk: `packages/backend/convex/gapAction.test.ts`,
`packages/backend/convex/evaluations.ts`, `packages/backend/convex/cockpit.ts`,
`packages/backend/convex/plans.ts`, `packages/backend/convex/schema.ts`,
`apps/web/app/(app)/dashboard/workspace/cards.tsx`, `docs/playbooks/business-evaluation.md`,
`docs/playbooks/cockpit.md`.
Commits verified in `git log`: `ab82e1f` (RED), `671f246` (Task 1), `0c1b0b9` (Task 2), `1d29c82`
(Task 3).
Claims verified by execution, not assertion: gapAction 4/4, backend 474/475 (sole failure
pre-existing), web typecheck exit 0, check-playbooks exit 0, Biome baseline compared against a
stashed tree, `deliverApprovedPlan.ts` diff empty across the whole plan range.
