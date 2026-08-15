---
phase: 33
slug: media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-15
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest per package (`packages/core` 936+, `packages/cost` 61+, `packages/backend` 1714+ via convex-test, `apps/web` .ts-only/DOM-less) + Playwright e2e |
| **Config file** | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.mts`, `apps/web/vitest.config.mts`, `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @pikar/backend test -- media` (or `-- storyboard` in core, `-- mediaCanvas` in web) |
| **Full suite command** | `turbo run test --concurrency=1` (concurrency 1 — vitest spawn-fail gotcha) |
| **Estimated runtime** | quick ~30-60s per filtered suite; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** Run the touched package's filtered suite (see per-task map)
- **After every plan wave:** Run `turbo run test --concurrency=1` + `npx tsc --noEmit` in BOTH `packages/backend` and `apps/web` (the wave-2 lesson: backend tsc green missed a web break)
- **Before `/gsd:verify-work`:** Full suite green + one Playwright media-canvas pass against a prod build; skill-body wave additionally needs seed + live read-back
- **Max feedback latency:** ~90 seconds (filtered suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 33-01-01 | 01 | 1 | 33-INTAKE | unit | `pnpm --filter @pikar/core test -- storyboard` | ✅ extend | ⬜ pending |
| 33-01-02 | 01 | 1 | 33-CITE | unit | `pnpm --filter @pikar/core test -- storyboard` | ✅ extend | ⬜ pending |
| 33-01-03 | 01 | 1 | 33-VARIA | unit | `pnpm --filter @pikar/core test -- storyboard` | ✅ extend | ⬜ pending |
| 33-02-01 | 02 | 2 | 33-INTAKE/VARIA/CITE | typecheck+unit | `cd packages/backend && npx tsc --noEmit -p . && pnpm test -- media` | ✅ extend | ⬜ pending |
| 33-02-02 | 02 | 2 | 33-INTAKE, 33-VARIA | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-02-03 | 02 | 2 | 33-CITE | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-03-01 | 03 | 3 | 33-INTAKE, 33-VARIA, 33-CITE | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-03-02 | 03 | 3 | 33-CITE | unit (observed RED) | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-03-03 | 03 | 3 | 33-VARIA | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-04-01 | 04 | 4 | 33-FAIL | unit | `pnpm --filter @pikar/core test -- render && pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-04-02 | 04 | 4 | 33-FAIL | unit (retry-cap observed RED) | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-04-03 | 04 | 4 | 33-FAIL | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-05-01 | 05 | 5 | 33-REEL, 33-CITE | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-05-02 | 05 | 5 | 33-REEL | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend | ⬜ pending |
| 33-05-03 | 05 | 5 | 33-REEL | unit | `pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-06-01 | 06 | 6 | 33-CANVAS | unit | `pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-06-02 | 06 | 6 | 33-CANVAS | unit | `pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-06-03 | 06 | 6 | 33-CANVAS | typecheck+unit | `cd apps/web && npx tsc --noEmit && pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-07-01 | 07 | 7 | 33-INTAKE, 33-VARIA | unit | `pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-07-02 | 07 | 7 | 33-INTAKE | typecheck+unit | `cd apps/web && npx tsc --noEmit && pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-07-03 | 07 | 7 | 33-VARIA | typecheck+unit | `cd apps/web && npx tsc --noEmit && pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-08-01 | 08 | 8 | 33-CITE, 33-FAIL | unit (swap-tested) | `pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-08-02 | 08 | 8 | 33-CITE | typecheck+unit | `cd apps/web && npx tsc --noEmit && pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-08-03 | 08 | 8 | 33-FAIL | typecheck+unit | `cd apps/web && npx tsc --noEmit && pnpm --filter web test -- mediaCanvas` | ✅ extend | ⬜ pending |
| 33-09-01 | 09 | 9 | 33-INTAKE, 33-VARIA, 33-CITE | round-trip unit | `pnpm --filter @pikar/core test -- storyboard` | ✅ extend | ⬜ pending |
| 33-09-02 | 09 | 9 | 33-INTAKE, 33-VARIA, 33-CITE | round-trip unit | `pnpm --filter @pikar/core test -- storyboard` | ✅ extend | ⬜ pending |
| 33-10-01 | 10 | 10 | all | live pre-flight | `cd packages/backend && npx convex run skills:getActiveSkill '{"name":"media-director"}'` (read-back evidence) | live-only | ⬜ pending |
| 33-10-02 | 10 | 10 | all | e2e (prod build) | `npx playwright test media-canvas` + `turbo run test --concurrency=1` | ✅ extend | ⬜ pending |
| 33-10-03 | 10 | 10 | all | checkpoint:human-verify | — (owner walk-through) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Seed check: read back live `media-director` version — a PRE-FLIGHT for live behavior only
  (`pnpm dev` seeds; `npx convex dev` alone does not). Deliberately scheduled at plan 33-10
  Task 1 because no earlier plan depends on live specialist behavior (all unit work runs against
  the on-disk body and parsers).
- [ ] `apps/web/e2e/media-canvas.spec.ts` — spec exists; new assertions are per-wave work (33-10), not missing infrastructure.

Existing test infrastructure covers all phase requirements — no missing frameworks or configs.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real paid end-to-end (clips bought → captioned final → vault save) | 33-REEL | Spends real media dollars on the no-refunds rail; owner's spend decision | 33-10 Task 3 step 4 (optional, price on button) |
| Distinct-concept quality of the two variations | 33-VARIA | "Different angle AND visual treatment" is a judgment call; tests pin only the kind-mix shadow | 33-10 Task 3 step 2 |
| Muted-autoplay/tap-for-sound feel and layout stability | 33-CANVAS | Perceptual; e2e asserts structure, not feel | 33-10 Task 3 steps 1/4 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (seed read-back scheduled at 33-10; nothing earlier depends on it)
- [x] No watch-mode flags
- [x] Feedback latency < 90s for filtered suites
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
