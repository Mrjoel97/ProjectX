---
phase: 1
slug: foundation-governance-substrate
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x + convex-test 0.0.54 (`@edge-runtime/vm` environment) |
| **Config file** | `packages/backend/vitest.config.mts` (`environment: "edge-runtime"`) — created in Plan 01, Task 3 |
| **Quick run command** | `pnpm --filter backend vitest run` |
| **Full suite command** | `pnpm turbo test` |
| **Estimated runtime** | ~30 seconds (unit suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter backend vitest run`
- **After every plan wave:** Run `pnpm turbo test` + `npx convex run` smoke scripts against the dev deployment
- **Before `/gsd:verify-work`:** Full suite green + clean-clone boot test + both smoke workflows (DLQ, review-gate race) demonstrated
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs assigned by the planner (format: {plan}-T{task}). RED tests are written first inside each owning plan (task-level TDD), so every automated command has an owner before implementation lands.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-T1/03-T2 | 01-03 | 2 | OPSG-02 (insert path) | unit (convex-test) | `pnpm --filter backend vitest run convex/audit.test.ts` | ❌ created RED in 03-T1 | ⬜ pending |
| 03-T1/03-T2 | 01-03 | 2 | OPSG-02 (insert-only static scan) | unit (static scan) | `pnpm --filter backend vitest run convex/auditImmutability.test.ts` | ❌ created RED in 03-T1 | ⬜ pending |
| 06-T1 | 01-06 | 3 | OPSG-04 (DLQ via onComplete) | integration (dev deployment) | `pnpm --filter backend smoke:dlq` | ❌ created in 06-T1 | ⬜ pending |
| 02-T1/02-T2/02-T3 | 01-02 | 2 | Criterion 2 (tenant scoping unavoidable) | unit negative (convex-test) + grep allow-list | `pnpm --filter backend vitest run convex/tenant.test.ts convex/importGuard.test.ts` | ❌ created RED in 02-T1 | ⬜ pending |
| 06-T2 | 01-06 | 3 | Criterion 4 (awaitEvent race) | integration (dev deployment) | `pnpm --filter backend smoke:reviewgate` | ❌ created in 06-T2 | ⬜ pending |
| 07-T1 | 01-07 | 3 | Criterion 4 (WORM cron stub) | unit + integration | `pnpm --filter backend vitest run convex/worm.test.ts` + `pnpm --filter backend smoke:worm` | ❌ created RED in 07-T1 | ⬜ pending |
| 04-T1/04-T2 | 01-04 | 2 | Criterion 6 (skills registry + seed skill) | unit (convex-test) + grep no-hardcoded-prompts | `pnpm --filter backend vitest run convex/skills.test.ts` | ❌ created RED in 04-T1 | ⬜ pending |
| 01-T3 | 01-01 | 1 | Criterion 1 (clean-clone boot) | scripted check | `node scripts/boot-check.mjs` (install → codegen → typecheck) | ❌ created in 01-T3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 items are satisfied inside their owning plans: Plan 01 (Wave 1) bootstraps the framework + boot-check; Plans 02/03/04/07 write their RED test files as Task 1 before implementation (task-level TDD); Plan 06 delivers the smoke scripts alongside the patterns they exercise (component-backed workflows are not emulatable by convex-test — dev-deployment integration per Research Open Question 2).

- [ ] `packages/backend/vitest.config.mts` + `@edge-runtime/vm` install — **Plan 01, Task 3**
- [ ] `convex/audit.test.ts` — OPSG-02 insert path — **Plan 03, Task 1 (RED)**
- [ ] `convex/auditImmutability.test.ts` — OPSG-02 insert-only static scan — **Plan 03, Task 1 (RED)**
- [ ] `convex/tenant.test.ts` + `convex/importGuard.test.ts` — cross-tenant negative + unauthenticated + raw-builder ban — **Plan 02, Task 1 (RED)**
- [ ] `convex/skills.test.ts` — skills registry loader/activation — **Plan 04, Task 1 (RED)**
- [ ] `convex/smoke.ts` + `smokeAssert.ts` + `smoke:dlq`/`smoke:reviewgate` scripts — OPSG-04 DLQ + review-gate race — **Plan 06, Tasks 1–2**
- [ ] `convex/worm.test.ts` + `smoke:worm` — WORM cron stub — **Plan 07, Task 1 (RED)**
- [ ] `scripts/boot-check.mjs` — install → codegen → typecheck — **Plan 01, Task 3**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clean-clone boot following README verbatim | Criterion 1 | First-run DX can't be fully scripted (README accuracy is the artifact) | Fresh `git clone` → follow README: `pnpm install` → `npx convex dev` → `pnpm dev` → app loads, codegen green, 5 components in `convex.config.ts` |
| Google OAuth verification submitted | Criterion 5 | External console workflow (Verification Center) — Plan 09, Tasks 1 & 3 (checkpoints) | Verification Center shows "submitted"; record URL/screenshot in phase notes; demo video of minimal gmail.send consent flow attached |
| Graphify active on repo | Criterion 5 | Local tooling state — Plan 05, Task 2 (checkpoint) | `.git/hooks/post-commit` exists; `graphify-out/graph.json` fresh after a commit; `.mcp.json` contains graphify stdio entry |
| Homepage + privacy live on verified domain | Criterion 5 | Domain attachment + Search Console DNS verification need user accounts — Plan 08, Task 3 (checkpoint) | `/` and `/privacy` return 200 on the production domain; Search Console domain property verified |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checkpoint tasks are manual by design and listed above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (owned per-plan, RED-first)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-09 (plans 01-01 … 01-09)
