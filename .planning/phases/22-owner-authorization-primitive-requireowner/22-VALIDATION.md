---
phase: 22
slug: owner-authorization-primitive-requireowner
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-29
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for the durable owner identity, server-side authorization boundary,
> and owner-only optimizer presentation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x + `convex-test`; React server rendering for the real web component; TypeScript/build checks |
| **Config file** | `packages/backend/vitest.config.mts`; `apps/web/vitest.config.mts` |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run convex/tenant.test.ts convex/owner.test.ts convex/optimizerConfig.test.ts convex/skills.test.ts convex/importGuard.test.ts --maxWorkers=1` |
| **Full suite command** | `pnpm --filter @pikar/backend test -- --maxWorkers=1 && pnpm --filter @pikar/backend typecheck && pnpm --filter @pikar/web typecheck` |
| **Estimated runtime** | ~25 s quick, ~150 s full |

---

## Sampling Rate

- **After every task commit:** Run the quick targeted command, narrowed only when the task has not
  created a later plan's test file yet.
- **After every plan wave:** Run the full suite command undisturbed.
- **Before `$gsd-verify-work`:** Full backend tests, reliable backend source/test typechecks, and web
  typecheck/build must be green.
- **Max feedback latency:** ~30 s quick, ~180 s full.
- Never run the full Vitest suite while another executor is editing modules it imports.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | GOVN-01 stable identity | source + Convex integration | `pnpm --filter @pikar/backend exec vitest run convex/tenant.test.ts convex/owner.test.ts --maxWorkers=1` | ✅ | ✅ green |
| 22-01-02 | 01 | 1 | GOVN-01 durable owner/bootstrap | Convex integration + §4 payload | `pnpm --filter @pikar/backend exec vitest run convex/owner.test.ts convex/importGuard.test.ts --maxWorkers=1` | ✅ | ✅ green |
| 22-01-03 | 01 | 1 | GOVN-01 deployment substrate | live checkpoint | owner bootstrap twice, then sign out/in and read `owner.viewer` | live evidence | ✅ green |
| 22-02-01 | 02 | 2 | GOVN-01 optimizer guard | Convex integration + mutation | `pnpm --filter @pikar/backend exec vitest run convex/optimizerConfig.test.ts convex/owner.test.ts --maxWorkers=1` | ✅ | ✅ green |
| 22-02-02 | 02 | 2 | GOVN-01 activation/body disclosure | Convex integration + mutation | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/owner.test.ts --maxWorkers=1` | ✅ | ✅ green |
| 22-02-03 | 02 | 2 | GOVN-01 guard coverage/eval preservation | static + regression | `pnpm --filter @pikar/backend exec vitest run convex/importGuard.test.ts convex/skills.test.ts --maxWorkers=1` | ✅ | ✅ green |
| 22-03-01 | 03 | 3 | GOVN-01 owner-only presentation | component render + hook execution | `pnpm --filter @pikar/web test -- 'app/(app)/ops/opsPresentation.test.ts' --maxWorkers=1` | ✅ | ✅ green |
| 22-03-02 | 03 | 3 | GOVN-01 integrated admission gate | focused suites + typecheck + live server UAT | authorization suite, web presentation suite, typechecks, then recorded server UAT | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/backend/convex/owner.test.ts` — stable user identity across session subjects,
  absent-owner refusal, idempotent bootstrap, exact audit payload keys, and wrapper behavior.
- [x] Owner/non-owner `/ops` proof — the existing Node Vitest runner renders the real `OpsPage`
  through React's server renderer with instrumented Convex hooks. This proves component output and
  mount/subscription behavior without pretending it observed browser pixels.
- [x] Every negative test carries an anti-vacuity assertion that the owner path actually reads or
  mutates the expected row.

Existing Vitest, `convex-test`, backend/web typecheck, and build infrastructure cover all other
requirements.

---

## Deployment Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Durable owner bootstrap on the intended deployment | GOVN-01 | The exact deployed user row and CLI operator action do not exist in `convex-test` | Completed 2026-08-01: exact owner changed true then false and survived fresh identity resolution |
| Browser layout/hydration spot-check | GOVN-01 | Component rendering does not observe pixels, CSS, or hydration | Optional regression smoke test; not the server trust boundary and no longer a blocking presentation gap |

---

## Mutation Checks

1. Replace `user?.owner === true` with authentication-only acceptance: every non-owner endpoint test
   must fail.
2. Move one named endpoint from `ownerMutation`/`ownerQuery` back to its tenant wrapper: the source
   guard and that endpoint's non-owner test must fail.
3. Do not use “move the owner check below a write” as a mutation: Convex rolls back the transaction,
   making that result observably identical. Wrapper placement and named endpoint guards prove the
   check cannot be skipped.
4. Remove the UI `isOwner` mount guard: all false/null/loading component cases must fail by rendering
   Optimizer and recording its owner-only hooks; the exact-owner positive case prevents vacuity.

---

## Validation Sign-Off

- [x] All auto tasks have `<automated>` verify; the deployment-only owner grant is recorded live
- [x] Sampling continuity: no 3 consecutive implementation tasks without automated verify
- [x] Wave 0 covers the backend fixture and real-component UI mount/subscription proof
- [x] No watch-mode flags
- [x] Feedback latency < 180 s for focused checks
- [x] Live server owner/non-owner gate recorded at its actual evidence level; component evidence is
  explicitly not described as a live DOM run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
