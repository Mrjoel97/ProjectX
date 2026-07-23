---
phase: 08-self-improvement
plan: 07
subsystem: optimizer
tags: [skillopt, python, github-actions, ci, offline-batch, dormant, IMPR-02]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: optimizerConfig.getOptimizerConfig kill switch (Plan 01) + optimizerEligibility breach query (Plan 03)
  - phase: 08-self-improvement
    provides: GET /skillopt/export scrubbed trajectory JSON contract (Plan 04)
  - phase: 08-self-improvement
    provides: POST /skillopt/writeback candidate write-back contract (Plan 05)
  - phase: 03.6-eval
    provides: run-eval-golden.mjs — the convex run llm:runCockpitAgent invocation rollout.py replicates
provides:
  - skillopt/envs/pikar_cockpit — the SkillOpt env package (dataloader/rollout/adapter/config/initial)
  - .github/workflows/skillopt.yml — dormant, kill-switch + eligibility-gated CI batch runner
affects: [08-08 dry-run (verifies the SkillOpt YAML split keys + runs the pipeline via workflow_dispatch), 08-08 playbook §9 sweep]

# Tech tracking
tech-stack:
  added:
    - "skillopt==0.2.0 (Python, pinned EXACT — pre-1.0, CLAUDE.md §6; Python CI side only, never the request path)"
  patterns:
    - "Offline CI batch optimizer (no sidecar) — GitHub Actions cron + workflow_dispatch, ships DORMANT (SKILLOPT.md 2026-07-12 revision)"
    - "rollout scores edits by EXECUTING the real cockpit skill via `convex run llm:runCockpitAgent` (node-direct subprocess, output-not-exit-code) — no second engine (RESEARCH Pitfall 3/6)"
    - "Two-gate CI: kill switch (optimizerConfig.enabled) THEN eligibility (breach-only cron, workflow_dispatch bypasses) before any spend"
    - "skillopt/adapter/dataloader import-shim to `object` when skillopt is absent — module still loads for the offline self-check/lint"

key-files:
  created:
    - skillopt/envs/pikar_cockpit/__init__.py
    - skillopt/envs/pikar_cockpit/dataloader.py
    - skillopt/envs/pikar_cockpit/rollout.py
    - skillopt/envs/pikar_cockpit/adapter.py
    - skillopt/envs/pikar_cockpit/configs/pikar_cockpit/default.yaml
    - skillopt/envs/pikar_cockpit/skills/initial.md
    - skillopt/requirements.txt
    - .github/workflows/skillopt.yml
  modified: []

key-decisions:
  - "Split selected from the path BASENAME (norm valid_unseen->valid), not a hardcoded YAML key — correct-by-contract even though the exact v0.2.0 split-path key names are LOW-confidence (verified in the 08-08 dry-run)"
  - "rollout mints its pinnable candidate via POST /skillopt/writeback (the only body->version seam that exists) once per run_batch; ponytail-flagged that a dedicated ephemeral no-notify dev-pin is the upgrade path if a real cadence makes the per-edit audit/notify noise matter"
  - "hard = the exported thumbs reward (RESEARCH OQ1); soft = a light plan-state completeness proxy (status/subject/body/recipients, the shape eval:golden asserts) — gives SkillOpt a per-item reward while forcing real execution"
  - "on: key quoted so YAML keeps the string 'on' (unquoted parses to boolean true); GitHub accepts both"
  - "eval evidence step uses the named `pnpm --filter @pikar/backend eval:golden --skill` script (the shipped EVAL_GATE input), not a re-implementation"

patterns-established:
  - "A Python CI env package glued to Convex ONLY by URL/CLI contracts (export/writeback endpoints + convex run) — imports zero TS, so it shares no files with any TS plan"

requirements-completed: [IMPR-02]

# Metrics
duration: ~25min
completed: 2026-07-24
---

# Phase 8 Plan 07: SkillOpt Offline Batch Runner Summary

**The offline SkillOpt deployment (IMPR-02): a Python env package (`skillopt/envs/pikar_cockpit/`) that loads the scrubbed `/skillopt/export` JSON, scores candidate skill edits by executing the REAL cockpit skill via `convex run llm:runCockpitAgent` (no second engine), plus a GitHub Actions runner that ships DORMANT behind a kill-switch gate and a breach-only eligibility gate — a batch job, never a hosted sidecar.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 8 (8 created, 0 modified)

## Accomplishments

- **`skillopt/envs/pikar_cockpit/` env package (v0.2.0 contract):**
  - `dataloader.py` — `PikarCockpitDataLoader(SplitDataLoader).load_split_items(split_path)` reads the Plan-08-04 export JSON (`{ skillName, items:[{ id, task_description, conversation, hard, soft, skillVersion, split }] }`) and returns the items whose exported `split` matches the split the PATH names (`norm valid_unseen->valid`). Pure `partition`/`split_of_path`/`read_split_items` helpers keep the logic testable without skillopt installed. A `__main__` self-check asserts the split partition of a tiny inline fixture matches the export `split` field (no network, no SkillOpt).
  - `rollout.py` — `run_batch(*, items, skill_content, out_root, workers=4, max_completion_tokens=4096)` mints `skill_content` as a pinnable candidate via `POST /skillopt/writeback`, then for each item seeds a fresh cockpit plan and drives the item's user turns through `convex run llm:runCockpitAgent` with `skillVersions` pinned to the candidate — invoking **node directly** (no shell; tenantIds carry `|`), judging success by **stdout JSON not exit code** (mirrors `smokeRun.mjs must()`). Persists `<out_root>/predictions/<id>/conversation.json` and returns `{ id, hard (exported thumbs), soft (plan-state health) }`.
  - `adapter.py` — thin `PikarCockpitAdapter(EnvAdapter)` (`build_train_env`/`build_eval_env`/`rollout`/`get_task_types`) delegating to the loader + `run_batch`.
  - `configs/pikar_cockpit/default.yaml` — conservative hyperparameters (LOW edit budget, TINY valid split) copied from the upstream `searchqa` template shape; the split-path keys are flagged verified-in-dry-run.
  - `skills/initial.md` — a placeholder noting the active `cockpit-agent` body is fetched at run start (no hardcoded prompt, CLAUDE.md §5).
  - `requirements.txt` — `skillopt==0.2.0` pinned EXACT (pre-1.0, CLAUDE.md §6); rollout/dataloader use only the Python stdlib.
- **`.github/workflows/skillopt.yml` — dormant, two-gate CI batch runner:**
  - `on: { schedule: weekly cron, workflow_dispatch }`.
  - **GATE 1 (kill switch, first step):** reads `optimizerConfig.getOptimizerConfig` via `convex run`; when `enabled` is false (the ship default) it echoes "optimizer dormant" and short-circuits the pipeline — belt-and-suspenders to a disabled schedule.
  - **GATE 2 (eligibility):** a scheduled cron proceeds ONLY when `optimizerEligibility.optimizerEligibility` reports `eligible===true` (a breach); `workflow_dispatch` BYPASSES eligibility for manual dry-runs — so the cron is a breach-triggered loop, never a disguised nightly sleep (08-CONTEXT defers SkillOpt-Sleep).
  - **Pipeline (only when enabled AND (dispatched OR eligible)):** `pip install`, `GET /skillopt/export`, fetch the active body into `initial.md`, `train.py`, `POST /skillopt/writeback` (gated candidate), then `pnpm eval:golden --skill cockpit-agent@<toVersion>` to record the EVAL_GATE evidence. The golden `eval-cases/*.json` are never an export/train source.

## Task Commits

1. **Task 1: pikar_cockpit SkillOpt env package** — `0ed681a` (feat)
2. **Task 2: GitHub Actions batch runner (dormant, kill-switch gated)** — `3d8c1b3` (feat)

## Files Created/Modified

- `skillopt/envs/pikar_cockpit/dataloader.py` — `SplitDataLoader` over the export JSON + pure split helpers + `__main__` self-check.
- `skillopt/envs/pikar_cockpit/rollout.py` — `run_batch` scoring via `convex run llm:runCockpitAgent` (node-direct, output-not-exit-code).
- `skillopt/envs/pikar_cockpit/adapter.py` — thin `EnvAdapter` wiring.
- `skillopt/envs/pikar_cockpit/configs/pikar_cockpit/default.yaml` — conservative hyperparameters (searchqa template shape).
- `skillopt/envs/pikar_cockpit/skills/initial.md` — run-start-fetched active body note (no hardcoded prompt).
- `skillopt/envs/pikar_cockpit/__init__.py` — package exports.
- `skillopt/requirements.txt` — `skillopt==0.2.0` pinned exact.
- `.github/workflows/skillopt.yml` — dormant, kill-switch + eligibility-gated CI batch runner.

## Decisions Made

- **Split by path basename, not a pinned YAML key** — the exact v0.2.0 split-path key names are LOW-confidence (RESEARCH OQ2). The loader normalizes the split off the path (`valid_unseen->valid`), so a key-name fix at the 08-08 dry-run needs no loader change. Correct-by-contract.
- **rollout pins via `/skillopt/writeback`** — the only existing body->version seam; minted once per `run_batch`. ponytail-flagged that this writes an audit row + owner notification per candidate, an accepted ceiling for the dormant dry-run (low edit budget), with a dedicated ephemeral no-notify dev-pin as the upgrade path.
- **`hard` = exported thumbs, `soft` = plan-state health** — the thumbs is the reward (OQ1); `soft` is a light completeness proxy that also forces the rollout to actually execute the skill (Pitfall 3), rather than static-replay.
- **Import shim to `object`** — dataloader/adapter fall back to `object` as the base when skillopt is not installed, so `python dataloader.py` runs the self-check offline and the parse-check lints clean without a CI-only dependency.

## Deviations from Plan

None — plan executed as written. Two correct-by-contract mechanical choices worth noting: the `on:` key is quoted so `yaml.safe_load` keeps the string key (unquoted `on` parses to boolean `true` — the plan's verify anticipated this with a `d[True]` fallback, but a raised `KeyError` on the left branch would still fail; quoting is the robust fix GitHub also accepts), and the eval-evidence step uses the named `pnpm --filter @pikar/backend eval:golden` script rather than a bare `pnpm eval:golden` (the script lives in `@pikar/backend`).

## Issues Encountered

- **skillopt is not installed in this dev env** — expected (it is a CI-only pip dependency). The env package is written correct-by-contract against the documented v0.2.0 interfaces + the pinned TS export/writeback contracts; the exact SkillOpt YAML split keys + base-class signatures are ponytail-flagged for verification in the 08-08 dry-run (which runs the pipeline via `workflow_dispatch`).
- **The runner is DORMANT and NOT armed this phase** — its live correctness (real `/skillopt/export` pull, real train, real writeback + eval-golden) is confirmed by the Plan 08-08 dry-run, not here. Offline verification only: Python parses + dataloader self-check green + `skillopt.yml` is valid YAML with `workflow_dispatch`.

## Verification

- `python skillopt/envs/pikar_cockpit/dataloader.py` → **`dataloader self-check PASSED`** (split partition matches the export `split` field; `valid_unseen` normalizes to `valid`).
- `python -c "ast.parse ... *.py"` → **`PY_OK`** (all four package modules parse).
- `python -c "yaml.safe_load(...skillopt.yml); assert 'workflow_dispatch' in d['on']; assert 'schedule' in d['on']"` → **`YML_OK`** (valid YAML, cron + workflow_dispatch present).

## User Setup Required

- Repo secrets before the CI job can run (all owner's own deployment): `CONVEX_DEPLOY_KEY`, `SKILLOPT_TOKEN`, `SKILLOPT_HTTP_URL` (the deployment `.convex.site` base), `OPENAI_API_KEY`. Until set, the runner cannot reach the gates/endpoints — but it also ships DORMANT (kill switch default OFF), so an unconfigured run is a no-op.

## Next Phase Readiness

- 08-08 dry-run can run the whole pipeline via `workflow_dispatch` (bypassing eligibility): pull `/skillopt/export`, verify the exact SkillOpt YAML split keys + `EnvAdapter`/`SplitDataLoader` base signatures, train a tiny run, write back a candidate, run `eval:golden`, then owner-activate — the end-to-end proof-of-life.
- **Playbook/watch.json for all of Phase 8 remain centralized in Plan 08-08** (deliberately untouched here — the new `skillopt/` + `.github/` paths are registered by the 08-08 §9 sweep; the check-playbooks hook self-clears on the second stop).

## Self-Check: PASSED

All eight created files exist on disk and both task commits (`0ed681a`, `3d8c1b3`) are in git history.

---
*Phase: 08-self-improvement*
*Completed: 2026-07-24*
