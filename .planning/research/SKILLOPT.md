# SkillOpt Adoption — Core Skills Setup & Optimization Layer

**Decided:** 2026-07-09 (owner mandate)
**Source:** https://github.com/microsoft/SkillOpt (Microsoft, MIT, v0.2.0 2026-07-02, paper arXiv:2605.23904)
**Confidence:** HIGH on concept/fit (README + paper abstract verified); implementation-level details (API surface, config schema) to be verified during Phase 8 planning research.

## What It Is

SkillOpt optimizes natural-language instruction documents ("skills", 300–2,000-token markdown) for frozen LLMs the way neural nets are trained: rollout → reflect (scored trajectories) → aggregate → select → bounded text edits by an optimizer model → **accept only if held-out validation improves** → track test performance. Textual learning-rate budgets and rejected-edit buffers provide stability. `skillopt_sleep` runs offline nightly self-evolution from experience replay. Deployment artifact is a static `best_skill.md` — zero inference-time overhead.

## Role in Pikar-AI

1. **Skills registry (Phase 1 constraint, from day one):** every agent prompt — Executive Agent classifier/planner, sub-agents, brief-writer, onboarding guide — is a versioned skill document stored in a Convex `skills` table (name, version, body, status: active/candidate/rolled-back, evidence ref). Agents load their active skill at runtime. **No hardcoded agent prompts anywhere.** This realizes the original spec's "skills registry" concept.
2. **Optimization layer (Phase 8):** SkillOpt runs as the third Python sidecar (with Presidio, graphify), scheduled nightly (SkillOpt-Sleep pattern) and/or on feedback-threshold breach (IMPR-02). Inputs: scored trajectories derived from user feedback (IMPR-01), review outcomes (approve/edit/reject deltas), and telemetry. Held-out validation set gates every edit — this **is** the "automated eval check" IMPR-02 requires, satisfying the autonomous-optimization decision with peer-reviewed guardrails instead of hand-rolled evals.
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

## Risks / Notes

- Python 3.10+ sidecar; same deployment class as Presidio/graphify (container host).
- Validation-set quality determines everything — curate held-out Pikar tasks the optimizer never sees.
- SkillOpt optimizes per-skill; per-user personalization (from FEATURES.md differentiators) can be layered later as per-tenant skill variants — defer until data volume justifies it.
