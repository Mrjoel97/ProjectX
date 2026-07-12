---
phase: 3
slug: guardrails
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-12
planned: 2026-07-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (packages) + convex-test 0.0.54 (backend) + smokeRun.mjs (dev-deployment smokes) |
| **Config file** | packages/*/vitest.config.ts; packages/backend/scripts/smokeRun.mjs |
| **Quick run command** | `pnpm --filter <touched-package> test` |
| **Full suite command** | `pnpm test` (turbo across packages) |
| **Estimated runtime** | ~20 seconds (full), ~2–10s per package |
| **Smoke runtime** | ~30–90s per smoke script against the running dev deployment |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter <touched-package> test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite green + `smoke:guardrails` + `smoke:pipeline` (regression) pass
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-T1 SafeText brand | 03-01 | 1 | GRDL-02 | unit (existing suite) | `pnpm --filter @pikar/pii test && pnpm --filter @pikar/pii typecheck` | ✅ scan.test.ts | ⬜ pending |
| 01-T2 @pikar/cost | 03-01 | 1 | GRDL-03 | unit (TDD, in-task) | `pnpm --filter @pikar/cost test` | created in task | ⬜ pending |
| 01-T3 isFallbackEligible | 03-01 | 1 | GRDL-05 | unit (TDD, in-task; lives in @pikar/core per CLAUDE.md §1) | `pnpm --filter @pikar/core test -- fallback` | created in task | ⬜ pending |
| 02-T1 action-cache install | 03-02 | 1 | GRDL-04 | exact-pin check + typecheck | `node -e "…pin check…" && pnpm --filter @pikar/backend typecheck` | n/a (script) | ⬜ pending |
| 02-T2 schema rails | 03-02 | 1 | GRDL-01 | typecheck + regression | `pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/backend test` | ✅ existing suite | ⬜ pending |
| 02-T3 blocked outcome | 03-02 | 1 | GRDL-01 | unit (TDD, in-task) | `pnpm --filter @pikar/core test && pnpm --filter @pikar/backend typecheck` | ✅ buildTelemetry.test.ts | ⬜ pending |
| 03-T1 limiter/config/readers | 03-03 | 2 | GRDL-06 | typecheck | `pnpm --filter @pikar/backend typecheck` | n/a | ⬜ pending |
| 03-T2 guardrails.prepare + preCall | 03-03 | 2 | GRDL-01, GRDL-03, GRDL-06 | convex-test (TDD, in-task; prepare + preCall fail-closed branches — component happy-path and the preCall budget branch deferred to 05-T2 per research caveat) | `pnpm --filter @pikar/backend test -- guardrails` | created in task | ⬜ pending |
| 03-T3 submit rate limit | 03-03 | 2 | GRDL-06 | regression + typecheck (limiter behavior lands in 05-T2 smoke) | `pnpm --filter @pikar/backend test && pnpm --filter @pikar/backend typecheck` | ✅ existing suite | ⬜ pending |
| 04-T1 uncached actions + fallback | 03-04 | 3 | GRDL-01, GRDL-05 | unit | `pnpm --filter @pikar/core test -- fallback` | from 01-T3 | ⬜ pending |
| 04-T2 cache wrappers + static scan | 03-04 | 3 | GRDL-02, GRDL-04 | static-scan test (in-task, mirrors auditImmutability.test.ts) | `pnpm --filter @pikar/backend test -- llmRedaction` | created in task | ⬜ pending |
| 04-T3 pipeline wiring | 03-04 | 3 | GRDL-01, GRDL-02, GRDL-03 | typecheck + full suite + smoke regression | `pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/backend test && pnpm --filter @pikar/backend smoke:pipeline` | ✅ run-smoke-pipeline.mjs | ⬜ pending |
| 05-T1 seeds + assertions | 03-05 | 4 | GRDL-02, GRDL-04, GRDL-05, GRDL-06 | typecheck + regression | `pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/backend test` | n/a | ⬜ pending |
| 05-T2 smoke:guardrails + phase gate (incl. mid-flight preCall blocked path) | 03-05 | 4 | GRDL-02, GRDL-04, GRDL-05, GRDL-06 | dev-deployment smoke (banner-judged, never exit codes) | `pnpm --filter @pikar/backend smoke:guardrails && pnpm --filter @pikar/backend smoke:pipeline` | created in task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Folded into tasks: existing vitest + convex-test + smokeRun.mjs infrastructure covers the phase; the new test files (cost.test.ts, fallback.test.ts, guardrails.test.ts, llmRedaction.test.ts, run-smoke-guardrails.mjs) are created test-first INSIDE their owning tasks (`tdd="true"` / static-scan-in-task), so no separate Wave 0 plan exists. `packages/cost` mirrors the `packages/pii` vitest scaffolding.
- [x] Framework install for the phase (action-cache 0.3.1 + `app.use` + codegen) is plan 03-02 Task 1 — first wave.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real fallback on live model outage | GRDL-05 | Cannot force a real provider outage from CI; smoke uses the extended SMOKE:: `fail=primary` seam (real classifier + catch wiring, fixed fallback draft) | Optionally verify with a bogus model id on the dev deployment with AI_GATEWAY_API_KEY set; do not block the phase gate on it |
| Kill-switch operator flip UX | GRDL-06 | Flipping the guardrailConfig row is an operator action on a live deployment | Now AUTOMATED in `smoke:guardrails` (flip on → assertBlocked → flip off, finally-guarded); optionally repeat by hand: `npx convex run guardrails:setKillSwitch '{"on":true}'` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (folded in-task, see above)
- [x] No watch-mode flags (all commands are one-shot `vitest run` package scripts / smokes)
- [x] Feedback latency < 90s (unit/typecheck in seconds; smokes ≤ 90s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-12 (plans 03-01…03-05)
