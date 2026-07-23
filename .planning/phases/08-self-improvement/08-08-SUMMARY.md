---
phase: 08-self-improvement
plan: 08
subsystem: skill-registry / self-improvement
status: paused-at-checkpoint
tags: [playbook, definition-of-done, skillopt, write-back, phase-close]
requires:
  - "All Phase-8 code plans (08-01..08-07): feedback, optimizerConfig/eligibility, skilloptExport, insertCandidate/activateCandidate, http /skillopt routes, notificationTemplates optimizer.candidate, the skillopt/ Python env + CI workflow"
provides:
  - "docs/playbooks/skill-registry.md — the SkillOpt write-back loop + candidate provenance + kill-switch documentation + Phase-9 blockers section"
  - "docs/playbooks/watch.json — §9 Stop-hook coverage for the new Phase-8 source paths"
affects:
  - "The §9 playbook Stop hook (now clears against the Phase-8 baseline)"
tech-stack:
  added: []
  patterns:
    - "Candidate-provenance chain: POST /skillopt/writeback -> skills.insertCandidate (CANDIDATE-only) -> owner activateCandidate/activateSkill through EVAL_GATE (never a raw patch)"
    - "Optimizer kill switch: optimizerConfig.enabled default OFF/dormant"
key-files:
  created:
    - .planning/phases/08-self-improvement/08-08-SUMMARY.md
  modified:
    - docs/playbooks/skill-registry.md
    - docs/playbooks/watch.json
    - docs/playbooks/cockpit.md
    - docs/playbooks/audit-dead-letter.md
decisions:
  - "watch.json coverage for the new Phase-8 paths lives under skill-registry.md's entry (the playbook that documents the loop) — no separate self-improvement.md playbook file, which would break the hook's playbook-filename key contract. http.ts stays under cockpit.md (already watched), notificationTemplates.ts under audit-dead-letter.md (already watched)."
  - "Phase-9 blockers (ops-surface owner-authorization, PII names-in-prose, deployment env config) recorded as an explicit gating section in the playbook, NOT fixed here — owner-approved deferrals for single-owner beta."
metrics:
  tasks_completed: 1
  tasks_total: 2
  files_touched: 4
  completed_date: "2026-07-24"
---

# Phase 8 Plan 08: Phase Close (playbook DoD + proof-of-life dry-run) Summary

**One-liner:** Documented the Phase-8 SkillOpt write-back loop in the skill-registry playbook (candidate provenance, kill switch, refs/counts-only optimization audit, Phase-9 blockers) and registered the new source paths under the §9 Stop hook; the owner-run cockpit-agent dry-run (proof-of-life) is a pending checkpoint.

## Status

- **Task 1 (autonomous — the §9 definition-of-done sweep): DONE + committed** (`f86ba11`).
- **Task 2 (manual cockpit-agent dry-run + feedback-UI walkthrough): AWAITING OWNER** — a `checkpoint:human-verify`. It requires the owner + deployment env (`SKILLOPT_TOKEN`, `SKILLOPT_OWNER_TENANT`) + Python (`pip install skillopt==0.2.0`) + seeding synthetic trajectories. Not run; no result fabricated.

## What was done (Task 1)

- **`docs/playbooks/skill-registry.md`** — new "## Phase 8: SkillOpt write-back loop (self-improvement)" section:
  - The full loop: feedback capture (`feedback.ts`) → breach eligibility (`optimizerEligibility.ts` + pure `optimizerBreach.ts`) → scrubbed export (`skilloptExport.ts` / `GET /skillopt/export`) → SkillOpt CI batch (`skillopt/`, `.github/workflows/skillopt.yml`) → candidate write-back → eval gate → owner activate.
  - **Candidate provenance:** `POST /skillopt/writeback` → `skills.insertCandidate` (CANDIDATE-only, gated names only, idempotent vs newest) → owner `skills.activateCandidate`/`activateSkill` through the SAME `EVAL_GATE` — never a raw patch to `active`.
  - **Optimization audit row shape:** `{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}` — refs/counts ONLY (§3 insert-only / §4 no-content).
  - **Kill switch:** `optimizerConfig.enabled` default OFF (dormant on read); `setOptimizerEnabled` writes it, the CI job reads-and-obeys it first.
  - **Cross-tenant IDOR fix (commit d67802d):** write-back audit/notify tenant comes from `SKILLOPT_OWNER_TENANT` env, never the request body.
  - **Phase-9 blockers section** (owner-approved deferral 2026-07-24): (a) ops-surface owner-authorization — `setOptimizerEnabled`/`activateCandidate`/`candidatesForReview` callable by any authenticated tenant (no owner-role primitive yet), Phase 9 must add `requireOwner()`; (b) PII names-in-prose — `scanText` scrubs structured PII only, names in free prose survive the export (hard blocker before multi-user); (c) deployment env config — `SKILLOPT_TOKEN` + `SKILLOPT_OWNER_TENANT` must be set on the deployment before the loop runs.
  - `Last verified` line bumped.
- **`docs/playbooks/watch.json`** — under the `skill-registry.md` entry, registered: `feedback.ts`, `optimizerConfig.ts`, `optimizerEligibility.ts`, `skilloptExport.ts`, `packages/core/src/optimizerBreach.ts`, `skillopt/`, `.github/workflows/skillopt.yml`.
- **`docs/playbooks/cockpit.md`** — `Last verified` bump (Phase 8 touched watched `cockpit.ts` skill-version attribution + `http.ts` /skillopt routes).
- **`docs/playbooks/audit-dead-letter.md`** — `Last verified` bump (Phase 8 touched watched `notificationTemplates.ts` optimizer.candidate kind + `packages/pii/` as the export scrubber).

## Verification (Task 1)

- `node scripts/check-playbooks.mjs` → exit 0.
- `python -c "import json; json.load(...watch.json...)"` → `WATCH_OK`.

## Deviations from Plan

None — Task 1 executed as written. `http.ts` was already watched under `cockpit.md`, so it was not duplicated under `skill-registry.md` (the plan noted it "isn't currently watched" — it is, via cockpit.md; coverage is satisfied).

## Task 2 — Owner checkpoint (NOT executed)

See the CHECKPOINT block returned to the orchestrator. The dry-run is RESEARCH § "Manual cockpit-agent dry-run" steps 1–6 (export → SkillOpt → candidate write-back → eval green → owner activate → active flips → rollback restores → kill switch dormant). Resume signal: owner types "approved" once the dry-run flips the active version and rollback restores it (or describes what broke).

## Self-Check: PASSED

- FOUND: docs/playbooks/skill-registry.md (modified), docs/playbooks/watch.json (modified), docs/playbooks/cockpit.md (modified), docs/playbooks/audit-dead-letter.md (modified)
- FOUND commit: f86ba11
