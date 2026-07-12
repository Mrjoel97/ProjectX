# SkillOpt Adoption — Core Skills Setup & Optimization Layer

**Decided:** 2026-07-09 (owner mandate)
**Source:** https://github.com/microsoft/SkillOpt (Microsoft, MIT, v0.2.0 2026-07-02, paper arXiv:2605.23904)
**Confidence:** HIGH on concept/fit (README + paper abstract verified); implementation-level details (API surface, config schema) to be verified during Phase 8 planning research.

## What It Is

SkillOpt optimizes natural-language instruction documents ("skills", 300–2,000-token markdown) for frozen LLMs the way neural nets are trained: rollout → reflect (scored trajectories) → aggregate → select → bounded text edits by an optimizer model → **accept only if held-out validation improves** → track test performance. Textual learning-rate budgets and rejected-edit buffers provide stability. `skillopt_sleep` runs offline nightly self-evolution from experience replay. Deployment artifact is a static `best_skill.md` — zero inference-time overhead.

## Role in Pikar-AI

1. **Skills registry (Phase 1 constraint, from day one):** every agent prompt — Executive Agent classifier/planner, sub-agents, brief-writer, onboarding guide — is a versioned skill document stored in a Convex `skills` table (name, version, body, status: active/candidate/rolled-back, evidence ref). Agents load their active skill at runtime. **No hardcoded agent prompts anywhere.** This realizes the original spec's "skills registry" concept.
2. **Optimization layer (Phase 8):** SkillOpt runs as a Python batch job (*deployment model revised — see the 2026-07-12 update below*), scheduled nightly (SkillOpt-Sleep pattern) and/or on feedback-threshold breach (IMPR-02). Inputs: scored trajectories derived from user feedback (IMPR-01), review outcomes (approve/edit/reject deltas), and telemetry. Held-out validation set gates every edit — this **is** the "automated eval check" IMPR-02 requires, satisfying the autonomous-optimization decision with peer-reviewed guardrails instead of hand-rolled evals.
3. **Versioning & rollback (IMPR-03):** SkillOpt's accepted/rejected edit history maps directly to the required before/after versions + triggering evidence; one-click rollback = re-activating the prior skill version in the registry; kill switch = disabling the optimizer schedule.

## Requirement Mapping

| Requirement | SkillOpt contribution |
|---|---|
| IMPR-01 | Feedback becomes rollout scoring signal |
| IMPR-02 | Rollout→reflect→update loop; held-out validation gate = the eval gate; autonomous per owner decision |
| IMPR-03 | Native skill versioning + evidence; registry stores history |
| AGNT-01/02 (indirect) | Executive Agent behavior defined by registry skill docs, so it is optimizable |

## Phase Impact

- **Phase 1 (Foundation):** add `skills` registry table + loader contract to the substrate; seed initial skill documents for the Executive Agent. (Small, cheap now; expensive to retrofit.)
- **Phase 2–7:** agents consume registry skills; every new agent ships as a skill document.
- **Phase 8 (Self-Improvement):** integrate SkillOpt sidecar: trajectory export, benchmark/env contract for Pikar tasks (`dataloader.py`, `rollout.py`, `initial.md`), validation-set curation, nightly sleep schedule, registry write-back, rollback + kill switch. Phase-8 planning research must verify current SkillOpt API/config specifics.

## Update (2026-07-12) — deployment model: no-sidecar batch runner

The original assumption ("third Python sidecar, with Presidio and graphify") is stale:
the PRD dropped the Python-sidecar plane on 2026-07-12 (PII went pure-TS in
`packages/pii`; see `.planning/design/pii-engine.md`). If Phase 8 stood up a hosted
sidecar, SkillOpt would carry that whole platform cost **alone**.

It doesn't need to. SkillOpt is an **offline nightly batch job**, not a live service:
it reads scored trajectories, runs the rollout→reflect→edit→held-out-validation loop,
and emits a static `best_skill.md`. Zero request-path involvement. Phase 8 planning
should therefore default to a **scheduled batch runner — a GitHub Actions cron (or
local cron) running the Python tool — that pulls trajectory exports and writes the
accepted skill version back to the Convex registry via an authenticated HTTP endpoint
(`convex/http.ts`)**. No hosted Python service, no container platform, no cold-start
or monitoring surface; the kill switch is disabling the schedule, and rollback stays
`activateSkill` on the prior version, both unchanged.

Escalate to a hosted sidecar only if a real need appears (e.g. optimization runs need
private-network access to data that can't flow through an export endpoint, or run
frequency outgrows CI job limits). ponytail: batch-over-service is the ladder answer —
the service exists only in the original assumption, not in SkillOpt's requirements.

## Risks / Notes

- ~~Python 3.10+ sidecar; same deployment class as Presidio/graphify (container host).~~ Superseded by the 2026-07-12 update above: Python 3.10+ **batch runner** (CI cron), no container host. Trajectory-export + registry write-back endpoints become the Phase 8 integration surface.
- Validation-set quality determines everything — curate held-out Pikar tasks the optimizer never sees.
- SkillOpt optimizes per-skill; per-user personalization (from FEATURES.md differentiators) can be layered later as per-tenant skill variants — defer until data volume justifies it.
