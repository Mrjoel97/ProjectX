---
phase: 15
slug: sub-agent-dispatch-action-executor
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `15-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^3.2.7` + `convex-test@0.0.54`, `edge-runtime` environment |
| **Config file** | `packages/backend/vitest.config.mts` (includes `convex/**/*.test.ts`); `packages/core/vitest.config.ts` for pure-TS |
| **Quick run (backend, one file)** | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` |
| **Quick run (core, one file)** | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` |
| **Full suite command** | `pnpm test` (turbo: core + contracts + backend + web) |
| **Typecheck** | `pnpm typecheck` — **must also pass for `apps/web`** (Pitfall 4) |
| **Playbook gate** | `node scripts/check-playbooks.mjs check` — exit 0 |
| **Estimated runtime** | ~30s per touched file; ~3-4 min full suite |
| **Known pre-existing red** | `convex/audit.test.ts` (`auditCounts` unregistered) — documented since Phase 2, **not** a regression |

---

## Sampling Rate

- **After every task commit:** the touched file's suite (< 30s) + `pnpm --filter @pikar/backend exec tsc --noEmit`
- **After every plan wave:** `pnpm test` + `pnpm typecheck` (**including `apps/web`**) + `node scripts/check-playbooks.mjs check` — this is exactly PARALLELIZATION Stage 3's automated merge gate
- **Before `/gsd:verify-work`:** full suite green (≈495 backend tests; sole permitted red is the documented `audit.test.ts` row) + `pnpm eval:golden` all-green with the three specialist pins
- **Max feedback latency:** 30 seconds (per-task); 4 minutes (per-wave)
- **Owner live human-verify:** ONCE, on integrated `main`, covering Phases 14 + 15 together (PARALLELIZATION Stage 3). Not a per-lane gate.

**Eval-gate escape hatch:** if `pnpm eval:golden` does not go green in-phase, **ship dark** (per CONTEXT.md) — the framework still lands and is still fully tested offline; specialist candidates park unregistered.

---

## Per-Task Verification Map

Task IDs are assigned by the planner. Every task MUST map to one of the rows below; the
planner fills `Task ID` / `Plan` / `Wave` when plans are written.

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|----------|-----------|-------------------|-------------|--------|
| 15-03 T1 | 15-03 | 3 | DISP-01 / SC#1 | Named specialist runs in the SAME loop with a swapped `(system, tools)` — skill body is the system prompt, only allow-listed tools present | integration (convex-test, mock model) | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-02 T1 / 15-03 T1 | 15-02, 15-03 | 2, 3 | DISP-01 / SC#1 | Unknown / empty specialist route fails closed to `unknown_route`, returns a conversational refusal, writes **no** `deadLetters` row | unit (core) + integration | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` · `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-03 T1 | 15-03 | 3 | DISP-01 / SC#2 | Hard depth cap: a specialist attempting to dispatch is refused at `depth > 1` | integration | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-02 T1 / 15-03 T1 | 15-02, 15-03 | 2, 3 | DISP-01 / SC#2 | Cycle refusal: `ancestry` containing the target route is rejected (A→B→A) | unit (pure predicate `wouldCycle`) + integration | `pnpm --filter @pikar/core exec vitest run src/specialists.test.ts` · `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-03 T2 | 15-03 | 3 | DISP-01 / SC#2 | Shared envelope drawn down across hops; mid-tree exhaustion stops, keeps partial output, labels it incomplete | integration (mock model, scripted `usage`, `rateLimiter` registered) | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-01 T3 | 15-01 | 1 | DISP-01 / SC#2 | **No nested `generateText`** — no agent spawns an agent | static source scan (`llmRedaction.test.ts` idiom) | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` | ❌ W0 | ⬜ pending |
| 15-03 T2 | 15-03 | 3 | DISP-01 / SC#3 | Every sub-agent audit row carries `rootRequestId` + `parentAgentId`; call tree reconstructs from `by_correlation`; cost sums to the root | integration | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-03 T2 | 15-03 | 3 | DISP-01 / SC#3 | Lineage payload is refs/ids/counts ONLY — no specialist output text in any audit/step row (CLAUDE.md §4) | static scan + assertion over written rows | `pnpm --filter @pikar/backend exec vitest run convex/llmRedaction.test.ts` | ✅ extend | ⬜ pending |
| 15-05 T2 | 15-05 | 2 | ACTN-01 / SC#4 | `executePlan` dispatches by action type; the memo arm persists a vault doc and seeds **zero** `requests` rows | integration | `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` | ✅ extend (`:157` already asserts zero-requests) | ⬜ pending |
| 15-05 T1 | 15-05 | 2 | ACTN-01 / SC#4 | Adding an arm needs ZERO spine edits | **compile-time** (`satisfies Record<ActionType, Arm>`) + unit on `armFor` | `pnpm typecheck` · `pnpm --filter @pikar/core exec vitest run src/actionType.test.ts` | ❌ W0 | ⬜ pending |
| 15-05 T3 | 15-05 | 2 | ACTN-01 / SC#4 | The Approve gate stays a `tenantMutation`, never a tool (`executePlan` absent from `buildCockpitTools` keys) | static source scan | `pnpm --filter @pikar/backend exec vitest run convex/dispatchGuard.test.ts` | ❌ W0 | ⬜ pending |
| 15-05 T2 | 15-05 | 2 | ACTN-01 / SC#4 | `deliverApprovedPlan.ts` byte-unchanged — gmail fan-out structurally unreachable from a non-email arm | integration (zero `requests` rows) + `git diff --exit-code` in plan verification | `pnpm --filter @pikar/backend exec vitest run convex/gapAction.test.ts` | ✅ extend | ⬜ pending |
| 15-03 T3 | 15-03 | 3 | BETA-05 / SC#5 | A sub-agent run keyed on `rootRequestId` is still tenant-scoped (two-tenant assertion) | isolation assertion | `pnpm --filter @pikar/backend exec vitest run convex/dispatch.test.ts` | ❌ W0 | ⬜ pending |
| 15-02 T3 / 15-03 T3 / 15-04 T3 / 15-05 T3 / 15-06 T3 | 15-02..15-06 | 2-5 | §9 | Playbooks updated in-phase | hook | `node scripts/check-playbooks.mjs check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 must land before any lane emits a dispatch step. Three of these fail **silently** if skipped.

- [ ] `packages/backend/convex/schema.ts` — dispatch literal(s) added to the closed `agentSteps.tool` union.
      **Mandatory before any lane emits a step** — a missing literal fails silently in production because
      the SDK swallows callback throws (Pitfall 3).
- [ ] `docs/playbooks/watch.json` — register `packages/core/src/specialists.ts`,
      `packages/core/src/actionType.ts`, `packages/backend/convex/dispatch.ts` (+ their test dirs).
      **The Stop hook blocks every lane otherwise.**
- [ ] `apps/web/.../workspace/cards.tsx` VERB map — dispatch entries + the missing `evaluateBusiness` entry.
      **PARALLELIZATION Stage 2's Phase-15 lane table has no web column — Stage 1 must assign one.**
- [ ] `packages/backend/convex/guardrails.ts` — `remainingDailyCents` internalQuery; file FROZEN afterwards
- [ ] `packages/backend/convex/dispatch.ts` — empty stub file (lane-owned afterwards)
- [ ] `packages/core/src/specialists.ts` — stub with `SPECIALIST_ROUTES` + `resolveSpecialist` failing closed,
      **no specialists registered yet** (PARALLELIZATION Stage 1 explicitly asks for this)
- [ ] `packages/core/src/actionType.ts` — stub with the two-arm union and a no-op passthrough switch
- [ ] New test files: `convex/dispatch.test.ts`, `convex/dispatchGuard.test.ts`,
      `packages/core/src/specialists.test.ts`, `packages/core/src/actionType.test.ts`
- [ ] No framework install needed — vitest + convex-test are already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Three golden fixtures: gap → tap → dispatch → staged specialist output | DISP-01 (live) | Paid, model-behaviour-dependent. CONTEXT explicitly reserves paid fixtures for the happy path only. | `pnpm eval:golden --skill offer-architect@N --skill money-model-designer@N --skill lead-engine@N` — one run, all three pinned, behind `EVAL_GATE` |
| Integrated cockpit walkthrough on `main` | DISP-01, ACTN-01 | Cross-lane UX seam (specialist attribution header, VERB map labels) | ONCE on integrated `main`, covering Phases 14 + 15 together — PARALLELIZATION Stage 3 |

**Manual-only justification:** the golden fixtures are the ONLY paid, model-behaviour-dependent signal.
Every refusal path (unknown specialist, depth breach, cycle, drained envelope) is asserted offline with
`MockLanguageModelV4` at zero cost. Adversarial paid fixtures are deferred.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (9 items above) — all land in 15-01
- [x] No watch-mode flags
- [x] Feedback latency < 30s per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-07-25 — 6 plans, 18 tasks, every task carries an `<automated>` command drawn from this map.
