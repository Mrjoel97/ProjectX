---
phase: 21
slug: user-authored-skills-and-routines
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-10
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for tenant-scoped skill authoring and manually re-runnable pinned prompts.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + convex-test; Playwright for authenticated browser UAT |
| **Config file** | `packages/backend/vitest.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @pikar/backend test -- skills.test.ts savedPrompts.test.ts` |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm --filter web build && node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~180 seconds, excluding authenticated browser/live gates |

---

## Sampling Rate

- **After every task commit:** Run the focused test command named by that task.
- **After every plan wave:** Run `pnpm --filter @pikar/backend test` plus the affected contracts/web gate.
- **Before `$gsd-verify-work`:** Full suite must be green, then authenticated browser UAT must pass.
- **Max feedback latency:** 180 seconds for automated task feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | SKILL-01 | contract/schema | `pnpm --filter @pikar/backend test -- skills.test.ts` | ✅ existing / extended | ⬜ pending |
| 21-01-02 | 01 | 1 | SKILL-01 | contract | focused authoring contract test selected by plan | ❌ W0 | ⬜ pending |
| 21-02-01 | 02 | 2 | SKILL-01 | Convex unit | `pnpm --filter @pikar/backend test -- skills.test.ts` | ✅ existing / extended | ⬜ pending |
| 21-02-02 | 02 | 2 | SKILL-01 | isolation/runtime | focused effective-loader test selected by plan | ❌ W0 | ⬜ pending |
| 21-03-01 | 03 | 3 | SKILL-01 | eval/activation | `pnpm --filter @pikar/backend test -- skills.test.ts` | ✅ existing / extended | ⬜ pending |
| 21-03-02 | 03 | 3 | SKILL-01 | runner offline | `pnpm --filter @pikar/backend eval:golden -- --self-check` | ✅ existing / extended | ⬜ pending |
| 21-03-03 | 03 | 3 | SKILL-01 | web owner UI | focused ops candidate review test selected by plan | ❌ W0 | ⬜ pending |
| 21-04-01 | 04 | 2 | SKILL-01 | Convex unit | `pnpm --filter @pikar/backend test -- savedPrompts.test.ts` | ❌ W0 | ⬜ pending |
| 21-04-02 | 04 | 2 | SKILL-01 | web component/static | focused workspace pinned-prompt test selected by plan | ❌ W0 | ⬜ pending |
| 21-05-01 | 05 | 4 | SKILL-01 | package/integration | `pnpm test && pnpm typecheck && pnpm --filter web build && node scripts/check-playbooks.mjs` | ✅ existing | ⬜ pending |
| 21-05-02 | 05 | 4 | SKILL-01 | browser | Phase 21 Playwright spec selected by plan | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Focused pure-contract test for the closed authorable-name set, deterministic composition, and body cap.
- [ ] Effective-loader test proving tenant override, cross-tenant isolation, and global fallback.
- [ ] `packages/backend/convex/savedPrompts.test.ts` covering bounded CRUD, dedupe, and two-tenant ownership.
- [ ] Owner-review UI test covering tenant labels, exact candidate identity, and absence of user activation.
- [ ] Workspace pinned-prompt test proving `useSendCockpitMessage`, no input `threadId`, fresh returned thread registration, and busy/error states.
- [ ] Phase 21 Playwright spec for authenticated authoring and pin/re-run behavior.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Authenticated two-tenant boundary | SKILL-01 | Requires two real identities and deployed auth state | User A publishes and pins; User B must see neither. Owner review may see the exact candidate only through the owner boundary. |
| Candidate live eval/activation/rollback | SKILL-01 | Incurs governed model spend and writes live throwaway evidence | Only after separate explicit authorization: run one full unfiltered candidate eval, verify exact-row evidence, owner activation, real runtime use, then rollback to the immutable baseline. |
| Responsive and accessible workspace states | SKILL-01 | Visual/focus behavior is not fully covered by source tests | Inspect desktop/mobile, keyboard focus, loading, empty, pending-eval, failure, and busy states. |

The failed Phase 17.1 golden run does not authorize a Phase 21 live run. No paid Phase 21 evaluation may run without new explicit owner authorization.

---

## Isolation and Anti-Vacuity Contract

- Candidate queries and effective loads must bind authenticated `tenantId`; a unique adaptation needle from tenant A must never resolve for tenant B.
- Public publication must accept no caller-supplied tenant, user, author, status, version, evidence, or base body, and must be structurally unable to call activation.
- Evidence must pin the exact tenant candidate identity; matching only name/version or another tenant's candidate must fail closed.
- The runner's registry tenant identifies the body under test while all golden fixtures remain in a throwaway evaluation tenant.
- A filtered, zero-case, failed, interrupted, or over-cap run must record no evidence; every zero-count assertion must include a positive execution witness.
- First customization must create an immutable rollback baseline; rollback must not require new evidence and must not mutate global or other-tenant rows.
- Saved-prompt delete/list/run must verify ownership. A run is inert until clicked and must create a fresh ordinary cockpit thread through `useSendCockpitMessage`.
- High-entropy body/prompt needles must be absent from audit, dead-letter, telemetry, and error payloads.
- During execution, deliberately mutate each load-bearing predicate locally to prove its named test turns red, then restore it before commit.

---

## Validation Sign-Off

- [x] All planned capability areas have an automated verify target or Wave 0 dependency.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 180 seconds.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved for planning 2026-08-10; implementation/live UAT remains pending.
