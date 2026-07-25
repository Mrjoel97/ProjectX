---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
status: planning
stopped_at: Phase 13 context gathered
last_updated: "2026-07-25T12:09:01.268Z"
last_activity: "2026-07-25 — Phase 12 plan 06 COMPLETE; PHASE 12 CLOSED. `pnpm eval:golden --skill cockpit-agent@15` → **27/27 PASSED, $0.1686, run `ed251c29`**; both new fixtures (27-grounded-assessment, 28-healthy-no-gaps) passed first try, one retry on the pre-existing flaky 18-briefing-then-action. **cockpit-agent@15 is ACTIVE** on that recorded evidence (verified live via `getActiveSkill`), teaching WHEN to call `evaluateBusiness` + the `recordScorecardAnswer` store half. The 7 Phase-12 rubrics needed no `activateSkill` — they had never been seeded, so their FIRST seed took the `rows.length === 0` bootstrap path and each landed **v1 ACTIVE** (SC #4 intact; only cockpit-agent rode the gate). Deviations: (Rule 2) `findingsPresent` added as a third expect key — `gapCount: 0` alone passes VACUOUSLY on the not-enough-data verdict because the engine force-clears gaps at zero findings; (Rule 3) the fixture-floor bump 18→27 moved from Task 1's commit to Task 2's. Five defects found and fixed during live verification (see PRIOR-FIXES below)."
progress:
  total_phases: 37
  completed_phases: 20
  total_plans: 146
  completed_plans: 142
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** Phase 13 — Proactive In-App Review (next; not yet planned)

## Current Position

Phase: 12 of 25 (Business Evaluation Engine) — **COMPLETE** (6/6 plans, owner-verified 2026-07-25); next Phase 13
Plan: 12-06 COMPLETE (the eval gate: assessment fixtures + cockpit teaching + activation) — LAST plan of Phase 12
Status: **Phase 12 CLOSED.** 6/6 plans have summaries; BEVL-01 + BEVL-02 complete and live-verified. The three-part verification debt (12-04 card states + 12-05 acting path + 12-06 teaching) is PAID — owner ran all three and approved. Ready for `/gsd:verify-work`, then Phase 13 planning.
Last activity: 2026-07-25 — Phase 12 plan 06 COMPLETE; PHASE 12 CLOSED. `pnpm eval:golden --skill cockpit-agent@15` → **27/27 PASSED, $0.1686, run `ed251c29`**; both new fixtures (27-grounded-assessment, 28-healthy-no-gaps) passed first try, one retry on the pre-existing flaky 18-briefing-then-action. **cockpit-agent@15 is ACTIVE** on that recorded evidence (verified live via `getActiveSkill`), teaching WHEN to call `evaluateBusiness` + the `recordScorecardAnswer` store half. The 7 Phase-12 rubrics needed no `activateSkill` — they had never been seeded, so their FIRST seed took the `rows.length === 0` bootstrap path and each landed **v1 ACTIVE** (SC #4 intact; only cockpit-agent rode the gate). Deviations: (Rule 2) `findingsPresent` added as a third expect key — `gapCount: 0` alone passes VACUOUSLY on the not-enough-data verdict because the engine force-clears gaps at zero findings; (Rule 3) the fixture-floor bump 18→27 moved from Task 1's commit to Task 2's. Five defects found and fixed during live verification (see PRIOR-FIXES below).

PRIOR-FIXES (2026-07-25, outside the plan's tasks, all committed): `d5814ae` shared `resolveMimeType` (Windows reports `File.type` `""` for `.md`); `f971613` literal extensions in `accept` (Chrome resolves accept MIME via the OS registry, which has no `text/markdown`); `b5e0f7f`+`7efa4f9` cockpit attachments now persist to the Knowledge Vault; `f5c279e` TWO grounding defects in the 12-03 engine — a large reference PDF monopolised the corpus (`rag.search` top-K is per CHUNK → grounding returned one 300-page book → "not enough data"), fixed by prepending the tenant's own profile-shaped docs via `internal.vault.profileSeedDocs`; and `fillVault` could never fill `identity.currentOffers` (empty-array default is not null), so `diagnose()` returned Gate 1 on EVERY vault-grounded run. Verified live after: growth-os, 8 cited findings, gap "Customer doesn't pay for themselves in 30 days" → `money-model-designer`.

PRIOR — Phase 12 plan 05 COMPLETE: the ACTING side of BEVL-02. `actOnGap` stages a gap as a proposed memo-plan through the pinned spine; `executePlan` branches on `plans.kind === "memo"` (before the mailbox pre-check) into a PERSIST terminal — a `next_step_memo` vault doc via `startIngest`, zero `requests` rows, `deliverApprovedPlan.ts` byte-unchanged. `buildMemo` is a deterministic grounded template naming the specialist (`gap.route`) + citing its playbook, never running it. "Act on this" is live and carries the ORIGINAL gap index through the `leverageRank` sort; `PlanCard` renders a NEXT-STEP MEMO variant on the SAME single Approve gate. Rule-3 deviation: `actOnGap` recycles the thread's one `plans` row (`byThread` is `.unique()`) and refuses `plan_busy` on an in-flight/delivered plan. gapAction 4/4, backend 474/475 (sole failure pre-existing), web typecheck + check-playbooks exit 0.

PRIOR — Phase 12 plan 04 CLOSED. evaluateBusiness read-tool + quiet recordScorecardAnswer write-tool in buildCockpitTools; EVALUATION card (findings + H/M/L chips + citations, ≤5 ranked gaps + more, healthy banner, distinct not-enough-data). Rule-3 deviation: recordScorecardAnswerInternal explicit-tenantId twin over a shared applyScorecardAnswer helper (the tool loop carries no live identity). Backend 470/471 (sole failure pre-existing), cockpitTools 57/57, web typecheck + check-playbooks exit 0. Task 3 visual check DEFERRED — the agent is never taught the tool (cockpit-agent.md: 0 mentions → 12-06 Task 2) and all 7 rubrics are gated-but-unactivated (EVAL_GATE → 12-06 Task 3), so the flow is not yet verifiable end-to-end. *(CORRECTED at 12-06: the rubrics were never SEEDED at all, not seeded-but-gated — `convex dev` alone does not seed. Task 3's debt is now PAID.)*

PRIOR — plan 03 COMPLETE: Business Evaluation Engine shipped. Dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward → ground via vaultGroundHydrated → pure diagnose()/leverageRank() → persist ONE cited row → refs-only evaluation.ran audit → evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (a user figure persists forward, cited user-provided, never re-asked); byThread feeds the card (plan 04). v1 findings deterministic (profile-parse + labeled-number scan); rich LLM narrative deferred to the plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over the SMOKE:: seam; check-playbooks exit 0.

Progress (v2.0): [██░░░░░░░░] 19%  (3/16 phases complete; Phases 10 + 11 shipped 4/4 each, Phase 12 shipped 6/6)

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
| Phase 12 P05 | ~25 min | 3 tasks | 8 files |
| Phase 12 P06 | ~120 min (incl. human eval gate) | 3 tasks | 8 files |

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
- [Phase 12]: 12-05: MEMO TERMINAL — a plan now carries an optional closed `kind: "memo"` discriminator and `executePlan` branches on it AFTER the CAS read and BEFORE the mailbox pre-check: the body persists as a `next_step_memo` vault doc (startIngest, the persistBrief precedent) and the plan goes done with ZERO requests rows seeded. deliverApprovedPlan.ts is byte-unchanged (verified by diff) — the gmail fan-out is structurally unreachable from a memo, not merely unused. One Approve gate, two promises; the generalized executor (ACTN-01) generalizes THIS branch in Phase 15, it does not widen the gmail one.
- [Phase 12]: 12-05: actOnGap RECYCLES the thread's single plans row (resetPlan→patchPlan) rather than inserting a second — `plans.byThread` is a `.unique()` read, so a second row per thread throws for every workspace reader. resetPlan (not patchPlan) because patchPlan drops undefined and could never clear a half-composed email's slots onto the memo; resetPlan now also clears `kind` (a reset must drop the memo SHAPE or the next fresh compose silently saves instead of sends). A mid-flight/delivered plan refuses with `plan_busy`.
- [Phase 12]: 12-05: the memo NAMES the specialist (gap.route) and cites its playbook — it does not run it (Phase 15+). buildMemo is a deterministic template over the persisted row (gaps[] gained optional reason/proofMetric at diagnose time so the memo is a pure READ, never a second drift-prone derivation); it is a document the user reads, NOT an agent prompt, so §5 does not apply — but it may assert no figure the evaluation did not ground.
- [Phase 12]: 12-05: PlanCard branches on kind === "memo" — the email chrome (recipients, mode, send-time picker, "Send to N recipients") would every word be a lie on a memo, at the exact surface where the human gives irreversible consent. Same approve() handler reused, so there is still exactly ONE Approve gate.
- [Phase 12]: 12-06: `findingsPresent` is a THIRD expect key beyond the plan's two — the engine force-clears gaps at zero grounded findings (SC #1), so `gapCount: 0` alone passes VACUOUSLY on the honest not-enough-data verdict. Pairing the two is what makes 28-healthy-no-gaps assert HEALTH rather than emptiness.
- [Phase 12]: 12-06: a GATED skill's FIRST seed lands v1 ACTIVE (the `rows.length === 0` bootstrap path) — gating costs nothing until a skill's first body EDIT. The 7 Phase-12 rubrics were never seeded on this deployment (`convex dev` alone does not seed; only `pnpm dev` / `npm run seed` runs `skills:seedSkills`), so they self-activated at v1 and only `cockpit-agent` rode the gate (→ **@15**, on 27/27 passing evidence, $0.1686, run `ed251c29`). This CORRECTS 12-04's "seeded but gated-not-activated" inference.
- [Phase 12]: 12-06 (verification-driven, `f5c279e`): grounding must PREPEND the tenant's own profile-shaped docs (`internal.vault.profileSeedDocs`) — `rag.search` top-K is per CHUNK, so one large reference PDF monopolises the corpus and the engine honestly reports "not enough data" while the user's own profile sits unread. Paired defect: `fillVault` could never fill `identity.currentOffers` (an empty-array default is not `null`), pinning `diagnose()` to Gate 1 on every vault-grounded run.
- [Phase 12]: 12-04: Task 3 human-verify DEFERRED to 12-06 (owner decision) — **PAID at 12-06; owner ran all three accumulated visual checks and approved 2026-07-25** — the plan's checkpoint asked for end-to-end verification of a flow whose two enabling halves land in 12-06 (agent teaching = Task 2, EVAL_GATE rubric activation = Task 3). Verified-not-litigated: cockpit-agent.md has 0 evaluate/scorecard/swot/diagnose mentions; all 7 Phase-12 rubrics are in GATED_SKILLS. Workarounds refused: no gated skill activated, no teaching hardcoded (§5), no throwaway seeding.

### Pending Todos

- ~~**12-04 AND 12-05 visual verification is UNPAID debt**~~ — **PAID 2026-07-25.** The owner ran all three checks (12-04 card states, 12-05 tap → NEXT-STEP MEMO → "Approve & save" → memo at `/dashboard/vault` with no email sent, 12-06 teaching) and reported "Everything worked. I approve."
- **Repeat-evaluation provenance gap (logged, not fixed)** — re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1): carry-forward preserves the scorecard VALUES but not their PROVENANCE, so only freshly-filled paths are re-cited. Workaround: a fresh thread per evaluation. Phase 13's proactive review runs on its own thread, so it is unaffected. Detail in `.planning/phases/12-business-evaluation-engine/deferred-items.md`.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-07-25T12:09:01.253Z
Stopped at: Phase 13 context gathered
Resume file: .planning/phases/13-proactive-in-app-review/13-CONTEXT.md
