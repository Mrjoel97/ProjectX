---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
status: executing
stopped_at: Completed 10-02-PLAN.md
last_updated: "2026-07-24T05:01:52.985Z"
last_activity: 2026-07-24 — Plan 10-02 shipped (searchVault tool + vaultSources card + vault.searched audit + ADR-006)
progress:
  total_phases: 37
  completed_phases: 17
  total_plans: 136
  completed_plans: 130
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 10 — Vault->Agent Grounding (the root dependency: the agent finally reads the vault mid-conversation)

## Current Position

Phase: 10 of 25 (Vault->Agent Grounding) — first phase of milestone v2.0
Plan: 02 of 4 complete (searchVault cockpit grounding tool)
Status: Executing — Plan 03 next (source-card UI + VERB label)
Last activity: 2026-07-24 — Plan 10-02 shipped (searchVault tool + vaultSources card + vault.searched audit + ADR-006)

Progress (v2.0): [░░░░░░░░░░] 0%  (0/16 phases; Phase 10: 2/4 plans)

*v1.0 milestone (Phases 1-9, less the superseded Phase 9) shipped: governed email cockpit + guardrails + vault/GraphRAG + live voice + resilience/ops + self-improvement. That is the spine v2.0 builds on.*

## Milestone v2.0 Phase Map

| Stage | Phases |
|-------|--------|
| S1 Foundation & Intelligence | 10 Vault grounding · 11 Onboarding+profile · 12 Evaluation engine · 13 Proactive review · 14 Flagship voice-doc |
| S2 Breadth of Action | 15 Dispatch+executor · 16 Research+web · 17 Calendar · 18 Doc/content · 19 Contacts/CRM |
| S3 Creation & Self-Extension | 20 Media canvas · 21 User skills · 22 requireOwner · 23 Agent skills |
| S4 Governance & Open the Beta | 24 ISO 9001 map · 25 Private Beta Productionization (LAST) |

## Performance Metrics

**Velocity:** (v2.0)
- Total plans completed: 2
- Average duration: ~12 min
- Total execution time: ~25 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 10 | 01 | 5 min | 2 | 3 |
| 10 | 02 | 20 min | 3 | 7 |

**Recent Trend:** 10-02 landed clean (TDD, 68/68 cockpitTools+vaultGround green, one fixture-only correction).

*Updated after each plan completion.*

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. Recent decisions affecting v2.0:

- [v2.0 open]: Build platform breadth BEFORE opening the beta — former Phase 9 productionization moves to the milestone's END (now Phase 25).
- [Roadmap]: `requireOwner` (GOVN-01) pulled EARLY to Phase 22 — it must exist before agent-authored skills (Phase 23) activate and before multi-user (Phase 25).
- [Roadmap]: BEVL market-fact grounding depends on web research (Phase 16); Phase 12 evaluation scopes to vault-grounded findings until then.
- [Architecture]: Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism.
- [Phase 10]: ADR-006: vault chunks are trusted-as-own — enter the agent loop directly (SC2-fenced), not through the toolless-ingestion firewall; fence + human Approve gate are the backstops

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-24T05:01:20.120Z
Stopped at: Completed 10-02-PLAN.md
Resume file: .planning/phases/10-vault-agent-grounding/10-03-PLAN.md
