---
phase: 22
slug: owner-authorization-primitive-requireowner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for the durable owner identity, server-side authorization boundary,
> and owner-only optimizer presentation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x + `convex-test`; web TypeScript/build checks |
| **Config file** | `packages/backend/vitest.config.mts` |
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
| 22-01-01 | 01 | 1 | GOVN-01 stable identity | source + Convex integration | `pnpm --filter @pikar/backend exec vitest run convex/tenant.test.ts convex/owner.test.ts --maxWorkers=1` | ❌ W0 `owner.test.ts` | ⬜ pending |
| 22-01-02 | 01 | 1 | GOVN-01 durable owner/bootstrap | Convex integration + §4 payload | `pnpm --filter @pikar/backend exec vitest run convex/owner.test.ts convex/importGuard.test.ts --maxWorkers=1` | ❌ W0 `owner.test.ts` | ⬜ pending |
| 22-01-03 | 01 | 1 | GOVN-01 deployment substrate | live checkpoint | owner bootstrap twice, then sign out/in and read `owner.viewer` | live only | ⬜ pending |
| 22-02-01 | 02 | 2 | GOVN-01 optimizer guard | Convex integration + mutation | `pnpm --filter @pikar/backend exec vitest run convex/optimizerConfig.test.ts convex/owner.test.ts --maxWorkers=1` | ✅ existing + ❌ W0 | ⬜ pending |
| 22-02-02 | 02 | 2 | GOVN-01 activation/body disclosure | Convex integration + mutation | `pnpm --filter @pikar/backend exec vitest run convex/skills.test.ts convex/owner.test.ts --maxWorkers=1` | ✅ existing + ❌ W0 | ⬜ pending |
| 22-02-03 | 02 | 2 | GOVN-01 guard coverage/eval preservation | static + regression | `pnpm --filter @pikar/backend exec vitest run convex/importGuard.test.ts convex/skills.test.ts --maxWorkers=1` | ✅ existing | ⬜ pending |
| 22-03-01 | 03 | 3 | GOVN-01 owner-only presentation | web typecheck/build + DOM/source guard | `pnpm --filter @pikar/web typecheck && pnpm --filter @pikar/web build` | ❌ W0 owner/non-owner UI proof | ⬜ pending |
| 22-03-02 | 03 | 3 | GOVN-01 integrated admission gate | full suite + live UAT | full suite command, then owner/non-owner `/ops` checklist | live only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/owner.test.ts` — stable user identity across session subjects,
  absent-owner refusal, idempotent bootstrap, exact audit payload keys, and wrapper behavior.
- [ ] Owner/non-owner `/ops` proof — add the smallest deterministic component/source test supported
  by the existing web harness; retain the live DOM check for final verification.
- [ ] Every negative test carries an anti-vacuity assertion that the owner path actually reads or
  mutates the expected row.

Existing Vitest, `convex-test`, backend/web typecheck, and build infrastructure cover all other
requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Durable owner bootstrap on the intended deployment | GOVN-01 | The exact deployed user row and CLI operator action do not exist in `convex-test` | Resolve the intended `users._id`; run the internal bootstrap twice; expect `true` then `false`; sign out/in and confirm `owner.viewer` remains true |
| Non-owner disclosure boundary | GOVN-01 | Requires a second authenticated identity and rendered `/ops` subscription behavior | Sign in as non-owner; confirm no Optimizer heading, controls, candidate bodies, queries, or owner-only error states mount |
| Owner controls and preserved tenant operations | GOVN-01 | Confirms deployment wiring and mixed `/ops` composition | Sign in as owner; exercise optimizer read/toggle and gated activation refusal/success; confirm Eval signals, Dead letters, Compliance navigation, and badge still render |

---

## Mutation Checks

1. Replace `user?.owner === true` with authentication-only acceptance: every non-owner endpoint test
   must fail.
2. Move one named endpoint from `ownerMutation`/`ownerQuery` back to its tenant wrapper: the source
   guard and that endpoint's non-owner test must fail.
3. Move the owner check below a config write or activation: zero-mutation/status-immutability tests
   must fail.
4. Remove the UI `isOwner` mount guard: the non-owner presentation proof must fail.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180 s
- [ ] Live owner/non-owner deployment gate recorded at its actual evidence level
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
