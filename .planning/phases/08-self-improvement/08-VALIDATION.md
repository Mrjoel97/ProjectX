---
phase: 8
slug: self-improvement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `08-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (backend `*.test.ts`, colocated), edge-runtime env |
| **Config file** | `packages/backend/vitest.config.ts` (exists) |
| **Quick run command** | `pnpm --filter @pikar/backend test <file>` |
| **Full suite command** | `pnpm --filter @pikar/backend test` + `pnpm eval:golden` |
| **Eval harness** | `packages/backend/scripts/run-eval-golden.mjs` — live-model, plan-state assertions, `--skill` pin, `$1.00` cap; `--self-check` for zero-convex offline |
| **PII unit** | `packages/pii/src/scan.test.ts` (exists) |
| **Estimated runtime** | ~15s unit; eval:golden ~minutes + live cost |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/backend test <touched file>`
- **After every plan wave:** Run `pnpm --filter @pikar/backend test` (full backend)
- **Before `/gsd:verify-work`:** Full suite green + the manual cockpit-agent dry-run performed
- **Max feedback latency:** ~15s (unit); eval:golden is gate-only, not per-commit

---

## Per-Requirement Verification Map

Seeded at requirement level from research; the planner/executor expands to per-task rows.

| Req / Criterion | Observable proof | Test Type | Automated Command | Exists | Status |
|-----------------|------------------|-----------|-------------------|--------|--------|
| IMPR-01 capture | thumbs±comment insert → tenant-scoped `feedback` row keyed requestId+skillName+skillVersion; edit/undo mutates same row | unit | `pnpm --filter @pikar/backend test feedback` | ❌ W0 | ⬜ |
| IMPR-01 attribution | `plans.skillVersion` set at propose; copied to `requests` at executePlan | unit | `pnpm --filter @pikar/backend test cockpit` | ❌ W0 | ⬜ |
| IMPR-01 UI | control renders on delivered PlanCard/request row; BRAND-compliant + a11y | manual + offline E2E | dev UI walkthrough | ❌ W0 (manual) | ⬜ |
| IMPR-02 trigger | breach query `eligible=true` only when negativeRate≥threshold AND count≥floor AND past cooldown; below floor → false | unit | `pnpm --filter @pikar/backend test optimizerEligibility` | ❌ W0 | ⬜ |
| IMPR-02 export scrub | export emits only `safeText`+counts; seeded email/SSN/phone absent; scan error drops the trajectory | unit | `pnpm --filter @pikar/backend test skilloptExport` | ❌ W0 | ⬜ |
| IMPR-02 write-back | POST inserts `status="candidate"`, `version=maxVer+1`, prior rows immutable; non-gated name rejected; idempotent | unit | `pnpm --filter @pikar/backend test skills` | ⚠ partial | ⬜ |
| IMPR-02 eval gate | `eval:golden --skill cockpit-agent@N` green → evidence recorded; `activateSkill` refuses candidate w/o evidence | eval-fixture + unit | `pnpm eval:golden --skill cockpit-agent@N` | ✅ | ⬜ |
| IMPR-02 kill switch | `optimizerConfig.enabled=false` → CI no-ops at step 1; ops toggle flips it | unit + manual | `pnpm --filter @pikar/backend test optimizerConfig` | ❌ W0 | ⬜ |
| IMPR-02 rollback | `activateSkill(prior)` reactivates without an eval run (status-exempt) | unit | `pnpm --filter @pikar/backend test skills` | ✅ | ⬜ |
| IMPR-03 versioning | each optimization = new candidate row (before=prior active, after=candidate); insert-only `audit` row carries refs/counts only (§4) | unit | `pnpm --filter @pikar/backend test skills audit` | ⚠ partial | ⬜ |
| Proof-of-life | ONE manual cockpit-agent dry-run: export → SkillOpt → best_skill.md → write-back candidate → eval green → owner activate → active flips | manual dry-run | end-to-end, owner-verified | ❌ Wave 6 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Held-out Set Partitioning

Three disjoint sets — the partition **is** the "optimizer never sees it" guarantee:

1. **SkillOpt TRAIN split** — scrubbed-export trajectories the optimizer reads/edits from. Deterministic partition (`hash(requestId) % k`).
2. **SkillOpt VALIDATION split (`valid_unseen`)** — disjoint slice of the same export gating each edit *inside* SkillOpt; optimizer model never trains on it.
3. **Pikar GOLDEN gate (`eval-cases/*.json`)** — the 23 in-repo scripted cases, **never exported to SkillOpt**. The truly-independent third gate that records `EVAL_GATE` evidence for `activateSkill`; lives only in repo/CI, structurally unseeable by the optimizer.

---

## Wave 0 Requirements

- [ ] `feedback` table + `packages/backend/convex/feedback.test.ts` — IMPR-01
- [ ] `plans.skillVersion` field + copy-to-`requests` + test — IMPR-01 attribution
- [ ] `optimizerEligibility` breach query + pure threshold fn + test — IMPR-02 trigger
- [ ] `/skillopt/export` httpAction + PII scrub + `skilloptExport.test.ts` — IMPR-02 export
- [ ] `skills.insertCandidate` mutation + test — IMPR-02 write-back
- [ ] `optimizerConfig` single-row (default OFF) + test — IMPR-02 kill switch
- [ ] `audit` optimization-event assertion — IMPR-03 evidence trail
- [ ] Python `skillopt/envs/pikar_cockpit/` package (`dataloader.py`, `rollout.py`, `adapter.py`, `configs/…/default.yaml`, `skills/initial.md`) — CI glue
- [ ] `.github/workflows/skillopt.yml` (cron + `workflow_dispatch`, reads `optimizerConfig.enabled`)
- [ ] CI framework install: `pip install skillopt==0.2.0`
- [ ] Playbook: extend `docs/playbooks/skill-registry.md` (write-back + candidate provenance) + register new watched paths in `watch.json` (§9); read `docs/design/BRAND.md` before the feedback UI (§10)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Feedback control render + a11y | IMPR-01 UI | No connected E2E creds; live paint owed | Dev UI walkthrough on delivered PlanCard/request row |
| cockpit-agent dry-run (proof-of-life) | IMPR-02 (whole seam) | SkillOpt is a Python CI job; end-to-end crosses TS↔Python↔registry | Research § "Manual cockpit-agent dry-run" steps 1–6; owner-verified |
| Kill-switch dormancy | IMPR-02 | Ships dormant; verifying "no autonomous run" is an absence | Confirm `optimizerConfig.enabled=false` and CI job no-ops on schedule |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
