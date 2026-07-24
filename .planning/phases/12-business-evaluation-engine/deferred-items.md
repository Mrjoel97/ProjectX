# Phase 12 — Deferred / Out-of-Scope Items

## Pre-existing failures observed during 12-02 execution (NOT caused by 12-02)

- **`convex/audit.test.ts > "audit.log inserts exactly one row that round-trips"` fails**
  (mutation error around `auditCounts.insert`). Reproduced with 12-02's `skills.ts` change
  stashed out — pre-dates this plan. 12-02 touches only skill-registry files. Root-cause and
  fix belong to whoever owns the audit subsystem / the plan that introduced it (likely 12-01 or
  earlier). Not fixed here (scope boundary — unrelated to the current task's changes).

- **`pnpm --filter @pikar/backend typecheck` is red (~52 errors)** — all in `*.test.ts` files
  (`import.meta.glob` type gap — a documented shared gap across `convex/*.test.ts`; `WorkflowId`
  string assignments in `vault.test.ts`; `mintClientSecret` drift in `voiceToken.test.ts`).
  Production `skills.ts` compiles clean (0 errors). Reproduced with 12-02 stashed — pre-existing.

  *Re-observed during 12-04's run (the 1 failure of 471 backend tests). Still open.*

## Deferred verification carried forward from 12-04 → 12-06

- **12-04 Task 3 (human-verify, BEVL-01) is DEFERRED, not passed.** The user ran it; the EVALUATION
  card did not appear (cockpit answered "evaluate my business" with plain prose, no activity step).
  The Task 1-2 code is correct — the plan's sequencing is not. Two enabling halves land only in 12-06:
  1. `packages/contracts/skills/cockpit-agent.md` has ZERO mention of evaluate/scorecard/swot/diagnose,
     so the agent never knows the tool exists. Teaching is a gated candidate body edit (§5) —
     **12-06 Task 2**.
  2. `evaluations.ts:234` loads the rubric via `getActiveSkill(FRAMEWORK_SKILL[chosen])`, and all seven
     Phase-12 rubrics sit in `GATED_SKILLS` (`packages/contracts/src/skill.ts:100-115`) — seeded but
     NOT activated. Activation happens only through the EVAL_GATE — **12-06 Task 3** (SC #4). Even a
     called tool would hit fail-closed-if-missing → fail-open and render nothing.

  **Action required:** plan 12-06's human-verify checkpoint must cover **BOTH plans' visual checks** —
  12-04's card states (framework sections, per-finding H/M/L chip + clickable citation, ≤5 ranked gaps
  with a "more" disclosure, distinct not-enough-data state, affirmative healthy state, no numeric
  scores) AND 12-06's own teaching/gate verification. Do NOT close Phase 12 with only 12-06's checks.

## Deferred verification added by 12-05 → 12-06 (the debt is now THREE-part)

- **12-05's acting path is NOT live-verified.** 12-05 is `autonomous: true` and has no checkpoint of
  its own, and its flow is unreachable by hand for exactly the reasons above: with no EVALUATION card
  rendering live there is no gap to tap. Coverage shipped is convex-test over the real mutations
  (`gapAction.test.ts`, 4/4) exercising evaluate → gap → `actOnGap` → proposed memo-plan →
  `executePlan` → persisted `next_step_memo` vault doc with ZERO `requests` rows.

  **Add to 12-06's checkpoint:** tap **"Act on this"** on a gap → a **NEXT-STEP MEMO** card appears
  (memo body, "Approving saves this to your knowledge vault. Nothing is sent to anyone.",
  **"Approve & save"**) → approve → the memo appears at `/dashboard/vault` as a `next_step_memo`
  doc and **no email is sent**. Also confirm the email PLAN card is unchanged for a normal compose
  (the memo branch must not have leaked into the send path).

  Workarounds explicitly ruled out by the owner: do not activate a gated skill to force the flow, do
  not hardcode agent teaching into source (§5), do not add throwaway seeding scaffolding.
