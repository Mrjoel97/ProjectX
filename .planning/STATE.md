---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Platform -> Private Beta
status: ready
stopped_at: "v2.0 roadmap created (Phases 10-25). Phase 10 (Vault->Agent Grounding) is next to plan."
last_updated: "2026-07-24T00:00:00.000Z"
last_activity: "2026-07-24 — Milestone v2.0 roadmap created: 16 phases (10-25) derived from 24 v2.0 requirements across the S1->S4 staircase; 100% coverage; former Phase 9 superseded/absorbed into Phase 25 (final productionization). REQUIREMENTS traceability filled; ROADMAP appended; STATE reset."
progress:
  total_phases: 16
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 10 — Vault->Agent Grounding (the root dependency: the agent finally reads the vault mid-conversation)

## Current Position

Phase: 10 of 25 (Vault->Agent Grounding) — first phase of milestone v2.0
Plan: none yet (phase not planned)
Status: Ready to plan
Last activity: 2026-07-24 — v2.0 roadmap created (Phases 10-25)

Progress (v2.0): [░░░░░░░░░░] 0%  (0/16 phases)

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
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**Recent Trend:** n/a (milestone just opened)

*Updated after each plan completion.*

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. Recent decisions affecting v2.0:

- [v2.0 open]: Build platform breadth BEFORE opening the beta — former Phase 9 productionization moves to the milestone's END (now Phase 25).
- [Roadmap]: `requireOwner` (GOVN-01) pulled EARLY to Phase 22 — it must exist before agent-authored skills (Phase 23) activate and before multi-user (Phase 25).
- [Roadmap]: BEVL market-fact grounding depends on web research (Phase 16); Phase 12 evaluation scopes to vault-grounded findings until then.
- [Architecture]: Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism.

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-24
Stopped at: v2.0 roadmap created — ROADMAP.md appended (Phases 10-25), REQUIREMENTS.md traceability filled, STATE.md reset. Former Phase 9 marked superseded (absorbed into Phase 25).
Resume file: None. Next: `/gsd:plan-phase 10`.
