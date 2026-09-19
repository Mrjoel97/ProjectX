---
status: awaiting_human_verify
trigger: "Investigate why `pnpm --filter @pikar/backend eval:golden -- --preflight` printed the offline self-check and then ended without a provider-readiness line or explicit exit code."
created: 2026-09-20T02:05:20.1925366+03:00
updated: 2026-09-20T02:30:00+03:00
---

## Current Focus

hypothesis: Confirmed and fixed offline — the preflight could block forever in an unbounded synchronous Convex child while backend function readiness was inconclusive, leaving terminal output and exit ownership to the external supervisor.
test: A future separately authorized standalone preflight against the named non-production deployment must emit exactly one canonical PASS or REFUSED line and terminate with exit 0 or 2 within the bounded readiness window.
expecting: A ready backend prints PASS/0; an unavailable or unsynchronized backend prints secret-safe REFUSED/2, with no budget or corpus activity.
next_action: Await separately authorized live verification; no external preflight rerun or backend startup is authorized here.

## Symptoms

expected: `--preflight` deterministically emits either a secret-safe readiness success/refusal line and exits explicitly after backend readiness checks, without opening a budget or loading a corpus.
actual: The command entered preflight, printed the offline self-check, then ended without provider readiness output or an explicit exit code while process 3210 had started from `packages/backend`.
errors: No provider-readiness line; local runner SHA `dfd9469a...` differed from the expected prior source identity.
reproduction: Offline/mocked only. Do not run live `--preflight`, Convex, corpus, or providers.
started: Observed after the 2026-09-20 settlement-race fix work.

## Eliminated

- hypothesis: pnpm stripped or corrupted `--preflight`
  evidence: The command printed the runner's offline self-check from inside the `--preflight` branch; parser self-checks also cover the forwarded bare `--` separator.
  timestamp: 2026-09-20T02:10:00+03:00

- hypothesis: top-level async fallthrough silently exited before readiness
  evidence: `requireProviderReadiness()` is synchronous and precedes `process.exit(0)` in the branch; a normal return must print PASS, while a normal throw reaches the top-level catch and prints an error.
  timestamp: 2026-09-20T02:11:00+03:00

- hypothesis: a stale or foreign runner was executed
  evidence: The logged runner SHA-256 `dfd9469a...` exactly matches the current clean `run-eval-golden.mjs` at source revision `77f8df8`; the differing older identity is expected because the settlement fix changed runner bytes and deliberately advanced evaluator identity.
  timestamp: 2026-09-20T02:12:00+03:00

## Evidence

- timestamp: 2026-09-20T02:09:00+03:00
  checked: immutable settlement-fix preflight record
  found: The backend listener existed, but the CLI session never emitted `Convex functions ready`; the runner then printed only its local self-check and no exit result.
  implication: The readiness query was attempted against a listener whose synchronized function readiness was inconclusive.

- timestamp: 2026-09-20T02:13:00+03:00
  checked: `smokeRun.mjs`
  found: Every Convex command uses `spawnSync` without `timeout` or `killSignal`; a non-responsive local backend can block indefinitely, leaving the runner no opportunity to print PASS, refusal, or an exit code.
  implication: Process supervision, not CLI parsing or provider logic, is the only source path consistent with the missing terminal output.

- timestamp: 2026-09-20T02:16:00+03:00
  checked: new mocked preflight and child-bound tests
  found: Tests fail because no standalone result wrapper or bounded Convex spawn option exists.
  implication: The red tests capture both missing lifecycle guarantees before implementation.

- timestamp: 2026-09-20T02:25:00+03:00
  checked: bounded child and standalone terminal wrapper tests
  found: Five tests pass, including an actual local non-responsive Node child terminated with `ETIMEDOUT`, canonical PASS/0, canonical redacted REFUSED/2, and invalid-timeout refusal.
  implication: The process can no longer hang silently, and backend errors cannot leak configuration details into the terminal verdict.

- timestamp: 2026-09-20T02:29:00+03:00
  checked: runner self-check, evaluator tests, targeted formatting, typechecks, and diff check
  found: The offline runner tripwire proves standalone preflight exits through the terminal wrapper before any budget/corpus/seed path; evaluator identity is advanced; all targeted checks pass.
  implication: Repository behavior is fixed offline without any Convex, provider, corpus, or deployment action.

## Resolution

root_cause: The preflight readiness query used `spawnSync` without a timeout or kill signal. Because the restarted local listener had not produced a conclusive functions-ready synchronization signal, its `convex run` child could block indefinitely. External supervision then ended the process before PASS/error output or the branch's `process.exit(0)`. CLI parsing, async fallthrough, and stale runner identity were eliminated.
fix: Added a finite 20-second timeout and deterministic SIGTERM for the readiness child, redacted its backend failure details, and routed standalone preflight through a terminal wrapper that synchronously writes exactly one canonical PASS or REFUSED line and returns exit 0 or 2. Added a self-check source-order tripwire proving this branch cannot reach budget/corpus paths. Advanced evaluator identity and manifest revision.
verification: Offline only. Mocked/direct tests prove PASS/0, redacted REFUSED/2, finite timeout configuration, invalid-timeout refusal, and real termination of a non-responsive local child. Runner self-check, evaluator/settlement tests, backend/contracts typechecks, targeted Biome, and diff-check pass. No live preflight, provider, Convex deployment, environment, corpus, budget, or cleanup action was invoked.
files_changed:
  - packages/backend/scripts/goldenProviderPreflight.mjs
  - packages/backend/scripts/goldenProviderPreflight.test.mjs
  - packages/backend/scripts/smokeRun.mjs
  - packages/backend/scripts/smokeRun.test.mjs
  - packages/backend/scripts/run-eval-golden.mjs
  - packages/backend/scripts/goldenEvaluatorIdentity.mjs
  - packages/backend/scripts/eval-suite-manifest.json
  - packages/contracts/src/skill.ts
