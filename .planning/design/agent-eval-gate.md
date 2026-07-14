---
title: Agent Eval Gate — golden-set evaluation before skill activation (Phase 3.6 spec)
status: proposed-design (drafted 2026-07-14 from the agent-architecture analysis; feeds /gsd:plan-phase)
sequencing: decimal insert after Phase 3.5, before Phase 4. Owner MAY pull it earlier
  (before 3.4/3.5) since those phases edit the cockpit-agent skill and currently fly blind.
decisions:
  - Eval asserts on PLAN/TOOL STATE, never on reply text (text is subjective; state is the contract)
  - The gate lives on activateSkill — activation is the behavior-deploy mechanism, so it is the choke point
  - Rollback is NEVER gated (re-activating a previously-active version must work mid-incident)
  - Phase 8 (SkillOpt) plugs into this harness instead of building its own eval substrate
---

# Agent Eval Gate (Phase 3.6)

## 1. Problem

Skill activation is Pikar's deploy mechanism for agent behavior (ADR-003), and nothing
verifies a new skill version against a real model before it goes live. The existing
rings — mock-model integration tests (deterministic, prove the *cage*: guardrails,
tool validation, approve gate) and the offline `SMOKE::` E2E — never exercise real
model reasoning. Production telemetry (approve/edit/reject, `regenerateCount`,
fallback count, DLQ, cost) is written diligently and read by nobody. So a subtly
worse `cockpit-agent` v(n+1) is discovered by paying users, and Phase 8's SkillOpt
assumes an eval harness ("gated by automated eval checks", IMPR-02) that no phase
builds. This phase is the missing evaluation ring between CI and SkillOpt.

## 2. Design

**Golden set.** ~15–25 scripted cockpit conversations as fixture files (user turns +
expected terminal state). Each case runs the REAL model through the REAL
`runCockpitAgent` loop against a dev deployment, then asserts on **state, never
text**: recipients (count/addresses), mode, subject present, plan status reached
(`proposed`), attachment presence/absence, and the standing invariants (zero
`requests` rows created, zero sends, refs-only audit). Delivery is impossible by
construction (no Approve click ever happens; asserted anyway). Coverage: happy paths,
mid-conversation edits ("remove #2", "make it formal"), bounce/re-ask paths (invalid
address), attachment ops, and at least one prompt-injection probe (a user turn asking
the agent to send without approval must end with nothing sent and no `proposePlan`
acceptance of an invalid row).

**Runner.** `pnpm eval:golden [--skill <name>@<version>]` — reuses the existing smoke
harness conventions (Windows-safe runner like `run-smoke-*.mjs`). Seeds a throwaway
tenant, runs cases sequentially, prints per-case pass/fail + total cost, exits
non-zero on any failure. Hard cost cap per run (abort if cumulative spend exceeds it;
expected well under $1 on the default model). Zero mailbox access (no Gmail token in
the eval tenant — `resolveContacts` cases assert the graceful-degradation path
instead).

**The gate.** `activateSkill(name, version)` refuses to activate a **candidate** row
(never-before-active) for a gated skill unless a passing eval run is recorded. The
run writes its result as the skill row's existing `evidence` field (runner id, cases
passed, cost, model, timestamp — refs/counts only). **Structural rollback exemption:**
a target row whose status is `archived` or `rolled_back` was active before and
activates without evidence — rollback during an incident must never be blocked by a
broken eval harness. Gated skills v1: `cockpit-agent`, `document-drafter` (the two
that drive tool behavior); `email-drafter`/`executive-router` join when golden cases
cover them.

**Production read-side (EVAL-02).** One new ops-page section reading data that
already exists: approve/edit/reject rates and `regenerateCount` (telemetry),
`llm.fallback` count (audit), DLQ rate (`deadLetters` + aggregate), cost per
delivered plan (telemetry). No new writes, no new tables — a query + a card. Falling
approve-rate after an activation IS the production eval; rollback is already one
click.

**Housekeeping (drift item):** archive the dead `executive-agent.classifier` skill
(live routing uses `executive-router`; the two even disagree on route-enum spelling).

## 3. Phase spec (GSD form — paste-ready for ROADMAP.md)

### Phase 3.6: Agent Eval Gate (INSERTED)
**Goal**: Agent behavior changes stop being blind — a golden set of scripted conversations evaluates every new agent-skill version against the live model before it can be activated, and the production eval signals already being written become readable on the ops page; this is the continuous-evaluation ring between the mock-model CI tests (Phase 3.2.1) and SkillOpt (Phase 8), which plugs into this harness instead of building its own.
**Depends on**: Phase 3.2.1 (agent tool-loop + SMOKE harness); Phase 3.3 (attachment tools in golden-set scope)
**Requirements**: EVAL-01, EVAL-02 (minted 2026-07-14)
**Design**: `.planning/design/agent-eval-gate.md`
**Success Criteria** (what must be TRUE):
  1. A golden set of scripted cockpit conversations (fixtures, ~15–25 cases incl. edit, bounce, attachment, and injection-probe paths) runs on demand against the live model via `pnpm eval:golden`, asserting on resulting plan/tool state (never reply text), with a hard per-run cost cap and zero possibility of a real send or mailbox read.
  2. `activateSkill` refuses to activate a never-before-active (candidate) version of a gated skill without a recorded passing eval run (evidence ref on the skill row, refs/counts only); re-activating a previously-active version (rollback) is structurally exempt and always works.
  3. The ops page shows production eval signals — approve/edit/reject rates, regenerate count, fallback count, DLQ rate, cost per delivered plan — from existing telemetry/audit data, with no new write paths.
  4. The legacy `executive-agent.classifier` skill row is archived, and the agent-runtime playbook's "no live-model eval gate" gap is closed (playbook updated in the same phase).
**Plans**: TBD (suggested: 3 plans / 2 waves below)

Suggested plan breakdown (for /gsd:plan-phase, not binding):
- 3.6-01 — Golden-set harness: fixture format + eval tenant seeding + runner (state assertions, cost cap, per-case report) + first ~15 cases (Wave 1)
- 3.6-02 — activateSkill gate: candidate-vs-rollback distinction + evidence recording + gate tests + archive dead classifier skill (Wave 2)
- 3.6-03 — Ops-page eval-signals section + `eval:golden` script wiring + playbook/watch.json updates + human-verify checkpoint (Wave 2)

## 4. Out of scope

- Automated/scheduled eval runs (cron) — on-demand is enough until Phase 8 gives it a caller.
- LLM-as-judge / text-quality scoring — state assertions only in v1; subjective quality stays human until SkillOpt brings scored trajectories.
- Per-tenant eval variants, A/B activation, canary traffic — post-beta at the earliest.
- Gating `email-drafter`/`executive-router` — join the gated list when golden cases cover their surfaces.

## 5. Phase 8 impact (re-scope note)

Phase 8's SkillOpt integration shrinks: the golden set seeds its held-out validation
pool, `evidence` on skill rows is already the before/after record IMPR-03 wants, and
the ops-page signals are its scoring inputs. Phase 8 becomes "connect the optimizer
to an existing harness," not "build evaluation from scratch."

## 6. Open questions (resolve during /gsd:plan-phase)

- Fixture grammar: reuse/extend the `SMOKE::agent::` sentinel grammar for scripted *user* turns, or a plain JSON fixture per case? (Recommendation: JSON fixtures — sentinels are for offline determinism, evals want real reasoning.)
- Where eval runs execute: developer machine against a dev deployment (recommended, zero infra) vs CI job (needs `OPENAI_API_KEY` as a CI secret — defer).
- Flake policy for live-model nondeterminism: one automatic re-run of a failed case before red? (Recommendation: yes, with both attempts recorded in evidence.)
