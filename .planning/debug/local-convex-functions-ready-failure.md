---
status: awaiting_human_verify
trigger: "Diagnose why the approved local Convex deployment emitted `Hit an error while running local deployment` and never reached functions-ready, blocking bounded golden preflight."
created: 2026-09-20T02:40:00+03:00
updated: 2026-09-20T09:38:15+03:00
---

## Current Focus

hypothesis: Confirmed — the initial `EACCES` was sandbox-only. The one escalated retry reached the exact named local deployment, and the process-local 300-second startup window permitted it to become functions-ready.
test: Read the emitted ready marker and query only `http://127.0.0.1:3210/instance_name` while leaving the authorized watcher running.
expecting: The marker names a successful functions-ready completion, and the endpoint returns `local-joel_feruzi-pikar_ai_50c69-1`.
next_action: Hand the running backend to the coordinator. Do not start preflight, corpus, provider calls, cleanup, configuration/source/state mutations, or any additional launch.

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

- timestamp: 2026-09-20T03:30:00+03:00
  checked: Existing local-run logs and listener/process state before the authorized launch
  found: The prior `convex-dev.stderr.log` ends at the known 30-second startup-timeout error; stdout is empty. No listener is present on port 3210 and no `convex*` process is running.
  implication: The authorized launch can target the named existing local deployment without displacing an active backend process.

- timestamp: 2026-09-20T09:32:56+03:00
  checked: One authorized launch from `packages/backend`, with `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=300` set only in that launch process
  found: The launcher (PID 17564) exited after about 2 seconds before emitting `Convex functions ready!`. Its redacted stderr says `Unexpected error when authorizing`, `TypeError: fetch failed`, and `connect EACCES 34.160.81.0:443`; stdout is empty.
  implication: The local-backend startup window was never reached or tested. This is a distinct remote-authorization/connectivity block, not evidence that the 300-second timeout is ineffective.

- timestamp: 2026-09-20T09:33:00+03:00
  checked: Post-exit process, port, endpoint, and log-integrity state
  found: No process named `convex` or `convex-local-backend` remains, port 3210 has no listener, and `/instance_name` is unavailable. Evidence is `packages/backend/.tmp/wave1-golden-20260920/launch-300s-20260920-093256/`; `stderr.log` SHA-256 is `4DD2A20394BCC5CFA26056BD0953F47E53284C0DEFAC2A79E7BC5167F0BBF02B` and `stdout.log` is the empty-file SHA-256.
  implication: No spawned backend needed manual termination, no local state was changed by the launch, and no ready target exists for preflight or corpus work.

- timestamp: 2026-09-20T09:35:00+03:00
  checked: Authorization boundary after the failed sandboxed launch
  found: The coordinating operator authorized exactly one repeat of the same launch using the required network escalation, because the observed `EACCES` occurred in the sandbox before any local backend process was created.
  implication: One escalated retry is within the original narrow launch scope; any further retry remains forbidden.

- timestamp: 2026-09-20T09:35:32+03:00 to 2026-09-20T09:37:57+03:00
  checked: The one authorized escalated launch from `packages/backend`, with `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=300` scoped only to launcher PID 5020
  found: The initial sandbox-only authorization block did not recur. The live launcher log reports the exact marker `√ 09:37:57 Convex functions ready! (1.21m)` after `Preparing Convex functions...`; it remains running and has moved to file watching.
  implication: The local backend was successfully relaunched within the authorized 300-second window. No retry is needed and the backend should remain available for the coordinator.

- timestamp: 2026-09-20T09:38:00+03:00
  checked: Only the target identity endpoint after functions-ready
  found: `http://127.0.0.1:3210/instance_name` returned `local-joel_feruzi-pikar_ai_50c69-1` exactly. The active launch evidence is `packages/backend/.tmp/wave1-golden-20260920/launch-300s-escalated-20260920-093532/stderr.log`; it is intentionally still locked by the live watcher.
  implication: The running service is the authorized named non-production target, not another local deployment.

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
verification: End-to-end launch verification now passes: after the sandbox-only attempt failed before startup, exactly one escalated retry reached `Convex functions ready! (1.21m)` and returned the exact `/instance_name` target. The watcher remains running. No preflight, corpus, provider call, or new evaluation/spend action was performed; no configuration/source/local-state mutation was made outside the normal existing `convex dev --run skills:seedSkills` launch behavior.
files_changed:
  - .planning/debug/local-convex-functions-ready-failure.md
