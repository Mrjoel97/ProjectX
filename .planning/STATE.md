---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
status: executing
stopped_at: "Completed 12-04-PLAN.md (Tasks 1-2 shipped; Task 3 visual verification DEFERRED to 12-06's checkpoint)"
last_updated: "2026-07-25T02:20:00.000Z"
last_activity: "2026-07-25 — Phase 12 plan 04 CLOSED (Tasks 1-2 done, Task 3 DEFERRED): evaluateBusiness read-tool (closed framework enum, readPlan cross-tenant guard, fail-open SC1, capped synopsis, SMOKE_OP_TOOL entry) + quiet recordScorecardAnswer write-tool (not plan-gated, refs-only audit) registered in buildCockpitTools; EVALUATION card renders findings + H/M/L chips + citations, ≤5 leverage-ranked gaps + 'more' disclosure with a DISABLED plan-05 'Act on this', affirmative healthy banner, and a visually distinct not-enough-data state. Deviation (Rule 3): recordScorecardAnswerInternal explicit-tenantId twin added over a shared applyScorecardAnswer helper — the tool loop carries no live identity so the public tenantMutation was uncallable; business-evaluation.md playbook updated. Checks: backend 470/471 (sole failure = pre-existing audit.test.ts auditCounts), cockpitTools 57/57, web typecheck exit 0, check-playbooks exit 0. Task 3 human-verify DEFERRED (card did not render live): cockpit-agent.md teaches the tool ZERO times (12-06 Task 2) and all 7 rubrics are seeded-but-gated in GATED_SKILLS (EVAL_GATE = 12-06 Task 3) — 12-06's checkpoint must carry BOTH plans' visual checks. No gated skill activated, no teaching hardcoded (§5).\n\nPRIOR — plan 03 COMPLETE: Business Evaluation Engine shipped. Dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward → ground via vaultGroundHydrated → pure diagnose()/leverageRank() → persist ONE cited row → refs-only evaluation.ran audit → evaluateBusiness activity step). recordScorecardAnswer = the LOCKED 'store' half (a user figure persists forward, cited user-provided, never re-asked). byThread feeds the card (plan 04). v1 findings deterministic (profile-parse + labeled-number scan); rich LLM narrative deferred to the plan-06 eval gate. Thin/idea-stage (zero grounded findings) → 'insufficient' + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over the SMOKE:: seam (grounded cited row, refs-only §4 audit, carry-forward anti-re-ask, two-tenant isolation, thin-data); check-playbooks exit 0. Pre-existing audit.test.ts + backend-typecheck failures remain out-of-scope (deferred-items.md)."
progress:
  total_phases: 37
  completed_phases: 19
  total_plans: 146
  completed_plans: 141
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 12 — Business Evaluation Engine (next; not yet planned)

## Current Position

Phase: 12 of 25 (Business Evaluation Engine) — executing
Plan: 12-04 closed (cockpit surface — evaluateBusiness + recordScorecardAnswer tools + EVALUATION card); next 12-05
Status: Phase 12 in progress — 4/6 plans have summaries. **One open verification debt:** 12-04's human-verify is deferred into 12-06's checkpoint (see phase deferred-items.md); Phase 12 must not close on 12-06's own checks alone.
Last activity: 2026-07-25 — Phase 12 plan 04 CLOSED. evaluateBusiness read-tool + quiet recordScorecardAnswer write-tool in buildCockpitTools; EVALUATION card (findings + H/M/L chips + citations, ≤5 ranked gaps + more, healthy banner, distinct not-enough-data). Rule-3 deviation: recordScorecardAnswerInternal explicit-tenantId twin over a shared applyScorecardAnswer helper (the tool loop carries no live identity). Backend 470/471 (sole failure pre-existing), cockpitTools 57/57, web typecheck + check-playbooks exit 0. Task 3 visual check DEFERRED — the agent is never taught the tool (cockpit-agent.md: 0 mentions → 12-06 Task 2) and all 7 rubrics are gated-but-unactivated (EVAL_GATE → 12-06 Task 3), so the flow is not yet verifiable end-to-end.

PRIOR — plan 03 COMPLETE: Business Evaluation Engine shipped. Dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward → ground via vaultGroundHydrated → pure diagnose()/leverageRank() → persist ONE cited row → refs-only evaluation.ran audit → evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (a user figure persists forward, cited user-provided, never re-asked); byThread feeds the card (plan 04). v1 findings deterministic (profile-parse + labeled-number scan); rich LLM narrative deferred to the plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over the SMOKE:: seam; check-playbooks exit 0.

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
| Phase 12 P01 | 8 min | 3 tasks | 8 files |
| Phase 12 P02 | 17 min | 3 tasks | 19 files |
| Phase 12 P03 | 17 min | 3 tasks | 5 files |
| Phase 12 P04 | ~35 min | 2 of 3 tasks (Task 3 deferred) | 6 files |

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
- [Phase 12]: 12-01: Growth diagnostic math ported to pure-TS packages/core/src/growth (ltgpCac/cfa/diagnose); Convex-free (CLAUDE.md §1)
- [Phase 12]: 12-01: unknown financial input → diagnose emits ask (empty route/proofMetric) at the money-model gate — an all-null Scorecard never falsely reaches 'scale' (BEVL-01 no-fabricated-metrics guarantee in the type system)
- [Phase 12]: 12-02: 7 evaluation/specialist skills registered as GATED (4 framework rubrics + 3 specialist targets); bootstrap seeds v1 active, edits publish eval-gated candidates activated only via plan-06 (SC #4). growth-os-diagnostic folds diagnose() gate order + financial spine + 7-level positioning into ONE body; the 3 persona-fallback bodies (swot=SME, lean-canvas=solopreneur, bmc=startup) carry the shared grounding rubric (per-finding vault cite, H/M/L confidence, explicit not-enough-data state, no numeric %, affirmative healthy state). Original wording, NO Hormozi book text; contracts-side skillBodies.test.ts enforces md↔ts byte-identity.
- [Phase 12]: 12-03: evaluation engine SHIPPED — dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward→ground via vaultGroundHydrated→pure diagnose()→persist cited row→refs-only evaluation.ran audit→evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (user figure persists forward, cited user-provided). v1 findings deterministic (profile-parse + labeled-number scan); LLM narrative deferred to plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over SMOKE:: seam.

- [Phase 12]: 12-04: cockpit surface shipped — evaluateBusiness (read, CLOSED framework enum so the model can't inject prose, readPlan cross-tenant guard, fail-open SC1, CAPPED synopsis into the loop, SMOKE_OP_TOOL entry) + recordScorecardAnswer (write, {field,value}, cited user-provided, NOT plan-gated — a self-reported fact isn't an outbound action — refs-only audit, QUIET so no agentStep/tool-union entry). EVALUATION card is a dumb renderer over byThread: H/M/L ConfChip on globals.css color-mix tokens, ≤5 leverage-ranked gaps + a "more" disclosure, DISABLED "Act on this" (handler = plan 05), affirmative healthy banner on --released, and an insufficientBox never styled as a gap. No numeric % anywhere.
- [Phase 12]: 12-04: recordScorecardAnswerInternal (explicit-tenantId internalMutation twin) added because the cockpit tool loop carries NO live identity — a tenantMutation is uncallable from a tool. Both it and the public mutation delegate to ONE applyScorecardAnswer helper so the tenant-scoping/carry-forward write path can't drift.
- [Phase 12]: 12-04: Task 3 human-verify DEFERRED to 12-06 (owner decision) — the plan's checkpoint asked for end-to-end verification of a flow whose two enabling halves land in 12-06 (agent teaching = Task 2, EVAL_GATE rubric activation = Task 3). Verified-not-litigated: cockpit-agent.md has 0 evaluate/scorecard/swot/diagnose mentions; all 7 Phase-12 rubrics are in GATED_SKILLS. Workarounds refused: no gated skill activated, no teaching hardcoded (§5), no throwaway seeding.

### Pending Todos

- **12-04 visual verification is UNPAID debt** — must be carried at plan 12-06's human-verify checkpoint, which has to cover BOTH plans' visual checks (12-04 card states + 12-06 teaching/gate). Detail in `.planning/phases/12-business-evaluation-engine/deferred-items.md`.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-25T02:20:00.000Z
Stopped at: Completed 12-04-PLAN.md — Tasks 1-2 shipped (0ce71e0, a23ff21) and summarized; Task 3 (human-verify) DEFERRED by owner decision into plan 12-06's checkpoint, since the agent teaching (12-06 Task 2) and the EVAL_GATE rubric activation (12-06 Task 3) are what make the flow reachable.
Resume file: .planning/phases/12-business-evaluation-engine/12-05-PLAN.md (next plan)
