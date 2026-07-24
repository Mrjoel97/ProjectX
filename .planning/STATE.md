---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
status: planning
stopped_at: Phase 11 COMPLETE & verified (passed 7/7) — next Phase 12
last_updated: "2026-07-24T18:09:24.485Z"
last_activity: "2026-07-24 — Phase 11 plan 04 COMPLETE (all 4 plans done) — editable /dashboard/profile page: getProfile + deserializeProfile load the committed Lean-core fields, Save re-embeds via updateProfile so grounding stays current; rail nav link added (page was unreachable); human-verified"
progress:
  total_phases: 37
  completed_phases: 19
  total_plans: 140
  completed_plans: 136
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 12 — Business Evaluation Engine (next; not yet planned)

## Current Position

Phase: 12 of 25 (Business Evaluation Engine) — Phase 11 complete & verified
Plan: none yet (Phase 12 not planned)
Status: Ready to plan Phase 12
Last activity: 2026-07-24 — Phase 11 (Persona Onboarding & Business Profile) COMPLETE & verified (passed 7/7). Sparse-start decision mid-phase: onboarding admits idea-stage users (only oneLineDescription + persona required); name/offering/customer optional, enriched on the editable /dashboard/profile page. Rail nav link added (page was unreachable). business-profile skill seeded active v1.

Progress (v2.0): [██░░░░░░░░] 13%  (2/16 phases complete; Phases 10 + 11 shipped 4/4 each)

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
| 10 | 03 | 12 min | 2 | 2 |

**Recent Trend:** 10-03 landed clean (web typecheck + playbook check green; SourceCard reused the existing briefingSheet style — no new card idiom).

*Updated after each plan completion.*
| Phase 10 P04 | 15 | 3 tasks | 8 files |
| Phase 11 P01 | 10 min | 3 tasks | 11 files |
| Phase 11 P02 | 11min | 3 tasks | 4 files |
| Phase 11 P03 | 76 min | 3 tasks | 6 files |
| Phase 11 P04 | 40 min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. Recent decisions affecting v2.0:

- [v2.0 open]: Build platform breadth BEFORE opening the beta — former Phase 9 productionization moves to the milestone's END (now Phase 25).
- [Roadmap]: `requireOwner` (GOVN-01) pulled EARLY to Phase 22 — it must exist before agent-authored skills (Phase 23) activate and before multi-user (Phase 25).
- [Roadmap]: BEVL market-fact grounding depends on web research (Phase 16); Phase 12 evaluation scopes to vault-grounded findings until then.
- [Architecture]: Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism.
- [Phase 10]: ADR-006: vault chunks are trusted-as-own — enter the agent loop directly (SC2-fenced), not through the toolless-ingestion firewall; fence + human Approve gate are the backstops
- [Phase 10]: 10-04: vault-grounding teaching is candidate cockpit-agent@13 (versioned skill, §5), gate-activated only; the 'not on compose turns' clause guards the 23 existing golden fixtures
- [Phase 10]: 10-03: the SourceCard reuses the existing briefingSheet opaque --card style (no new card idiom); titles link to /dashboard/vault (doc-level, no new query) — inline PreviewModal click-through deferred behind a getVaultDoc(byId) query
- [Phase 11]: 11-01: business-profile skill is UNGATED (mirrors voice-brief) — output is a human-confirmed vault doc, not tool-state; not in GATED_SKILLS
- [Phase 11]: 11-01: SC#1 encoded as pure decideConfirm returning literal { needsConfirm: true } — persona auto-commit impossible at the type level; enterprise not an emittable Persona
- [Phase 11]: 11-02: onboarding is a thin adapter — the profile is 'just another vault doc', so embed/tenant-scope/retrieval come free from startIngest/vaultGroundHydrated; new work is only the extraction call + §4-safe audit
- [Phase 11]: 11-02: extractProfile writes nothing (no doc, no audit) — SC#1 confirm-not-assume is structural; the sole write path is the separate human-confirmed commitProfile
- [Phase 11]: 11-03: first-run gate lives in the client <Authenticated> AppShell (useQuery(api.onboarding.status) redirect), NOT middleware.ts — middleware has no DB access (RESEARCH Pitfall 4, eternal-spinner class)
- [Phase 11]: 11-03: onboarding reuses the conversational chat SURFACE but routes extraction through the UNGATED business-profile skill, not the gated cockpit-agent — keeps onboarding tweaks out of the EVAL_GATE cycle / off the ~25 golden fixtures (RESEARCH Pitfall 1)
- [Phase 11]: 11-03: sparse-start — REQUIRED_STRINGS relaxed to [oneLineDescription] + confirmed persona; name/stage/offering/targetCustomer optional so idea-stage users (ONBD-02 'business/idea') can commit and are enriched later (46a86c3)
- [Phase 11]: 11-04: profile page is the post-onboarding editability/enrichment surface — save re-embeds via updateProfile so grounding stays current; the committed vault-doc markdown is the single record, getProfile parses it back with deserializeProfile (round-trip test binds the two)

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-24T18:04:30.456Z
Stopped at: Completed 11-04-PLAN.md
Resume file: None
