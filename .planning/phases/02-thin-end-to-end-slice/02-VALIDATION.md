---
phase: 2
slug: thin-end-to-end-slice
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` ^3.2.7 + `convex-test` 0.0.54 (unit); dev-deployment smoke scripts (workflow/integration) |
| **Config file** | per-package vitest (backend `test` script); Node smoke runners under `scripts/` |
| **Quick run command** | `pnpm --filter @pikar/backend test` |
| **Full suite command** | `pnpm test` (turbo, all packages) + `pnpm boot:check` |
| **Estimated runtime** | ~30 seconds (unit); smoke scripts require a running `convex dev` |

**Critical constraint:** `convex-test` CANNOT drive component-backed workflows (Workflow / Agent /
Retrier) — confirmed in `smoke.ts` and STATE.md. Pipeline, review-gate, and delivery behaviors are
validated by **dev-deployment smoke scripts** (the existing `scripts/run-smoke-*.mjs` + `smokeRun.mjs`
banner-match pattern), NOT by `convex-test`. Pure logic is unit-tested.

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/backend typecheck`
- **After every plan wave:** Run `pnpm test` + the relevant `smoke:*` scripts against a running `convex dev`
- **Before `/gsd:verify-work`:** Full suite + `pnpm boot:check` green; both DLQ paths, the gate loop, and a real Gmail send demonstrated on the dev deployment
- **Max feedback latency:** 30 seconds (unit tier)

---

## Per-Task Verification Map

Task IDs are assigned by the planner. This table maps each phase requirement to its verification
tier and command; the planner MUST attach each row to the task that delivers it.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01 T3 | 02-01 | 1 | OPSG-06 | smoke | `node scripts/run-smoke-migration.mjs` | ❌ W1 | ⬜ pending |
| 02-02 T1 | 02-02 | 2 | AGNT-01, AGNT-03 | unit | `pnpm --filter @pikar/backend test routing` | ❌ W2 | ⬜ pending |
| 02-03 T1 | 02-03 | 2 | INTK-01, INTK-04 | unit | `pnpm --filter @pikar/backend test validateSubmit` | ❌ W2 | ⬜ pending |
| 02-02 T1 | 02-02 | 2 | AGNT-02 | unit | `pnpm --filter @pikar/backend test routing` (step-plan shape) | ❌ W2 | ⬜ pending |
| 02-04 T1 | 02-04 | 2 | REVW-01 | smoke | `pnpm --filter @pikar/backend smoke:reviewgate` (extend existing) | ⚠️ extend | ⬜ pending |
| 02-06 T3 | 02-06 | 3 | AGNT-03 | smoke | `node scripts/run-smoke-dlq.mjs` (extend) | ⚠️ extend | ⬜ pending |
| 02-06 T3 | 02-06 | 3 | DLVR-01, DLVR-03 | smoke | `node scripts/run-smoke-pipeline.mjs` | ❌ W3 | ⬜ pending |
| 02-04 T2 | 02-04 | 2 | OPSG-01 | unit | `pnpm --filter @pikar/backend test buildTelemetry` | ❌ W2 | ⬜ pending |
| 02-06 T2 | 02-06 | 3 | OPSG-07 | unit | `pnpm --filter @pikar/backend test deadLetters` | ❌ W3 | ⬜ pending |
| 02-09 T1 | 02-08/09 | 5 | BETA-04 | manual + unit | query-shape assertion in unit; reactivity verified in UI | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · File Exists ❌ Wn = created in that wave*

---

## Wave 0 Requirements

> **No separate blocking "Wave 0."** These test-first items are distributed as inline `tdd`
> tasks inside their owning feature plans (see the map above for the exact plan/task); the
> substrate install lands in Wave 1 (02-01) ahead of the first schema change per OPSG-06. The
> checklist below is the coverage contract — each item is owned by the plan named at its right.

- [ ] Component install + registration — `@convex-dev/migrations@0.3.5 @convex-dev/aggregate@0.2.2` in `convex.config.ts`, then codegen → **02-01 T1** (Wave 1). Per OPSG-06 must land *before* the first schema change.
- [ ] `convex/routing.test.ts` — routing Zod schema valid/invalid → AGNT-01, AGNT-02, AGNT-03 → **02-02 T1**
- [ ] `convex/validateSubmit.test.ts` — the five INTK-04 rejection checks → INTK-01, INTK-04 → **02-03 T1**
- [ ] `convex/buildTelemetry.test.ts` — terminal-row builder completeness → OPSG-01 → **02-04 T2**
- [ ] `convex/deadLetters.test.ts` — `status="new"` count + mark-resolved → OPSG-07 → **02-06 T2**
- [ ] `scripts/run-smoke-pipeline.mjs` — full spine (route → gate → send) + `awaiting_reauth` path → DLVR-01, DLVR-03, REVW-01 → **02-06 T3**
- [ ] Extend `scripts/run-smoke-dlq.mjs` with the two AGNT-03 route paths (unknown route, `sub_agent`) → **02-06 T3**
- [ ] Extend `smoke:reviewgate` with the 4-member decision union + attempt-suffixed event name → **02-04 T1**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live reactive updates of pipeline status + review queue with no refresh | BETA-04 | `useQuery` reactivity is a Convex platform guarantee; no meaningful assertion exists below the browser. Unit tests assert the query's return shape only. | With `convex dev` running, open the requests view, submit a request in a second tab, confirm status and review queue update without refresh. |
| Gmail "unverified app" consent screen + real inbox receipt | DLVR-01 | Requires a human at a Google consent screen (Testing mode, ≤100 test users). | Complete the `gmail.modify` consent flow, approve a drafted response, confirm the email arrives in the target inbox. |
| Gmail 7-day refresh-token expiry prompts re-auth before it breaks | DLVR-03 | The real 7-day expiry cannot be waited out in a test. Smoke covers the simulated token-dead → `awaiting_reauth` transition. | Revoke the token in the Google account console, confirm the UI surfaces the re-auth prompt rather than failing silently. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (distributed as inline `tdd` tasks — see map)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < 30s (unit tier)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified by gsd-plan-checker 2026-07-11 (goal-backward pass; 1 blocker + 2 warnings fixed).
