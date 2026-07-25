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

## Known gap — logged during 12-06 verification, NOT fixed

- **Re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1).** Carry-forward
  preserves the scorecard **values** but not their **provenance**, so a second evaluation on the same
  thread re-cites only the paths filled fresh on that run. The verdict/gap stay correct; the evidence
  list shrinks and understates the grounding. **Workaround: a fresh thread per evaluation.** The real
  fix is a provenance-carrying carry-forward (store the citation alongside each carried value in
  `evaluations.ts`); deferred until repeat-evaluation-in-thread actually matters (Phase 13's proactive
  review runs on its own thread, so it is unaffected).

## ~~Deferred verification carried forward from 12-04 → 12-06~~ — RESOLVED 2026-07-25

**RESOLVED at 12-06 Task 3.** The owner ran all three accumulated visual checks (12-04 card states,
12-05 gap → memo → approve → vault-doc-with-no-email, 12-06 teaching) against a live deployment with
`cockpit-agent@15` ACTIVE and reported: *"Everything worked. I approve."* Both 12-04's and 12-05's
deferred human-verify are paid; BEVL-01 and BEVL-02 are live-verified. Five real defects surfaced during
this verification and were fixed (`d5814ae`, `f971613`, `b5e0f7f`+`7efa4f9`, `f5c279e`) — see
`12-06-SUMMARY.md`. Historical record of the debt follows:

- **12-04 Task 3 (human-verify, BEVL-01) was DEFERRED, not passed.** The user ran it; the EVALUATION
  card did not appear (cockpit answered "evaluate my business" with plain prose, no activity step).
  The Task 1-2 code is correct — the plan's sequencing is not. Two enabling halves land only in 12-06:
  1. `packages/contracts/skills/cockpit-agent.md` has ZERO mention of evaluate/scorecard/swot/diagnose,
     so the agent never knows the tool exists. Teaching is a gated candidate body edit (§5) —
     **12-06 Task 2**.
  2. `evaluations.ts:234` loads the rubric via `getActiveSkill(FRAMEWORK_SKILL[chosen])`, and all seven
     Phase-12 rubrics sit in `GATED_SKILLS` (`packages/contracts/src/skill.ts:100-115`) — ~~seeded but
     NOT activated~~. Even a called tool would hit fail-closed-if-missing → fail-open and render nothing.

     **CORRECTION (12-06 Task 3):** the rubrics were **not seeded at all**, not "seeded but gated".
     `convex dev` alone does not seed — only `pnpm dev` (`convex dev --run skills:seedSkills`) or
     `npm run seed` does, and the running watcher had been started before 12-02 authored them. On their
     FIRST seed they took the `rows.length === 0` bootstrap path and each landed **v1 ACTIVE**, so no
     `activateSkill` was needed. Gating costs nothing until a skill's first body EDIT; only
     `cockpit-agent` rode the gate (→ **@15**, activated on 27/27 passing evidence, SC #4 intact).

  **Action required (DONE):** 12-06's human-verify covered both plans' visual checks. Owner approved.

## ~~Deferred verification added by 12-05 → 12-06 (the debt is now THREE-part)~~ — RESOLVED 2026-07-25

- **12-05's acting path is NOT live-verified.** 12-05 is `autonomous: true` and has no checkpoint of
  its own, and its flow is unreachable by hand for exactly the reasons above: with no EVALUATION card
  rendering live there is no gap to tap. Coverage shipped is convex-test over the real mutations
  (`gapAction.test.ts`, 4/4) exercising evaluate → gap → `actOnGap` → proposed memo-plan →
  `executePlan` → persisted `next_step_memo` vault doc with ZERO `requests` rows.

  **Added to 12-06's checkpoint and PASSED:** tap **"Act on this"** on a gap → a **NEXT-STEP MEMO** card appears
  (memo body, "Approving saves this to your knowledge vault. Nothing is sent to anyone.",
  **"Approve & save"**) → approve → the memo appears at `/dashboard/vault` as a `next_step_memo`
  doc and **no email is sent**. Also confirm the email PLAN card is unchanged for a normal compose
  (the memo branch must not have leaked into the send path).

  Workarounds explicitly ruled out by the owner: do not activate a gated skill to force the flow, do
  not hardcode agent teaching into source (§5), do not add throwaway seeding scaffolding.

## Eval fixture `18-briefing-then-action` is degrading — OPEN (logged 2026-07-25)

Post-phase regression run of `pnpm eval:golden` (run `8b43e179`, 26/27, $0.1644) after the
chunk-precise hydration change: `18-briefing-then-action` FAILED both the first attempt and the
harness's one automatic re-run, on `briefingPresent: expected true, got false`.

**Not caused by that change, and this was checked rather than assumed:**
- All four fixtures on the changed retrieval path PASSED — `25-vault-grounded`, `26-vault-empty`,
  `27-grounded-assessment`, `28-healthy-no-gaps`.
- The briefing path cannot reach the changed code: `briefInbox` calls `internal.gmail.listInbox`,
  and neither `briefings.ts` nor `gmail.ts` references `vaultGround`/`searchVault` at all (grepped).

**Why it still matters:** this case was already the harness's known flake — it needed a retry in the
PREVIOUS run (`ed251c29`, 27/27) — and it has now gone from "passes on retry" to "fails twice". The
assertion depends on the live model actually calling `briefInbox` on a follow-up turn, so the
fixture's turns may no longer reliably steer it there.

**Action:** treat a green gate as 27/27, not "26/27 plus the usual flake". Before the next
activation that depends on this gate, either tighten fixture 18's turns so the briefing call is
unambiguous, or split the briefing assertion from the follow-up action assertion. Do NOT raise the
retry count to paper over it — the harness's one-retry flake policy is deliberate.
