---
status: awaiting_human_verify
trigger: "Diagnose why the approved local Convex deployment emitted `Hit an error while running local deployment` and never reached functions-ready, blocking bounded golden preflight."
created: 2026-09-20T02:40:00+03:00
updated: 2026-09-20T03:12:00+03:00
---

## Current Focus

hypothesis: Confirmed — the launch omitted the process-scoped startup-timeout override required by this unusually large local deployment, so Convex killed its child after the built-in 30-second backend-start window, before function analysis or synchronization began.
test: On the next separately authorized launch, set `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=300` for that process only, start from `packages/backend`, and wait for the exact `Convex functions ready!` marker without starting preflight or corpus automatically.
expecting: The backend's `/instance_name` endpoint becomes available inside 300 seconds and the subsequent function push reaches ready; otherwise preserve the verbose launch logs and diagnose the new concrete terminal error.
next_action: Human/operator performs the bounded 300-second launch and confirms the exact functions-ready marker. A standalone bounded preflight remains a separate authorized step; corpus remains forbidden unless preflight passes and fresh run authority exists.

## Symptoms

expected: Launching the named local deployment from `packages/backend` reaches `Convex functions ready`, after which bounded preflight returns PASS or a provider-configuration refusal.
actual: The approved target at `:3210` emitted `Hit an error while running local deployment` / a generic reported-to-team error and never emitted functions-ready. Bounded preflight correctly returned REFUSED/2; corpus and spend remained zero.
errors: `Hit an error while running local deployment`; generic already-reported error.
reproduction: Read-only/offline evidence only. Do not start or synchronize Convex.
started: Observed on 2026-09-20 during the bounded settlement-fix preflight attempt.

## Eliminated

- hypothesis: A TypeScript test file or concurrent source edit caused Convex function preparation to retry indefinitely.
  evidence: The current `convex/tsconfig.json` already excludes `./**/*.test.ts`; this incident never reached function preparation and instead terminated at the backend-process startup gate.
  timestamp: 2026-09-20T03:03:00+03:00

- hypothesis: A repository bundle, schema, or function-analysis error caused the generic reported-to-team message.
  evidence: The immediately preceding concrete CLI error is `Local backend did not start on port 3210 within 30 seconds`; installed Convex source emits the generic wrapper only after `ensureBackendRunning` exhausts that startup window.
  timestamp: 2026-09-20T03:05:00+03:00

- hypothesis: Bounded golden preflight opened a budget or entered the corpus before refusing.
  evidence: The immutable preflight log prints `provider preflight REFUSED (secret-safe; no budget opened)` and exits 2 after the offline self-check; it contains no case execution or budget-open marker.
  timestamp: 2026-09-20T03:07:00+03:00

## Evidence

- timestamp: 2026-09-20T02:48:00+03:00
  checked: `packages/backend/.tmp/wave1-golden-20260920/convex-dev.stderr.log`
  found: The log says `waiting for local backend to start...` followed by `Local backend did not start on port 3210 within 30 seconds`, then the generic local-deployment/reporting lines. File timestamps span 02:34:30–02:35:06, consistent with the bounded startup failure.
  implication: This is a backend-process readiness timeout, not a function-ready timeout and not a provider failure.

- timestamp: 2026-09-20T02:51:00+03:00
  checked: Installed Convex 1.42.1 source at `node_modules/convex/src/cli/lib/localDeployment/run.ts`
  found: `DEFAULT_STARTUP_TIMEOUT_SECS` is 30. `ensureBackendRunning` polls `http://127.0.0.1:3210/instance_name` every 500 ms and raises the exact observed message when the window expires. `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS` is the supported override.
  implication: The mechanism and repair knob are deterministic and repository-independent; the generic follow-up message does not imply an unknown Convex failure.

- timestamp: 2026-09-20T02:55:00+03:00
  checked: Local deployment metadata and storage sizes, without reading or printing secret values
  found: SQLite is 1,239,052,288 bytes. Exports, files, modules, search, and snapshot-import storage total another 21,539,731,830 bytes across 39,238 files; total on-disk state measured is 22,778,784,118 bytes (about 21.2 GiB). Config key names identify the expected local deployment metadata; no secret values were emitted.
  implication: Convex's own large-database warning directly applies, and a 30-second cold-start expectation is not credible for this state.

- timestamp: 2026-09-20T02:58:00+03:00
  checked: Same-deployment historical Convex logs under `.tmp/17.1-10-golden` and the resolved `convex-local-backend-preparing-functions` debug record
  found: Successful functions-ready durations were 1.46m, 2.37m, 2.6m, and 3.41m. Earlier operators explicitly required a 180-second override when the database was smaller; the 3.41-minute proof already exceeds 180 seconds.
  implication: Every observed successful startup exceeds 30 seconds. A 300-second process-scoped window covers the slowest recorded successful launch with bounded headroom.

- timestamp: 2026-09-20T03:00:00+03:00
  checked: `packages/backend/convex/tsconfig.json` and archived retry diagnosis
  found: The historical function-preparation bug was fixed by excluding tests, and that exclusion is present now. The current log has no `Preparing Convex functions`, filesystem-change retry, bundle, typecheck, schema, or analysis error.
  implication: Reverting or changing application/function source cannot address this incident; the failure is launch configuration against heavyweight runtime state.

- timestamp: 2026-09-20T03:07:00+03:00
  checked: `bounded-preflight.log` and SHA-256
  found: SHA-256 is `9B5DEA7511468A80A49B7DF627ACA1957635B00545A921E16CAEDD46AD34A87E`. It records offline self-check PASS, provider preflight REFUSED, no budget opened, and exit code 2.
  implication: The preflight guard behaved correctly after the backend failed to become ready; corpus count and spend stayed zero.

- timestamp: 2026-09-20T03:09:00+03:00
  checked: Repository launch configuration and prior operator notes
  found: `packages/backend/package.json` invokes bare `convex dev --run skills:seedSkills`, while multiple repository records already document that this deployment requires `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS`; one existing probe independently defaults it to 180 seconds. The failed invocation demonstrably used 30 seconds.
  implication: The immediate repair is operational and process-scoped. Do not mutate `.env`, local state, or application source merely to extend the CLI child-start window.

## Resolution

root_cause: The approved Convex launch used the CLI's default 30-second local-backend startup window. The named deployment now has about 21.2 GiB of on-disk runtime state and historically needs 1.46–3.41 minutes to reach functions-ready. Convex therefore terminated its child at the `/instance_name` readiness gate before function analysis/sync. The later generic reported-to-team line merely wrapped this explicit timeout.
fix: No repository application-source change is indicated. For the next separately authorized attempt, set `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=300` only in the launch process, invoke the existing backend dev command from `packages/backend`, and wait for the exact functions-ready marker. Do not use `--start-fresh`, delete state, edit `.env`, or chain preflight/corpus to startup. After ready, verify the named `/instance_name`; run standalone bounded preflight only under its own authority, and run corpus only after PASS plus fresh explicit authorization.
verification: Offline mechanism verification is complete: exact log/CLI-source match, runtime-size measurement, current tsconfig inspection, immutable preflight hash, and four same-deployment successful-duration comparisons. End-to-end runtime verification intentionally remains pending because backend start/sync was prohibited in this investigation.
files_changed:
  - .planning/debug/local-convex-functions-ready-failure.md
