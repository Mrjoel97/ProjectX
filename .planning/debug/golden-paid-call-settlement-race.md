---
status: awaiting_human_verify
trigger: "Investigate and fix the golden runner's premature `GOLDEN_PAID_CALL_UNRESOLVED` termination at case 8 without any paid rerun."
created: 2026-09-20T01:42:54.8192201+03:00
updated: 2026-09-20T02:26:00+03:00
---

## Current Focus

hypothesis: Confirmed and fixed offline — a one-shot, post-observation status assertion created the premature unresolved failure.
test: A future separately authorized non-production golden run must exercise the original case-8 path and confirm the runner waits, observes the durable plan, proceeds without replay, and closes only after settlement.
expecting: Case 8 reaches its true verdict rather than `GOLDEN_PAID_CALL_UNRESOLVED`; no duplicate attempt appears and the budget closes with zero unsettled calls.
next_action: Await separately authorized live verification; no provider call or rerun is authorized in this debug task.

## Symptoms

expected: With `--no-retry`, the runner should wait within a bounded, deterministic window for all paid calls/reservations spawned by a case to settle, then observe the case plan/result and continue or fail for the true terminal reason. It must not begin the next case or close a budget while calls are unsettled.
actual: Fresh authorized run bc1d1a74, budget ps7f497nf881se330r2jncnzr18epwfx, standalone preflight green. Manifest 57; pinned executable scope 46. Cases 1-7 printed PASS. At case 8 runner immediately terminated `GOLDEN_PAID_CALL_UNRESOLVED`. Later read-only reconciliation showed all 93 calls settled, unresolved cents 0, budget closed at USD 0.06745454, and case8 memo plan exists in proposed state. Thus the runner checked too early and lost observation of eventual settlement/plan state.
errors: `GOLDEN_PAID_CALL_UNRESOLVED`; no retry occurred. Exact reconciled evidence is in commits a31bd70 and 3a0c80e and current 03.7/17.1 evidence/logs. No further paid command is authorized.
reproduction: Use logs and tests only. Do not invoke corpus/provider. Inspect packages/backend/scripts/run-eval-golden.mjs settlement logic, guardrails/budget status APIs, plan polling, timing, and existing tests. Reproduce with deterministic mocks/fake timers where unsettled calls resolve after initial case response.
started: Exposed 2026-09-20 after commit d78cbb1 secret-safe preflight allowed the first real corpus progress. Historical runs may contain similar races.

## Eliminated

## Evidence

- timestamp: 2026-09-20T01:55:00+03:00
  checked: `run-eval-golden.mjs` case loop and `guardrails:evalBudgetStatus`
  found: `assertSettledBudget()` performs exactly one status query and throws whenever `unsettledCount` is non-zero; it has no wait, backoff, or timeout loop.
  implication: A normally delayed settlement is misclassified as permanently unresolved.

- timestamp: 2026-09-20T01:58:00+03:00
  checked: `attemptCase()` ordering
  found: The runner reads `plans:getById` and evaluates all case expectations before the outer case loop calls `assertSettledBudget()`.
  implication: Even replacing the outer assertion with polling would still observe a stale plan; settlement must complete before case-state reads.

- timestamp: 2026-09-20T02:00:00+03:00
  checked: reconciled run log and Phase 03.7 evidence for run `bc1d1a74`
  found: Case 8 stopped on `GOLDEN_PAID_CALL_UNRESOLVED`, while later reconciliation found 93/93 calls settled, zero unresolved cents, USD 0.06745454 actual spend, and the case-8 memo plan proposed.
  implication: The production observation matches the source-order race precisely and contradicts a truly orphaned reservation.

- timestamp: 2026-09-20T02:06:00+03:00
  checked: new `goldenPaidAttempt.test.mjs` delayed-settlement regression tests
  found: The test file fails at module load because no `waitForPaidSettlement` implementation exists.
  implication: The red test establishes the missing behavior before the production change.

- timestamp: 2026-09-20T02:12:00+03:00
  checked: `goldenPaidAttempt.test.mjs` after implementing `waitForPaidSettlement`
  found: All 7 direct tests pass, including delayed settlement, a reservation appearing after an initially settled snapshot, bounded timeout, and terminal budget refusal.
  implication: A read-only quiet-window poll can eliminate the race without replaying a paid action or waiting indefinitely.

- timestamp: 2026-09-20T02:20:00+03:00
  checked: runner integration and offline self-check
  found: The runner now settles after every paid turn, after scheduled dispatch work, before plan/expectation observation, before any retry/next case, and again before budget closure. The self-check source-order tripwire passes for observation and closure ordering.
  implication: The original case-8 ordering is mechanically prevented, including future refactors covered by the self-check.

- timestamp: 2026-09-20T02:23:00+03:00
  checked: targeted tests, typechecks, and formatting
  found: 11 direct evaluator/settlement tests pass; 22 guardrail budget tests pass; backend and contracts typechecks pass; targeted Biome checks pass; `git diff --check` passes. Full-repository Biome remains red on five unrelated pre-existing files outside this task's ownership.
  implication: The fix is offline-verified with adjacent budget regressions, while live/provider verification remains intentionally unperformed.

## Resolution

root_cause: `runLive` performed a single immediate `evalBudgetStatus` query only after `attemptCase` had already read and graded plan state. A delayed nested/scheduled reservation therefore produced `GOLDEN_PAID_CALL_UNRESOLVED`, while the durable plan and settlement completed later.
fix: Added a deterministic, bounded, read-only quiet-window settlement poll. The runner invokes it after each paid turn, after dispatched specialist work, before observing case state or moving to another attempt/case, and before closing the budget. The poll resets its quiet window when a late reservation or any ledger change appears, never invokes a provider, and fails closed on timeout or terminal budget state. Evaluator identity and manifest revision were advanced.
verification: Offline only. 11 settlement/evaluator tests, 22 adjacent budget/closure tests, runner self-check, backend/contracts typechecks, targeted Biome, and diff-check pass. No provider, corpus, deployment, environment, cleanup, or paid retry was invoked. End-to-end verification requires a separately authorized non-production golden run.
files_changed:
  - packages/backend/scripts/goldenPaidAttempt.mjs
  - packages/backend/scripts/goldenPaidAttempt.test.mjs
  - packages/backend/scripts/run-eval-golden.mjs
  - packages/backend/scripts/eval-suite-manifest.json
  - packages/contracts/src/skill.ts
