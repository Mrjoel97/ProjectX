---
phase: 12
slug: business-evaluation-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `12-RESEARCH.md` → Validation Architecture. Per-task rows are
> filled by the planner as PLAN.md task IDs are assigned.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`convex-test` for Convex fns; pure package fns test without Convex) |
| **Config file** | per-package `vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @pikar/core test` (pure ports) / `pnpm --filter @pikar/backend test` (convex) |
| **Full suite command** | `pnpm test` (workspace) + `pnpm eval:golden` (live agent gate) |
| **Offline seam** | `SMOKE::<docId,…>` grounding seam (`vaultGround.ts:43`) — zero network |
| **Estimated runtime** | unit ~seconds; `pnpm eval:golden` ~minutes + live cost |

---

## Sampling Rate

- **After every task commit:** Run the pure-port unit tests + the relevant `convex-test` file (`pnpm --filter … test`) — seconds, no network.
- **After every plan wave:** Run `pnpm test` (workspace) + the two-tenant isolation assertion.
- **Before `/gsd:verify-work`:** `pnpm eval:golden` green (records evidence, activates the gated rubric/cockpit-agent candidates). Mind eval-env fragility — kill-all-convex → one clean `npx convex dev` → verify stable before eval.
- **Max feedback latency:** unit < 30s; eval gate is a phase-boundary gate, not per-commit.

---

## Per-Task Verification Map

> Task IDs assigned during planning. Requirement → observable signal → command below;
> planner maps each to the task that delivers it.

| Requirement | Behavior (observable signal) | Test Type | Automated Command | File Exists | Status |
|-------------|------------------------------|-----------|-------------------|-------------|--------|
| BEVL-01 | `diagnose(scorecard)` returns correct gate/route per financial regime; unknown → asks, never guesses | unit | `pnpm --filter @pikar/core test` | ❌ W0 `growth/diagnose.test.ts` | ⬜ pending |
| BEVL-01 | `ltgpCac`/`cfa` math matches Python worked examples (LTGP `$4,500`; CFA boundaries at 1 and 2) | unit | `pnpm --filter @pikar/core test` | ❌ W0 `financialSpine.test.ts` | ⬜ pending |
| BEVL-01 | Thin/idea-stage profile (null financials) → "not enough data" state, NO fabricated metric | unit | `pnpm --filter @pikar/core test` | ❌ W0 (assert ask-not-route) | ⬜ pending |
| BEVL-01 | `evaluateBusiness` grounds tenant-scoped, writes evaluation row + refs-only `evaluation.ran` audit (no prose) | integration | `pnpm --filter @pikar/backend test` | ❌ W0 `evaluations.test.ts` | ⬜ pending |
| BEVL-01 | Grounded assessment produces ≥1 finding, each with a citation (live model) | eval | `pnpm eval:golden` | ❌ W0 `eval-cases/NN-grounded-assessment.json` | ⬜ pending |
| BEVL-02 | Tapped gap → `proposed` plan through the existing spine | integration | `pnpm --filter @pikar/backend test` | ❌ W0 (assert status transition) | ⬜ pending |
| BEVL-02 | Healthy business → zero gaps affirmative card (live model) | eval | `pnpm eval:golden` | ❌ W0 `eval-cases/NN-healthy-no-gaps.json` (`gapCount: 0`) | ⬜ pending |
| BEVL-02 | Approved gap-action → persisted next-step memo (not an email) | integration | `pnpm --filter @pikar/backend test` | ❌ W0 memo-terminal test | ⬜ pending |
| SC #5 | Two-tenant isolation — tenant B never sees tenant A's evaluation row/scorecard | integration | `pnpm --filter @pikar/backend test` | ⚠️ pattern `plans.test.ts:44`; ❌ new assertion | ⬜ pending |
| §4 | Audit/telemetry payloads for evaluation carry counts/hashes/enums only (no prose) | static/unit | `pnpm --filter @pikar/backend test` | ⚠️ mirror `llmRedaction.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/*/src/growth/diagnose.test.ts` + `financialSpine.test.ts` — one assert-based self-check per pure fn (covers BEVL-01 math + conservative-unknown behavior)
- [ ] `packages/backend/convex/evaluations.test.ts` — convex-test: grounding, refs-only audit, storage, **two-tenant isolation** (SC #5, mirror `plans.test.ts:44`)
- [ ] `eval-cases/NN-grounded-assessment.json` + `NN-healthy-no-gaps.json` — new golden fixtures riding the `SMOKE::` seam
- [ ] Extend `evaluateExpect`/`validateFixture` (`run-eval-golden.mjs:119`) with new expect key(s) (`evaluationPresent`/`gapCount`) + matching `smoke:` read; bump the `>= 18` fixture floor (`:189`)
- [ ] Add `"evaluateBusiness"` to `agentSteps.tool` union (`schema.ts:318`) + `SMOKE_OP_TOOL` (`llm.ts:1767`) — else the step insert silently drops in prod while tests pass

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EVALUATION card visual layout / confidence chips / thin-data-vs-gap distinction | BEVL-01/02 | Rendered UI against BRAND.md; no snapshot infra for these cards | Run app, ask cockpit "evaluate my business", confirm framework sections, per-line H/M/L chips + citations, ranked gap list ≤5, affirmative healthy state, distinct "not enough data" state |

*Automated coverage handles the data/logic; only the visual render is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit); eval gate at phase boundary
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
