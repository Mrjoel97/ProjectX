---
phase: 2
slug: thin-end-to-end-slice
status: draft
nyquist_compliant: false
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
| TBD | TBD | 0 | OPSG-06 | smoke | `npx convex run migrations:run '{fn:"migrations:backfillRequestDefaults"}'` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AGNT-01, AGNT-03 | unit | `pnpm --filter @pikar/backend test routing` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | INTK-01, INTK-04 | unit | `pnpm --filter @pikar/backend test submitValidation` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AGNT-02 | unit | `pnpm --filter @pikar/backend test routing` (step-plan shape) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-01 | smoke | `pnpm --filter @pikar/backend smoke:reviewgate` (extend existing) | ⚠️ extend | ⬜ pending |
| TBD | TBD | TBD | AGNT-03 | smoke | `node scripts/run-smoke-dlq.mjs` (extend) | ⚠️ extend | ⬜ pending |
| TBD | TBD | TBD | DLVR-01, DLVR-03 | smoke | `node scripts/run-smoke-pipeline.mjs` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPSG-01 | unit | `pnpm --filter @pikar/backend test telemetry` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPSG-07 | unit | `pnpm --filter @pikar/backend test deadLetterQuery` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BETA-04 | manual + unit | query-shape assertion in unit; reactivity verified in UI | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Component install + registration — `pnpm --filter @pikar/backend add @convex-dev/migrations@0.3.5 @convex-dev/aggregate@0.2.2`, register in `convex.config.ts`, then `npx convex dev` codegen. **Blocks everything**, and per OPSG-06 must land *before* the first schema change.
- [ ] `convex/routing.test.ts` — routing Zod schema valid/invalid → AGNT-01, AGNT-02, AGNT-03
- [ ] `convex/submitValidation.test.ts` — the five INTK-04 rejection checks → INTK-01, INTK-04
- [ ] `convex/telemetry.test.ts` — terminal-row builder completeness → OPSG-01
- [ ] `convex/deadLetterQuery.test.ts` — `status="new"` count + mark-resolved → OPSG-07
- [ ] `scripts/run-smoke-pipeline.mjs` — full spine (route → gate → send) + `awaiting_reauth` path → DLVR-01, DLVR-03, REVW-01
- [ ] Extend `scripts/run-smoke-dlq.mjs` with the two AGNT-03 route paths (unknown route, `sub_agent`)
- [ ] Extend `smoke:reviewgate` with the 4-member decision union + attempt-suffixed event name

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live reactive updates of pipeline status + review queue with no refresh | BETA-04 | `useQuery` reactivity is a Convex platform guarantee; no meaningful assertion exists below the browser. Unit tests assert the query's return shape only. | With `convex dev` running, open the requests view, submit a request in a second tab, confirm status and review queue update without refresh. |
| Gmail "unverified app" consent screen + real inbox receipt | DLVR-01 | Requires a human at a Google consent screen (Testing mode, ≤100 test users). | Complete the `gmail.modify` consent flow, approve a drafted response, confirm the email arrives in the target inbox. |
| Gmail 7-day refresh-token expiry prompts re-auth before it breaks | DLVR-03 | The real 7-day expiry cannot be waited out in a test. Smoke covers the simulated token-dead → `awaiting_reauth` transition. | Revoke the token in the Google account console, confirm the UI surfaces the re-auth prompt rather than failing silently. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
