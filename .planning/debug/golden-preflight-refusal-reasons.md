---
status: awaiting_human_verify
trigger: "`--preflight` deterministically returns REFUSED/2 but emits only a generic secret-safe refusal, blocking diagnosis. Add a bounded non-secret reason enum without leaking credential-derived details."
created: 2026-09-20T03:20:00+03:00
updated: 2026-09-20T04:02:00+03:00
---

## Current Focus

hypothesis: Confirmed and fixed — the standalone helper erased the runner's already-safe readiness distinctions, while transport redaction erased backend availability before the terminal renderer could classify it.
test: Run the direct reason/redaction tests, runner self-check, readiness query tests, backend/contracts typechecks, targeted formatter, and diff whitespace check entirely offline.
expecting: Every allowlisted reason renders deterministically; arbitrary errors render only `transport_error`; evaluator identity matches source; no live backend/provider/budget/corpus path runs.
next_action: On the next separately authorized preflight, confirm the real refusal line contains one allowlisted `reason=` value and exit 2, or PASS/0. Do not infer provider readiness from offline tests alone.

## Symptoms

expected: `--preflight` returns PASS/0 or REFUSED/2 with one stable, non-secret reason from a closed enum, without opening a budget or entering corpus/seed paths.
actual: `--preflight` returns REFUSED/2 with only `secret-safe; no budget opened`, so operators cannot distinguish credential, attestation, backend, or transport failures.
errors: Generic provider preflight refusal with no reason.
reproduction: Offline source/tests only. Do not start backend, invoke preflight, providers, or corpus.
started: Observed after bounded preflight lifecycle commit `e04a656` and follow-up identity/evidence changes through `d8ac77a`.

## Eliminated

## Evidence

- timestamp: 2026-09-20T03:24:00+03:00
  checked: `guardrails.goldenProviderReadiness`, runner readiness helpers, and standalone preflight helper
  found: The query already returns only closed enums and an aggregate boolean. The runner converts these into detailed strings inside a normal Error, while the standalone helper catches without inspecting them and prints a generic constant.
  implication: The backend need not return any secret-derived material; diagnosis can be restored entirely with a closed runner-side enum.

- timestamp: 2026-09-20T03:26:00+03:00
  checked: `smokeRun.mjs` redacted invocation path
  found: Every spawn timeout, unavailable backend, CLI failure, and function error becomes the identical `CONVEX_FUNCTION_FAILED` Error when `redactErrors` is enabled.
  implication: A bounded classification must be derived before raw stderr/error text is discarded, while retaining the existing redacted message for other callers.

- timestamp: 2026-09-20T03:31:00+03:00
  checked: New direct preflight and smoke transport tests before implementation
  found: Both test modules fail at import because the closed reason enum, typed refusal, renderer, and safe transport classifier do not exist.
  implication: The regression is reproduced with deterministic offline tests before changing implementation.

- timestamp: 2026-09-20T03:49:00+03:00
  checked: Closed reason renderer and raw-error redaction tests
  found: 19/19 direct Node tests pass. All eight reasons render, unknown errors collapse to `transport_error`, an unknown reason is rejected, and injected URL/length/whitespace/raw-detail needles never appear.
  implication: Terminal diagnostics are useful but bounded entirely by code-owned constants.

- timestamp: 2026-09-20T03:54:00+03:00
  checked: `convex/goldenBudget.test.ts`
  found: 13/13 tests pass, including the existing secret-safe readiness query matrix.
  implication: The query's true/false readiness semantics and closed response shape are preserved.

- timestamp: 2026-09-20T03:58:00+03:00
  checked: Evaluator self-check, backend/contracts typechecks, targeted Biome, and diff check
  found: Self-check passes for all 57 fixtures; both package typechecks complete successfully; Biome checks all six changed source/test files; `git diff --check` is clean. Evaluator revision is pinned to `2026-09-11.budgeted-evaluator.0d46cad9beefc9d126fa30d6d39db8b1428afb0056ff2728590f5491d8b8e923` in contracts and manifest.
  implication: The offline fix is internally consistent and old evaluator evidence cannot silently certify the changed runner.

## Resolution

root_cause: `guardrails:goldenProviderReadiness` already returned safe closed state, and the runner already detected individual invalid fields, but it encoded them in an ordinary Error that `runStandaloneProviderPreflight` caught and replaced with one generic constant. In the separate CLI-failure path, `must(..., redactErrors: true)` discarded whether the backend was unavailable before rendering.
fix: Added an eight-value refusal enum and typed refusal, deterministic single-reason precedence, a canonical `reason=<enum>` terminal line, and pre-redaction Convex failure classification. Missing and malformed credentials intentionally share one reason per provider. Unknown response shapes map to `readiness_response_invalid`; arbitrary/raw failures map to `transport_error`. No raw error, URL, value, length, hash, or whitespace position is rendered. Updated evaluator identity pin/manifest.
verification: Direct Node reason/transport tests 19/19; golden readiness tests 13/13; golden self-check PASS across 57 fixtures; backend and contracts typechecks green; targeted Biome and diff check green. No backend, deployment, provider, budget, seed, corpus, environment, or cleanup action ran.
files_changed:
  - packages/backend/scripts/goldenProviderPreflight.mjs
  - packages/backend/scripts/goldenProviderPreflight.test.mjs
  - packages/backend/scripts/smokeRun.mjs
  - packages/backend/scripts/smokeRun.test.mjs
  - packages/backend/scripts/run-eval-golden.mjs
  - packages/backend/scripts/eval-suite-manifest.json
  - packages/contracts/src/skill.ts
  - .planning/debug/golden-preflight-refusal-reasons.md
