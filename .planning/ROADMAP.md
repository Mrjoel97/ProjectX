# Roadmap: Pikar-AI

## Overview

Pikar-AI reaches a private beta in ~4 weeks (target ~2026-08-05) by building the governed request pipeline outward from an immutable foundation. We first lay the Convex data/orchestration substrate that bakes in tenant isolation, insert-only audit, durable workflows, and the dead-letter/timeout patterns every later feature reuses â then prove the core value with one thin end-to-end slice (type a goal â plan â review â email â audit). Guardrails (PII, cost, cache, kill-switch) slot into the existing pipeline steps, followed by richer intake (attachments + voice dictation), the knowledge vault with GraphRAG memory, and the identity-defining live voice sessions. We then harden every failure path, add the self-improvement loop, and finish with private-beta productionization: invite-only signup, verified per-user isolation, fast onboarding, and the second email provider. Voice is deliberately staged (dictation before live) and email providers are strictly sequenced (Gmail before Microsoft Graph) to keep the highest-risk, least-controllable work off the critical path.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Governance Substrate** - Convex/Next.js monorepo, tenant scoping, insert-only audit, DLQ + timeout patterns, graphify, OAuth paperwork started
- [ ] **Phase 2: Thin End-to-End Slice** - Text request â plan â human review â Gmail delivery â live status + full audit trail
- [ ] **Phase 3: Guardrails** - PII redaction, cost estimate/downgrade, tenant-namespaced cache, fallback, rate-limit + cost kill-switch
- [ ] **Phase 3.1: Cockpit Core** (INSERTED) - Two-pane chat cockpit: guided slot-filling conversation â single plan-approval â hands-off multi-recipient governed send â live per-recipient report; reuses the Phase 2 engine, retires the /submit form + /review queue
- [ ] **Phase 3.2: Inbox Reading** (INSERTED) - Agent searches/reads the connected mailbox (gmail.modify already granted) to find people and context for a request
- [x] **Phase 3.2.1: Agent-Driven Cockpit** (INSERTED) â 2026-07-13 - Replace the deterministic FSM cockpit with an Executive Agent governed tool-loop so the conversation is flexible ("remove Bob", "make it formal, add Jane") while every governance invariant survives; must land before 3.3 (attachment builds on the agent engine)
- [x] **Phase 3.3: Attachment Generation** (INSERTED) — 2026-07-14 - Agent generates a document and attaches it to an outgoing email
- [x] **Phase 3.4: Per-Recipient Personalization** (INSERTED) - Tailored wording per recipient in a multi-recipient send (beyond slice-1 same-content) (4/4 plans; CKPT-03 human-verified 2026-07-14, incl. multi-name resolution gap-closure)
- [x] **Phase 3.5: Deferred Send** (INSERTED) - "Send this at 4 AM": a plan carries a future send time, shown absolute on the PLAN card before the single Approve; execution scheduled through the same governed fan-out, cancellable until it fires (recurring sends stay out of v1 â `.planning/design/scheduled-send.md`)
- [x] **Phase 3.6: Agent Eval Gate** (INSERTED) - Golden-set live-model eval for agent skills + eval-gated `activateSkill` (rollback always exempt) + ops-page eval signals — skill activations stop being blind; Phase 8's SkillOpt plugs into this harness (completed 2026-07-15)
- [x] **Phase 3.7: Inbox Briefing** (INSERTED) - On-demand read-and-summarize of the user's inbox into a time-grouped, triaged BRIEFING card under the toolless-ingestion invariant (bodies never enter the tool-bearing loop); read-only, capped, refs-only audit — the first feature converting the restricted scope into recurring chief-of-staff value
- [x] **Phase 3.8: Vault Document Extraction** (INSERTED) — 2026-07-18 - Wire PDF/DOCX/XLSX/PPTX/CSV/image (OCR) extraction into the vault's `vaultIngestText` seam so non-text uploads become searchable instead of sitting at `pending_extraction` forever (6/6 plans; owner live human-verify APPROVED 2026-07-18 incl. video transcription + preview modal; VERIFICATION.md passed 6/6)
- [x] **Phase 3.9: Agent Activity Streaming** (INSERTED) — 2026-07-17 - The workspace shows the agent's steps as it works (and in-progress chat bubbles) instead of freezing for 10–30s — cross-cutting across every agent flow (4/4 plans; CKPT-05 human-verified 2026-07-17, incl. the WorkspacePage crash-fix uncovered during verify)
- [x] **Phase 3.10: Cockpit Conversation Repair** (INSERTED) - Fix two live-UAT defects (2026-07-19): the BriefingCard/ResolutionCard panel arbitration (a stale brief buries the contact picker → resolution stalls → "#1 (no name)" plans) and the agent's stalled-resolution recovery (loops "ready to pick", re-asks for a given subject, ignores a stated body intent); skill edit rides the 3.6 eval gate with new stalled-resolution fixtures — completed 2026-07-19 (7/7 plans incl. gap closures UAT-C/D/E/F; verification passed; human sign-off recorded)
- [x] **Phase 3.11: Inbox Reply** (INSERTED) — 2026-07-19 - "Draft a reply to X" becomes a real reply: recipient by message ref (From address, refs-only — no panel round-trip), `Re:` subject + Gmail in-thread threading, body drafted from user intent with the original as toolless-ingested context, delivered through the unchanged plan → Approve → governed fan-out (6/6 plans; RPLY-01 owner live human-verify APPROVED 2026-07-19 — a real reply landed in-thread in real Gmail with the Re: subject, addressed only the original sender)
- [x] **Phase 4: Attachment & Voice-Dictation Intake** - Attachments classified/OCR'd/transcribed and voice dictation, both into the pipeline (6/6 plans; SC3 live human-verify APPROVED 2026-07-15 — attach + dictate → delivered email reflected the content, guardrails intact)
- [x] **Phase 5: Knowledge Vault & GraphRAG** - Briefs/docs stored, embedded, graph-extracted, and grounded via hybrid retrieval per user (7/7 plans, live in-browser verified + P0 embed fix 2026-07-14)
- [x] **Phase 6: Live Voice Sessions** (VOIC-01..04 live human-verified 2026-07-21) - 15-min bidirectional voice with server watchdog â durable brief â optional executable plan
- [x] **Phase 7: Resilience & Operations Hardening** (AGNT-04/REVW-02/REVW-03/OPSG-03/OPSG-05; owner-approved 2026-07-21 — live smokes green + OPSG-05 email & in-app matrix owner live-verified; real-S3 Object-Lock durability owner-deferred) - Timeouts, retry escalation, notifications, dead-letter completeness, WORM archival export
- [x] **Phase 8: Self-Improvement** - Feedback capture â eval-gated autonomous prompt optimization with versioning + rollback + kill switch (completed 2026-07-23)
- [~] **Phase 9: Private Beta Productionization** - **SUPERSEDED (2026-07-24) -> absorbed into Phase 25.** Productionization moves to the END of milestone v2.0 (executes LAST, after all Phase 10+ platform work). `09-CONTEXT.md` remains the spec for that final phase.

### Phase 26: Connected product pages

> **AMENDED 2026-08-07 (owner decisions on the unbuilt mockups). Three surfaces changed shape.**
>
> **(1) Finance SPLITS into Cost and Cash.** The mockup was a cost console — AI spend, not business
> money — and said so in its own copy. It becomes **Cost** (`/dashboard/cost`), and plans 26-06→26-10
> are **unchanged in substance**: the append-only spend ledger, reasoning/ingest instrumentation,
> media reserve/actual/refund/unlanded, tenant projections + owner-only controls, and the connected
> route. Rename and retitle only. **Cash** — revenue, invoices, runway — is a NEW surface owned by
> **Phase 28**, which currently has 29 plans and **not one that renders a page**; it needs a new
> "connected Cash route" plan shaped like 26-10. Neither page fabricates the other's numbers.
>
> **(2) Content NARROWS to an artifact shelf** — documents, reels, memos. **Sent mail moves to
> Reports** (which already owns sends-per-day and review outcomes; Approvals' "Cleared" covers the
> recent window). **Research briefs move to the Knowledge Vault** — they are cited grounding
> material that goes stale, which is what the Vault is for. The channel/funnel/metrics scope the
> mockup had put on Content moves to the **Marketing milestone** (ADR-015). Affects 26-11→26-13.
>
> **(3) Pipeline: the backing data gets built first.** Phase 19 is pulled forward (below). Note that
> **Phase 19 SC#8 already owns the Pipeline route** — 26-18 remains nav integration only.
>
> **RESOLVED 2026-08-09 (owner decision).** The mockup's Pipeline tiles included **"Open
> opportunities"** and **"Pipeline value"**, which both PIPE-01 and Phase 19 SC#8 forbid —
> *"does not invent opportunities, deal stages or monetary pipeline values."* **The tiles come off
> the mockup; PIPE-01 stands as written and is NOT amended.** Pipeline reads contacts needing
> attention, follow-ups due, consented and suppressed — every tile derived from the one person
> store. **No `opportunities` table, no stage enum, no `amountCents` anywhere in Phase 19.** Real
> money arrives with Phase 28's connector-backed Cash surface, from observed provider data rather
> than typed guesses. The schema that follows is two new tables: `contacts` and `followUps`.

**Goal:** Replace every remaining `pending-pages.html` placeholder with a tenant-safe, bounded and fully connected product surface, enabling each navigation entry only after its read model, governed actions, failure states, audit boundary and production verification path are real.
**Requirements**: DASH-01, APRV-01, FIN-01, CONT-01, RPRT-01, HOME-01
**External gate**: Phase 19 owns ACTN-05 and PIPE-01; Phase 26 consumes its approved Pipeline route/contracts only at the Pipeline integration wave.
**Depends on:** Phase 15.4 for the connected product-shell/design baseline. There is **no blanket Phase 25 dependency**. Plan-specific dependencies remain explicit: Pipeline pairs with Phase 19; Content consumes landed Phase 18/20 artifacts without blocking their unrelated work; Command Center follows the Phase 26 source surfaces.
**Execution position:** Pulled forward 2026-08-05. Start after Phase 15.4; run independent plans alongside existing lanes where file ownership does not overlap. Phase 25 consumes these finished surfaces rather than blocking them.
**Success Criteria** (what must be TRUE):
  1. Shared dashboard contracts enforce tenant/owner authorization, bounded pagination/time windows, honest loading/empty/partial/error states, IANA time, USD cost semantics and refs/counts-only audit before any new route is enabled.
  2. Approvals exposes a tenant-wide, indexed queue whose approve/schedule/cancel/discard/revise paths are state-guarded, idempotent and race-tested; unsupported inline calendar edits route back to the cockpit.
  3. Finance reports only durable estimated/reserved/actual/refunded spend recorded after an explicit coverage start, exposes tenant versus owner-global rails correctly, and never fabricates historical zeroes.
  4. Content unifies bounded projections over Vault artifacts, rendered media and sent mail with provenance, ownership-checked signed URLs and cockpit-prefill reuse; it does not duplicate content silently.
  5. Reports provides bounded business, operations and governance projections, a server-sanitized audit view, owner-only WORM/skill/deployment facts, and a governed board-pack artifact path.
  6. Pipeline ships with — and never duplicates — Phase 19's tenant-scoped contacts/follow-up/consent/suppression substrate; the send-path suppression guard remains the trust boundary.
  7. Command Center v2 composes stable page summaries and deterministic next-move/health logic after the source pages land; every page passes package tests, typechecks, production build, playbook watchers and authenticated responsive UAT before its nav item becomes live.
**Plans:** 8/20 plans executed

Plans:
- [x] 26-01-PLAN.md — Shared result/window/money contracts and dashboard playbook ownership (Wave 1)
- [x] 26-02-PLAN.md — Single-owner additive schema and index foundation (Wave 1)
- [x] 26-03-PLAN.md — Approvals discard, schedule move and progress state machines (Wave 2)
- [x] 26-04-PLAN.md — Bounded tenant-safe Approvals read models (Wave 2)
- [ ] 26-05-PLAN.md — Connected Approvals route, executed browser gate, owner UAT, then nav activation (Wave 3)
- [ ] 26-06-PLAN.md — Append-only spend ledger and coverage-start core (Wave 4)
- [ ] 26-07-PLAN.md — Reasoning and ingest ledger instrumentation (Wave 5)
- [ ] 26-08-PLAN.md — Media reserve/actual/refund/unlanded instrumentation (Wave 5)
- [ ] 26-09-PLAN.md — Tenant Finance projections and owner-only controls (Wave 6)
- [ ] 26-10-PLAN.md — Connected Finance route, executed browser gate, owner UAT, then nav activation (Wave 7)
- [ ] 26-11-PLAN.md — Artifact provenance and idempotent promotion (Wave 8)
- [ ] 26-12-PLAN.md — Bounded Content union, safe URLs, reuse and Refresh Research terminals (Wave 9)
- [ ] 26-13-PLAN.md — Connected Content route, executed browser gate, owner UAT, then nav activation (Wave 10)
- [ ] 26-14-PLAN.md — Business/operations reporting semantics and bounded projections (Wave 11)
- [ ] 26-15-PLAN.md — Sanitized governance projection and owner-only operational facts (Wave 11)
- [ ] 26-16-PLAN.md — Immutable board-pack snapshot/render artifact (Wave 12)
- [ ] 26-17-PLAN.md — Connected Reports route, privacy gate, owner UAT, then nav activation (Wave 13)
- [ ] 26-18-PLAN.md — External Phase 19 Pipeline safety/UAT gate and nav integration only (Wave 14)
- [ ] 26-19-PLAN.md — Deterministic home priority, health, briefing and source-summary composition (Wave 15)
- [ ] 26-20-PLAN.md — Command Center v2, full repository gates and blocking owner UAT (Wave 16)

## Post-Beta Knowledge-Work Expansion (Phases 27-30)

These phases are the reviewed expansion queue after Phase 25 opens the private beta. They do not
become new beta-admission blockers, and they extend the same Executive Agent, business memory,
approval model, tenant boundary and outcome-measurement philosophy rather than adding a plugin
catalogue or parallel runtime.

### Phase 27: Curated Knowledge-Work Pack Pilot

**Goal:** Prove that six high-value external workflow patterns can become native, governed Pikar packs without importing a second plugin runtime, router, memory plane or capability boundary.
**Requirements**: PACK-01, PACK-02, PACK-03, PACK-04
**Depends on:** Phase 25 for the live private-beta identity/connector baseline; consumes landed Phase 16 research, Phase 17 calendar, Phase 18 content, Phase 19 contacts and Phase 26 source summaries. This is queued post-beta work and does not block Phase 25.
**Success Criteria** (what must be TRUE):
  1. An exact upstream commit/file manifest and Apache-2.0 attribution/modification record exist for every adapted source; updates require a reviewed diff and cannot auto-activate.
  2. Business Pulse, Campaign Plan, Customer Complaint Response, Sales Call Prep, Process/SOP Builder and Brand Review are native Pikar skills/workflows using one Executive Agent, one Business Blueprint/Vault memory and existing artifact/plan surfaces.
  3. Every operation is classified as existing, explicitly missing or forbidden; code-owned grants and structural tool absence enforce the matrix, untrusted connector content cannot reach writes, and no workflow bypasses the plan gate.
  4. All six candidates pass outcome-state/adversarial evals and authenticated responsive browser gates before becoming discoverable, with honest missing-source and partial-result states.
  5. The shared refs/counts-only measurement layer reports time-to-first-outcome, recommendation acceptance, plan decisions, missing-connector surprises, evidence quality, completion, cost and latency per workflow.
**Plans:** 9 plans across 5 waves

Plans:
- [ ] 27-01-PLAN.md — Pin upstream sources, Apache-2.0 provenance and reviewed-update controls (Wave 1)
- [ ] 27-02-PLAN.md — Native pack contracts, code-owned grants, candidate lifecycle and fixture runner (Wave 1)
- [ ] 27-03-PLAN.md — Privacy-bounded workflow outcome measurement (Wave 2)
- [ ] 27-04-PLAN.md — Business Pulse and Campaign Plan adaptations/evals (Wave 2)
- [ ] 27-05-PLAN.md — Complaint Response and Sales Call Prep adaptations/evals (Wave 2)
- [ ] 27-06-PLAN.md — Process/SOP and Brand Review adaptations/evals (Wave 2)
- [ ] 27-07-PLAN.md — Executive Agent runtime and real terminal-event integration (Wave 3)
- [ ] 27-08-PLAN.md — Final provenance/parity, candidate publication and exact-version evals (Wave 4)
- [ ] 27-09-PLAN.md — Authenticated browser evidence, owner gate, activation and rollback (Wave 5)

### Phase 28: Connector-Backed Revenue Pack

**Goal:** Add the read-only business-data rails that turn the pilot into measurable revenue and cash outcomes, while keeping mutations structurally behind Pikar's approved-plan executor.
**Requirements**: REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06
**Depends on:** Phase 27 and completed Phase 19 ACTN-05/PIPE-01. Provider adapters additionally require Phase 25's production secret/OAuth posture. No MCP endpoint is assumed suitable until its execution-time review passes.
**Success Criteria** (what must be TRUE):
  1. HubSpot, QuickBooks, Stripe and PayPal each pass server-side endpoint/OAuth/security/data-processing/rate-limit/terms review and expose tenant-scoped read-only projections with encrypted, revocable credentials and honest re-auth/error states.
  2. Lead triage, call lists, pipeline reviews and customer pulse consume Phase 19's one person/consent/suppression store and never invent or duplicate CRM state.
  3. Cash-flow and payroll-confidence calculations are deterministic pure-TypeScript domain logic with fixtures, normalized-input validation, provenance, coverage/confidence semantics and no LLM arithmetic.
  4. Invoice reminders stage drafts into the existing plan gate; no revenue specialist can send, refund, credit or mutate CRM/accounting state directly.
  5. Authenticated two-tenant tests, provider replay/rate-limit tests and live read-only smoke gates pass before each connector-backed workflow is exposed; outcome telemetry can measure follow-up completion, overdue-item recovery and handling time without raw content.
**Plans:** 29 plans across 20 waves

Plans:
- [ ] 28-17-PLAN.md — Hard Phase 19/25/27 readiness gate before connector work (Wave 1)
- [ ] 28-01-PLAN.md — Independent provider suitability, OAuth, security and terms decisions (Wave 2)
- [ ] 28-18-PLAN.md — Operational playbook and watch ownership (Wave 2)
- [ ] 28-02-PLAN.md — Normalized deterministic finance core (Wave 2)
- [ ] 28-03-PLAN.md — Encrypted credentials and additive connector schema (Wave 3)
- [ ] 28-04-PLAN.md — Shared OAuth/revocation/security mechanics without a generic runtime (Wave 4)
- [ ] 28-26-PLAN.md — Durable machine-readable provider eligibility gate (Wave 5)
- [ ] 28-05-PLAN.md — Independent read-only HubSpot rail (Wave 6)
- [ ] 28-06-PLAN.md — Independent read-only QuickBooks rail (Wave 6)
- [ ] 28-07-PLAN.md — Independent read-only Stripe rail (Wave 6)
- [ ] 28-08-PLAN.md — Independent read-only PayPal rail (Wave 6)
- [ ] 28-22-PLAN.md — HubSpot judgment and machine gate sealing (Wave 7)
- [ ] 28-23-PLAN.md — QuickBooks judgment and machine gate sealing (Wave 7)
- [ ] 28-24-PLAN.md — Stripe judgment and machine gate sealing (Wave 7)
- [ ] 28-25-PLAN.md — PayPal judgment and machine gate sealing (Wave 7)
- [ ] 28-09-PLAN.md — Eligible-provider callback, status and connection integration (Wave 8)
- [ ] 28-10-PLAN.md — Phase 19-native CRM outcome projections (Wave 9)
- [ ] 28-11-PLAN.md — Available-rail cash-flow and payroll-confidence composition (Wave 9)
- [ ] 28-12-PLAN.md — Minimal read-only revenue specialist grant (Wave 10)
- [ ] 28-13-PLAN.md — Invoice reminders behind existing approval and suppression (Wave 11)
- [ ] 28-14-PLAN.md — Provider-neutral revenue body authoring (Wave 12)
- [ ] 28-28-PLAN.md — Reviewed-body publication as byte-pinned dark candidates (Wave 13)
- [ ] 28-19-PLAN.md — State-based golden outcome and adversarial eval suite (Wave 14)
- [ ] 28-20-PLAN.md — Version-specific activation after evidence and owner judgment (Wave 15)
- [ ] 28-15-PLAN.md — Privacy-safe revenue outcome measurement (Wave 16)
- [ ] 28-21-PLAN.md — Provider/workflow terminal telemetry wiring (Wave 17)
- [ ] 28-29-PLAN.md — Plan-decision and observed-recovery telemetry wiring (Wave 18)
- [ ] 28-16-PLAN.md — Automated live/browser/repository exposure evidence (Wave 19)
- [ ] 28-27-PLAN.md — Owner subset decision and strict named-provider phase sealing (Wave 20)

### Phase 29: Unified Knowledge and Routines

**Goal:** Turn connected Pikar knowledge into one cited cross-source search experience and turn Phase 21 from a generic prompt editor into safe workflow-pack customization and repeatable routines.
**Requirements**: KNOW-01, ROUT-01, ROUT-02
**Depends on:** Phase 28 and Phase 21's tenant-scoped candidate/eval authoring seam. Recurrence remains gated on an explicit standing-instruction/OAuth decision and is not implied by this phase's existence.
**Success Criteria** (what must be TRUE):
  1. One bounded tenant-scoped query decomposes across available native adapters, synthesizes cited/deduplicated answers, scores authority/freshness/confidence and identifies unavailable/partial sources without an arbitrary MCP client.
  2. Users customize approved workflow-pack templates as immutable tenant-scoped candidates; templates can change instructions/preferences but cannot widen code-owned tools or publish executable code.
  3. Candidate activation uses outcome-based held-out evals and authenticated UAT; provenance identifies upstream template, user edits, version, evidence and rollback target.
  4. The manually re-runnable pinned workflow remains the safe baseline. Recurrence ships only if approval-template semantics, token expiry/re-auth, timezone/DST, missed runs, idempotency, pause/revoke and audit behavior are all decided and proven.
  5. Search and routine telemetry reports evidence coverage, unsupported claims, repeat use, completion, cost and latency through refs/counts-only events.
**Plans:** 13 plans across 9 waves

Plans:
- [ ] 29-01-PLAN.md — Dependency audit, pure contracts, schema and playbook boundary (Wave 1)
- [ ] 29-02-PLAN.md — Vault and Drive native knowledge adapters (Wave 2)
- [ ] 29-03-PLAN.md — Gmail and landed CRM/support adapters behind toolless ingestion (Wave 2)
- [ ] 29-04-PLAN.md — Registry-owned toolless query planning and cited synthesis (Wave 2)
- [ ] 29-05-PLAN.md — Schema-driven tenant pack candidates through Phase 21 (Wave 3)
- [ ] 29-06-PLAN.md — Bounded cited cross-source search coordinator (Wave 3)
- [ ] 29-09-PLAN.md — Unified knowledge workspace UI and browser gate (Wave 4)
- [ ] 29-07-PLAN.md — Pack customization UI and held-out eval corpus (Wave 4)
- [ ] 29-08-PLAN.md — Version-pinned manual workflow reruns (Wave 5)
- [ ] 29-10-PLAN.md — Authenticated customization/manual-rerun release gate (Wave 6)
- [ ] 29-11-PLAN.md — Fail-closed recurrence governance and live-evidence decision (Wave 7)
- [ ] 29-12-PLAN.md — Deferred-absence proof or approved recurrence backend (Wave 8)
- [ ] 29-13-PLAN.md — Branch-correct routine UI, live evidence and final owner gate (Wave 9)

### Phase 30: Optional Vertical Workflow Packs

**Goal:** Offer selectively relevant Legal, HR, Product, Design, Engineering and Data workflow packs without turning the core solopreneur product into a catalogue or weakening high-stakes safeguards.
**Requirements**: VERT-01, VERT-02, VERT-03, VERT-04
**Depends on:** Phase 29's native pack authoring/search substrate and behavioral evidence from Phases 27-29. Each external connector has an independent suitability gate.
**Success Criteria** (what must be TRUE):
  1. Tier/profile/capability rules recommend at most the relevant packs and never alter tool authority; users can inspect why a pack is available or blocked.
  2. Legal, HR, Product, Design, Engineering and Data each have separately versioned native templates, provenance, outcome contracts, disclaimers, adversarial evals and authenticated UAT before exposure.
  3. High-stakes Legal/HR/Data outputs are explicitly assistive, grounded and review-required; Data begins file-first/read-only and external system execution is absent until a dedicated adapter gate passes.
  4. Vertical metrics prove useful outcomes and repeat use rather than install count; a pack can be disabled independently without damaging shared memory or artifacts.
  5. Bio Research remains excluded until behavioral demand and a separate scientific, licensing, data and regulated-risk plan exist.
**Plans:** 10 plans across 6 waves

Plans:
- [ ] 30-01-PLAN.md — Shared vertical safety/relevance contracts and structural Bio exclusion (Wave 1)
- [ ] 30-02-PLAN.md — Tenant discovery, evidence, telemetry and independent controls (Wave 2)
- [ ] 30-03-PLAN.md — Deterministic file-first Data pack (Wave 3)
- [ ] 30-04-PLAN.md — Product and Design artifact-only candidates (Wave 3)
- [ ] 30-05-PLAN.md — Legal issue-spotting candidate and high-stakes boundary (Wave 3)
- [ ] 30-06-PLAN.md — HR hiring/onboarding candidate and employment-decision boundary (Wave 3)
- [ ] 30-07-PLAN.md — Engineering architecture/runbook candidate without production authority (Wave 3)
- [ ] 30-08-PLAN.md — Shared candidate publication, provenance and eval integration (Wave 4)
- [ ] 30-09-PLAN.md — Authenticated UAT and evidence-based exposure of at most two packs (Wave 5)
- [ ] 30-10-PLAN.md — Six-pack activation/rollback drills, Bio scan and final owner gate (Wave 6)

---

## EXTERNAL BLOCKER (non-code, unscheduled): the legal entity

**Status as of 2026-08-07: NOT STARTED.** Recorded here as a first-class roadmap item because it is
not a coding task and therefore has never had a phase, yet it gates more product surface than any
single phase does. `.planning/design/growth-surfaces-canvas-funnels-connections.md` §5.8 calls it
"the highest-leverage non-code task in the project."

What it blocks, simultaneously:

| Dependent | Where |
|---|---|
| Google OAuth verification (privacy policy must name a real data controller) | already-deferred; caps Gmail Testing mode at a **7-day refresh-token lifetime**, which is why `SEND_TIME_HORIZON_MS` is 7 days |
| Custom domain registrant + TLS | Phase 25 SC#6 |
| Meta Business Verification, LinkedIn Marketing Developer Platform | Marketing **tranche B** (Phase 32) |
| CASA assessment | Phase 25 posture |
| Billing | post-beta commercialization |

**Nothing downstream of this row can be scheduled by deciding it is important.** A plan that dates
tranche B before the entity exists is wrong on its face.

---

## Milestone: Marketing (Phases 31-32) — PULLED PRE-BETA 2026-08-07

*Owner decision 2026-08-07, recorded as `docs/decisions/015-marketing-milestone-pulled-pre-beta.md`.
The Content page's channel/funnel/metrics scope moves here; Content narrows to an artifact shelf.*

**This milestone is an explicit override of `PROJECT.md:51-53`'s admission rule** (no idea → phase
without an evidence-backed Validated line; `PROJECT.md:49` still records `Validated: (None yet)`).
The rule is not repealed and continues to govern every other idea. ADR-015 is the override record.

**It also supersedes the 2026-07-31 refusals** of the funnel phase and of social publishing
(`FEATURES.md:179`). ADR-015 §2 is load-bearing and is NOT superseded by the same stroke: a social
post stages into the existing plan gate exactly as an email does. **Approve-once-for-many and
standing pre-authorized rules stay deferred** (ADR-004 §56-58) — "auto-publishing" remains refused;
what is admitted is human-approved publishing.

**Execution position:** runs before Phase 25, alongside Phase 19 (which it depends on) and the
remaining Phase 26 work where file ownership does not overlap. **Phase 25 slips by the duration of
tranche A** — taken knowingly.

### Phase 31: Marketing surface and funnel v0 (TRANCHE A — buildable now)

**Goal:** A Marketing surface where the user manages outbound channels with Executive Agent
assistance, honest about every channel not yet connectable, plus the link-only funnel that produces
the first real click evidence this milestone was admitted without.
**Requirements**: MKTG-01, MKTG-02, MKTG-03
**Depends on:** Phase 19 (the one person store — contacts, `origin`, consent, `unsubscribedAt`, and
the SEND-path suppression guard). **No dependency on the legal entity.**
**Success Criteria** (what must be TRUE):
  1. The Marketing route renders every planned channel with an honest state — connected, connectable,
     or **blocked-with-reason** (naming the legal entity for tranche B channels). An unconnectable
     channel never renders as a zero; BRAND §5's no-fabricated-numbers rule governs this page.
  2. Funnel v0 is link-only and lives on the Convex `httpAction` plane, never a Next route: one
     unguessable token → increment three integer counters (visits / claims / downloads) → 302 to
     `ctx.storage.getUrl(...)`, with `?s=` source attribution. **This is the product's first
     unauthenticated read** and ships with the review weight that deserves; `apps/web/middleware.ts`
     is NOT widened.
  3. A captured lead writes into Phase 19's single person store with `origin`, `consentAt` and
     `consentSource` — never a second CRM plane, never a `contacts` bypass.
  4. Agent assistance on this surface proposes; it does not publish. Every outbound action stages
     into the existing plan gate.
  5. No `funnelEvents`-style event table ships in this phase — three integer columns only
     (`growth-surfaces...md` §4 item 8, relaxed by ADR-015 §4 for tranche B metrics ONLY).
**Plans**: TBD

### Phase 32: Channel connection, publishing and metrics (TRANCHE B — GATED)

**Goal:** Connect real social channels, publish to them through the plan gate, and report per-post
engagement — the half of the owner's 2026-08-07 request that external providers gate.
**Requirements**: MKTG-04, MKTG-05, MKTG-06
**Depends on:** **THE LEGAL ENTITY (see the blocker section above) — hard, external, not started.**
Also Phase 31. Meta Business Verification and LinkedIn's Marketing Developer Platform both require a
verified legal business before issuing API access; this phase cannot start at any priority until
that clears. Each provider additionally carries its own suitability gate in the Phase 28 pattern
(endpoint/OAuth/security/data-processing/rate-limit/terms review) — none is assumed eligible.
**Success Criteria** (what must be TRUE):
  1. Each social channel passes an independent suitability review and exposes tenant-scoped,
     encrypted, revocable credentials with honest re-auth and error states.
  2. Publishing and scheduling stage into the **existing** plan gate; deferred posts reuse the
     shipped Phase 3.5 deferred-send machinery (one approved plan, one future instant, cancellable).
     No new unattended authority is minted.
  3. Per-post engagement metrics store **provider ids, counts and timestamps ONLY** — never post
     text, never recipient identity. The refs-and-counts contract (CLAUDE.md §4) governs this table
     as it governs audit. The table arrives WITH a connected channel, never empty and ahead of one.
  4. A tenant can disconnect any channel with revocation at the provider, not merely a local token
     delete (GOVN-03's standard, applied to every new provider).
**Plans**: TBD (do not plan before the blocker clears)

**Known sequencing gap — lead-to-sale conversion.** The owner's request included conversion from
lead to sale. That attribution needs a payment/CRM rail, and those live in **Phase 28**, which is
post-beta and depends on Phase 27 → Phase 25. So pre-beta Marketing delivers funnels and leads;
**conversion-to-sale arrives with Phase 28 unless a read-only Stripe slice is separately pulled
forward.** Recorded rather than silently assumed — it is an open owner decision.

---

## Milestone v2.0 - Platform -> Private Beta (Phases 10-25)

*Defined 2026-07-24. Grow the governed email cockpit into a broadly-capable AI chief-of-staff, then open the invite-only beta on top of it. Dependency-ordered staircase S1->S4; every v2.0 requirement maps to exactly one phase (24/24 covered). Phases 1-9 above are shipped v1.0 history - not renumbered.*

**S1 - Foundation & Intelligence**
- [x] **Phase 10: Vault->Agent Grounding** - The agent finally reads the vault mid-conversation via a governed `searchVault` tool (the root dependency everything else grounds on)
 (completed 2026-07-24)
- [x] **Phase 11: Persona Onboarding & Business Profile** - Guided first-run persona detection (solopreneur/startup/SME) + business/idea intake -> structured profile in the vault
 (completed 2026-07-24)
- [x] **Phase 12: Business Evaluation Engine** - On-demand grounded assessment (SWOT/Lean/BMC) + gaps -> governed action proposals + honest "no gaps"
 (completed 2026-07-25)
- [x] **Phase 13: Proactive In-App Review** - Scheduled recurring in-app business review, using no OAuth mailbox token
 (completed 2026-07-25)
- [x] **Phase 14: Flagship Voice-Doc Workflow** - Upload a report -> discuss by voice -> grounded insights/patterns/gaps -> memo or gap-bridging plan (9/9 plans; owner live human-verify APPROVED 2026-07-26 — real call, grounded drill-in, and BOTH outcome paths: memo saved to the vault + a gap turned into a plan that produced an email through the Approve gate. SC4 enforced by seven mutation-verified static scans. Open by decision: the tool-declaration branch (Open Question 3, unrecoverable post-session) and retrieval latency)

**S2 - Breadth of Action**
- [x] **Phase 15: Sub-Agent Dispatch & Generalized Action Executor** - Real swappable (skill, tool-set) dispatch + action-agnostic approve->execute spine (the framework all breadth rides)
 (completed 2026-07-25)
- [x] **Phase 15.1: Fact-Derived Tier & Conversational Onboarding** (INSERTED 2026-07-25) - Tier becomes derived-from-facts and non-self-assignable (no direct tier control in the UI *or* the mutation), conversational onboarding, agent name + behavior preset; plugs tier filtering into the Phase-15 dispatch seam. Consumes `.planning/design/tier-and-conversational-onboarding.md` (completed 2026-07-26)
- [x] **Phase 15.2: Vault Universal Format Recognition & Extraction Fan-Out** (INSERTED 2026-07-27) - Content-based (magic-byte) format recognition replacing the MIME allow-list, full common-format coverage incl. legacy Office, never-silent extraction failure, and per-page fan-out so scanned PDFs transcribe verbatim. Consumes `docs/superpowers/specs/2026-07-27-vault-format-coverage-and-extraction-fanout-design.md`. Runs as a third concurrent lane alongside 16/17
 (completed 2026-07-27)
- [ ] **Phase 15.3: Vault Folders - Folder Ingest, Synthesis & Drill-In** (INSERTED 2026-08-02) - The deliberately-deferred "Phase 2" of the 15.2 line, carved out at `15.2-CONTEXT.md:170-184` and never given a slot: a `vaultFolders` table + optional `folderId`, folder upload at 1-1.5 GB with the per-file cap raise to 200 MB (safe now that 15.2's fan-out bounds per-action memory), folder-level synthesis where the digest IS ITSELF a vault document so it embeds for free, a folder-scoped drill-in reusing `PreviewModal`, and a per-folder budget estimate + reservation. **The reservation is load-bearing, not polish:** every ingest opens with `guardrails.preCall`, so a large folder can trip the daily budget mid-run and leave half its documents `failed` - and a half-ingested folder is WORSE than a refused one, because the agent grounds on it confidently. SCOPE EXPANDED 2026-08-02 to SEVEN items: the owner put the two remaining carve-out deferrals back in scope — document identity classification as a first-class classifier (it applies to single-file uploads too) and the Google Drive export rail (one-time 1:1 import, re-import on demand, same budget window). Unblocks Phase 17.1's Stage-2 drift trigger, which fires on bulk/folder-ingest completion and degrades to a one-click rebuild banner until this exists (`17.1-RESEARCH.md:114`)
- [x] **Phase 16: Research Sub-Agent & Web Research** - First exemplar specialist + injection/SSRF-hardened web research stored in the vault
- [x] **Phase 17: Calendar Actions** - Governed Google/Microsoft calendar events (read in-loop, write plan-gated)
 (completed 2026-07-30)
- [ ] **Phase 17.1: Business Blueprint - Corpus Synthesis & Agent Spine** (INSERTED 2026-07-27) - One cited artifact (typed profile + document-derived gaps + graph entities) prepended in `vaultGroundHydrated`, so every agent surface has standing business context instead of query-scoped retrieval only. Draft -> user confirms -> live; typing is never overwritten. Consumes `docs/superpowers/specs/2026-07-27-business-blueprint-design.md`. NOT a concurrent lane - sequenced after 15.2/16/17 merge (shares `vaultGround.ts` with Lane R)
- [ ] **Phase 18: Document & Content Creation** - Standalone documents/content artifacts beyond email attachments - a second output format (self-contained HTML) through the SAME governed render path; no sites table, no ActionType, no public route
- [ ] **Phase 19: Contacts, CRM & Follow-ups** - Scoped contact/CRM state + follow-ups (read in-loop, write plan-gated) + leads/consent/unsubscribe, with the suppression check in the SEND path and the CAN-SPAM postal address on the tenant profile

**S3 - Creation & Self-Extension**
- [ ] **Phase 20: Media Canvas** - A finished short-form reel (clips + voiceover, assembled to one mp4) via fal.ai as async governed jobs with a separate cost cap
- [ ] **Phase 20.1: Drive in the Cockpit** (INSERTED 2026-08-05) - the Executive Agent can browse and SEARCH the user's Google Drive to answer "which folder has the Q3 numbers", and provably cannot import from it. READ HALF ONLY: no new scope (drive.readonly, already granted and live-verified), no new consent, no write risk. **Numbered 20.1 because the constraint is the SKILL BODY, not the tools** — cockpit-agent is a GATED skill with ONE candidate stream and both 18-08 and 20-12 already edit it, so this runs after both. Agent-initiated import is deliberately OUT (it would need the Calendar propose-then-approve shape, a phase of its own); creating a Drive folder is IMPOSSIBLE without a restricted write scope behind a CASA assessment
- [ ] **Phase 21: User-Authored Skills & Routines** - User authors business-adapted skills through the eval-gated registry (candidate-only); a routine is a skill body + a trigger row, and the pre-beta deliverable is a re-runnable pinned prompt (no routines table, no cron, no canvas)
- [ ] **Phase 22: Owner Authorization Primitive** - `requireOwner` gates the three Phase-8 functions + admin controls (pulled EARLY - needed before Phase 23 and before multi-user)
- [ ] **Phase 22.1: Beta Admission Readiness** (INSERTED) - Gmail disconnect + Google token revocation (the privacy policy currently promises a control that does not exist), per-tenant keying of the deployment-wide `dailySpendCents` window, and a green deployment/typecheck/CI gate
- [ ] **Phase 23: Agent-Authored Skills** - Agent authors candidate-only skills; activation needs the eval gate PLUS owner approval

**S4 - Governance & Open the Beta**
- [ ] **Phase 24: ISO 9001 Conformance Map** - Map existing audit/skill-versioning/playbook change-control to ISO 9001:2015 clauses; fill only genuine gaps
- [ ] **Phase 25: Private Beta Productionization** - Invite/waitlist, cross-tenant isolation test, fast onboarding, Outlook (DLVR-02) + the provider adapter Outlook forces into existence, the custom-domain decision, Vercel deploy - the beta opens LAST (absorbs former Phase 9, consumes `09-CONTEXT.md`)

## Phase Details

### Phase 1: Foundation & Governance Substrate
**Goal**: The governed data + orchestration substrate exists so every later feature inherits tenant isolation, immutable audit, durable workflows, and failure handling for free â the decisions that are cheap now and expensive to retrofit.
**Depends on**: Nothing (first phase)
**Requirements**: OPSG-02, OPSG-04
**Success Criteria** (what must be TRUE):
  1. The full stack (Next.js + Convex + Python sidecars) boots from a clean clone by following the README, with the Workflow/Agent/RAG/RateLimiter/ActionRetrier components wired and all domain logic living in pure-TS `packages/*` imported by a thin `convex/` adapter.
  2. Every write flows through the `customQuery`/`customMutation` tenant wrapper â a query that omits `tenantId` scope cannot be written.
  3. Any state change appends to the insert-only audit module (no update/delete functions exist), and a deliberately failed smoke-test workflow lands in the dead-letter table via `onComplete`.
  4. The `awaitEvent`-timeout race pattern and the WORM (S3 Object Lock) export cron stub are demonstrated on a smoke-test workflow.
  5. ~~Google OAuth verification paperwork (privacy policy, verified domain, homepage) is submitted in Week 1~~ â **DEFERRED to Phase 9.** The homepage, privacy policy and Terms are written (01-08 Task 1). Submission is blocked on forming a legal entity: Google's review reads a privacy policy that must name a real data controller. Gmail **Testing mode** (100 test users, sensitive scopes permitted, 7-day token expiry â already anticipated by Phase 2 SC-5) carries Phases 2â8 with no verified domain and no public site. Verification's 2â4 week clock therefore blocks Phase 9 (private beta), not Phase 2. graphify (git hook + MCP) is active on the repository.
  6. A versioned skills registry (Convex `skills` table + loader contract) exists and the Executive Agent's seed skill document loads from it â no agent prompt is hardcoded (SkillOpt readiness, see research/SKILLOPT.md).
**Plans**: 9 plans

Plans:
- [x] 01-01-PLAN.md â Monorepo scaffold, five-component wiring, schema, auth, test harness, boot-check, README/CLAUDE.md (Wave 1)
- [x] 01-02-PLAN.md â Tenant-scoping customQuery/customMutation wrapper + raw-builder ban + isolation tests (Wave 2)
- [x] 01-03-PLAN.md â Insert-only audit module + taxonomy package + immutability scan [OPSG-02] (Wave 2)
- [x] 01-04-PLAN.md â Versioned skills registry + loader + Executive Agent seed skill (Wave 2)
- [x] 01-05-PLAN.md â graphify install: git hook + MCP on the repo (Wave 2)
- [x] 01-06-PLAN.md â DLQ via onComplete + awaitEvent-timeout race smoke workflows [OPSG-04] (Wave 3)
- [x] 01-07-PLAN.md â WORM export cron stub + export cursor mechanics (Wave 3)
- [~] 01-08-PLAN.md â Task 1 DONE (homepage + privacy + Terms, all static, build-green). Tasks 2â3 (Vercel deploy, domain + Search Console) **DEFERRED to Phase 9** â blocked on legal entity, and unnecessary for Phases 2â8 (Wave 3)
- [ ] 01-09-PLAN.md â Google OAuth consent flow + demo video + verification submission â **DEFERRED to Phase 9.** Cannot submit: verification reads a privacy policy that must name a real data controller (Wave 4)

### Phase 2: Thin End-to-End Slice
**Goal**: A user submits a typed goal and follows it all the way to a delivered email, approving it at a durable review gate, with the entire trail audited and visible live â the MVP spine that proves the core value proposition.
**Depends on**: Phase 1
**Requirements**: INTK-01, INTK-04, AGNT-01, AGNT-02, AGNT-03, REVW-01, DLVR-01, DLVR-03, OPSG-01, OPSG-06, OPSG-07, BETA-04
**Gmail runs in Testing mode**: 100 test users, `gmail.send` permitted unverified (users see an "unverified app" warning), and refresh tokens expire after 7 days â which is exactly what SC-5 below already anticipates. No verified domain, no public site, no legal entity required for this phase.
**Components**: `@convex-dev/migrations` (OPSG-06 â adopt BEFORE the first schema change, not after); `@convex-dev/aggregate` for OPSG-01 counters â the `audit` table is append-only and unbounded, so any `.collect()`-based count will eventually exceed Convex read limits and hard-fail rather than degrade.
**Success Criteria** (what must be TRUE):
  1. User submits a text request (with optional attachment upload) and watches its pipeline status and review queue update in real time via reactive `useQuery` subscriptions â no refresh.
  2. User sees the Executive Agent's routing decision and step plan before anything runs, and can approve, edit, or reject the generated response.
  3. An approved response is delivered to a real inbox via Gmail (Testing mode); an invalid/unauthenticated request is rejected with a notification and an auditable "Request Rejected â Validation Failed" outcome.
  4. An unknown/invalid routing value is sent to the dead-letter store instead of silently defaulting.
  5. Every request produces telemetry (tokens, cost, duration, decision counts, review outcome) and a full audit trail, and a Gmail token nearing its 7-day expiry prompts the user to re-auth before it breaks.
**Plans**: 9 plans (02-01â02-07 executed; 02-08/02-09 SUPERSEDED by Phase 3.1 â see note below)

Plans:
- [x] 02-01-PLAN.md â Migrations + aggregate components, +5 tables, first migration, audit aggregate wiring (Wave 1)
- [x] 02-02-PLAN.md â routingDecision contract + two seeded skills + LLM route/draft action via AI Gateway (Wave 2)
- [x] 02-03-PLAN.md â Submit mutation + INTK-04 validation + requests queries + in-app notifications (Wave 2)
- [x] 02-04-PLAN.md â Review-gate decision union + attempt-suffixed event + write-once telemetry (Wave 2)
- [x] 02-05-PLAN.md â Gmail gmail.modify OAuth connect flow + token storage + REST send + token-age cron (Wave 2)
- [x] 02-06-PLAN.md â Pipeline workflow spine + operator dead-letter surface + full-spine/DLQ smoke (Wave 3)
- [x] 02-07-PLAN.md â Google sign-in + Next.js auth wiring + app shell + persistent DLQ badge + privacy edit (Wave 4)
- [~] 02-08-PLAN.md â Submit form + attachment picker + live requests list â **SUPERSEDED by Phase 3.1 (2026-07-12).** Code shipped ad-hoc (files on disk), but the `/submit` form is the retired UX the cockpit replaces; the human-verify checkpoint was NOT run and SC-1 end-user verification is reassigned to 3.1. `AttachmentPicker` + live-list patterns carry forward into the cockpit composer/report (Wave 5)
- [~] 02-09-PLAN.md â Review queue + collapsed gate + ops page + connect-gmail + reconnect banner â **SUPERSEDED (partial) by Phase 3.1 (2026-07-12).** RETIRED: the `/review` queue + collapsed gate (the cockpit approves at the PLAN, not a mid-run gate). SURVIVES & reused by the cockpit: `/connect-gmail` (prerequisite), the ops page (OPSG-07), and `ReconnectBanner` (DLVR-03) â do NOT delete these. Human-verify checkpoint NOT run; SC-2 reassigned to 3.1 (Wave 5)

**02-08/02-09 supersession (2026-07-12):** Per the approved Email Chat Cockpit design, the manual submit-form + review-queue UX is replaced by the Phase 3.1 cockpit rather than finished and verified here. Nothing is deleted now (design: retired pages are "Kept, retired later"). Phase 2's **backend spine is complete** (routing, drafting, review-gate mechanics, Gmail delivery, DLQ, telemetry, audit, migrations, aggregate) and unblocks Phase 3; the user-facing verification of SC-1 (submit + live status) and SC-2 (see-plan + approve/edit/reject) moves to Phase 3.1's manual checkpoint, where the real cockpit UX is exercised end to end.

### Phase 3: Guardrails
**Goal**: Every request passes cost, PII, and quality guardrails before any external model call, and runaway spend is structurally impossible â governance as a shipped product feature, slotted into the existing pipeline steps.
**Depends on**: Phase 2
**Requirements**: GRDL-01, GRDL-02, GRDL-03, GRDL-04, GRDL-05, GRDL-06
**PII engine (decided 2026-07-12)**: pure-TS `packages/pii` â `scanText` (email/card+Luhn/SSN/phone â stable placeholders, fail-closed Result) exists and is tested; Phase 3 wires it ahead of the marked `ponytail:` slots in `llm.ts` route/draft. Design record + open tensions (names-in-prose, cache-collision semantics, fail-closed UX): `.planning/design/pii-engine.md`.
**Components**: `@convex-dev/action-cache` implements GRDL-04. The cache key MUST include `tenantId` alongside `safeTextHash` â action-cache keys on the action's args, so omitting `tenantId` would serve one tenant's LLM response to another. That is a cross-tenant data leak, not a cache miss. GRDL-02 additionally forbids raw PII in the key, hence hashing `safeText` rather than keying on it.
**Success Criteria** (what must be TRUE):
  1. Every request is PII-scanned and redacted to `safeText` before any external model call, and an unknown/null scan result fails closed (request stops rather than proceeding).
  2. No raw PII appears in any log, telemetry record, or cache key â redaction always precedes logging (redact-then-log ordering enforced as a step contract).
  3. Over-budget requests (estimated from `safeText`) automatically downgrade to a cheaper model, and a per-user rate limit plus a cost kill-switch hard-stop runaway spend; unknown/null cost results fail closed.
  4. Two different users submitting identical redacted input receive isolated, tenant-namespaced cache entries, and a cache hit returns without a model call.
  5. A primary model failure or timeout transparently triggers fallback generation.
**Plans**: 5 plans

Plans:
- [x] 03-01-PLAN.md â Pure domain logic: @pikar/cost (estimate/downgrade/price, fail-closed) + isFallbackEligible classifier + SafeText brand (Wave 1)
- [x] 03-02-PLAN.md â Platform prep: action-cache 0.3.1 exact-pin install, safeText/safeTextHash schema rails + guardrailConfig, scanning/blocked statuses + blocked telemetry outcome (Wave 1)
- [x] 03-03-PLAN.md â Guard choke point: guardrails.ts (kill switch, scanâpersist, costâmodel choice, daily-spend window) + per-user submit rate limit [GRDL-01/03/06] (Wave 2)
- [x] 03-04-PLAN.md â Rewire llm.ts (fail-closed safeText reader, tenant-namespaced cache, cheap-model fallback) + pipeline guard step/blocked terminal/priced spend + GRDL-02 static scan (Wave 3)
- [x] 03-05-PLAN.md â smoke:guardrails integration suite (no-raw-PII, cache isolation/hit, fallback, kill switch, budget, rate limit) + phase gate (Wave 4)

### Phase 3.1: Cockpit Core (INSERTED)
**Goal**: The manual `/submit` form + `/review` queue are replaced by a conversational two-pane cockpit â a guided slot-filling conversation assembles a PLAN, the user approves once, and execution fans out hands-off to multiple recipients through the existing governed engine (Gmail, audit, telemetry, DLQ, tenant scoping, durable workflows), with a live per-recipient report.
**Depends on**: Phase 3 (governed engine + guardrails complete); reuses Phase 2 delivery/audit/telemetry/DLQ primitives unchanged
**Requirements**: Reshapes INTK-01, AGNT-02, REVW-01, DLVR-01 UX (approval moves to the PLAN before execution); no new v1 requirement ID â the governance backend is reused, not rebuilt
**Design**: `.planning/design/email-chat-cockpit.md` (slice 1). Groundwork Connect-Gmail infinite-loading fix landed in commit `18c8442`.
**Success Criteria** (what must be TRUE):
  1. `/dashboard/workspace` renders a two-pane cockpit (chat ~30% / workspace ~70%) with a draggable, per-user-persisted divider (min ~20% each pane).
  2. A pure, tested `emailIntent` module (`packages/core`) tracks slots (recipients, subject, body intent, optional attachment); the agent asks only for what is missing, one topic at a time; an invalid email re-asks only that one and nothing is ever sent on an assumption.
  3. For >1 recipient the agent asks individual-copies (safe default) vs group-email; a PLAN card shows recipients + mode + subject + body preview + steps before a single Approve.
  4. Approve triggers `executePlan` â a lean `deliverApprovedPlan` durable workflow that fans out per recipient over the existing `gmail.send` + retrier + audit + telemetry + DLQ; approval is idempotent (double-approve sends once) and zero sends occur before Approve.
  5. A REPORT card fills per recipient live (status + message id + audit link); one recipient failing dead-letters that row while the rest still send; no raw email content lands in any audit/DLQ payload.
**Plans**: 9 plans in 5 waves (7/9 executed)
  - [x] 03.1-01-PLAN.md â Backend contracts: plans table + planId on requests + pinned status enum + tenantAction wrapper (Wave 1) â 2026-07-12
  - [x] 03.1-02-PLAN.md â Frontend + E2E harness: @convex-dev/agent@0.6.4 in apps/web, teal tokens, Playwright install (Wave 1) â 2026-07-12
  - [x] 03.1-03-PLAN.md â Pure emailIntent slot-filling module + tests (packages/core, TDD) (Wave 1) â 2026-07-12
  - [x] 03.1-04-PLAN.md â deliverApprovedPlan fan-out workflow + deadLetterRecipient + smoke:fanout (Wave 2) â 2026-07-12
  - [x] 03.1-05-PLAN.md â Cockpit page shell + resizable divider + SC1 E2E specs (Wave 2) â 2026-07-12
  - [x] 03.1-06-PLAN.md â plans adapter (byThread + REPORT projection) + cockpitDraft in llm.ts (Wave 2) â 2026-07-12
  - [x] 03.1-07-PLAN.md â Agent thread + proposeEmailPlan + executePlan approve gate (idempotent) (Wave 3) â 2026-07-12
  - [x] 03.1-08-PLAN.md â PLAN/DRAFT/REPORT cards + chat pane wired to live queries (Wave 4) â 2026-07-12
  - [ ] 03.1-09-PLAN.md â E2E integration + governance redaction + Connect-Gmail verify + human checkpoint (Wave 5)

### Phase 3.2: Inbox Reading (INSERTED)
**Goal**: The agent can search and read the connected mailbox to find people and context, so a request can reference real recipients and prior threads instead of only user-typed input.
**Depends on**: Phase 3.1 (cockpit + guided conversation)
**Requirements**: CKPT-01 (minted 2026-07-12; the `gmail.modify` read scope is already granted in Phase 2)
**Design**: `.planning/design/email-chat-cockpit.md` (slice 2)
**Success Criteria** (what must be TRUE):
  1. The agent searches/reads the user's mailbox via the already-granted `gmail.modify` scope, scoped to the requesting user only.
  2. Mailbox reads surface people/context into the guided conversation (e.g. resolving a recipient from prior correspondence) without sending anything.
  3. Read access is audited with refs/ids/counts only â no raw message content in any audit/DLQ payload.
**Plans**: 6 plans in 4 waves (planned 2026-07-12)

Plans:
- [ ] 03.2-01-PLAN.md â Pure emailIntent: needs_resolution state + name/group detection + parseAddress/rankCandidates (Wave 1)
- [ ] 03.2-02-PLAN.md â Transient plans.candidates/pendingValid/greetingName + writeCandidates/clearCandidates (Wave 1)
- [ ] 03.2-03-PLAN.md â gmail.ts headers-only search action + freshAccessToken + SMOKE fixture + mailbox.searched audit (Wave 1)
- [ ] 03.2-04-PLAN.md â Cockpit resolution wiring: comma/"and" tokenizer, searchârankâcard, resolveRecipients, greetingName, redaction tests (Wave 2)
- [ ] 03.2-05-PLAN.md â Resolution card + "Searchingâ¦" chip + cockpit-resolve E2E (Wave 3)
- [ ] 03.2-06-PLAN.md â Playbook + watch.json update (Â§9) + CKPT-01 human-verify (Wave 4)

### Phase 03.2.1: Agent-Driven Cockpit (INSERTED)

**Goal:** Replace the deterministic `emailIntent` FSM cockpit with an Executive Agent governed tool-loop (`generateText` + tools in `llm.ts`) so the conversation is flexible ("remove Bob", "make it more formal, add Jane") while every governance invariant survives â human Approve gate stays a mutation (never a tool), redaction-before-draft, refs-only logs, and structural facts are never model-invented (validated/resolved at the tool boundary). Clean cutover (FSM deleted).
**Requirements**: AGNT-01, AGNT-02 (reshaped â the Executive Agent finally becomes a real reasoning tool-loop instead of an inert message store; no new v1 ID)
**Depends on:** Phase 3.2 (inbox-read primitives become agent tools). **Blocks Phase 3.3** â attachment generation builds on the agent engine, so this must land first.
**Design record:** `.planning/design/agent-driven-cockpit.md`
**Plans:** 6/6 plans complete

Plans:
- [x] 03.2.1-01-PLAN.md â cockpit-agent skill registry row + seed constant + static-sync test (Wave 1)
- [x] 03.2.1-02-PLAN.md â Pure tool-internals in @pikar/core: buildRecipientView + applyRecipientEdit (index/label view, add/remove/set bounce) (Wave 1)
- [x] 03.2.1-03-PLAN.md â Governed tool wrappers + agent-context builder in llm.ts + per-tool unit tests + redaction static scan (Wave 2)
- [x] 03.2.1-04-PLAN.md â runCockpitAgent generateText tool-loop (preCall/maxSteps/recordSpend/fallback) + mock-model integration test (Wave 3)
- [x] 03.2.1-05-PLAN.md â Clean cutover: sendCockpitMessage thin driver + FSM delete + slim emailIntent + offline SMOKE:: E2E (Wave 4)
- [x] 03.2.1-06-PLAN.md â Cockpit playbook rewrite (Â§9) + watch.json + human-verify checkpoint (Wave 5)

### Phase 3.3: Attachment Generation (INSERTED)
**Goal**: The agent can generate a document and attach it to an outgoing email, so a plan can deliver produced artifacts, not just body text.
**Depends on**: Phase 3.1 (plan/draft artifacts + send fan-out)
**Requirements**: CKPT-02 (minted 2026-07-12; distinct from INTK-02, which is inbound attachment ingestion)
**Design**: `.planning/design/email-chat-cockpit.md` (slice 3)
**Success Criteria** (what must be TRUE):
  1. The agent generates a document artifact and attaches it to the outgoing email within a plan.
  2. The generated attachment flows through the same governed send (Gmail + audit + telemetry + DLQ) and appears on the PLAN/REPORT cards.
**Plans**: 6 plans in 4 waves (planned 2026-07-13)

Plans:
- [x] 03.3-01-PLAN.md — @pikar/core doc validators + document-drafter skill + draftDocument + markdownToPdf render (Wave 1)
- [x] 03.3-02-PLAN.md — plans.attachments/attachmentError schema + recordAttachments + attachmentUrls + reportForPlan URLs (Wave 1)
- [x] 03.3-03-PLAN.md — multipart buildMime + send loads storage bytes + getForDelivery resolves refs (Wave 1)
- [x] 03.3-04-PLAN.md — generate/regenerate/remove attachment tools + proposePlan cap/render gate + SMOKE ops (Wave 2)
- [x] 03.3-05-PLAN.md — executePlan fan-out propagation + PLAN/REPORT card attachment rows (Wave 3)
- [x] 03.3-06-PLAN.md — smoke:fanout/guardrails + cockpit-attachment E2E + human-verify + playbook close (Wave 4) — 2026-07-14

### Phase 3.4: Per-Recipient Personalization (INSERTED)
**Goal**: A multi-recipient send can tailor wording per recipient, moving beyond slice-1 same-content-to-all while keeping the single plan-approval gate.
**Depends on**: Phase 3.1 (multi-recipient fan-out); Phase 3.2 (inbox context strengthens personalization)
**Requirements**: CKPT-03 (minted 2026-07-12)
**Success Criteria** (what must be TRUE):
  1. For a multi-recipient plan, each recipient can receive individually tailored wording, shown per recipient on the PLAN card before the single Approve.
  2. Personalized content passes the same PII/cost/review guardrails and per-recipient audit/telemetry as same-content sends.
**Plans**: 4 plans in 4 waves (planned 2026-07-14)

Plans:
- [x] 03.4-01-PLAN.md — plans.recipientBodies schema field + patchPlan arg + tests (Wave 1)
- [x] 03.4-02-PLAN.md — personalizeRecipient tool + buildAgentContext + proposePlan group gate + cockpit-agent skill + SMOKE op (Wave 2)
- [x] 03.4-03-PLAN.md — executePlan per-recipient seed override + PLAN card per-recipient body section (Wave 3)
- [~] 03.4-04-PLAN.md — cockpit-personalize E2E + smoke:fanout distinct-body + playbook close (BUILT); CKPT-03 human-verify PENDING (Wave 4)

### Phase 3.5: Deferred Send (INSERTED)
**Goal**: A plan can carry a user-specified future send time, so the chief-of-staff promise covers *when* as well as *what* â approve once, and the governed send fires at the requested moment, cancellable until then.
**Depends on**: Phase 3.1 (plan/approve/execute spine); no new scope or platform (Convex built-in scheduler `runAt`)
**Requirements**: SCHD-01 (minted 2026-07-12)
**Design**: `.planning/design/scheduled-send.md` (Tier 1; Tier 2 recurring is out of v1 â 7-day Testing-mode tokens + unmade approve-template-vs-re-draft governance decision)
**Success Criteria** (what must be TRUE):
  1. The guided conversation accepts a natural-language send time as an optional slot; no time given â immediate send on Approve (today's behavior is the unchanged default).
  2. The PLAN card shows the resolved absolute time in the user's timezone before the single Approve; ambiguous times are re-asked, never guessed.
  3. Approve schedules (never immediately starts) the existing `deliverApprovedPlan` fan-out; nothing sends before the scheduled time; audit/telemetry/DLQ paths are reused unchanged.
  4. A scheduled plan is cancellable any time before it fires (halt control), with the cancellation audited; a token dead at fire time lands `awaiting_reauth` + notification exactly like an immediate send.
**Plans**: 6 plans (4 shipped + Wave 5: 2 deferred-item enhancements appended 2026-07-18)
Plans:
- [x] 03.5-01-PLAN.md — pure parseSendTime (@pikar/core) + plans schema/status/sendAt foundation (Wave 1)
- [x] 03.5-02-PLAN.md — setSendTime tool + clientContext threading + SMOKE sendTime= + §4 scan + cockpit-agent Scheduling skill (Wave 2)
- [x] 03.5-03-PLAN.md — executePlan startFanout/scheduled branch + startScheduledDelivery + cancelScheduledPlan + picker/ScheduledCard (Wave 3)
- [x] 03.5-04-PLAN.md — cockpit-schedule E2E + cockpit.md phase close + SCHD-01 human-verify (Wave 4)
- [x] 03.5-05-PLAN.md — re-schedule a canceled plan (reschedulePlan canceled→proposed + orphan cleanup + CanceledCard reschedule surface, re-arm via existing executePlan) (Wave 5)
- [x] 03.5-06-PLAN.md — far-future cap: SEND_TIME_HORIZON_MS + tooFar parse variant + executePlan send_time_too_far refusal + setSendTime re-ask + native picker max (Wave 6)

### Phase 3.6: Agent Eval Gate (INSERTED)
**Goal**: Agent behavior changes stop being blind — a golden set of scripted conversations evaluates every new agent-skill version against the live model before it can be activated, and the production eval signals already being written (review outcomes, regenerate/fallback counts, DLQ rate, cost) become readable on the ops page; this is the continuous-evaluation ring between the mock-model CI tests (Phase 3.2.1) and SkillOpt (Phase 8), which plugs into this harness instead of building its own.
**Depends on**: Phase 3.2.1 (agent tool-loop + SMOKE harness); Phase 3.3 (attachment tools in golden-set scope)
**Requirements**: EVAL-01, EVAL-02 (minted 2026-07-14)
**Design**: `.planning/design/agent-eval-gate.md`
**Success Criteria** (what must be TRUE):
  1. A golden set of scripted cockpit conversations (fixtures, ~15–25 cases incl. edit, bounce, attachment, and injection-probe paths) runs on demand against the live model via `pnpm eval:golden`, asserting on resulting plan/tool state (never reply text), with a hard per-run cost cap and zero possibility of a real send or mailbox read.
  2. `activateSkill` refuses to activate a never-before-active (candidate) version of a gated skill without a recorded passing eval run (evidence ref on the skill row, refs/counts only); re-activating a previously-active version (rollback) is structurally exempt and always works.
  3. The ops page shows production eval signals — approve/edit/reject rates, regenerate count, fallback count, DLQ rate, cost per delivered plan — from existing telemetry/audit data, with no new write paths.
  4. The legacy `executive-agent.classifier` skill row is archived, and the agent-runtime playbook's "no live-model eval gate" gap is closed (playbook updated in the same phase).
**Plans**: 5 plans in 4 waves (planned 2026-07-15)

Plans:
- [x] 03.6-01-PLAN.md — EVAL_GATE on activateSkill + recordEvalEvidence + getSkillVersion + seedSkills candidate-publish + classifier archival + skill-registry.md [EVAL-01] (Wave 1) — completed 2026-07-15
- [x] 03.6-02-PLAN.md — Ops eval-signals read-side: telemetry by_tenant_created index + opsSignals tenantQuery + tests + ops-page card [EVAL-02] (Wave 1) — completed 2026-07-15
- [x] 03.6-03-PLAN.md — Agent-loop threading: skillVersions candidate pin (runCockpitAgent→buildCockpitTools→draftDocument) + costUsd in the loop return (Wave 2) — completed 2026-07-15
- [x] 03.6-04-PLAN.md — Golden-set harness: 15 NL fixtures + run-eval-golden.mjs (cost cap, flake retry, evidence write) + assertEvalCaseClean + pnpm eval:golden wiring + agent-runtime.md/watch.json close (Wave 3) — completed 2026-07-15
- [x] 03.6-05-PLAN.md — Phase close: automated sweep + live human-verify (first golden run, full gate cycle, classifier archival, ops card) (Wave 4) — completed 2026-07-15

### Phase 3.7: Inbox Briefing (INSERTED)
**Goal**: The agent converts the already-granted mailbox scope into daily chief-of-staff value — on demand it reads the inbox, groups messages by time in pure code, summarizes content only through toolless schema-validated digest calls, and renders a triaged BRIEFING card — with zero mailbox writes, nothing sent, and any briefing-seeded action crossing the normal Approve gate.
**Depends on**: Phase 3.2 (gmail.ts search/token infra), Phase 3.2.1 (agent engine), Phase 3.6 (golden-set eval covers the new tools, incl. the injection-probe fixture)
**Requirements**: CKPT-04 (minted 2026-07-14)
**Design**: `.planning/design/inbox-briefing.md`
**Success Criteria** (what must be TRUE):
  1. Asking for a briefing in the cockpit produces a BRIEFING card grouped today/yesterday/this week, computed in pure tested code from `internalDate` + user timezone; each item shows timestamp, sender, and a one-line gist.
  2. The **toolless-ingestion invariant** holds and is enforced: raw message bodies reach an LLM only inside toolless, schema-validated digest calls; the tool-bearing loop sees structured digests only (unit test + static scan, and the invariant is added to the agent-runtime playbook).
  3. Reads are capped and snippet-first (full bodies only for digest-selected messages), audited refs/ids/counts only, with zero mailbox writes and zero sends; a briefing-seeded action goes through the normal conversation → PLAN → human Approve gate.
  4. A "Needs you" triage section surfaces needsReply/deadline items as suggestions (never actions), from the digest schema.
  5. The 3.6 golden set gains briefing cases including an injection-probe fixture: an email body containing send/forward instructions yields zero tool actions and no `proposePlan`.
**Plans**: 9 plans in 9 waves (01–05 planned 2026-07-17; 06–09 added 2026-07-17 as Gap-1 closure — the intelligent-report reshape; sequential — plans share watch.json/playbook files, and the phase close needs its own gate-cycle plan per the 3.6 precedent)

Plans:
- [x] 03.7-01-PLAN.md — Pure @pikar/core briefing module (TDD): Intl time-bucketing + selection cap + digest index-join (Wave 1)
- [x] 03.7-02-PLAN.md — briefings/inboxFixtures tables + gmail listInbox/fetchInboxBodies (fixture-first, refs-only mailbox.listed, zero-write scans) + seedInboxFixture (Wave 2)
- [x] 03.7-03-PLAN.md — inbox-digest skill (gated 5-file mirror) + toolless digestInbox + listInbox/briefInbox tools + SMOKE brief op + invariant enforcement + agent-runtime invariant 10 (Wave 3)
- [x] 03.7-04-PLAN.md — BRIEFING card (plan-independent CardList) + offline cockpit-briefing E2E (Wave 4) — completed 2026-07-17 (E2E written + Playwright-discovered; live run blocked on a Gmail-connected seeded E2E user — run it in 05's live session)
- [x] 03.7-05-PLAN.md — Golden-set briefing fixtures 16–18 (incl. injection probe) + briefingPresent runner key + live cockpit-agent gate cycle + human-verify (Wave 5) — mechanism ran live 18/18 (cockpit-agent v7); PRESENTATION rejected at the checkpoint → Gap 1 (see 03.7-UAT.md), CKPT-04 held open

Gap 1 closure — "an intelligent report, not a receipt" (added 2026-07-17, `/gsd:plan-phase 3.7 --gaps`):
- [x] 03.7-06-PLAN.md — Pure @pikar/core reshape (TDD): buildBriefingView (action-first order + newsletter collapse + code-owned lede composition) + DigestBatch type; time grouping PRESERVED as secondary (Wave 6) — completed 2026-07-17 (115/115 core tests green incl. preserved bucket/joinDigest; typecheck + check-playbooks exit 0; CKPT-04 held open to Wave 9)
- [x] 03.7-07-PLAN.md — Toolless cross-message synopsis: inbox-digest skill lede section (gated candidate vN) + digestSchema/digestInbox → DigestBatch + briefings.synopsis persisted + SC-2 scans extended to the synopsis (Wave 7) — completed 2026-07-17 (3 target files 95/95; backend+web typecheck clean; fifth mutation-checked SC-2 scan + invariant 10 extended; CKPT-04 held open to Wave 9)
- [x] 03.7-08-PLAN.md — Intelligent BRIEFING card: lede-first + action-first + collapsed "N automated notifications" row + visible category, rendered from buildBriefingView; SC-4 intact + offline E2E update (Wave 8) — completed 2026-07-17 (BriefingCard a dumb renderer over buildBriefingView; web typecheck + Biome baseline-diff + Playwright discovery + check-playbooks all clean; CKPT-04 held open to Wave 9's connected human-verify)
- [x] 03.7-09-PLAN.md — Phase close: ledePresent runner key + synopsis smoke read + live inbox-digest@N gate cycle + human-verify of the reshaped card → CKPT-04 complete (Wave 9) — completed 2026-07-17 (Task 1 offline: ledePresent wired end-to-end + briefingSynopsisPresent smoke read; Task 2 live gate cycle: activate v2 REFUSED pre-evidence → pnpm eval:golden --skill inbox-digest@2 run d2f541cb 18/18 $0.0682 → evidence recorded → activateSkill v2 SUCCEEDED, inbox-digest v2 ACTIVE; Task 3 human-verify APPROVED — reads as an intelligent executive report, Gap 1 + Gap 2 closed; E2E remains env-blocked (no E2E creds), live human-verify substitutes)

### Phase 3.8: Vault Document Extraction (INSERTED)
**Goal**: A document uploaded to the knowledge vault in a non-text format (PDF, DOCX, XLSX, PPTX, images, videos) has its text extracted and flows through the existing `vaultIngestText` seam into embedding/graph ingestion — closing the gap where such uploads sit at `pending_extraction` forever and never become searchable. (CSV is already text-on-upload — out of scope; videos IN per 2026-07-18 user decision, transcription-rail-only.)
**Depends on**: Phase 5 (vault + `vaultIngestText` late-text seam), Phase 4 (extraction engine — hosted OCR `extractVisual` + `transcribeAudio` patterns)
**Requirements**: EXTR-A..EXTR-I (derived in planning — see 03.8-RESEARCH.md Phase Requirements → Test Map)
**Plans:** 6 plans (Wave 1: sequential contract on main; Wave 2: FOUR parallel worktree lanes with pairwise-disjoint file ownership; Wave 3: integration + phase close)

Plans:
- [x] 03.8-01-PLAN.md — Wave-0 contract (schema union, internal seam variant, dispatcher stubs, deps+lockfile, watch.json/playbook/PARALLELIZATION) — wave 1, sequential, main — completed 2026-07-18 (all 10 contract items on `main`; vault 27/27 + vault.test 18/18 green; schema.ts/vault.ts/watch.json/package.jsons/lockfile FROZEN; NO skills.ts edit, deliberate absence verified; Wave-2 lanes may start)
- [x] 03.8-02-PLAN.md — Lane 1: PDF + image extraction (unpdf text-layer-first + hosted OCR fallback) + live smoke — wave 2, own worktree — merged to main 2026-07-18 (3d48d1b; EXTR-B/D/E/F, 15/15 offline, text-layer verified on deployed runtime)
- [x] 03.8-03-PLAN.md — Lane 2: Office parsers (pure-TS fflate + XML text-walk, DOCX/XLSX/PPTX, zero convex edits) — wave 2, own worktree — merged to main 2026-07-18 (a12dec4; EXTR-C: real extractOfficeText, 15-test fixture suite, vault 42/42)
- [x] 03.8-04-PLAN.md — Lane 3: backlog sweep + retry + vault UI lifecycle (extracting pill / failed+Retry / truncation note) + offline E2E — wave 2, own worktree — merged to main 2026-07-18 (c8db65b; EXTR-G/H, sweep 10/10, UI lifecycle, E2E un-skip-guarded at merge)
- [x] 03.8-05-PLAN.md — Lane 4: video transcription (existing hosted rail, honest unsupported-container failure) + live smoke — wave 2, own worktree — merged to main 2026-07-18 (86e81d6; EXTR-I, transcribeDoc 6/6, mp4/webm sentinel smoke green)
- [x] 03.8-06-PLAN.md — Integration: merge all lanes, full sweep on main, phase-close human-verify — wave 3 — completed 2026-07-18 (Task 1: all four lanes merged, merged whole green: backend 317/318 + vault 42/42 + web tsc + biome lint + check-playbooks; backlog swept pending_extraction → 0. Task 2: owner live human-verify APPROVED 2026-07-18 — all formats + video transcription + honest failures + preview modal, after post-merge fix chain 510c5e0/24863cd/db0f485/5413776/8775c0c/a085113/4980c8d)

### Phase 3.9: Agent Activity Streaming (INSERTED)
**Goal**: The cockpit stops looking frozen — while the Executive Agent runs its tool loop, the workspace shows the steps it is taking as they happen (reading the inbox, summarizing, drafting), and the chat renders in-progress bubbles, so a user never mistakes a working agent for a hung system. Cross-cutting: applies to every agent flow (briefing, send, attachment, personalization), not one feature.
**Depends on**: Phase 3.2.1 (the agent tool-loop that emits the steps); reuses Convex reactivity (`useQuery`) — no polling, no new transport
**Requirements**: CKPT-05 (minted in this phase — see 03.9-01; NOT a CKPT-04 reshape: CKPT-04 is a Pending capability blocked on its own Gap 1, and the user sequenced them apart)
**Why now (2026-07-17)**: user-reported during the 03.7 human-verify — a 10–30s tool loop renders nothing until a card materializes; the user reads that as broken and refreshes/resubmits. Sequenced BEFORE the 03.7 intelligent-report gap closure (user decision), so the smarter briefing is watchable while it is produced.
**Key constraint (amended 2026-07-17 per 03.9 research)**: §4 is enforced by **schema absence, not vigilance** — the step row carries NO free-text field at all (a closed tool-name union + phase enum + numbers); the display verbs live in the UI. This structurally kills the leak class rather than forbidding it, which matters because the SDK's tool events carry `messages[]`/`toolOutput.output` and `listInbox`'s return contains subjects, and invariant 10's existing static scans do not cover a new table. Labels are VERBS ("Reading your inbox", "Summarizing"), per the verbatim user ask — superseding this line's earlier counts-shaped example ("Read 12 messages"), which was wrong: counts exist only in the §4-hazardous return string, not in any tool event.
**Reuse note**: BRAND already specifies this — §5's collapsible "Thought Process" trace, §3's `LATEST TRACE` label idiom, the existing `.trace-line` CSS (`globals.css:1119`), and the composer's disabled "Thought process — coming soon" button. This is an UNBUILT BRAND PATTERN, not a new one. `ai@7.0.20`'s `onToolExecutionStart`/`onToolExecutionEnd` supply the events (zero tool-wrapper edits); `@convex-dev/agent` 0.6.4 streaming is version-blocked (peer-requires `ai@^6`, repo pins `ai@7`; 0.6.4 is latest — nothing to bump to, §6 moot).
**No eval gate**: this instruments CODE, not prompts — no skill-body edit, so no cockpit-agent gate cycle (unless planning drifts into a new tool or a changed tool description).
**Plans:** 4 plans (4/4 executed) — human-verified 2026-07-17

Plans:
- [x] 03.9-01-PLAN.md — the `agentSteps` table + adapter (record/finish/latestTurn) + unit tests; mint CKPT-05 (Wave 1) — completed 2026-07-17
- [x] 03.9-02-PLAN.md — emit from ai@7's onToolExecution* callbacks + the SMOKE path; turn lifecycle in both cockpit drivers; §4 static scans (Wave 2) — completed 2026-07-17
- [x] 03.9-03-PLAN.md — the UI: ActivityCard (LATEST TRACE) + the in-progress chat bubble, off one query — completed 2026-07-17 (both traps dodged: NO-args query rendered above the `!threadId` AND `plan === null` returns; the brain button now toggles the trace instead of claiming it unbuilt. NOT live-verified — that is 04's job)
- [x] 03.9-04-PLAN.md — offline E2E + full sweep + human-verify (perceived latency); mark CKPT-05 Complete (Wave 4) — completed 2026-07-17 (human-verify uncovered + fixed a WorkspacePage crash: a slow `listThreads` threw inside the page and killed the whole cockpit — now behind an error boundary; plus input-clears-on-send, Send-button spinner, fresh-chat stale-trace suppression)

### Phase 3.10: Cockpit Conversation Repair (INSERTED)
**Goal**: The two shipped defects surfaced by the live UAT conversation of 2026-07-19 are fixed: (1) PANEL DESYNC — CardList/PlanCards (`apps/web/app/(app)/dashboard/workspace/cards.tsx`) pins the BriefingCard above the ResolutionCard and never dismisses/demotes it when the conversation pivots from briefing to composing, so a tall brief buries the contact picker, resolution stalls, and the plan ships with "#1 (no name)"; (2) AGENT STALLED-RESOLUTION RECOVERY — the cockpit-agent skill has no recovery path while a resolveContacts pick is pending: it loops "ready to pick in the panel", re-asks for a subject the user already gave, and fails to call draftBody on a stated body intent. Skill-body edits are registry-gated (seedSkills publish → eval:golden gate → activate, per Phase 3.6); the fix must add eval fixtures reproducing the stalled-resolution conversation so the gate proves the loop is gone.
**Depends on**: Phase 3.7 (BriefingCard), Phase 3.2.1 (agent tool-loop), Phase 3.6 (eval gate for the skill edit)
**Requirements**: none minted (UAT gap closure) — internal defect labels UAT-A (panel desync) / UAT-B (stalled-resolution recovery) / UAT-C (propose-while-pending deadlock + tall-brief clutter) / UAT-D (reset confabulation + invented subject + phantom claims) / UAT-E (conversational amnesia) / UAT-F (post-pick trust collapse + count parity), per 03.10-CONTEXT.md
**Plans:** 7 plans (01-03 core; 04-07 gap closure inserted from the live UAT replays of 2026-07-19) — 7/7 complete; HUMAN SIGN-OFF 2026-07-19 (full-transcript live replay approved, zero unintended sends)

Plans:
- [x] 03.10-01-PLAN.md — Wave 0: gmail.search inboxFixtures seam (fixture-before-token, mirroring listInbox) + unit tests + fixture-09 description (prereq for the Defect-B eval fixture) — completed 2026-07-19 (fixture branch after the SMOKE:: sentinel, refs-only mailbox.searched audit mutation-checked, live fall-through pinned; gmail.test.ts 28/28)
- [x] 03.10-02-PLAN.md — Defect A: composing-aware BriefingCard demotion in PlanCards (reorder + one boolean) + offline DOM-order E2E (SC-4 intact) — completed 2026-07-19 (composing derived from the plan row only, brief demoted last in the grid — never destroyed; picker-precedes-brief DOM-order test in cockpit-resolve.spec.ts; cockpit-briefing.spec.ts byte-untouched; live paint owed to 03.10-03's human-verify)
- [x] 03.10-03-PLAN.md — Defect B via the 3.6 gate: "While a pick is pending" skill mirror edit + fixture 19 + live gate cycle (seed → refused activate → pinned eval → activate) + blocking human-verify UAT-transcript replay — completed 2026-07-19 (skill edit + fixture 19 shipped 509925b; the blocking human-verify was superseded by the live replays that surfaced UAT-D/E/F and closed under the final 2026-07-19 sign-off covering UAT-A + UAT-B)
- [x] 03.10-04-PLAN.md — Gap closure (UAT-C, code-only): propose-while-pending DEADLOCK + tall-brief CLUTTER, defense-in-depth — completed 2026-07-19 (backend: proposePlan refuses over a parked pick BEFORE the proposeEmailPlan write, name-only PlanRow widening keeps the header-hint redaction scan green; frontend: picker survives a proposed+parked plan, no "#1 (no name)" PlanCard, BriefingCard collapses to its masthead with an expand toggle, SC-4 rescoped to briefing-body; cockpitTools 40/40 + web typecheck 0 + Playwright discovery + check-playbooks 0; live paint owed to 03.10-03's human-verify)
- [x] 03.10-05-PLAN.md — Gap closure (UAT-D): resetPlan mutation+tool (explicit slot-clear — patchPlan drops undefined) + neutral pending-pick context statement + skill v9 via the gate (reset flow, reply-vs-compose no-invent-subject, never-claim-unperformed, attach-only-on-ask) + fixture 20 — completed 2026-07-19 (86e5a5f; pinned run 7940a9a0 20/20 green $0.0791; v9 activated post-evidence only; human-verify closed under the final sign-off; reply-grounding rebuild stays the deferred ceiling)
- [x] 03.10-06-PLAN.md — Gap closure (UAT-E, conversational amnesia): history-injected prompt (buildHistoryBlock last-10/500-chars + fetchRecentHistory in BOTH drivers + eval-runner accumulation parity) + skill v10 transcript-reading via the gate + fixture 21 — completed 2026-07-19 (2e1ffbb + fail-open hotfix b9da09b; first pinned run 361d5769 stormed at $0 (recovered per eval-env-recovery, not activated on red), clean run 27efb84d 21/21 green $0.0973; fragment absorption approved in the final replay)
- [x] 03.10-07-PLAN.md — Gap closure (UAT-F, post-pick trust): recipientNames persisted+rendered (`#1: Brett J. Fox`, never "(no name)" for a pick) + STRUCTURAL omitRecipientEdits tool withholding on the continue turn + honest RESOLUTION_CONTINUE + one isNeedsYou briefing predicate (count parity with the card) + skill v11 via the gate — completed 2026-07-19 (c10c012; pinned run 39d0c4e2 21/21 green $0.0871; v11 active confirmed; fixture 22 explicitly SKIPPED (harness never drives resolveRecipients — upgrade path recorded); final replay approved: counts parity, named picks, no fabrication, clean reset, zero unintended sends)

### Phase 3.11: Inbox Reply (INSERTED)
**Goal**: "Draft a reply to X" is a real reply, not a silently-downgraded fresh compose (the live-UAT gap of 2026-07-19). Replying to a mailbox message: (1) targets the original message by ref — the recipient is the message's From address, set by message reference without a resolveContacts panel round-trip (the address stays refs-only to the agent loop, §2-D); (2) the plan carries `Re:` subject and Gmail threading (In-Reply-To/References headers + threadId) so the reply lands in-thread; (3) the reply body is drafted from the user's stated intent WITH the original message as context, honoring the toolless-ingestion invariant (the original body is untrusted third-party content — it reaches an LLM only in a toolless call, never the tool-bearing loop; injection in the original can describe, never actuate); (4) delivery rides the unchanged governed plan → single Approve → fan-out (audit refs-only, zero sends before Approve).
**Depends on**: Phase 3.7 (gmail read plane: listInbox/fetchInboxBodies + toolless digest precedent), Phase 3.2.1 (agent tool-loop), Phase 3.6 (eval gate for the skill edit), Phase 3.10 (conversation repair lands first — reply UX must not build on the broken panel flow)
**Requirements**: RPLY-01 (minted at planning 2026-07-19)
**Plans:** 6/6 plans executed

Plans:
- [x] 03.11-01-PLAN.md — Wave 1: groundwork — optional threading schema fields (plans/requests/inboxFixtures) + closed agentSteps.tool union literal + fixture thread-anchor & injection message + 2 golden eval cases + RPLY-01 mint (completed 2026-07-19; commits 06e5cb1/b7e784d/54b5168)
- [x] 03.11-02-PLAN.md — Wave 2: reply-body brain — new gated reply-drafter skill (5-file mirror) + toolless draftReply internalAction (digestInbox clone; original body ingested with NO tools) (completed 2026-07-19; commits 6969e8d/7c8e7ab)
- [x] 03.11-03-PLAN.md — Wave 3: delivery threading spine — buildMime In-Reply-To/References + send POST threadId + target-header read + executePlan copies threading to requests + getForDelivery returns it (completed 2026-07-19; commits e10ba23/0a08052/ea2a2b0/e50b228)
- [x] 03.11-04-PLAN.md — Wave 4: the replyToMessage tool — server-side resolve + recipient-by-ref (no panel) + Re: subject + threading + toolless draft; patchPlan/resetPlan threading writers; mutation-checked toolless-boundary scan (completed 2026-07-19; commits f37b74a/e3ccc36/940230c)
- [x] 03.11-05-PLAN.md — Wave 5: cockpit-agent reply guidance edit through the 3.6 eval gate — candidate v12 (2-file mirror) → pnpm eval:golden --skill cockpit-agent@12 23/23 GREEN incl. 23-reply-happy + 24-reply-injection (runId 98ea4f20, $0.1009) → evidence recorded → activateSkill v12 (RPLY-01) (completed 2026-07-19; commits e8e13e0/6ca78f6)
- [x] 03.11-06-PLAN.md — Wave 6: phase close + live in-thread reply human-verify — backend suite green (359/360, sole red the documented audit auditCounts non-regression), cockpit-agent@12 active, owner confirmed in-thread reply in real Gmail; Pitfall 1 resolved empirically (RFC In-Reply-To/References in raw MIME + threadId in POST — belt-and-suspenders — threads correctly; owner did not isolate which signal is individually sufficient) (completed 2026-07-19)

### Phase 4: Attachment & Voice-Dictation Intake
**Goal**: Users can enrich requests with files and speak requests aloud, both flowing through the same governed pipeline â grouped because dictation reuses the attachment audio-transcription path and Python sidecar.
> **SUPERSEDED (2026-07-14, 04-06):** the "Python sidecar" phrasing above is stale. The shipped extraction engine is Path A — hosted OpenAI API calls, NO `services/*` Python sidecar. See STATE.md Decisions ("[Phase 4 — sidecar-killed, 04-06]") for the full reasoning; this note amends the Goal line without rewriting it.
**Depends on**: Phase 2 (pipeline); guardrails from Phase 3 apply to enriched context
**Requirements**: INTK-02, INTK-03
**Success Criteria** (what must be TRUE):
  1. User attaches an image, PDF, audio, or document and the system classifies it and OCRs/extracts/transcribes it, merging the result into the request context.
  2. User dictates a request by voice; it is recorded, transcribed, and enters the same pipeline as a typed request.
  3. A delivered result reflects content that originated from an attachment or a dictated recording, having passed the same PII/cost/review guardrails.
**Plans**: 6/6 plans executed
- [x] 04-01-PLAN.md — pure @pikar/extraction (classify + frame) + intake §9 playbook + watch.json (Wave 1)
- [x] 04-02-PLAN.md — attachment-extractor skill (5-file mirror) + skill-registry.md bump (Wave 1)
- [x] 04-03-PLAN.md — intakeArtifacts schema table + @pikar/cost transcription pricing (Wave 1)
- [x] 04-04-PLAN.md — convex intakeDb + intake.ts spine: classify→extract→redact→cost→audit→persist→merge (Wave 2)
- [x] 04-05-PLAN.md — IntakeControls.tsx (attach + one-shot dictation) + Playwright E2E over SMOKE:: (Wave 3)
- [x] 04-06-PLAN.md — phase close + SC3 live human-verify (APPROVED 2026-07-15) + sidecar-killed decision log (Wave 4)

### Phase 5: Knowledge Vault & GraphRAG
**Goal**: The system remembers â briefs and documents become groundable, searchable memory scoped to each user via hybrid vector + graph retrieval.
**Depends on**: Phase 4 (extraction feeds ingestion); Phase 2 (pipeline grounding step)
**Requirements**: VALT-01, VALT-02, VALT-03, VALT-04
**Success Criteria** (what must be TRUE):
  1. Briefs and documents are stored and embedded (`text-embedding-3-small` @1536, under Convex's 2048-dim cap) and appear in the user's vault.
  2. Graphify extracts entities/relationships from vault content at ingestion; the resulting nodes/edges are stored and queryable in Convex `graphNodes`/`graphEdges` tables.
  3. A request is grounded using hybrid retrieval â vector similarity plus hop-capped graph traversal â scoped to only the requesting user's data.
  4. User can browse and search their own vault contents.
**Plans**: 7 plans in 7 waves (Lane C, planned 2026-07-14)

Plans: 7/7 executed (Lane C). Phase 5 code-complete + live in-browser verified (P0 embedding-adapter fix recorded at close).
- [x] 05-01-PLAN.md — vault playbook + watch.json registration + @pikar/vault pure domain (normalize/BFS/fusion/categories/constants) (Wave 1)
- [x] 05-02-PLAN.md — schema (vaultDocuments/graphNodes/graphEdges) + single RAG instance + graph-extractor skill 5-file mirror (Wave 2)
- [x] 05-03-PLAN.md — graph plane: extractGraph (V8 generateObject) + upsert dedup/degree/GC + hop-capped BFS expand (Wave 3)
- [x] 05-04-PLAN.md — ingest workflow (store→embed→extract→ready) + rag.add embed + lifecycle mutations + delete-cascade + §4 redaction scan (Wave 4)
- [x] 05-05-PLAN.md — vaultGround hybrid vector+graph retrieval + browse/stats/category-search/signed-download/docEntities read plane (Wave 5)
- [x] 05-06-PLAN.md — /dashboard/vault route matching brand-024242/024258 (stat tiles, tabs, dropzone, search, grid/list, preview modal) + nav (Wave 6)
- [x] 05-07-PLAN.md — Playwright vault E2E + live smoke:vault + playbook/STATE/ROADMAP close + human-verify (Wave 7)

### Phase 6: Live Voice Sessions
**Goal**: Users can hold a live strategy conversation with the Executive Agent that safely becomes a durable brief and, optionally, an executable plan â the product's identity feature, isolated from the durable pipeline and cost-metered.
**Depends on**: Phase 5 (briefs land in the vault); Phase 4 (transcription)
**Requirements**: VOIC-01, VOIC-02, VOIC-03, VOIC-04
**Success Criteria** (what must be TRUE):
  1. User holds a live bidirectional voice conversation with the Executive Agent (WebRTC, browser-direct) and can end it with an End-session button.
  2. A server-side watchdog hard-caps every session at 15 minutes and terminates cleanly even if the tab closes or the network drops, with per-session token metering to prevent cost blowout.
  3. An ended session (clean or abnormal) produces a detailed structured markdown brief that is stored and indexed in the knowledge vault.
  4. At session end the agent asks permission to convert the brief into a step-by-step plan; an approved plan enters the normal request pipeline with the review gate.
**Plans**: 8 plans across 6 waves
Plans:
- [x] 06-01-PLAN.md — Pure foundations: pin Realtime API shapes + packages/voice + priceRealtime + voice playbook (Wave 0)
- [x] 06-02-PLAN.md — voiceSessions table + voice-session/voice-brief skills (Wave 0)
- [x] 06-03-PLAN.md — voiceToken: mint ephemeral secret + server hangup (Wave 1)
- [x] 06-04-PLAN.md — llm.draftVoiceBrief: toolless brief drafting + SMOKE seam (Wave 1)
- [x] 06-05-PLAN.md — voice.ts: durable watchdog + end paths + metering + brief store (Wave 2)
- [x] 06-06-PLAN.md — Voice UI: WebRTC client + pre-flight + live session (Wave 3)
- [x] 06-07-PLAN.md — Post-call summary + brief review/store + plan handoff + e2e (Wave 4)
- [x] 06-08-PLAN.md — ADR + playbook finalize + live human-verify gate (Wave 5) — completed 2026-07-21 (owner live human-verify APPROVED; UAT-fix chain: mint shape, transcript completeness, plain-text brief, visible wrap-up, ingest-stranding fix, honest handoff rename)

### Phase 7: Resilience & Operations Hardening
**Goal**: Every failure path â agent/review timeouts, retry-threshold breaches, dead-letters â is caught, notified, escalated, and archived immutably.
**Depends on**: Phase 6 (hardens error paths across all prior feature phases)
**Requirements**: AGNT-04, REVW-02, REVW-03, OPSG-03, OPSG-05
**Success Criteria** (what must be TRUE):
  1. Edit and reject retry counters enforce thresholds; a breach escalates, notifies, and terminates the request safely.
  2. A review-inactivity timeout and an Executive Agent timeout each fire an escalation notification (via the scheduled-event race on the review gate).
  3. Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events.
  4. Completed request trails export on schedule to immutable (WORM) archival storage. **(PARTIAL — owner ruling 2026-07-21: WORM export IN scope; the hot-audit-copy sweep/delete is DEFERRED — export-only, §3/ADR-002 intact, no new ADR. The verifier records SC#4 as partially met, not a silent gap.)**
**Plans**: 6 plans

Plans:
- [x] 07-01-PLAN.md — Wave-0 foundation: pure @pikar/core modules (retention/serialize, review-threshold, notification templates) + @aws-sdk/client-s3 + schema by_ts index + plan counter fields (Wave 1) — completed 2026-07-21 (145/145 core green; OPSG-03/REVW-02/OPSG-05 primitives)
- [x] 07-02-PLAN.md — OPSG-03: real WORM S3 Object Lock export + auditSince by_ts rewrite (export-only; hot-copy sweep deferred) (Wave 2)
- [x] 07-03-PLAN.md — REVW-02/03 workflow path: fail-closed review gate (escalated terminal) + review-timeout notification (Wave 2)
- [x] 07-04-PLAN.md — AGNT-04 + REVW-02 cockpit path: agent-timeout notification + bounded fail-closed cockpit revise cap (Wave 3)
- [x] 07-05-PLAN.md — OPSG-05: notify choke point + best-effort external (email) dispatch + DLQ notification + §4 scan (Wave 3)
- [x] 07-06-PLAN.md — Phase close: full offline sweep + fail-closed grep-proofs + live smokes (worm/pipeline/dlq) + owner human-verify of the notification matrix + SC#4-partial record (Wave 4) — 6/6 COMPLETE, owner-approved 2026-07-21. Offline sweep green (core 145/145, backend 398/399 sole documented red, check-playbooks 0); four fail-closed grep-proofs hold; runnable live smokes PASSED on :3210 (worm stub, pipeline 3 terminals, dlq); SC#4-partial recorded. Two cloud-infra-only checks (real S3 Object-Lock durability, real external email delivery) owner-DEFERRED as Manual-Only (3.8/6 precedent — not silent gaps). Commits c7da38b, 2ffa989, 02e8c2b. Orchestrator to run gsd-verifier + phase-complete next.

### Phase 8: Self-Improvement
**Goal**: The system learns from real feedback and improves its own skills (versioned agent skill documents, optimized via the SkillOpt sidecar's held-out-validation loop â see research/SKILLOPT.md) under automated evaluation guardrails with instant rollback â sequenced last because the loop is meaningless until review/feedback data has accumulated.
**Depends on**: Phase 7 (needs delivered-response feedback and a stable pipeline)
**Requirements**: IMPR-01, IMPR-02, IMPR-03
**Success Criteria** (what must be TRUE):
  1. User can rate and comment on delivered responses, and the feedback is captured against the originating request.
  2. A feedback threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks (held-out set the optimizer never sees), with a one-click rollback and a kill switch.
  3. Prompts are versioned; every optimization records the before/after versions and the triggering evidence.
**Plans**: 8 plans in 6 waves
- [x] 08-01-PLAN.md — Schema substrate (feedback table, plans/requests.skillVersion, optimizerConfig) + kill-switch config (Wave 1)
- [x] 08-02-PLAN.md — Feedback capture mutation + skill-version attribution at propose/executePlan (Wave 2)
- [x] 08-03-PLAN.md — Threshold-breach eligibility: pure classifier + optimizerEligibility query (Wave 2)
- [x] 08-04-PLAN.md — PII-scrubbed trajectory export endpoint (fail-closed) (Wave 3)
- [x] 08-05-PLAN.md — Candidate write-back through the eval gate + IMPR-03 audit + owner notification (Wave 4)
- [x] 08-06-PLAN.md — Feedback UI on delivered ReportCard + ops kill-switch/activate panel (Wave 5) — completed 2026-07-24 (FeedbackControl on sent rows wired to feedback API + reportForPlan requestId; ops Optimizer section: kill-switch role=switch toggle + candidate review/activate through the shared EVAL_GATE; 48/48 backend + web tsc green)
- [x] 08-07-PLAN.md — SkillOpt Python env package + dormant GitHub Actions batch runner (Wave 5)
- [ ] 08-08-PLAN.md — Manual cockpit-agent dry-run (proof-of-life) + playbook/watch + phase close (Wave 6)

### Phase 9: Private Beta Productionization
> **SUPERSEDED (2026-07-24) -> absorbed into Phase 25 (Milestone v2.0).** This entry stays as history; its requirements (BETA-01/02/03, DLVR-02) now map to Phase 25, which reuses `09-CONTEXT.md` as its spec and executes LAST after all Phase 10+ work.

**Goal**: Invited users beyond the owner can sign up, stay fully isolated from each other, onboard fast to a first delivered result, and deliver via either email provider â the week-4 definition of "production" (not billing/public launch).
**Depends on**: Phase 8
**Requirements**: BETA-01, BETA-02, BETA-03, DLVR-02
**Success Criteria** (what must be TRUE):
  1. A new user can sign up only with a valid invite code (Convex Auth + `betaInvites`).
  2. User A cannot read User B's requests, vault, cache, audit, or telemetry â isolation holds across every table and index, verified by an explicit cross-user test.
  3. A new user reaches their first delivered result within minutes via a guided conversational onboarding.
  4. An approved response can be delivered via Microsoft Graph (Outlook) through the same provider-agnostic adapter that already serves Gmail (delegated `Mail.Send`, built only after Gmail works end-to-end).
**Plans**: TBD

## Phase Details - Milestone v2.0

### Phase 10: Vault->Agent Grounding
**Goal**: The Executive Agent can retrieve from the user's knowledge vault mid-conversation through a governed `searchVault` tool, so every downstream intelligence feature grounds in the user's own data instead of generic model memory. This is the root dependency the launch-readiness review named (vault retrieval shipped but had zero agent callers).
**Depends on**: Phase 5 (vault + `vaultGround.ts`), Phase 3.2.1 (the governed agent tool-loop), Phase 3.6 (eval gate for the skill-teaching edit)
**Requirements**: VGND-01
**Success Criteria** (what must be TRUE):
  1. In a cockpit conversation the agent calls `searchVault(query)` and receives hydrated, tenant-scoped chunk text; an empty or failed search returns cleanly and the turn continues (fails open, never dead-ends).
  2. Retrieved vault content is quarantined as untrusted data (delimited, labelled untrusted, never able to select a tool or set a parameter) - an injection in a grounded doc can at most inform a proposal, execution still crosses the human Approve gate.
  3. No grounded-doc substring appears in any audit, telemetry, agent-step, or DLQ payload (refs/ids/counts only); a regression test asserts the boundary.
  4. User A's `searchVault` can never return User B's vault content (tenant-scoped by `namespace=tenantId`); the isolation assertion ships with the tool, not retrofitted.
  5. The searchVault skill-teaching lives as a gated skill version activated only through the Phase-3.6 eval gate.
**Plans**:
  - Wave 1: 10-01 (vault hydration engine — `vaultGroundHydrated` internalAction returns titles + capped chunk text)
  - Wave 2: 10-02 (governed `searchVault` tool: briefInbox shape, refs-only `vault.searched` audit, untrusted fence, fail-open, BETA-05 isolation; +`vaultSources` table, ADR-006)
  - Wave 3: 10-03 (UI: "Searching your knowledge vault…" step + "📚 Grounded in N documents" source card) · 10-04 (gated `cockpit-agent` skill teaching WHEN to ground + grounded/empty golden fixtures via the eval gate)

### Phase 11: Persona Onboarding & Business Profile
**Goal**: A guided first-run onboarding identifies the user's persona and captures their business/idea into a structured, indexed business profile in the vault - the grounded substrate the evaluation engine and flagship workflow read.
**Depends on**: Phase 10 (grounding - the profile is a groundable vault doc), Phase 3.8 (extraction for uploaded business docs), Phase 6 (voice, for a spoken brief)
**Requirements**: ONBD-01, ONBD-02
**Success Criteria** (what must be TRUE):
  1. A brand-new user completes a guided onboarding that identifies persona (solopreneur / startup / SME); a low-confidence detection confirms with the user rather than silently assuming (enterprise is out of scope).
  2. The user supplies their business via files, pasted text, or a written/spoken brief and a structured business profile document is stored and embedded in the vault, retrievable via `searchVault`.
  3. The business profile is tenant-scoped and unreachable by any other user (isolation assertion ships with the profile doc-kind/table).
  4. No raw business-profile prose lands in any audit/telemetry/DLQ row (refs/counts only - business profiles are name-dense, so the redaction boundary holds here).
**Plans**: TBD

### Phase 12: Business Evaluation Engine
**Goal**: The agent produces an on-demand, persona-appropriate business assessment grounded in the user's own vault data, surfaces real gaps as governed action proposals, and honestly reports when there are none - Pikar doing what generic AI does, but grounded and action-connected.
**Depends on**: Phase 11 (business profile), Phase 10 (grounding). Market-fact claims depend on Phase 16 web research - until then the engine scopes itself to vault-grounded findings only and says so.
**Requirements**: BEVL-01, BEVL-02
**Success Criteria** (what must be TRUE):
  1. On demand the agent returns an assessment using a persona-appropriate framework (SWOT / Lean / Business Model Canvas), grounded in the user's vault; every finding carries a source citation and a confidence label, and no metric, competitor, or viability score is fabricated.
  2. A healthy-business fixture returns zero gaps - "no gaps found" is a first-class, eval-tested outcome, never a forced quota.
  3. Each surfaced gap becomes a concrete, approvable next action routed through the existing plan -> human Approve -> execute spine (the review is read-only; acting is gated).
  4. Evaluation rubrics are minted AS gated skills and activated only through the Phase-3.6 eval gate; the engine's market claims stay scoped to vault-grounded findings until web research (Phase 16) lands.
  5. Evaluation findings write refs/citations/counts only to audit/telemetry (no grounded prose leaks); an isolation assertion ships for the evaluations table.
**Plans**:  6 plans

Plans:
- [ ] 12-01-PLAN.md — Growth OS pure-TS port (diagnose/ltgpCac/cfa + scorecard type)
- [ ] 12-02-PLAN.md — Register 7 gated rubric/specialist skills (bodies + sync test)
- [ ] 12-03-PLAN.md — evaluations table + engine + refs-only audit + two-tenant isolation test
- [ ] 12-04-PLAN.md — evaluateBusiness read-tool + EVALUATION card (human-verify)
- [ ] 12-05-PLAN.md — Gap -> proposed memo-plan + memo terminal (not email)
- [ ] 12-06-PLAN.md — Eval-gate harness + 2 golden fixtures + cockpit-agent teaching + activation

### Phase 13: Proactive In-App Review
**Goal**: The chief-of-staff initiates - a scheduled recurring business review is delivered in-app on a weekly-style cadence using no OAuth mailbox token, so proactivity never depends on (or silently breaks on) the Google 7-day testing token.
**Depends on**: Phase 12 (runs the on-demand evaluation engine on a schedule); reuses the existing crons + `briefings` in-app-digest pattern (no audit row, no OAuth token)
**Requirements**: BEVL-03
**Success Criteria** (what must be TRUE):
  1. A Convex-scheduled job runs the evaluation engine per tenant on a recurring cadence and writes an in-app review card + notification - no email, no mailbox token touched.
  2. The proactive review survives past 7 days (no `invalid_grant` dependency); any future scheduled Google-bound call is explicitly deferred to production OAuth (S4).
  3. The scheduled review is tenant-scoped (the cron iterates tenants, every read/write scoped) and writes refs/counts only to audit.
**Plans**: 4 plans

Plans:
- [ ] 13-01-PLAN.md - Engine delta (route/playbook keyed), by_kind index, shared review constants, watch.json registration
- [ ] 13-02-PLAN.md - proactiveReview.ts (runWeekly fan-out + reviewOne + direct notification insert), crons.weekly, SC#2/SC#3 guard tests
- [ ] 13-03-PLAN.md - Pinned Weekly-review tab + composer suppression, dated card header + delta line + profile CTA, notification click-through
- [ ] 13-04-PLAN.md - Full phase gate + live dashboard runWeekly {} verification (checkpoint)

### Phase 14: Flagship Voice-Doc Workflow
**Goal**: The flagship experience - a user uploads a report, has it understood in the vault, discusses it by voice with the grounded agent, and receives surfaced insights/patterns/gaps plus a memo or a gap-bridging plan, with an honest "no gaps" path and the user deciding after the discussion.
**Depends on**: Phase 10 (grounding), Phase 12 (insight/gap engine), Phase 6 (live voice sessions), Phase 3.8/4 (report ingestion/extraction). Mostly integration of shipped machinery.
**Requirements**: DOCV-01
**Success Criteria** (what must be TRUE):
  1. An uploaded report is ingested and embedded in the vault, then the user holds a live voice conversation with the agent that grounds its answers in that specific document (interrupt, drill in, redirect).
  2. The agent surfaces insights/patterns/gaps each carrying a vault citation; when the document reveals no gaps it says so honestly rather than fabricating one.
  3. After the discussion the user chooses the outcome - a memo or a gap-bridging plan - and any resulting action crosses the normal plan -> Approve gate.
  4. No report content leaks into audit/telemetry/step rows (refs/counts only).
**Plans**: 9 plans (9 waves — serialized: every plan writes docs/playbooks/voice.md, see 14-VALIDATION.md § Wave / File-Ownership Contract)

Plans:
- [ ] 14-01-PLAN.md — Wave-0 freeze contribution: schema widening + FRAMEWORK_LABEL, every Lane-C stub, the ungated document-analyst persona, playbook registration
- [ ] 14-02-PLAN.md — Pure doc-session domain: bounded fenced digest, welded citations/routes, the honesty verdict rule, doc memo composer, pinned Realtime function-call vocabulary
- [ ] 14-03-PLAN.md — Doc-scoped session start + the doc-filtered retrieval action with its refs-only audit and the BETA-05 isolation assertion
- [ ] 14-04-PLAN.md — Doc-grounded mint: document-analyst persona + digest + the flat read-only tool, with the session.update fallback
- [ ] 14-05-PLAN.md — Findings producer: transcript → cited evaluations row on the synthetic thread, honest healthy / no-fabricated-gap
- [ ] 14-06-PLAN.md — Browser relay: ?doc= connect, the response.done function-call round trip, always-send-an-output
- [ ] 14-07-PLAN.md — Vault "Discuss by voice" entry with status gating, plus the in-call doc context strip and partial badge
- [ ] 14-08-PLAN.md — Post-call outcome: cited findings via CardList, memo-vs-plan choice, gap → proposed plan → the single Approve gate, SC3 e2e
- [ ] 14-09-PLAN.md — §4 static scans (mutation-verified), playbook consolidation, and the live human-verify checkpoint

### Phase 15: Sub-Agent Dispatch & Generalized Action Executor
**Goal**: The hollow `sub_agent` route becomes real - specialists are swappable (skill body, tool-set) pairs the ONE governed loop runs - and the approve->execute spine becomes action-agnostic, so all breadth of action rides a single governed seam instead of re-forking the loop or the executor.
**Depends on**: Phase 10 (grounding, for credible specialist output), Phase 3.2.1 (the one governed loop). The S2 framework - must exist before any specific action tool or media.
**Requirements**: DISP-01, ACTN-01
**Success Criteria** (what must be TRUE):
  1. The router dispatches a named specialist that runs in the SAME governed loop with a swapped (skill body, tool-set); an unknown specialist fails closed to `unknown_route`, never a silent default.
  2. Dispatch enforces a hard depth cap, a shared root-request cost budget (one envelope drawn down across the whole sub-agent tree), and cycle refusal (A->B->A is rejected) - no nested `generateText` loops, no agents spawning agents.
  3. Every sub-agent audit/telemetry row carries `rootRequestId` + `parentAgentId` lineage (refs/ids only), so the insert-only audit reconstructs the call tree and cost attributes to the root request.
  4. An approved plan can execute a non-email action type through a generalized executor (`executePlan`/`deliverApprovedPlan` dispatches by action type); the human Approve gate stays a mutation, never a tool.
  5. A cross-tenant isolation assertion ships for the dispatch/lineage rows (a sub-agent run keyed on `rootRequestId` is still tenant-scoped).
**Plans**: 6 plans in 5 waves (Wave 0 freeze, then Lane A / Lane B — see `.planning/PARALLELIZATION.md`)
- [ ] 15-01-PLAN.md - Wave-0 freeze: agentSteps dispatch literals, readable daily budget, VERB map, core stubs, watch.json, finalized lane table (run on `main`)
- [ ] 15-02-PLAN.md - Lane A: specialist registry + closed `Prescription.route` + the ONE loop seam (`toolNames`) + ADR-007
- [ ] 15-03-PLAN.md - Lane A: governed dispatcher - depth cap, cycle refusal, shared root envelope, refs-only lineage, two-tenant isolation + ADR-008
- [ ] 15-04-PLAN.md - Lane A: "Act on this" handoff - `collecting` staging, scheduled dispatch, attribution/incomplete body, honest fallback
- [ ] 15-05-PLAN.md - Lane B: generalized action executor - exhaustive arm table in `executePlan`, `deliverApprovedPlan.ts` byte-unchanged, Approve-not-a-tool scan
- [ ] 15-06-PLAN.md - Lane A: rewritten specialist bodies, multi-pin eval runner, 3 golden fixtures, one eval-gate run (ship dark on red)

### Phase 15.4: Vault redesign and scoped browse correctness (INSERTED)

**Goal:** Ship the approved Nord Edge Vault experience on the real vault data plane, preserving every existing governed action while making browse and search honestly folder-scoped.
**Requirements**: VALT-16
**Depends on:** Phase 15.3
**Success Criteria** (what must be TRUE):
  1. The root browse, inside-folder, document-preview and empty states match the approved mockup using shared product tokens rather than page-local hardcoded colors.
  2. Existing upload, folder upload, Google Drive import, folder digest/rebuild, identity correction, citations, download and delete controls remain reachable and functional.
  3. Search within an open folder cannot return documents from another folder; root/category search retains its current tenant-scoped behavior.
  4. Category tabs do not claim exact counts until a bounded counter contract exists, and all loading, error, empty, partial-ingest and stale-digest states remain honest.
  5. Backend/component tests, production build and browser UAT cover the redesigned states and scoped-search boundary.
**Plans:** 4/4 plans executed — complete 2026-08-05

Plans:
- [x] 15.4-01-PLAN.md — Server-scoped folder search contract with isolation/sealing regression tests (Wave 1)
- [x] 15.4-02-PLAN.md — Nord Edge root/folder browse, honest state model, retained-action component tests and scoped styles (Wave 2)
- [x] 15.4-03-PLAN.md — Nord Edge preview/import surfaces with lifecycle and control-retention tests (Wave 3)
- [x] 15.4-04-PLAN.md — Executed Playwright/full gates, watched playbooks and authenticated owner UAT (Wave 4)

### Phase 15.3: Vault Folders - Folder Ingest, Synthesis and Drill-In (INSERTED)

**Goal:** A user can upload a company FOLDER as a unit and the vault treats it as one thing — ingested under a bounded budget, synthesised into a folder-level digest that is itself a grounded vault document, and browsable by drilling into the folder rather than scrolling one flat document grid.

**Origin:** Not new scope. This is the "Phase 2 of this line of work" that Phase 15.2 explicitly carved out and sequenced AFTER itself (`15.2-CONTEXT.md:170-184`), because the per-file cap raise was unsafe until the extraction fan-out bounded per-action memory. 15.2 shipped that fan-out; the blocker is cleared and the work never got a slot.

**Scope (SEVEN items — five from the 15.2 carve-out, plus the two carve-out deferrals the owner put back in scope on 2026-08-02; see `15.3-CONTEXT.md`):**
- `vaultFolders` table + an OPTIONAL `folderId` on vault documents — new table, new optional field, the zero-migration widening idiom (`actionType.ts:11-13`). A document with no `folderId` is exactly what it is today.
- Folder upload at 1–1.5 GB and the per-kind file cap raise to 200 MB.
- Folder-level synthesis. The lazy shape the carve-out already names: **the folder digest IS ITSELF a vault document**, so it embeds, retrieves and grounds through the existing rails with no second plane.
- Folder-scoped UI drill-in **reusing `PreviewModal`** — the file-side UI (`DocGrid`, `PreviewModal`, `CategoryTabs`, `Dropzone`, `VaultStats`) already shipped in 3.8/15.2, which is why this half was cheap to defer.
- Per-folder budget estimate + reservation.
- **Document identity classification as a first-class classifier** — a closed `docType` union plus a free-text identity line (*"2025 P&L"*, not *"a spreadsheet"*), user-correctable and never overwritten once corrected. Standalone, so it applies to SINGLE-FILE uploads too, not only to documents inside a folder.
- **The Google Drive export rail** — a one-time 1:1 import of a Drive folder into one `vaultFolder`, re-importable on demand, bounded by the SAME budget window and the same intact-refusal path. Continuous sync is explicitly out of scope.

**The one invariant this phase exists to protect:** every ingest opens with `guardrails.preCall`, which enforces a daily budget. A large folder can trip it mid-run and leave half its documents `failed` — and **a half-ingested folder is worse than a refused one**, because the agent grounds on it confidently without knowing what is missing. Estimate and reserve for the WHOLE folder before the first document, or refuse the folder intact.

**Corrections carried from research:** the Drive rail DOES move bytes — non-native Drive files are downloaded into a Convex action, so the per-file byte cap applies to it too and is enforced from `size` metadata BEFORE download (`15.3-RESEARCH.md` §A6). And the estimator needs a probe stage: bytes + mime alone cannot see the variable that costs the money (a text-layer PDF vs a scanned one is a 40x spread inside one mime type), so a FREE local page-count/text-layer probe runs after bytes land and BEFORE the first paid call, and the reservation is taken off the probed number (§A4).

**Requirements**: VALT-05, VALT-06, VALT-07, VALT-08, VALT-09, VALT-10, VALT-11, VALT-12, VALT-13, VALT-14
**Depends on:** Phase 15.2 (the extraction fan-out that made the cap raise safe)
**Unblocks:** Phase 17.1 — its Stage-2 blueprint drift is specified to fire on bulk/folder-ingest completion and degrades to the Stage-1 one-click rebuild banner until folder ingest exists (`17.1-RESEARCH.md:114-115`, `17.1-CONTEXT.md:201-207`)
**Plans:** 3/9 plans executed (9 plans, waves 1-9, strictly serial — every plan depends on 01 schema)

Plans:
- [x] 15.3-01-PLAN.md - Wave 1: schema + requirements + roadmap - `vaultFolders` table, six optional `vaultDocuments` fields, two indexes, the `folder_digest` origin literal; ALL schema for the phase lands here so no later wave touches `schema.ts`
- [x] 15.3-02-PLAN.md - Wave 2: vault survivability at folder scale - the grid + stats read is bounded by ROWS AND BYTES and projected (no `text`), and the size cap is one 200 MB declaration (VALT-05, VALT-14)
- [x] 15.3-03-PLAN.md - Wave 3: the budget rail - third $25/day ingest window, two-stage estimate, hard reserve, clamped refund, intact refusal that names numbers (VALT-06)
- [x] 15.3-04-PLAN.md - Wave 4: folder ingest orchestration - dedicated workpool, watchdog armed at `markExtracting`, counter-based completion, cancel-by-delete (VALT-05, VALT-06, VALT-08). **Two plan-vs-reality corrections shipped deliberately:** `pool.cancelAll` is unscopeable (it cancels every pending item for every tenant), so the stop moved into `vault.markExtracting`, which refuses work whose folder row has vanished; and `reserveFolder` runs AFTER the members upload because it is also the close signal — without that ordering a 3-file folder completes at `1 === 1`. No folder-level reservation watchdog was built: completion and cancel are the only two exits and both route through the one `settleFolder`
- [x] 15.3-05-PLAN.md - Wave 5: sealing at all three read sites - `runVaultGround` (seeds AND graph neighbours), `vault.vaultSearch`, `blueprint.unincorporatedFor` (VALT-07). **ONE predicate, `vaultFolders.sealedIn`, and the status test is POSITIVE (`=== "ingesting"`):** `cancelFolder` deletes the folder row, so `!== "complete"` would seal every cancelled folder's documents forever. Graph neighbours are an INDEPENDENT leak path — `vaultGraph.expand` reads `graphEdges` with no filter of its own — so a seeds-only fix does not close it. All five mutations run RED; the graph-neighbour test was VACUOUS on first run and its own non-vacuity control caught it. Accepted and documented: `upsertGraph` still writes sealed members' entities into the shared tenant graph (structural metadata, never content or a doc id)
- [x] 15.3-06-PLAN.md - Wave 6: the folder digest - registry-governed synthesis inserted as an INGESTED vault document, plus the 17.1 staleness/rebuild idiom (VALT-08, VALT-09, VALT-10). **`origin: "folder_digest"` IS INERT** — no origin predicate exists in retrieval, so the digest grounds ONLY because its insert calls `startIngest` and the observable check is `ragEntryId != null`. The digest carries NO `folderId` (the recursion guard). **An ADVERSARIAL VERIFY PASS after the suite was already green found THREE defects, all the same root cause — a digest with no `folderId` is invisible to every mechanism that finds work by folder membership:** the staleness read bounded ROWS but not BYTES and could throw the drill-in banner (now streams like `readVaultPage`, newest-first); `cancelFolder` orphaned a still-groundable digest (now cascaded); a budget refusal was completely silent (now one refs-only audit row). Plus the digest's own re-ingest was charging the cockpit token rail. 9 tests, EIGHT mutations run RED, zero spend
- [x] 15.3-07-PLAN.md - Wave 7: the folder UI - folder picking, always-on inline pre-flight, the refusal that names both numbers, sealed progress, drill-in, stale-digest rebuild (VALT-05, VALT-06, VALT-08, VALT-10, VALT-11). Built by a 14-agent workflow. **AN ADVERSARIAL VERIFY PASS FOUND FOUR MAJORS AFTER THE SUITE WAS GREEN AND THE BUILD PASSED, AND THE UNIFYING CAUSE IS THAT `apps/web` HAS NO UNIT-TEST RUNNER** (no test script, no vitest dep, no config; `pnpm test` is `turbo run test` and skips it): a `preflightCopy.test.ts` that executed NOWHERE while reading as coverage; estimate/reserve parity (the plan's own <verification> line) asserted by nothing; the Start loop awaiting `reserveFolder`/`cancelFolder` OUTSIDE any try/catch in a fire-and-forget handler, so one dropped socket froze the panel forever with 400 members parked under a folder no sweep touches; and per-file failures accumulated then DISCARDED on partial success. All four fixed, four mutations run RED. NOT fixed and recorded: the folder Cancel pill's 3.67:1 teal is a byte-identical clone of two shipped pills, so it needs a surface-wide pass rather than one inconsistent fix
- [x] 15.3-08-PLAN.md - Wave 8: document identity classification - closed `DOC_TYPES` union, registry-row classifier prompt, one ingest step, user-correctable identity that wins (VALT-12). Built by a 13-agent workflow. The union lives in `packages/core` (a `<select>`-driving precedent already exists there) with a TWO-DIRECTION compile bridge, mutated both ways and proven to fail. Classification DEGRADES the label rather than failing the document — the try/catch is INSIDE `classifyDoc`, because a throw at the step boundary exhausts the workflow retries and `onIngestComplete` marks the row `failed`, so an unseeded skill would have failed EVERY ingest in the deployment for a cosmetic field. **THE VERIFY PASS FOUND THREE DEFECTS AFTER GREEN, the sharpest being that `identityLine` was the ONE field passed RAW from the model** — `jsonSchema()` without a `validate` fn does not check the model object at runtime, so a non-string value hit `v.string()` inside `step.runMutation`, OUTSIDE the try/catch, and failed the document. Also: `PreviewModal`'s seed guard was per-MOUNT not per-DOCUMENT (switching docs kept the previous identity in the form and Save would write A onto B), and a classified-but-still-`processing` row seeded an EMPTY form whose Save blanked and permanently LOCKED it. The intermittent `crypto is not defined` suite failure was proven PRE-EXISTING (reproduces with only `onboarding` + `vaultDigest`), not this wave
- [x] 15.3-09-PLAN.md - Wave 9: the Google Drive rail - scope widening of the existing Google grant, metadata-only pre-flight, one-time import + on-demand re-import (VALT-13). **THE RESERVATION IS TAKEN FROM METADATA, BEFORE ANY BYTE IS DOWNLOADED** — `files.list` returns count/size/type up front, so refuse-intact is proven by absence rather than asserted, and this is the one place the Drive rail is deliberately ordered differently from the upload rail. Two locked decisions corrected on FACTS: the per-file byte cap DOES apply (non-native files download into a ~512 MB action) and Drive reports no `size` for Google-native docs (`estimatedBytesFor` never returns 0 — reading a missing size as 0 prices a 500-Doc folder at $0 and strands it mid-run). **BOTH SHARED-DRIVE PARAMS ON EVERY CALL, PINNED BY A SOURCE SCAN** because the failure has no observable behaviour — Drive answers a param-less request with HTTP 200 and an EMPTY file list, i.e. "imported 0 files, folder complete". Re-import is keyed `driveFileId + modifiedTime`, never `contentHash` (OOXML is a zip; a hash key duplicates the folder every refresh); an unchanged listing issues ZERO export fetches and creates ZERO rows. A dedup hit gets identity but NOT membership (annexing would seal a document the user could already ground on). Deviations recorded in vault.md: enumeration is bounded below the 10-min action limit by node caps instead of a self-scheduling continuation; `DRIVE_ID_RE` guards the id at the trust boundary because it is interpolated into Drive's `q=` QUERY LANGUAGE, which percent-encoding does not protect. SIX mutations RUN — one of which exposed that the audit name-leak scan tested only for `name:` and the shorthand `name,` walked straight through it. **NOT LIVE-RUN: every Drive response in the suite is a stub**

### Phase 15.1: Fact-Derived Tier & Conversational Onboarding (INSERTED)
**Goal**: The business tier stops being something a user can assign themselves and becomes a fact-derived, auditable property of the tenant — because tier now selects agent voice and which Growth OS specialists get offered, making a self-writable tier a behavioral control rather than a preference.
**Depends on**: Phase 15 (dispatch seam exists, so tier plugs in as a filter/ordering layer rather than forking the router). Design doc D7 originally sequenced this "after Phase 13"; deferred one phase so Phase 15 can ship tier-agnostic dispatch and keep the seam clean.
**Requirements**: consumes `.planning/design/tier-and-conversational-onboarding.md` (decisions D1-D7 are LOCKED)
**Success Criteria** (what must be TRUE):
  1. `deriveTier(facts)` is the ONLY writer of the tier; no UI control and **no mutation argument** accepts a caller-supplied tier — the profile page and `updateProfile` both refuse it (defect 1b). Enterprise stays admin-granted only (D6).
  2. The tier lives in a queryable, indexed tenant-profile table with `tierSource` + `derivedAt`, not string-matched out of markdown (defect 1d); a malformed doc can no longer silently reclassify a tenant as solopreneur.
  3. Onboarding asks the determining facts (headcount/paid staff) instead of letting an LLM guess the persona from prose (defect 1a); a required slot cannot be left empty.
  4. The audit row reflects what actually happened — the hardcoded `personaConfirmed: true` on edits is gone (an insert-only log must not assert a confirmation that never occurred, CLAUDE.md §3).
  5. Tier visibly changes treatment: agent voice/framing and which specialists are offered off a diagnosis (D5); a tier change is surfaced as an event, not a silent setting. **Scoped by ADR-009 (owner decision Q2, 2026-07-26): `diagnose()` emits exactly ONE prescription, so there is no candidate set to filter — SC#5 ships as PROMPT-SHAPING (tier + agent name + behaviour-preset directive ride into the specialist's prompt). A verifier must NOT read it as "the offer set is filtered" or "the rubric pick changes"; widening `diagnose()` is deferred with an ADR.**
  6. Existing tenants backfill as `tierSource: "legacy"` with no forced re-onboarding (§10).
**Plans**: 7 plans in 6 waves (Wave-0 freeze first; runs SERIALLY in `.worktrees/lane-a-dispatch` — no lanes, no merges)
- [x] 15.1-01-PLAN.md — Wave-0 freeze: pure tier rules in @pikar/core (deriveTier + slot gate + agent-name sanitizer), the `tenantProfiles` table, watch.json registration, ADR-009 — completed 2026-07-26 (core 254/254 + `tsc` exit 0 with the D6 `@ts-expect-error` in place, both mutation-checks RED-then-restored; backend `tsc` at the exact 55-error test-file baseline with 0 in `schema.ts`; `Doc<"tenantProfiles">` resolves with no codegen; turbo 8/10 + `check-playbooks` exit 0; `git diff` proves onboarding.ts / evaluations.ts / llm.ts / dispatch.ts / apps/web all untouched)
- [x] 15.1-02-PLAN.md — `convex/tenantProfile.ts`: the record, derive-on-write, the tier-change audit event, the operator-only enterprise grant, the resumable legacy backfill — completed 2026-07-26 (327 lines, 6 exports — `forTenant`/`get`/`saveFacts`/`grantEnterprise`/`backfillLegacyTier`/`runBackfillLegacyTier`; `saveFacts` takes NO tier argument and returns `{tier, tierSource, changed}` — the ONLY tier writer; audit event `tenant.tier_changed` with payload keys `["factsChanged","from","tierSource","to"]` — refs/counts only per §4; `grantEnterprise` is an `internalMutation` with NO public surface, so GOVN-01 is explicitly NOT closed by this plan; backfill is resumable, batched and idempotent. 2 deviations auto-fixed: the §4 no-fact-values scan narrowed from whole-row to PAYLOAD (the whole-row form would flake ~11%-per-number against 13-digit `ts`/`_creationTime` fields and was the WEAKER assertion — mutation-checked, adding `headcount` to the payload turns it RED), and the test needed `TestConvex<typeof schema>` to clear the documented `SystemIndexes` wall. All 4 mandated mutation-checks run and reverted. tenantProfile 19/19, +vaultSweep 29/29, backend full 564/565 (sole red the documented `audit.test.ts` row), backend `tsc` at the exact 55-error baseline with 0 in `tenantProfile.ts`, turbo 8/10, `check-playbooks` exit 0, freeze probe clean. Operator commands deferred to integration on `main` — no `CONVEX_DEPLOYMENT` in this worktree)
- [x] 15.1-03-PLAN.md — The subtraction: no tier argument in `vProfile`, tier spliced from the table into the markdown projection, truthful audit rows, both pill sets deleted, the SC#1c source scan — completed 2026-07-26 (`vProfile` and `profileSchema` have NO `persona` field, so a caller-supplied tier is a HARD Convex validation error and the extraction model has nowhere to put a guess — SC#1b; both write paths read `tenantProfiles` through `currentTierRow` and splice `row.tier` before `serializeProfile`, making the markdown a PROJECTION of the table. **`personaConfirmed` was DELETED, not corrected — an insert-only log does not get an amended claim (SC#4, CLAUDE.md §3)**; audit payload key sets now `profile_committed` = `["fieldCount","tierSource","vaultDocId"]`, `profile_updated` adds `reembed`. `ProfileInput = Omit<BusinessProfile,"persona">`; `BusinessProfile.persona` is now `Tier` (projection only). Error codes shipped for plan 07: `INCOMPLETE_ONBOARDING` / `INCOMPLETE_FACTS`, both `{code, missing: SlotName[]}`. THREE mutation-checks observed RED then reverted — re-adding `persona` to `vProfile`, dropping the tier splice (markdown lost its Persona line), and pasting the pill block back into `profile/page.tsx` (2 assertions). 4 deviations auto-fixed, incl. a `telemetry.payload` typecheck break (that table has no `payload` column) and the §4b needles switched from substring-scan to numeric-leaf comparison. core 264/264, contracts 13/13, backend 569/570 (sole red the documented `audit.test.ts` row), backend `tsc` at the exact 55-error baseline with 0 in `onboarding.ts`, apps/web exit 0, turbo 8/10, `check-playbooks` exit 0. **Left first-time onboarding intentionally FAIL-CLOSED between this plan and 15.1-07 — `commitProfile` refuses until the tier facts exist; the block was LIFTED by 15.1-07**)
- [x] 15.1-04-PLAN.md — `evaluations.ts` picks its rubric from the table; `personaHint` deleted (defect 1d closed on the read side) — completed 2026-07-26 (`TIER_FRAMEWORK` bound `as const satisfies Record<Tier, Framework>`, `enterprise`→`swot`, NO trailing `??` — mutation-checked: deleting an entry fails at both the map TS2741 and the index site TS7053; `runEvaluation` reads `internal.tenantProfile.forTenant`; SC#2b proven with TWO table tiers over ONE identical malformed doc, both CONFIRMED RED first at `"lean"`; Q3 preserved and pinned — `financialsPresent` still overrides with `growth-os`; zero deviations; SC#2b set 5/5, evaluations 23/23, +proactiveReview+gapAction 36/36, backend 573/575, backend `tsc` at the exact 55-error baseline with 0 in `evaluations.ts`, apps/web exit 0, turbo 8/10, `grep personaHint` empty, diff limited to the 4 owned files)
- [x] 15.1-05-PLAN.md — Tier → treatment: three UNGATED behaviour-preset style skills, pure `tierBriefing`, wired into the dispatched specialist's prompt (ADR-009: prompt-shaping, not an offer-set filter) — completed 2026-07-26 (`style-direct`/`style-coaching`/`style-concise` through the FULL 5-file mirror, UNGATED per Q6 with the rationale on `GATED_SKILLS`; `tierBriefing` total over `TIERS` by `satisfies` bind, absent tier ⇒ NO tier claim, `agentName` sanitized in exactly one place; `buildSpecialistPrompt` prepends on BOTH return paths and the style read FAILS OPEN while the specialist body loader stays fail-CLOSED. **The plan's own SC#5b distinctness assertion was VACUOUS — mutation-checked 34/34 GREEN with two tiers sharing a clause, because the block interpolates the tier NAME; fixed by masking the discriminator, which then goes RED.** 3 deviations auto-fixed. ADR-009 held: `llm.ts` byte-unchanged via `git diff --exit-code`, router unforked, `diagnose()` unwidened, Q3 override intact. contracts 16/16, core 277/277 + `tsc` exit 0, skills 42/42, dispatch+guard+gapAction 45/45, backend 577/579 (`voice.test.ts` 8/8 in isolation = documented flake), backend `tsc` at the exact 55-error baseline with 0 in any non-test file, apps/web exit 0, turbo 8/10, `check-playbooks` exit 0)
- [x] 15.1-06-PLAN.md — Conversational onboarding: the `onboarding-agent` skill + a `generateObject` slot-filler where code owns the state machine (Q1) — completed 2026-07-26 (`converse` = ONE `generateObject` turn → `{reply, slots, missing, nextSlot, done}`; a `tenantAction`, STATELESS, writes NOTHING. `nextSlot` = `missingSlots(slots)[0]` in `REQUIRED_SLOTS` order and `done` = `canComplete(slots)`, NEVER read off the model — a reply claiming "your onboarding is complete!" leaves `done:false`, and the non-vacuity turn says the opposite while going `done:true`. UNGATED `onboarding-agent` (Q6) through the FULL 5-file mirror, loaded FAIL-CLOSED and FIRST — before the `SMOKE::onboard::` short-circuit — so SC#3c is exercised offline. The code supplies the slot NAME + shape, the body the words; the merge's admission test IS `missingSlots` over a one-slot object, so `0` is an answer and off-union enums are DROPPED. **Q1 honoured literally: `llm.ts` AND `schema.ts` byte-unchanged via `git diff --exit-code`, no new `agentSteps.tool` literal, no `"use node"`, and the `ponytail:` ceiling names the three `runAgentLoop` blockers + the upgrade path.** FOUR mutation-checks, all CRLF-aware and loud on NO MATCH: load-after-short-circuit ⇒ 1 RED exactly SC#3c; `done` off the reply ⇒ 2 RED; `nextSlot` in model order ⇒ 1 RED; one-char `.md` edit ⇒ 1 RED. ZERO deviations. contracts 17/17, core 277/277, onboarding+profileRedaction 26/26, +skills+tenantProfile 87/87, backend FULL 585/586 (sole red the documented `audit.test.ts` row), backend `tsc` at the exact 55-error baseline with 0 in any non-test file, apps/web exit 0, turbo 8/10, `check-playbooks` exit 0, diff limited to the 9 owned files)
- [x] 15.1-07-PLAN.md — apps/web: the conversational onboarding surface + the profile facts form with a read-only tier and its reason — completed 2026-07-26 (**the deploy block from 15.1-03/06 is LIFTED — `commitProfile` is satisfiable again**; the onboarding page runs the fact conversation and writes `saveFacts` before `commitProfile`, the profile page renders the tier READ-ONLY with its `tierSource` reason and the preset as the closed `BEHAVIOR_PRESETS` enum, never free text. The closing beat costs a SECOND `converse` call and that is load-bearing: `converse` derives `nextSlot` from the slots it was GIVEN, so the turn completing the set is still under `Next fact to obtain: <last>` — re-asking with the completed slots is the only path to the prompt's "nothing left to obtain" branch; ceiling + upgrade path in a `ponytail:` comment. **TWO would-be-vacuous checks caught: (a) plan 03's mutation-check did NOT carry over — it pasted back a persona pill block that no longer exists in either rewritten file, so against the new source it was a no-op reporting CLEAN; re-armed properly, a planted `saveFacts({tier:"sme"})` button gave 2 RED on the profile page. (b) the scan's four `not.toContain` rows were ALL satisfiable by a page with no controls at all — added a positive row asserting the `BEHAVIOR_PRESETS` group survives, so "no tier control" now means "no tier control AND the legitimate preference control still exists".** 3 deviations auto-fixed: the plan's `role="radio"` group tripped `useSemanticElements` and had no keyboard nav (replaced with native `fieldset`/`legend` + `input[type=radio]` on both pages), the new `tier:` scan rule false-positived on the read-only render `{tierRow ? tierRow.tier : "—"}` (re-anchored on property position), and `onboarding.md` still described the persona confirm/change control plan 03 deleted. Measurement caveat carried forward: `grep -c $'\r'` under Git Bash here matched EVERY line — do not measure EOLs that way in this worktree. apps/web `tsc` exit 0, core 282/282, SC#1c scan 14/14, backend full 585/586, backend `tsc` at the exact 55-error baseline, turbo 8/10, `check-playbooks` exit 0, `git diff -- packages/backend/` zero files)

### Phase 15.2: Vault Universal Format Recognition & Extraction Fan-Out (INSERTED)
**Goal**: A document the user uploads is either READ or it FAILS — never a silent "reading…" pill forever. Recognition becomes content-based (magic bytes) instead of a MIME-string allow-list, every common business format extracts, and scanned PDFs transcribe verbatim instead of being summarised.
**Depends on**: Phase 15 only in sequence, not in substance — this is independent vault work. Runs as a THIRD concurrent lane alongside the live Phases 16 and 17 (see `.planning/PARALLELIZATION.md`).
**Requirements**: consumes `docs/superpowers/specs/2026-07-27-vault-format-coverage-and-extraction-fanout-design.md` (owner-approved 2026-07-27, incl. the SheetJS dependency call)
**Origin**: owner-reported "the vault has been reading this document for 10+ minutes". Diagnosed live 2026-07-27: a `.xlsm` sat at `pending_extraction` ~20h with 0 chars and NO `failureReason`, because `extractionKindFor` returns `null` for any MIME outside a three-entry allow-list and `null` schedules nothing.
**Success Criteria** (what must be TRUE):
  1. `sniffContainer(bytes)` decides the extraction rail from magic bytes; a correct file with a wrong, renamed or ABSENT MIME type still extracts (closes the same class as the documented Windows empty-MIME `.md` defect).
  2. `extractOfficeText` dispatches on ZIP ENTRIES, not mimeType — so XLSM/DOCM/PPTM/ODT/ODS/ODP/EPUB are covered by construction rather than by enumeration. No new dependency for this tier (`fflate` is installed).
  3. Legacy formats read: DOC/PPT via an OLE2 printable-run sweep (no dep); XLS/XLSB via SheetJS pinned from the CDN tarball, NOT the npm `xlsx@0.18.5` publish (CVE-2023-30533 / CVE-2024-22363). A text sweep is NOT acceptable for BIFF — it recovers headers and silently loses every number.
  4. **No document ever parks silently.** An unresolvable format is terminal `failed("unsupported_format")` at the `vaultUpload` chokepoint, and a 15-minute watchdog flips stalled `pending_extraction`/`extracting` rows — the two non-terminal statuses that never got the guarantee `onIngestComplete` gave `processing` after the 2026-07-20 stranding incident.
  5. Scanned PDFs extract VERBATIM: the hosted-OCR branch fans out per-page (pdf-lib `copyPages`, bounded-concurrency batches, page-ordered reassembly), matching the `attachment-extractor` skill's existing single-page contract — so §5 is satisfied by REUSE, with no new skill row and no prompt change.
  6. `markReady` clears `failureReason`/`extractionTruncated`, so a successful retry stops reporting a stale error; and `extractGraph` caps its prompt (today it is the one uncapped model call in the repo).
  7. **LIVE GATE:** the owner's stuck `.xlsm` reaches `ready` with non-zero `textChars` on the real deployment via `vaultSweep:runSweep`. Offline green does NOT close this phase (Pitfall-1 class — only the deployed run proves it).
**Non-goal**: folders, 1–1.5 GB folder upload, the 200 MB per-file cap raise, document-identity classification and folder-level synthesis are **Phase 2 of this line of work** — the cap raise is unsafe until the fan-out bounds per-action memory (the playbook already flags large-doc extraction memory/time at the CURRENT 100 MiB cap).
**Plans**: 8/8 plans executed (8 waves, serial — `vaultExtract.ts` is the spine of four of them, and `execute-phase` serialises on `wave`, not on intra-wave `depends_on`). The 8th was created BY the 15.2-05 live gate, not authored up front.
**STATUS 2026-07-27:** **all 7 authored waves COMPLETE and ALL SEVEN success criteria CLOSED**, each of the three live-only ones executed against `local-joel_feruzi-pikar_ai_50c69-1` and owner-approved (SC#7 by 15.2-05, SC#5 by 15.2-06, SC#3-XLS by 15.2-07). `15.2-VALIDATION.md`'s three Manual-Only rows are all executed and passing, and `nyquist_compliant: true` now rests on execution evidence rather than planning-time conditions. **THE PHASE IS NOT FINISHED: 15.2-08 (below) was created BY the 15.2-05 live gate, has no PLAN.md yet, and is outstanding.** Two honest gaps carried to the verifier: **`failureCopy` has never been rendered in a browser** (SC#4's live half only partially paid, compounded by the `:3000` `next start` predating its own build), and a real **Excel-authored `.xls` with DATE cells** is unobserved (the serial-`46067` ceiling was measured only on a SheetJS-written fixture).

Plans:
- [x] 15.2-01-PLAN.md — Lane V contract + magic-byte `sniff.ts` + the never-null scheduling decision [SC#1, SC#4] (Wave 1)
- [x] 15.2-02-PLAN.md — Format coverage in the pure layer: ZIP-entry dispatch (XLSM/DOCM/PPTM/ODF/EPUB) + RTF/markup/OLE2 DOC-PPT, no new dependency [SC#2, SC#3] (Wave 2)
- [x] 15.2-03-PLAN.md — **THE UNBLOCK**: permissive scheduling at ONE chokepoint, in-action rail dispatch, reachable `unsupported_format`, 15-min per-attempt watchdog [SC#1, SC#2, SC#3, SC#4] (Wave 3)
- [x] 15.2-04-PLAN.md — Stale-reason fix, `GRAPH_EXTRACT_CHAR_CAP`, plain-language failure copy + remedy [SC#4, SC#6] (Wave 4)
- [x] 15.2-05-PLAN.md — **LIVE GATE**: the owner's stuck `.xlsm` reaches `ready` with non-empty text on the real deployment [SC#7] (Wave 5) — **PAID 2026-07-27 on `local-joel_feruzi-pikar_ai_50c69-1`: 0 → 256,439 chars.** Owner approved but PARTIALLY OBSERVED — `failureCopy` still unverified live. Gate finding: `runSweep` is a NO-OP without `'{"reset": true}'`
- [x] 15.2-06-PLAN.md — Per-page fan-out so scanned PDFs transcribe VERBATIM (bounded concurrency, page-ordered, per-page timeout) [SC#5] (Wave 6) — **VERIFIED LIVE + owner-APPROVED 2026-07-27: the 12-page deck went 2,161 → 7,868 chars, `Page 1`…`Page 12`, 0 `[unreadable]`, 13¢/12 calls, no OCC.** `attachment-extractor` prompt BYTE-UNCHANGED (§5 by reuse). Verdict from row data, NOT a browser (`:3000` still stale). `extractionTruncated` on long scans is now expected, not a regression
- [x] 15.2-07-PLAN.md — SheetJS spike + legacy XLS/XLSB, sequenced LAST so its failure narrows only SC#3 [SC#3] (Wave 7) — **SPIKE PASSED + VERIFIED LIVE + owner-APPROVED 2026-07-27: a real legacy `.xls` reached `ready` with its NUMBERS visible, so SC#3 is FULLY CLOSED and all seven criteria are now closed.** `xlsx` 0.20.3 pinned EXACTLY to the vendor CDN tarball (NOT npm `xlsx@0.18.5` — CVE-2023-30533, CVE-2024-22363). Rebuilt under Convex's own esbuild flags: SheetJS carries **19 real named exports**, the `pdf-lib` **control still collapsed to 1**, so the probe provably detects a collapse. **PITFALL 9 GENERALISED — the discriminator is the missing `exports` map / ESM build, NOT the import form — and promoted into the playbook's `## Invariants`.** Approval evidence level: the owner's direct confirmation of the criterion; **no figures transcribed back, nothing diffed against Excel.** Date-serial ceiling remains open
- [x] 15.2-08-PLAN.md — **(NEW, added by the 15.2-05 live gate)** — completed 2026-07-29 PPTX extracts slide TITLES ONLY (`pptxText` reads `<a:t>` from slides, never opens `ppt/charts/*`), and scaffolding-only output reports `ready` because `` `Slide ${n}` ``/`` `Sheet ${n}` `` are emitted unconditionally so `empty_extraction` never fires — a false-ready one layer below the scheduler. Both halves. Sequenced AFTER 15.2-07 (Wave 8)

### Phase 16: Research Sub-Agent & Web Research
**Goal**: The first exemplar specialist - a Research sub-agent - is dispatched through the new framework and performs grounded, injection/SSRF-hardened web research, storing findings in the vault and unblocking credible market-fact evaluation.
**Depends on**: Phase 15 (dispatch framework + generalized executor)
**Requirements**: DISP-02, ACTN-03
**Success Criteria** (what must be TRUE):
  1. A Research specialist is dispatched via DISP-01 with its own least-privilege tool-set and returns findings to the executive agent - it has NO send/write capability, so an injected instruction in a fetched page can at most propose, never execute.
  2. The web-research tool is injection- and SSRF-hardened (retrieved page text quarantined as untrusted data; no internal/metadata endpoints reachable); findings are stored in the vault with a retrieval-date freshness stamp.
  3. Research findings and the sub-agent trace write refs/counts only to audit/telemetry (no page content, no grounded prose); an isolation assertion ships for stored findings.
  4. The evaluation engine (Phase 12) can now cite fresh web-research results with a freshness stamp for market claims instead of relying on stale model memory.
**Plans**: 8/9 plans executed (9 plans, 6 waves). 16-09 is PARTIAL: tasks 1-2 committed, task 3's three fixtures + the self-check floor bump landed 2026-07-31, but the paid `pnpm eval:golden` gate and the task-4 owner checkpoint are UNPAID — blocked on a securely available `OPENAI_API_KEY`.
Plans:
- [x] 16-01-PLAN.md — Wave-0 freeze: shared unions, llm.ts signature widening, watch registrations
- [x] 16-02-PLAN.md — the OQ-2 live web-search probe (D8) and the research model + cost constants it gates
- [x] 16-03-PLAN.md — the research route, its least-privilege grant, the output fence, ADR-010
- [x] 16-04-PLAN.md — the §5 research-specialist skill body (D10 sophistication) + the 5-file mirror
- [x] 16-05-PLAN.md — the hosted webSearch tool, per-call billing, SSRF scan + non-vacuity floor
- [x] 16-06-PLAN.md — the ASYNC dispatch seam (D9-REVISED: stage -> schedule -> land), the persisted `collecting` interlock, the relocated model pin. NOT the superseded D9 in-loop seam: no per-turn envelope closure (the interlock replaces it) and NO guard-comment amendment (dispatchGuard.test.ts:16-24 predicted this shape and is left untouched, deliberately)
- [x] 16-07-PLAN.md — the vault terminal: research.ts, the freshness stamp, cross-tenant isolation — completed 2026-07-27 (one `kind: "web_research"` vault document per successful run, written by the DISPATCHER after `dispatchAndLand` returns — so the approvable card already holds the findings and a persist failure costs groundability, not the work: audited as `research.persist_failed` with a reason CODE, swallowed, no retry/DLQ. Stored text is provenance header → 16-03's `<research_findings …>` fence → the D10 limits footer; the zero-source "insufficient evidence" verdict is CODE's, not the model's, and sits ahead of the fence. `retrievedAt` is a stored, queryable number; ingest starts through `startIngest` with `rootRequestId` as the correlation id. Honest boundary recorded in the playbook: only the FIRST chunk carries the header + inner fence — per-chunk containment is `searchVault`'s outer `<vault_context …>` fence. research.test.ts 12/12; backend 723/723 across 48 files; tsc ZERO non-test errors; 3 mutation-checks RED-then-green. 4 auto-fixed deviations, two of which make the plan's own done-criteria checkable: `INCOMPLETE_MARKER` exported from `@pikar/core` (one phrasing per stop cause) and a `research` flag on `__runSpecialistWithScript` — `runResearch` cannot be driven offline. `llmRedaction.test.ts`'s pinned audit-payload count 4→5, discharged by REVIEWING the new §4 site. NOT live-verified — offline only)
- [x] 16-08-PLAN.md — D11 offline: containment proven positively + the failure-mode matrix + the mutation ledger — completed 2026-07-29
- [x] 16-09-PLAN.md — SC#4 citation + the eval:golden gate (D11's second proof) + the phase checkpoint — completed 2026-08-08 (gate run `14feb4b7` **34/34, $0.3456**, unfiltered, pins cockpit-agent@17 research-specialist@8 offer-architect@4 money-model-designer@4 lead-engine@4; all five evidence rows recorded and all five ACTIVATED with the active row verified to equal the pin. The research plane is proven END TO END on the LOCAL Tavily tool — `research.persisted` x3 and `subagent.completed` x7 in the audit trail — NOT on a hosted vendor search: the 2026-08-07 Gemini grounding excursion is dead history, since `webResearch` needs no vendor entitlement. Fixture 29's `citesVaultDoc` retrieval variance passed this run; it remains variance, not a guarantee)

### Phase 17: Calendar Actions
**Goal**: The agent can schedule and manage calendar events (Google / Microsoft) as governed actions - a read tool that surfaces availability in-loop and a write that stages an event into the plan for human approval.
**Depends on**: Phase 15 (dispatch + generalized executor); mirrors the shipped `gmail.ts` adapter pattern (standard, research-phase likely skippable)
**Requirements**: ACTN-02
**Success Criteria** (what must be TRUE):
  1. The agent reads calendar availability in-loop (like `listInbox`) and proposes a calendar event; the event is created only after the human Approve gate fires the generalized executor - never inside a tool call.
  2. Calendar actions reuse the shipped OAuth-refresh/adapter pattern and log refs/ids/counts only to audit.
  3. Calendar reads/writes are tenant-scoped and covered by an isolation assertion shipped with the surface.
**Plans**: 4/4 plans executed (4 plans in 4 waves, serial — each plan's files are the next one's contract). Research REFUTED the "likely skippable" note: `inline` cannot fetch (a mutation cannot `fetch`) and `workflow` IS the gmail fan-out, so a THIRD `Arm` literal (`externalAction`) is structurally forced.
- [x] 17-01-PLAN.md — Stage-1 shared-union freeze (agentSteps literals, widened `plans.kind`, staged-event fields, `calendarFixtures`, VERB, watch.json) + the three arm-table compile sites + the pure `@pikar/core` calendar domain
- [x] 17-02-PLAN.md — the Google Calendar adapter: the offline fixture seam, the widened one-URL Google grant, `freeBusy` read, `events.insert` write, and the single retrier-`onComplete` terminal handler
- [x] 17-03-PLAN.md — the two in-loop tools in `llm.ts`: `checkAvailability` (read) and `proposeCalendarEvent` (stages onto the plan, never creates) — completed 2026-07-29
- [x] 17-04-PLAN.md — the real `externalAction` arm behind the Approve gate, the enforcement scans (write unreachable from `llm.ts`, POST targets by NAME, no attendees/`sendUpdates`), and the SC#3 two-tenant isolation assertion — completed 2026-07-30

### Phase 17.1: Business Blueprint - Corpus Synthesis and Agent Spine (INSERTED)

**Goal:** Every agent surface carries a standing, cited description of the business instead of
reaching it only through query-scoped retrieval. One blueprint artifact = the user's typed profile
(authoritative, never overwritten) + document-derived fields where they left blanks (cited) + the
top graph entities. Draft -> user confirms -> live.

**Delivered through TWO SEAMS** (owner decision 2026-07-27, REPLACING the original "prepended in
`vaultGroundHydrated` so all five callers inherit it from one seam" plan, which research disproved):
- **Seam 1 — the cockpit turn prompt.** The blueprint is prepended to the `prompt` passed into
  `runAgentLoop`, so it is present on EVERY turn regardless of tool use. Prepending it inside
  `vaultGroundHydrated` would have reached the cockpit only on turns that happened to call
  `searchVault` — and would have made `llm.ts:1364`'s honest "nothing in your vault" answer
  structurally unreachable (HIGH severity), inflated every `vault.searched` count, and put a
  blueprint chip on every search.
- **Seam 2 — a separate `spine` field** on `vaultGroundHydrated`'s return, ALONGSIDE the parallel
  arrays and never inside them, consumed explicitly by `evaluations.ts` and `voiceDoc.ts`. There
  are **THREE** real callers of that function, not five: `onboarding.ts` and `tenantProfile.ts`
  mention it in comments only.

Also amended 2026-07-27: the blueprint is **NOT embedded and NOT graph-extracted**; the
`business-blueprint` skill is **UNGATED**; Stage-2 drift is **USER-TRIGGERED** (detection is
automatic and free, the rebuild is one click — no automatic trigger until a bulk-ingest completion
event exists); `stage` is `BusinessProfile.stage`, never `tenantProfiles.revenueStage`.

**Source:** `docs/superpowers/specs/2026-07-27-business-blueprint-design.md` (PRD express path).
Locked owner decisions D1-D5 in spec §2.1.

**Requirements**: BLPR-01 (synthesis + typed-wins precedence + confirm gate), BLPR-02 (standing spine on every cockpit turn + the explicit `spine` field + staleness + drift diff)
**Depends on:** Phase 17. Also sequenced AFTER 15.2 and 16 — it edits `vaultGround.ts`, which Lane R
(Phase 16) also touches, so it is deliberately NOT a fourth concurrent lane.
**Out of scope:** folder ingest (15.2's "Phase 2") and visual rendering/diagrams — spec §9.
**Plans:** 9/10 plans executed

Plans:
- [x] 17.1-01-PLAN.md — Pure blueprint core: closed field set, FIELD_SPEC totality table, stated assembly, blank-driven probes, deterministic serializer pair (Wave 1)
- [x] 17.1-02-PLAN.md — Substrate: migration-free `tenantProfiles` widening + 2 indexes; the UNGATED `business-blueprint` skill row (Wave 1) — completed 2026-07-27 (5 optional `tenantProfiles` fields — draft/draftAt/sourceDocIds/docId/confirmedAt — with ZERO migration entry and no existing field or validator touched; `graphNodes.by_tenant_degree` for the top-entities read and `vaultDocuments.by_tenant_status` for Stage-1 drift, the second a DECLARED deviation from CONTEXT's "one new index", said so in the schema comment rather than landing as silent drift. `business-blueprint` shipped through the FULL 5-file mirror and is **UNGATED** — the owner decision that REPLACES the phase's original "through the eval gate" DoD line, recorded in three places (the `skill.ts` doc comment, the `seedSkills` row comment, the playbook) because that omission is exactly what a later reader "fixes". Both reasons pinned: mechanically `run-eval-golden.mjs` hard-validates `--skill` against a closed name list it cannot extend to the synthesis path, so gating deadlocks the skill at v1 on its first body edit; principled, the `business-profile` rationale verbatim — output is a vault doc a human confirms under D2, and precedence (`mergeBlueprint`) plus citation validation are already CODE. **The absence is now an ASSERTION, not an absence:** `isGatedSkill("business-blueprint") === false` is tested. Drift row MUTATION-VERIFIED — `(v1)`→`(v2)` in the `.md` turned exactly ONE row red (1 failed/20 passed), revert restored 21/21. Body obeys the three locked properties: candidates-only and never shown the live blueprint, NO field enumeration (code supplies FIELDS TO FILL so the closed set has one home — the 15.1-06 split), and a REQUIRED integer `sourceIndex` with `-1` as the no-source sentinel because the plan-05 `generateObject` schema must be strict-mode legal, plus an explicit "a fabricated index DROPS the claim" so guessing gains nothing. Carries the DATA-not-instructions clause. ZERO deviations, ZERO auto-fixes. Gates: contracts 21/21, contracts tsc exit 0, backend **47/47 files / 710/710 tests** (fully green — the plan's documented `audit.test.ts` baseline red did NOT appear), backend tsc ZERO non-test `error TS`, `check-playbooks` empty. **One trap worth carrying: a backend run backgrounded ACROSS my own edits went red on 6 `intake.test.ts` tests — vitest transforming a module graph changing underneath it, indistinguishable at a glance from a real regression. Re-run undisturbed: green. Do not background a long suite and then edit files it imports.** `.git/MERGE_HEAD` checked before every commit; all three commits used the pathspec form and no foreign lane file or foreign playbook was staged)
- [x] 17.1-03-PLAN.md — Precedence as code: citation trust boundary, `mergeBlueprint` + the two-kind diff, `renderSpine` (Wave 2) — completed 2026-07-27 (the three functions that carry this phase's guarantees, all pure `@pikar/core`, 20→48 tests, full core suite 355/355, typecheck exit 0. **D5 is now structural: `mergeBlueprint` has NO branch that assigns a derived entry over a stated one**, and the proof is a LOOP over `BLUEPRINT_FIELDS` — not one hand-picked field — so it survives a twelfth field; mutation-verified `out[field] = candidate ?? typed` ⇒ 3 RED, reverted green. A contradicting candidate raises a `contradiction` ROW and changes nothing; blank→value is an `addition`; a CHANGED derived value stays an `addition` because a contradiction is only ever raised against content the USER typed; an identical rebuild yields an EMPTY diff (the whole Stage-2 drift contract, made true by carrying `live` forward when a probe pass comes back empty). **`validateCandidates` is the citation trust boundary**: out-of-range / the `-1` sentinel / a non-integer all drop in ONE branch, unknown and `derivable:false` fields drop too (a model cannot rename the business, reclassify the tier or write the graph), narrowing is a membership test and never a cast, and **drops are REPORTED** so VALIDATION L2 is measurable. **The plan's literal second mutation is behaviour-PRESERVING here and that is recorded, not papered over** — `sources[i]` yields `undefined` for every bad index anyway, so the range test and the lookup are deliberate belt-and-braces; the mutation was re-run against the real defect shape (emit a placeholder source, i.e. keep the claim uncited) ⇒ 3 RED. **`renderSpine` is the ONE renderer both seams inject**, budgeted outside `TOTAL_CHAR_CAP`, `[stated]` vs `[source: …]` markers with a stated fact never cited, staleness line iff the count > 0, plain labels so the `- **Persona:**` detector cannot fire. **The size guarantee became arithmetic:** `FIELD_SPEC.cap` now budgets the WHOLE RENDERED LINE (17.1-01's 2280 value-level caps could not sum under 2500 once labels, markers and framing were counted — the tripwire would have fired on a legitimate max blueprint); caps retuned to sum 1960 and the worst case MEASURED at 2294 of 2500. Per-field char-cap constants are Claude's discretion per CONTEXT and `cap` has no consumer outside the renderer, so blast radius is zero. The hard total assertion was SEEN to fire — `offering` cap 240→1000 ⇒ throws `3052 chars, over SPINE_CHAR_CAP` ⇒ 3 RED, reverted green. `check-playbooks` blocks ENTIRELY on foreign lanes (`growth-diagnostic.md`/`specialists.ts`, `cockpit.md`/`research.ts`) and was deliberately NOT satisfied — this plan owns `onboarding.md` only, and it is not in the stale list. BLPR-01/-02 left PENDING: their text covers the confirm gate and the seams, which are plans 06/07/08)
- [x] 17.1-04-PLAN.md — Backend read plane: `liveForTenant`, `topEntities`, Stage-1 drift, `spineForTenant` (Wave 3) — completed 2026-07-29
- [x] 17.1-05-PLAN.md — Synthesis: probes -> grounding -> ONE governed model call -> draft write that refuses without a tier row (Wave 4) — completed 2026-07-29 (fail-closed registry prompt before SMOKE; both guardrail refusals return as data; strict source-index schema; ordered blank-field grounding and doc-ID dedupe; citation gate + typed-wins merge; current-live/no-drift edits cost zero model calls; `NO_TENANT_PROFILE` refusal mutation-verified; draft patches exactly two fields and never touches the vault or live source IDs; backend serial suite green)
- [x] 17.1-06-PLAN.md — SEAM 1: the cockpit turn prompt, proven on a turn that calls no tools (Wave 4) — completed 2026-07-29 (`buildTurnPrompt` is the one spine-first assembly; null is byte-identical to the legacy prompt; `spineForTenant` runs after SMOKE and fails open; item 24 drives the real read/render chain and mutation-pins production plus the shim; backend 761/761)
- [x] 17.1-07-PLAN.md — SEAM 2: the `spine` return field + `evaluations`/`voiceDoc` consumption + the three pinned non-regressions, with ZERO `llm.ts` edits (Wave 5) — completed 2026-07-30 (spine remains outside retrieval arrays and budgets; evaluation and voice consumers preserve their existing caps; real cockpit search non-regressions mutation-proven; backend 766/766)
- [x] 17.1-08-PLAN.md — The confirm gate: `confirmBlueprint`, one never-ingested blueprint document, refs-only audit, four-state query (Wave 6) — completed 2026-07-30 (reviewed drafts cross one explicit D2 gate; reconfirmation patches the same ready document; refs/counts-only audit and all four profile states are pinned; backend 775/775)
- [x] 17.1-09-PLAN.md — The confirm surface: `BlueprintPanel` + `BlueprintDiff` (additions grouped ON, contradictions ticked OFF), brand-token styled (Wave 7) — completed 2026-07-30
- [ ] 17.1-10-PLAN.md — Playbooks + the NON-NEGOTIABLE live gate L1-L7 (Wave 8, has a blocking checkpoint)

### Phase 18: Document & Content Creation
**Goal**: The agent can create standalone documents and content artifacts (beyond email attachments) as governed, vault-stored outputs. Scope decision 2026-07-31: this adds an OUTPUT FORMAT to the shipped render path, NOT a subsystem — no `sites` table, no new `ACTION_TYPES` member, no arm re-bind, no public/unauthenticated route. `packages/core/src/actionType.ts:29-31` already pre-commits Phase 18 to the existing `externalAction` arm and that pre-commitment stands. Publishing a page to a real URL is post-beta, gated on this phase's downloadable artifact proving demand and on Phase 25 settling the custom domain.
**Depends on**: Phase 15 (dispatch + executor); reuses the shipped attachment/render pattern (`renderAndStore` + `plans.recordAttachments`)
**Requirements**: ACTN-04
**Success Criteria** (what must be TRUE):
  1. The agent produces a standalone document/content artifact stored under the tenant as a vault asset (ref, never raw bytes to the model), distinct from an outbound email attachment.
  2. Any external delivery of a created artifact crosses the plan -> Approve gate; creation alone has no external side effect.
  3. Artifact refs only in audit/telemetry; artifacts are tenant-scoped with an isolation assertion.
  4. `renderAndStore`'s hardcoded `application/pdf` (`llm.ts:948`, `:952`) and `buildDocFilename`'s hardcoded `.pdf` (`documentGen.ts:173`, `:177`) are parameterized by format, so a SECOND format (a self-contained HTML page) is emitted through the SAME governed path — PII scan -> registry drafter -> cap -> `ctx.storage.store` -> ref-only return — with zero new tables and zero new routes. The vault's markup rail already sniffs `text/html` (`sniff.ts:124`), so the artifact is groundable without new extraction work.
  5. The agent authors a STRUCTURED SPEC and CODE renders the markup: a model-authored string never becomes markup. Enforced by a test, not by prompt instruction.
  6. A created artifact is SEEN: it renders in the Output card specified at `docs/design/BRAND.md:101-102` (specified today, unimplemented), not only as a silent vault row.
**Plans**: 10 plans (waves 1-7). Waves 1-5 are runnable independently; **18-08 and 18-10 are PARKED** behind Phase 16 closing and `17.1-10`'s live gate respectively (independent parks, both must clear before 18-09).
Plans:
- [x] 18-01-PLAN.md — Pure core: DocFormat + format-parameterized `buildDocFilename` + `renderHtmlDocument`, with the SC#5 spec->markup boundary proved behaviourally AND structurally (Wave 1) — completed 2026-08-01 (`formatSpec` is the ONE place the ext/MIME literals live; both `.pdf` literals gone from `buildDocFilename`, 4th param defaulted so the two shipped 3-arg call sites are byte-identical. `renderHtmlDocument` renders from `tokenizeMarkdown`'s `DocToken[]`, never the raw model string; the escape boundary is held by a behavioural test AND a structural test that saw **17** interpolations, all `esc(...)`/`*Html`/`HTML_*`. Mutation-verified: `esc(r.text)` → `r.text` ⇒ 1 RED on `/<script/i`, reverted green. Core 18 files / 381 tests, tsc exit 0, zero new dependencies. **The research's verbatim `not.toMatch(/onerror/i)` assertion is unsatisfiable** — the substring survives as inert TEXT by design — corrected to the attribute form plus a code-owned-tag allow-list strip)
- [x] 18-02-PLAN.md — Schema + trace registration: the `agentSteps.tool` literal and its `cards.tsx` VERB entry together, plus `vaultDocuments.origin` and `vaultSources.role`/`snippet`/`form` — all optional, zero migration (Wave 1) — completed 2026-08-01 (Registration Checklist rows 1, 2, 13, 14 closed. `createDocument` landed on BOTH sides in ONE commit; traceParity 2/2 with the sets at 26→**27** each and the `>= 22` floor untouched — checked explicitly, since set equality also passes when both halves are absent. `resetPlan`/`recordScorecardAnswer` left deliberately trace-less with a ponytail note whose tool names are **bare identifiers**: traceParity regexes the union slice *including comments*, so the file's own `v.literal` idiom would have injected two phantom literals and turned RED the very test the task gates on. Four `v.optional` fields ⇒ zero tables, zero indexes, zero migrations, zero backfill. **Backend typecheck 150, ZERO non-test — delta 0**; that 150 is the number every later Phase-18 plan gates against)
- [x] 18-03-PLAN.md — The `content-drafter` skill as the full 5-file mirror, DELIBERATELY UNGATED so it lands live at v1 with no eval and no paid run (Wave 1) — completed 2026-08-01 (99-line body covering hook / length / platform voice + both house clauses; formatting rules deliberately INVERSE of `document-drafter`'s. Mirror generated mechanically via `JSON.stringify` — no generator script added. `CONTENT_DRAFTER_SKILL` outside `GATED_SKILLS`, with the absence asserted as a test. Mutation-verified: one char in the `.md` ⇒ exactly 1 RED, reverted ⇒ 50/50. Backend typecheck 150, ZERO non-test — delta 0. `document-drafter` + `cockpit-agent` bodies byte-unchanged. **DEAD WEIGHT until 18-05 lands `draftDocument`'s `skillName` argument** — nothing loads this body yet)
- [x] 18-04-PLAN.md — The vault write plane: `insertCreatedDoc` + `patchCreatedDoc`, the Output-card row shape, and the deliberate absence of `startIngest` that IS the retrieval exclusion (Wave 2) — completed 2026-08-01 (SC1/SC1b/SC3/SC7 all green, 10/10 in `createdDocs.test.ts`. `startIngest` **call sites in `vault.ts` unchanged at 5** — the exclusion is the absence, annotated at the site with the `blueprint.ts confirmBlueprint` precedent and the promotion path; `vaultIngest.ts` diff empty. `patchCreatedDoc` resolves the 1-based `#index` INSIDE the mutation off a **role-filtered** `vaultSources` read, guards on tenant AND origin, and returns `{ ok: false }` rather than throwing. Mutation-verified: deleting the `origin !== "agent"` conjunct ⇒ exactly 1 RED (the user-upload test), reverted ⇒ 10/10 — and both the byThread and same-`_id` tests insert a grounding card AFTER the created one, so the load-bearing filter is non-vacuous. storageId trap: took **option A** (store a real blob, pass its id) and strengthened `toBeDefined()` → `toBe(storageId)`. Backend typecheck **150 — delta 0**, zero non-test, zero attributable. **Two measurement traps recorded**: a BACKGROUNDED turbo typecheck can be read mid-flush and returned a false 27; and the sibling `@ts-expect-error import.meta.glob` idiom is a DEAD directive under this tsconfig — 100 of the 150 errors are that one line across 37 files. `vault.md` is owed by §9 and deliberately NOT bumped — 18-09 owns it, and the hook's exit 0 is a FALSE NEGATIVE from foreign lane 22.1-02 bumping it earlier today)
- [x] 18-05-PLAN.md — `llm.ts` parameterization: `draftDocument`'s closed `skillName` (the reach that makes `content-drafter` live) and `renderAndStore`'s `format`, defaulted so Phase 3.3 stays byte-identical (Wave 3) — completed 2026-08-01 (**Registration Checklist row 4 CLOSED — `content-drafter` is REACHABLE and 18-03's row is no longer dead weight.** `draftDocument`'s args are now `{ tenantId, safeText, safeTextHash, skillVersion?, skillName? }` where `skillName` is a CLOSED `v.union` of the two literals — a wrong name is a validator error, not a silently-wrong prompt body — and ONE `const name = skillName ?? DOCUMENT_DRAFTER_SKILL` feeds BOTH lookup branches. `skills.ts` unchanged (both queries already took `name: v.string()`); `document-drafter`'s BODY byte-unchanged, so no gated candidate was minted. `renderAndStore` gained a 4th DEFAULTED `format`; both `"application/pdf"` literals replaced by one `formatSpec(format).mimeType` hoist, `buildDocFilename` takes the format, and `generateAttachment` exposes it as an OPTIONAL input property — `regenerateAttachment` stays three-arg, `gmail.ts` needs zero changes, no second size constant. **HTML is reachable on the ATTACHMENT path ONLY, by design** — 18-06's `createDocument` will find no HTML in its flow and must NOT "fix" it. Two mutation checks, each exactly 1 RED and reverted green: hardcoding `name` back ⇒ the discriminator test (seeds both rows, archives only `content-drafter`); encoding `draft.markdown` instead of `renderHtmlDocument(...)` ⇒ the SC4 row. Gates: 142/142 across documentDraft + cockpitTools + llmRedaction + runCockpitAgent, backend typecheck **150 — delta 0, zero non-test**, biome byte-identical to HEAD on all three edited files, `renderAndStore` occurrences still 5 (closure NOT extracted). **The SC4 html test lives in `cockpitTools.test.ts`, not `documentDraft.test.ts`** — `renderAndStore` is only reachable through the `__invokeCockpitTool` shim, which needs the node pragma + the registered aggregate that file already has. `cockpit.md` is owed under §9 and deliberately NOT bumped — 18-09 owns it, and the hook's exit 0 is again a possible FALSE NEGATIVE)
- [x] 18-06-PLAN.md — The `createDocument` tool: closed `form` enum, optional `replace` #index for replace-in-place revision, refs-only audit, the `create=` SMOKE op that is the ONLY offline e2e driver, and the SC#2 no-external-side-effect scan (Wave 4) — completed 2026-08-01 (**Registration Checklist rows 3 and 16 CLOSED.** ONE key in `buildCockpitTools`, a closed `form` enum selecting BOTH the skill row and the PDF branch, and `replace` as an OPTIONAL property on the SAME schema — the revision path costs **zero** registration surface. `execute` always returns a sentence: a PII refusal, a drafter failure and a bad `#index` are all returned strings, never throws out of the governed loop. The `document.created` audit is `{ topicHash, form, vaultDocId, hasPdf }` — four keys, asserted by exact key-set equality — and it is emitted from the TOOL, so `cockpit.ts` still has exactly **2** audit call sites and `llmRedaction.test.ts` is 43/43. `create=<short|long>:<topic>` registered at all four SMOKE sites; **18-07's spec MUST send `SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager`** — the NESTED route prefix is part of the topic and without it the turn is not offline. **The card ACCUMULATES:** there is no turn identity inside a tool closure, so the tool reads the thread's latest `role: "created"` row and appends, keeping `#2`/`#3` addressable across turns; that needed one additive `internal.vaultSources.latestCreated` because `byThread` is a `tenantQuery` and the tool plane passes `tenantId` explicitly. Two mutation checks, each reverted green: an injected `internal.cockpit.` reference ⇒ exactly **1 RED** (the SC2 scan, which has a non-vacuity floor); dropping `form` from the card write ⇒ **5 RED**. Gates: cockpitTools **82/82** (was 71), **268/268 across 10 suites**, backend typecheck **150 — delta 0, zero non-test**, locked-file diffs empty. ⚠ **The tool is INVISIBLE to the model until 18-08 teaches it in the active `cockpit-agent` body** — a tool the body does not teach is a tool that does not exist)
- [x] 18-07-PLAN.md — The artifact is SEEN: the BRAND-conformant Output card, the vault-grid AGENT chip, and the SC#6 e2e spec (authored here; RUN at 18-09's gate, which owns the live stack) (Wave 5) — completed 2026-08-01 (**SC#6's AUTOMATED half only.** `OutputCard` is `SourceCard`'s dumb self-querying shape with ONE extra arg on the SAME `byThread` query (`role: "created"`) — zero new tables, zero new queries, zero new routes, zero new deps, no component library. It returns `null` on a turn that created nothing, and the shipped grounding `useQuery` call is byte-unchanged (the diff on `cards.tsx` is **91 added lines and zero removed**; `traceParity` 2/2). Copy: `✍️ Created` / `✍️ Created · N`, an UPPERCASE `DOCUMENT`/`POST` badge read off the row's own `form` (absent ⇒ DOCUMENT), the titles as `/dashboard/vault` links, the subline **`Saved to your vault. Nothing was sent.`**, and `snippet` as the artifact preview. **The plan's `titles[0]` heading was NOT implementable and was replaced by the `#index` title list:** the row ACCUMULATES and on a `replace: 2` revise the newest title lands in slot 2 — nothing on the row records which slot moved, so any single-title heading is wrong after the first revision; the `#N` prefixes double as the affordance for the `replace` grammar. **Tokens only, zero hex added, ZERO `--held`** (its 3 occurrences are comments forbidding it). **BRAND §6 beat the in-file precedent:** `ConfChip` sets `--teal-600` as 0.62rem TEXT (~2.9:1, §6-banned), so the badge and the vault `AGENT` chip put the teal in the FILL (`color-mix` on `--teal-400`) and keep `--ink` for the label. The vault chip gates on `origin !== undefined`, not `=== "agent"`, so a promoted doc keeps its provenance. `DocGrid`'s filter carries a `ponytail:` ceiling note: created docs BROWSE for free but never match `vaultSearch` (same rag primitive; they are deliberately never ingested — that absence IS the exclusion), upgrade = a ~3-line title-substring fallback right there; **do not close it by ingesting** — open owner question at 18-09. ⚠ **TWO THINGS ARE STILL OWED AND BOTH ARE 18-09's: (a) the Playwright run itself** — the spec is authored and `--list`-discoverable but has NEVER executed (`playwright.config.ts` pins `:3111` with NO `webServer` block, so it needs a live `convex dev` + the app pinned to `:3111` + `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` an executor cannot mint); **(b) the BRAND conformance judgement** — the card has never been rendered in a browser. The spec's own header states both. It sends the verbatim `SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager` and asserts the testid, the offline title `Smoke Document`, the `DOCUMENT` badge and the subline; a SECOND test pins the null case, which is what makes the first non-vacuous. Gates: web `tsc --noEmit` exit 0, production build green, `--list` 3 tests in 2 files, Biome diagnostic sets **identical to `git show HEAD:<path>`** on both edited files (baselines taken via throwaway siblings — `git stash` is banned in this tree), the new spec Biome-clean, all locked-file diffs empty)
- [x] 18-08-PLAN.md — Teach `cockpit-agent` the tool + regenerate its one-line mirror (Wave 6) — completed 2026-08-08 (body edit + fixture landed `cb48d11` 2026-08-02 under an OWNER OVERRIDE of the Phase-16 gate: one shared candidate stream, one multi-pin gate run, two paid runs become one. CERTIFIED LIVE 2026-08-08 by gate `14feb4b7` 34/34 with `cockpit-agent@17` activated. Fixture 35 FAILED its first live execution and was right to — it caught `createDocument` obeying a model-supplied `replace` on a first create, a defect no reply-text assertion could see; fixed in `0094ac0`)
- [ ] 18-10-PLAN.md — The blueprint drift exclusion (one conjunct + the `BLUEPRINT_KIND` tidy), split out and PARKED because landing it before `17.1-10`'s live gate corrupts the number that gate measures (Wave 6, has a blocking checkpoint)
- [ ] 18-09-PLAN.md — Playbooks, the two ROADMAP contradictions, and the NON-NEGOTIABLE live gate: 4 turns proving the surfaces no offline test can see (Wave 7, has a blocking checkpoint)

### Phase 19: Contacts, CRM & Follow-ups

> **PULLED FORWARD 2026-08-07 (owner decision).** Asked how to handle a Pipeline page with no
> backing data, the owner chose to build the substrate first. This is a genuine unblock rather than
> a reorder: Phase 19 gates **26-18** (Pipeline nav), **Phase 28** twice (28-17 readiness gate,
> 28-10 CRM projections), and now **Phase 31** (Marketing tranche A needs the one person store for
> lead capture). **PLANNED 2026-08-09: 10 plans across 9 waves.** **The PIPE-01 "opportunities / pipeline value" contradiction was RESOLVED 2026-08-09** in
> favour of the requirement as written (see Phase 26 above): the two tiles come off the mockup, no
> `opportunities` table and no monetary column ship in this phase.

**Goal**: The agent can track contacts / CRM state and follow-ups scoped to the user - read to resolve people and surface context in-loop, write staged through the plan gate. Scoped follow-up tracking, not a full pipeline/deal-stage CRM. Widened 2026-07-31 to absorb LEADS and CONSENT: this is the one person store, built once, and it is where the outreach legal obligations (suppression, CAN-SPAM, lawful basis at capture) get a home before anything needs them.
**Depends on**: Phase 15 (dispatch + executor)
**Requirements**: ACTN-05, PIPE-01
**Success Criteria** (what must be TRUE):
  1. The agent reads contact/CRM state in-loop to resolve people and surface follow-up context; a CRM write (add contact, log a follow-up) stages into the plan and executes only via the human Approve gate.
  2. Contact/CRM data is tenant-scoped and unreachable across tenants (isolation assertion ships with the surface).
  3. CRM reads/writes log refs/ids/counts only to audit.
  4. A contact row carries an `origin` discriminator (mailbox-resolved / user-entered / inbound), `consentAt` + `consentSource`, and `unsubscribedAt`. The consent record is reproducible on request — the exact wording shown, the timestamp, and the capture context — and it lives in the content plane, because `audit` is refs-only (CLAUDE.md §4) and structurally cannot hold it.
  5. **The suppression check lives in the SEND path, not in the contacts module.** `executePlan`/`startFanout` refuses every suppressed target address, checked address-by-address against `plans.recipients` (`schema.ts:189`) — a raw address array resolved from Gmail headers that never touches the contacts table. A contacts-row-only check is defeated by a user typing an unsubscribed person's name in chat, so the guard goes in the one place all sends converge, with a test that proves it there.
  6. `tenantProfiles` gains a physical postal address field (CAN-SPAM requires one in the body of every commercial email) and the drafter cannot omit the footer that renders it.
  7. The phase states IN WRITING — in the playbook, not only in a plan summary — why a contacts table does not violate the "no contacts cache at rest" invariant at `schema.ts:210-211`.
  8. A narrow connected Pipeline route shows contacts needing attention, follow-ups due, consent and suppression states from this one store; it does not invent opportunities, stages, monetary value or a second CRM data plane.
**Plans**: **10 plans across 9 waves.** Waves are longer than the dependency graph alone requires because exactly ONE plan per wave may bump a given playbook, and `convex/contacts.ts`, `cockpit.ts`, `gmail.ts`, `schema.ts` and `cards.tsx` are each touched by several plans. **26-18 still owns the nav flip** — Phase 19 ships `/dashboard/pipeline` URL-reachable with `soon: true` intact.

Plans:
- [x] 19-01-PLAN.md — Pure contacts core (normalizeAddress + the three predicates + renderFooter), the THREE new tables, `tenantProfiles.postalAddress`, and the new `contacts-crm.md` playbook with its `watch.json` registration (Wave 1)
- [x] 19-02-PLAN.md — The person store: the tenant-scoped write surface, the suppression/footer/unsubscribe-token internals, the BETA-05 asA/asB isolation assertion and the no-opportunities structural scan (Wave 2)
- [x] 19-03-PLAN.md — The CAN-SPAM postal address: write-boundary validation on `tenantProfile.saveFacts` and the `/dashboard/profile` field, deliberately NOT an onboarding slot (Wave 2)
- [x] 19-04-PLAN.md — The public unsubscribe route on `convex/http.ts`: an inert signed GET landing page and a confirm-only idempotent POST (Wave 3)
- [x] 19-05-PLAN.md — The send-path trust boundary: the pre-CAS refusals and the per-address drop BEFORE the group join, the unbypassable `gmail.send` backstop, the footer at the `buildMime` call site, and an honest terminal for a post-approve suppression (Wave 4)
- [x] 19-06-PLAN.md — `crm_write` joins `ACTION_TYPES` on the `inline` arm across all eleven registration sites in one commit, with the stale `actionType.ts` Phase-19 prediction corrected by the commit that falsifies it (Wave 5)
- [ ] 19-07-PLAN.md — The connected Pipeline route: three bounded read models, four always-known tiles that render a real zero as `0`, the five-column table, the unassigned-follow-ups section, and the authored e2e spec (Wave 6)
- [ ] 19-08-PLAN.md — Contacts-first in-loop resolution and the ONE `stageCrmWrite` tool, landed at all three registration surfaces with both guards proven red-able, plus the offline SMOKE driver (Wave 7)
- [ ] 19-09-PLAN.md — Teach `cockpit-agent` the capability and pay the 18-08 override debt: `eval-cases/36-*.json`, a $0 observable and the 34 → 35 fixture floor bump (Wave 8, has a blocking checkpoint)
- [ ] 19-10-PLAN.md — Correct the two documents this phase falsified, fill in all 22 verification rows, close the playbook against a real sha, and the blocking owner browser UAT (Wave 9, has a blocking checkpoint)


### Phase 20: Media Canvas
**Goal**: A media-creation canvas produces a FINISHED SHORT-FORM REEL - one mp4 assembled from N generated clips with a voiceover over them - as async governed jobs drawing a separate capped media budget. Generation is wrapped, not rebuilt (PROJECT.md mandate).

> **RE-SCOPED TWICE. Read both, in order.**
>
> **(1) 2026-08-01, after the mandated spike (`20-SPIKE.md`, `20-PROVIDER-EVAL.md`).** Two premises of the original wording were false: video is <=15 SECONDS per generation, not <=3 minutes - a MODEL ceiling across 28 video models from eight independent labs, not a provider limitation (ADR-011); and the delivery path is NOT the Pikar-Ai MCP, which is an account-level OAuth connector on the claude.ai CLIENT, absent from `.mcp.json` and structurally unreachable from a Convex action. Phase 20 calls a server-to-server HTTP API (fal.ai) with an API key held as a Convex deployment secret; the `gmailAuth.ts` refresh-token machinery is NOT needed and must not be copied.
>
> **(2) 2026-08-01, owner re-scope after the first 12 plans were committed (`20-CONTEXT.md` D8-D12, `20-RESEARCH-DELTA.md`).** **Phase 20 now ships a FINISHED REEL, not a set of assets.** The <=15 s ceiling is real but it is a **per-CLIP** ceiling, not a per-DELIVERABLE one: multi-block output by ASSEMBLY is now IN scope. The pipeline is `script -> art-direction -> storyboard -> generate -> voiceover -> assemble -> captions`, and the output is ONE mp4. Re-cutting footage the user already has, music beds and sung tracks all remain OUT. The 12 committed plans were REVISED, not discarded - their generation half (price table, batch reserve, fal adapter, HMAC webhook, `media` route, canvas) survives, because a reel is still built from N clips that each need pricing, capping and safe landing.

**Depends on**: Phase 15 (dispatch, media specialist); reuses the scheduling/async machinery and the `@pikar/cost` price-table pattern.
**Requirements**: MEDIA-01
**Success Criteria** (what must be TRUE):
  1. DECIDED 2026-08-01 (ADR-011, amended by ADR-012): provider is **fal.ai**; clips are **Wan 2.5** (**$0.05/s at 480p**, 2x at 720p, 3x at 1080p - and **1080p is the endpoint's DEFAULT**, so every submit pins its resolution explicitly); voiceover is **`fal-ai/inworld-tts`** at $0.01 per 1000 SUBMITTED characters; captions STT is **`fal-ai/elevenlabs/speech-to-text/scribe-v2`** at $0.008 per input audio minute. Auth is one `FAL_KEY` deployment secret for all three. Async via fal queue + webhook onto `convex/http.ts`. Replicate is the recorded fallback. **Every media line item's cost MUST be COMPUTABLE PRE-SUBMIT AND BOUNDED ABOVE from the request's own parameters** (characters, megapixels, video-seconds, audio-minutes, frame count). A model whose price can only be known after generation - billed per COMPUTE SECOND, or per an output length the request does not pin - cannot be reserved and is refused by construction. **Corrected 2026-08-01** from the earlier wording "priced per SUBMITTED INPUT", which was wrong: Wan 2.5 is billed per second of OUTPUT video and passes only because `duration` is a pinned request enum (5 or 10). The old phrasing would have refused our own default model. The test is pre-flight computability, not the billing unit's name.
  2. Media generation runs as an async background job; the UI tracks per-block clip AND voice status independently, plus the reel's render status, and never hangs synchronously. (A 10 s clip takes 1-3 minutes of wall-clock and the render adds another 1-3, so the canvas must show meaningful state through several minutes of nothing arriving.)
  3. Media draws a SEPARATE capped budget line with its own kill-switch, never folded into the token budget: **`MEDIA_JOB_CAP_USD = 3.50`** per job and **`MEDIA_DAILY_CENTS = 1000` ($10/day) keyed PER TENANT**, plus a keyless `deploymentMediaSpendCents` ceiling at 10,000. **The whole JOB - every clip, every voice take, the captions STT and the render - is the priced and reserved unit, in ONE serializable transaction before a single request exists**, and its cents are floored ONCE on the job total rather than per line item. Fail closed on an unknown model, exactly as `chooseModel` already does. An agent or injected content cannot fire generation, voiceover or a render without human approval (plan-gated by construction: the media specialist's grant is `searchVault` only). **ADR-012** records why that is STRUCTURAL rather than procedural, names the two human-initiated paid entry points, and names the tests that assert the absence of any path between them.
  4. Generated assets are stored under the tenant as refs; audit logs asset id/hash + a moderation-verdict ref only (never the asset or its URL); an isolation assertion ships for media jobs/assets. A response carrying no moderation field is recorded as `none_reported` - never as clear, passed or safe.
  5. The price table names its own ceiling. It is hand-maintained against fal's own catalog API, so it CAN drift from real billing; the phase ships a documented two-bullet reconciliation step (compare recorded spend against the provider's invoice/balance, AND diff the catalog API against a committed vendor-provenance fixture) plus a `ponytail:` comment naming the upgrade path. Silent drift in a budget rail is the failure mode this criterion exists to prevent.
  6. **NEW (re-scope):** the reel is assembled by **ffmpeg in an ephemeral Vercel Sandbox**, driven from a **Next.js route handler at `apps/web/app/api/media/render/route.ts` where OIDC is automatic and NO Vercel access token exists anywhere in the system** (a Vercel PAT is scoped to a team, not a capability - ADR-013). Convex calls that route with a shared bearer secret, reusing the shipped `/skillopt/export` fail-closed pattern in reverse. Every sandbox is created `persistent: false` with `networkPolicy: "deny-all"` and no `name`; nothing it returns is published without passing a magic-byte/size check AND a strict `assembly.json` sidecar validator - **presence of a valid sidecar IS the proof-of-governed-render**, and a render without one publishes nothing.
  7. **NEW (re-scope):** retention is **delete-on-success**. A job produces ~55 MB against a Convex Free/Starter allowance of 1 GB total, so on a successful render with a valid sidecar the intermediate clips and voice takes are deleted and their fields nulled; on FAILURE they are kept as the only debugging evidence. (**ADR-012** Decision 8; narrowed by 20-17 so the clean voice takes survive until the FINAL artifact exists, because they are the transcript's source.)
**Plans**: **19 plans across 14 waves** (revised 2026-08-01 from 12 plans / 9 waves; 20-18 and 20-19 added 2026-08-02 after plan 20-04 found the D5 reconciliation procedure had no owner for either half). The old SC #1 (an MCP auth/token-exchange spike) is DISCHARGED: it ran, and it refuted its own premise. Waves 1-13 are runnable now and are entirely free of Lane-R contention; **20-12 alone is PARKED** behind Phase 16 closing the shared `cockpit-agent` candidate stream (the 18-08 precedent) - the phase is demonstrable without it, only the conversational entry point waits. Note that 20-12 and 18-08 edit the same body and therefore serialize with each other. **20-17 (captions) was the designated CUT LINE**: cutting it would still have shipped one finished mp4 with voiceover at zero rework. **It was NOT cut — it shipped 2026-08-03**, and it cost no Python, no Whisper weights and nothing added to the sandbox image. Waves are longer than the dependency graph alone requires because exactly ONE plan per wave may bump `docs/playbooks/media.md`.
Plans:
- [x] 20-01-PLAN.md - The pure media core: the fixed-BLOCK parser with its 140-character narration ceiling, the four-billing-unit price table with the D10 caps and the ONCE-only cents floor, the vendor-provenance fixture, the new `media.md` playbook and every `watch.json` registration this phase needs (Wave 1)
- [x] 20-02-PLAN.md - Schema + trace freeze: `mediaJobs` (four kinds, USD estimates), the block deck with narration, the RENDER PLANE on the plan row, `guardrailConfig.mediaKillSwitch`, and the `dispatchMedia` step literal shipped WITH its `cards.tsx` VERB entry (Wave 2)
- [x] 20-13-PLAN.md - NEW: the assemble CONTRACT, offline - `assemble_final.sh` harvested as a governed repo file with its byte-identical TS mirror (never a registry row: that would be RCE), plus the pure `assembly.json` sidecar validator and its refusal (Wave 2)
- [x] 20-03-PLAN.md - The `media-director` skill: koda /script + /art-direction + /storyboard + /generate ported into ONE registry row, DELIBERATELY UNGATED, emitting N fixed-length blocks with a narration line each, with a body-to-parser round-trip test (Wave 3)
- [x] 20-04-PLAN.md - The media budget rail: a second per-tenant window at 1000 cents plus a keyless 10,000-cent deployment ceiling, its own kill switch, and `reserveJob` - the WHOLE reel (clips + voice + STT + render) in one transactional mutation, mutation-checked twice (Wave 3)
- [x] 20-05-PLAN.md - The fal submit adapter: the request body is a function of the priced spec, with an EXHAUSTIVE switch over kind so a new priced kind is a compile error, idempotent per line, with the $0 offline seam (Wave 4)
- [x] 20-06-PLAN.md - The authenticated webhook and the landing plane: HMAC path segment, bytes downloaded into `_storage`, the honest four-value verdict, kind-aware reconciliation (`EXACT_SPEND_KINDS`), refs-only audit scans (Wave 5)
- [x] 20-07-PLAN.md - `media` joins `ACTION_TYPES`; the `externalAction` arm becomes a table and its media pre-step reserves the whole reel, with a calendar-behaviour-unchanged regression (Wave 6)
- [x] 20-18-PLAN.md - NEW (authored 2026-08-02): the D5 reconciliation READER - `spendForPeriod` + `listJobs`, so `mediaJobs.actualCents` stops being a write-only field and the playbook's reconciliation command finally exists; unlanded rows are counted, never silently dropped (Wave 6)
- [x] 20-08-PLAN.md - The dispatch surface: `media` in `SPECIALIST_ROUTES` with `SPECIALIST_TOOLS` reused verbatim, a four-way no-path scan, the `dispatchMedia` tool, `runMedia` and `persistStoryboard` (Wave 7)
- [x] 20-14-PLAN.md - NEW: the voiceover stage - one TTS take per block through the SAME adapter, secret, webhook and landing code; two switch arms and one narration read, with no rate knob anywhere (Wave 7)
- [x] 20-15-PLAN.md - NEW: the token-free renderer - the bearer-guarded `apps/web` route handler, the OIDC-authed sandbox with `persistent:false` + `deny-all`, the pure options builder and return validators, the snapshot bake script, and the offline render seam (Wave 8, has a blocking checkpoint on the Vercel tier and max duration)
- [x] 20-09-PLAN.md - The canvas backend plane: the ITEMISED estimate-before-spend query, the reel read, the two paid entry points through the ONE money gate, five free editor mutations, render invalidation, and the isolation assertion (Wave 9)
- [x] 20-16-PLAN.md - NEW: the assemble stage - the last landing in a batch starts the render with no poller, publish is gated on a valid sidecar, and D12(b) delete-on-success retention lands here (Wave 10)
- [x] 20-10-PLAN.md - The canvas is SEEN: `MediaCanvas.tsx` in the workspace right pane as one more `plan.kind`, with a reel region, two status rows per block, BRAND Output-card tiles and live status with no polling (Wave 11)
- [x] 20-17-PLAN.md - NEW, **CUTTABLE, AND IT WAS NOT CUT — SHIPPED 2026-08-03**: burned captions - fal STT instead of Whisper-in-the-VM (zero Python, zero model weights), a pure-TS `.ass` writer and speech-anchor rebase, and one more ffmpeg pass (Wave 12)
- [ ] 20-11-PLAN.md - ADR-012 (the route + the reel + the corrected, now vendor-direct arithmetic) and ADR-013 (the render worker), the REQUIREMENTS/ROADMAP/todo corrections, four playbooks, and the NON-NEGOTIABLE owner live gate at ~$0.75 that renders a REAL reel — Run A the Wan spine (~$0.29), Run B the LongCat 720p A/B (~$0.12) and Run C the 30 s block that empirically backs out fal's billed-seconds fps divisor (~$0.33) (Wave 13, has a blocking checkpoint)
- [ ] 20-12-PLAN.md - Teach `cockpit-agent` the media route + regenerate its one-line mirror, PARKED behind Phase 16 closing the shared candidate stream (Wave 14, has a blocking checkpoint)
- [x] 20-19-PLAN.md - NEW (authored 2026-08-02): vendor price + endpoint-health drift detection - a scheduled unauthenticated catalog check with THREE outcomes (agree / drift / unreachable), proven red before it is trusted; closes D5(b) and the `-preview` retirement blind spot (Wave 14)
### Phase 20.1: Drive in the Cockpit (INSERTED)

**Goal:** the Executive Agent can SEE the user's Google Drive — list folders, drill down, and answer
"which folder has the Q3 numbers" — and provably cannot import from it or spend a cent doing so.

**Requirement:** VALT-15.

**Why 20.1 and not 18.1.** The tools are cheap; the constraint is the SKILL BODY. `cockpit-agent` is
in `GATED_SKILLS` with ONE candidate stream, so teaching it a new tool mints a candidate at
`maxVersion+1` that an eval must flip active. **Phase 18-08 and Phase 20-12 already edit that same
body.** A concurrent edit would mint a candidate carrying two lanes' prose and the next eval would
certify instructions nobody tested. This phase therefore runs AFTER both.

**Scope — the READ half only.**
- `vaultDrive.findInDrive` — the one genuinely new capability. The picker walks a tree; "where is
  the Q3 folder" is a search, and `files.list` already answers it.
- Two READ-ONLY cockpit tools (`listDriveFolders`, `findInDrive`), thin wrappers over the
  tenantActions the vault picker already calls. No second Drive client.
- A static guard proving `llm.ts` has NO reference to `importDriveFolder`, `reserveFolder`,
  `openRun`, `exportOne` or `landFile` — not as a tool key, not inside an `execute`, not via the
  scheduler.

**Explicitly OUT, and why.**
- **Agent-initiated import.** The import spends a governed budget and writes vault rows. If it is
  ever wanted the shape is Calendar's — a `drive_import` plan kind the model STAGES and a human
  approves through `executePlan` — which is a phase of its own, not a tool bolted on here. The
  vault's Drive picker already gives the user a one-click import today.
- **Creating a folder in Drive.** Not possible: `drive.readonly` is read-only by definition, and
  writing needs `drive.file` or full `drive` — a RESTRICTED scope requiring a CASA assessment, the
  same verification wall as the social integrations, itself blocked on the legal entity existing.

**No new scope, no new consent, no new secret, no new HTTP route.** The whole phase runs inside the
`drive.readonly` grant that shipped in 15.3-09 and has been live-verified against a real account.

**Plans:**
- [ ] 20.1-01-PLAN.md - Wave 1: findInDrive + two read-only cockpit tools + the no-paid-path guard + the SMOKE ops + the GATED cockpit-body edit (VALT-15)

### Phase 21: User-Authored Skills & Routines
**Goal**: The user can author skills adapted to their business through the existing eval-gated skills registry - draft -> publish-as-candidate -> eval -> activate - tenant-scoped, reusing the shipped `insertCandidate`/`activateCandidate` seam verbatim. A ROUTINE is that same thing plus a trigger row: it reuses `insertCandidate` (`skills.ts:386`), `activateSkillVersion` (`skills.ts:110`) and `GATED_SKILLS` (`skill.ts:170-194`) and introduces no authoring language. **Pre-beta deliverable: a re-runnable pinned prompt** — a saved chat message re-fired at `api.cockpit.sendCockpitMessage`. NOT a `routines` table, NOT a cron, NOT an authoring canvas, NOT a graph DSL; those are post-beta and evidence-gated on someone actually re-firing a pinned prompt twice.
**Depends on**: Phases 16-19 (real specialist capability worth authoring skills for), Phase 3.6 (eval gate). User-authored first, agent-authored (Phase 23) last.
**Requirements**: SKILL-01
**Success Criteria** (what must be TRUE):
  1. A user composes a skill body through an authoring surface that can only ever write a `candidate` (never `active`) via the existing `insertCandidate` seam.
  2. A user-authored candidate leaves `candidate` only through a passing held-out eval run recorded on the skill row (evidence refs/counts only); rollback to a prior active version stays structurally exempt and always works.
  3. Authored skills are tenant-scoped and immutable-versioned with recorded provenance (author = user).
**Plans**: TBD

### Phase 22: Owner Authorization Primitive (requireOwner)
**Goal**: A real `requireOwner(ctx)` primitive gates the three known Phase-8 functions and every admin-ish control at birth - pulled EARLY because it must exist before agent-authored skills can activate (Phase 23) and before a second user ever exists (Phase 25). Closes the standing Phase-8 owner-auth blocker.
**Depends on**: Phase 8 (the three un-gated functions exist). Deliberately pulled early - no dependency on later phases.
**Requirements**: GOVN-01
**Success Criteria** (what must be TRUE):
  1. `requireOwner(ctx)` derives owner identity from a durable data source (a `users.owner` boolean seeded via `convex run`, NOT the `SKILLOPT_OWNER_TENANT` env hack) and lives as a sibling primitive to the tenant wrappers.
  2. `optimizerConfig.setOptimizerEnabled`, `skills.activateCandidate`, and `skills.candidatesForReview` each reject a non-owner caller server-side - a non-owner cannot flip the optimizer, activate a skill, or read candidate bodies.
  3. Any new admin-ish control added from here on carries `requireOwner` from birth; the server-side guard is the trust boundary (hiding the UI is only presentation).
**Plans**: 3/3 complete. Live UAT 2026-08-01: owner bootstrap PASSED; the server-side trust boundary PASSED in both directions; the /ops DOM half is NOT obtained (environmental — see 22-UAT-EVIDENCE.md)
- [x] 22-01-PLAN.md — identity + owner substrate: `getAuthUserId`, `users.owner`, `requireOwner`/`ownerQuery`/`ownerMutation`, `owner.viewer`, audited idempotent `bootstrapOwner`, new `authorization.md` (Tasks 1-2 done; **Task 3 = BLOCKING live owner bootstrap, NOT run**)
- [x] 22-02-PLAN.md — the four global Phase-8 controls moved onto owner wrappers; closes the standing Phase-8 owner-auth blocker in `skill-registry.md`. Full backend 860/860
- [x] 22-03-PLAN.md — `/ops` mounts its whole Optimizer section only for a confirmed owner; web typecheck + build green (Tasks 1-2 done; **Task 3 = BLOCKING two-identity live UAT, NOT run**)

> **GOVN-01 stays Pending until both checkpoints pass.** The load-bearing one is calling all four
> public APIs directly as a controlled non-owner and observing `OWNER_REQUIRED` with no state
> change — the DOM check proves presentation, not the trust boundary. Checklist:
> `docs/playbooks/authorization.md` § "Live owner/non-owner checklist".
> Phase 22's total backend typecheck delta is ZERO (back to the exact 150 baseline).

### Phase 22.1: Beta Admission Readiness - legal deployment CI typechecking and identity-boundary hardening (INSERTED)

**Goal:** Close the beta-admission blockers that are not features — the things a SECOND user's existence makes unsafe or untrue. The published privacy policy becomes true (a working Gmail disconnect that actually revokes the Google token), the daily spend cap stops being deployment-wide (per-tenant keying), and the deployment / typecheck / CI path this phase's title names runs green as a gate.
**Requirements**: GOVN-03 (minted 2026-08-01 — the milestone's 1:1 requirement-to-phase map now holds). GOVN-03 covers SC1: the published privacy policy is the specification, and every user-exercisable data/connection control it promises must exist and behave as described. SC2 (per-tenant budget keying) and SC3 (the CI/typecheck gate) remain defect closure against the shipped GRDL-03 guard and carry no separate id — they are the reason this phase was inserted, not new capability.
**Depends on:** Phase 22
**Success Criteria** (what must be TRUE):
  1. A connected user can DISCONNECT Gmail from inside the app: the control lands on the existing `apps/web/app/(app)/connect-gmail/page.tsx`, the `gmailTokens` row is deleted, AND the token is revoked at Google (`https://oauth2.googleapis.com/revoke`), with a refs-only audit row. This makes `apps/web/app/privacy/page.tsx:312` — "You can disconnect your Google account at any time from within the application" — true; today it is a published legal claim with zero implementation (no revoke call and no token-delete mutation exist in the repo). No new route, no new NAV entry, no connections page; the hardcoded hexes on that page become `globals.css` tokens in the same pass (CLAUDE.md §10).
  2. `dailySpendCents` is keyed PER TENANT. It is currently a KEYLESS rate-limiter window capping the whole DEPLOYMENT (`guardrails.ts:182-185`), and `dispatch.ts:41-45`'s `ENVELOPE_FRACTION` takes its 25% from that same shared pool — so the moment a second user exists, one tenant's loop drains everyone else's day and every other tenant sees governed refusals it cannot explain. A test proves one tenant exhausting its budget does not refuse another tenant's request.
  3. Typecheck, lint and the deployment/CI path named in this phase's title run green as an enforced gate, not as a remembered manual step.
**Plans:** 2 of 3 complete

Plans:
- [x] 22.1-01-PLAN.md — Disconnect Google: revoke at Google, then delete locally (SC1) — completed 2026-08-01 (`gmailAuth.disconnectGoogle` POSTs the REFRESH token to `oauth2.googleapis.com/revoke`, so the whole grant dies; 200 and 400 both mean gone and the local delete runs unconditionally; one refs-only `google.disconnected` audit row. Deliberately NOT in `gmail.ts` — `llmRedaction.test.ts` pins that module's POST set to two. Backend 863/863, typecheck at the exact 150 baseline with ZERO TS2589, refresh-token assertion mutation-verified. **OWNER LIVE-VERIFIED 2026-08-01: the grant is gone from `myaccount.google.com/permissions`.** `apps/web/app/privacy/page.tsx:312` is now a true statement)
- [x] 22.1-02-PLAN.md — Per-tenant keying of `dailySpendCents` (SC2) — completed 2026-08-01 (TWO rails now: `dailySpendCents` keyed by tenantId, plus a deliberately KEYLESS `deploymentSpendCents` ceiling, because keying alone would trade a noisy-neighbour bug for unbounded N × budget exposure — owner decision. Both checked, both consumed, tenant checked FIRST so a tenant is never blamed for a global pause; `remainingDailyCents` returns min(tenant, deployment) with each rail clamped >= 0 before the min. 53 threading replacements across 12 modules incl. six private helpers; `recordModelSpend` threaded ONCE as the shared sink. Making `tenantId` a REQUIRED arg is what found the 10 sites where it only looked in scope. Backend 865/866 — the one red is pre-existing `onboarding.test.ts §4.2`, proven by stashing this plan and watching it fail identically — typecheck at the exact 150 baseline. Two-tenant test mutation-verified RED without the key. **LIVE VERIFIED 2026-08-01: `pnpm smoke:guardrails` 7/7 PASSED against the real deployment**, incl. 5/6 "C (other tenant) unaffected" — the SC proven end-to-end. That run also exposed and fixed a 19-day-old landmine: case 2/6 asserted an ABSOLUTE `llm.called` count against the insert-only `audit` table keyed on a constant goal hash, so it accumulated across runs and had been unrunnable since 2026-07-12; the goal now carries a per-run uid)
- [ ] 22.1-03-PLAN.md — The deployment / typecheck / CI gate (SC3)

### Phase 23: Agent-Authored Skills
**Goal**: The agent can author skills as candidates only - structurally unable to self-activate - with activation requiring BOTH a passing eval and owner approval; the governance-heaviest self-modification capability, placed last among the capability phases.
**Depends on**: Phase 21 (user-authored authoring seam), Phase 22 (`requireOwner`), Phase 3.6 (eval gate incl. adversarial held-out fixtures)
**Requirements**: SKILL-02
**Success Criteria** (what must be TRUE):
  1. An agent-reachable authoring tool can only ever produce a `status:"candidate"` skill - it is physically incapable of calling `activateCandidate` (capability minimization, not instruction-policing).
  2. An agent-authored candidate reaches `active` only through a passing held-out eval (including adversarial cases the authoring agent never sees) PLUS `requireOwner` approval.
  3. Every agent-authored skill row records author = agent and is immutable-versioned with one-write rollback; an `active` skill whose author is `agent` without recorded owner + eval evidence is impossible by construction.
**Plans**: TBD

### Phase 24: ISO 9001 Conformance Map
**Goal**: An ISO 9001:2015 conformance foundation that maps the existing audit / skill-versioning / GSD-playbook change-control to the relevant clauses and fills only genuine gaps - a conformance map that makes the compliance/trust moat real, not process theater.
**Depends on**: the shipped audit/playbook/ADR/eval spine (all prior phases provide the artifacts to map)
**Requirements**: GOVN-02
**Success Criteria** (what must be TRUE):
  1. A thin conformance map pairs each relevant ISO clause with the existing artifact that satisfies it (audit spine -> 7.5/8.5.1; skill registry versioning/rollback -> 8.5.6; playbooks/ADRs -> 7.5/8.3; eval gate -> 8.6; DLQ/notifications -> 10.2).
  2. New documents exist ONLY where the map exposes a genuine gap; records point at the real audit log / immutable ADRs and match actual practice (no drift docs, no parallel binder).
**Plans**: TBD

### Phase 25: Private Beta Productionization
**Goal**: Open the invite-only private beta on the full platform - invited users beyond the owner sign up, stay fully isolated, onboard to a first delivered result in minutes, and deliver via Gmail OR Outlook - executed LAST, after all platform work lands. Absorbs former Phase 9 and consumes `09-CONTEXT.md` as its spec.
**Depends on**: all prior v2.0 phases (10-24); reuses the Phase 22 `requireOwner` primitive for the owner-admin surface
**Requirements**: BETA-01, BETA-02, BETA-03, BETA-05, DLVR-02
**Success Criteria** (what must be TRUE):
  1. A new user can sign up only with a valid single-use invite (public waitlist -> owner approves on the owner-only admin page); a Google/Microsoft sign-in without a redeemed invite is blocked at the door with NO orphaned tenant persisted.
  2. Invite redemption binds the OAuth SUBJECT (not the typed email), verifies the invited email matches, records the subject immutably, and rejects cross-subject re-redemption - tested against both Google and Microsoft subject formats.
  3. A two-user cross-tenant isolation test (BETA-05) covers every table and index added across S1-S3 and asserts a non-owner cannot reach the three owner-gated functions; grounded-prose export stays owner-gated until the `packages/pii` names-in-prose scrub ceiling is closed.
  4. A new user reaches a first real delivered result (a governed email to their own address) within minutes via the scripted first-run cockpit onboarding.
  5. An approved plan can deliver via Microsoft Graph (Outlook) (connect-both, choose-per-send). **Phase 25 BUILDS the provider-agnostic adapter — it does not exist today**: `gmailTokens` (`schema.ts:625-632`) has no `provider` column and is indexed `by_tenant` only, `gmail.ts:45-46` hardcodes `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, and `gmail.ts:19` hardcodes the Google token endpoint. The widening — a `provider` column, a `by_tenant_provider` index, and a provider lookup — is written in the SAME commit as the Microsoft Graph adapter and NOT before; an abstraction with one implementation is what CLAUDE.md §8 forbids. Deployed to a live Vercel domain on Gmail Testing mode + unverified Azure app (verification off the critical path).
  6. The custom-domain decision is MADE here, because every user-shareable URL depends on it. Serving from `*.convex.site` shares a host with the OAuth callback (`http.ts:15`), so a reputation flag on that host breaks SIGN-IN, not just the page; and a Convex deployment URL is deployment-scoped, so a link a user sent a client does not survive a prod migration. Branch A (durable domain + DNS + TLS) is required to complete the mandatory BETA-03 and DLVR-02 live sends. Branch B records that no user-shareable URL ships and explicitly BLOCKS Phase 25 until Branch A becomes available.
**Plans**: 14 plans across 13 waves (execution is blocked on Plan 25-00's prerequisite gate; Plan 25-10 Branch B also blocks completion)

Plans:
- [ ] 25-00-PLAN.md — Blocking completion/stable-baseline gate for every pre-beta prerequisite lane; Phase 32 explicitly excluded (Wave 1)
- [ ] 25-01-PLAN.md — Atomic invite admission, owner issuance backend, and beta-admission playbook (Wave 2)
- [ ] 25-02-PLAN.md — Public signup/waitlist UX and consolidated owner-admin surface (Wave 3)
- [ ] 25-03-PLAN.md — Schema-derived two-user isolation matrix, owner API assertions, and prose-export gate (Wave 4)
- [ ] 25-04-PLAN.md — Existing-onboarding extension to an inline-recoverable first governed self-send (Wave 3)
- [ ] 25-05-PLAN.md — Red-to-green contracts plus same-commit provider widening, Graph send, migration, and two-arm adapter (Wave 5)
- [ ] 25-06-PLAN.md — Outlook OAuth lifecycle/UI and explicit Microsoft remote-invalidation posture (Wave 6)
- [ ] 25-07-PLAN.md — Hosted provider migration, automatic schema/fallback narrow deploy, and fresh Gmail proof (Wave 7)
- [ ] 25-08-PLAN.md — Threading-first live Outlook gate on the narrowed deployment (Wave 8)
- [ ] 25-09-PLAN.md — Full Outlook read-plane parity and live consent-capable provider matrix (Wave 9)
- [ ] 25-10-PLAN.md — Runtime environment manifest, domain decision, Branch-A enforcement; Branch B blocks phase (Wave 10)
- [ ] 25-11-PLAN.md — Durable-domain Vercel/Convex deployment, seed/readiness, and hosted OAuth admission (Wave 11)
- [ ] 25-12-PLAN.md — Exact-SHA automated/authenticated-E2E/boot/hosted-env production qualification (Wave 12)
- [ ] 25-13-PLAN.md — Fresh live Outlook/two-user/timed-first-result acceptance and evidence-only bookkeeping closure (Wave 13)

## Progress

**Execution Order:**
Base phases retain numeric dependency order, with Phase 25 remaining the final beta-opening phase. Phase 26 is an explicitly pulled-forward product-surface lane: it begins after completed Phase 15.4, may run alongside non-overlapping Phase 16–20 work, pauses at 26-18 until Phase 19's ACTN-05/PIPE-01 gate is approved, then finishes Command Center before Phase 25.

**Amended 2026-08-07 (owner).** Two more lanes now run before Phase 25, and Phase 25 slips by their
duration — taken knowingly:
- **Phase 19 is pulled forward** (contacts/leads/consent/suppression). It unblocks 26-18, Phase 28
  (twice) and Phase 31. Needs planning first — 0/TBD.
- **Phases 31-32 (Marketing) are pulled pre-beta** via ADR-015, overriding `PROJECT.md:51-53`'s
  admission rule. **Phase 31 (tranche A) is schedulable; Phase 32 (tranche B) is NOT** — it is gated
  on the legal entity, which is not started. See the EXTERNAL BLOCKER section above.

Numeric order is not execution order and has not been for some time (Phase 26 established the
precedent). Phases 31-32 are numbered after 30 and execute before 25.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Governance Substrate | 7/9 | In progress | - |
| 2. Thin End-to-End Slice | 7/9 (+2 superseded by 3.1) | Spine complete; UI superseded | 2026-07-12 |
| 3. Guardrails | 0/5 | Planned | - |
| 3.1 Cockpit Core (INSERTED) | 8/9 | In Progress (Waves 1â4 done; Wave 5 E2E + human checkpoint next) | 2026-07-12 |
| 3.2 Inbox Reading (INSERTED) | 6/6 | Complete | 2026-07-12 |
| 3.2.1 Agent-Driven Cockpit (INSERTED) | 6/6 | Complete (goal-verified + human-verified) | 2026-07-13 |
| 3.3 Attachment Generation (INSERTED) | 6/6 | Complete (CKPT-02 human-verified) | 2026-07-14 |
| 3.4 Per-Recipient Personalization (INSERTED) | 4/4 | Complete (CKPT-03 human-verified) | 2026-07-14 |
| 3.5 Deferred Send (INSERTED) | 6/6 | Complete (SCHD-01 + reschedule/far-future cap refinements) | 2026-07-19 |
| 3.6 Agent Eval Gate (INSERTED) | 5/5 | Complete   | 2026-07-15 |
| 3.7 Inbox Briefing (INSERTED) | 9/9 | Complete (Gap 1 + Gap 2 closed; inbox-digest v2 eval-gated & active; CKPT-04 human-verified 2026-07-17) |  |
| 3.11 Inbox Reply (INSERTED) | 6/6 | Complete (RPLY-01 — replyToMessage tool + delivery threading spine + cockpit-agent@12 eval-gated; owner live human-verify APPROVED 2026-07-19 — reply landed in-thread in real Gmail, Re: subject, original sender only) | 2026-07-19 |
| 4. Attachment & Voice-Dictation Intake | 6/6 | Complete (SC3 live human-verify APPROVED) | 2026-07-15 |
| 5. Knowledge Vault & GraphRAG | 7/7 | Complete (live in-browser verified + P0 embed fix) | 2026-07-14 |
| 6. Live Voice Sessions | 8/8 | Complete (VOIC-01..04 live human-verified) | 2026-07-21 |
| 7. Resilience & Operations Hardening | 6/6 | Complete (owner-approved; email + in-app matrix live-verified; real-S3 durability owner-deferred) | 2026-07-21 |
| 8. Self-Improvement | 8/8 | Complete    | 2026-07-23 |
| 9. Private Beta Productionization | - | **SUPERSEDED -> Phase 25** | - |
| **Milestone v2.0 - Platform -> Private Beta** | | | |
| 10. Vault->Agent Grounding | 4/4 | Complete    | 2026-07-24 |
| 11. Persona Onboarding & Business Profile | 4/4 | Complete    | 2026-07-24 |
| 12. Business Evaluation Engine | 6/6 | Complete    | 2026-07-25 |
| 13. Proactive In-App Review | 4/4 | Complete    | 2026-07-25 |
| 14. Flagship Voice-Doc Workflow | 8/9 | In Progress|  |
| 15. Sub-Agent Dispatch & Generalized Action Executor | 6/6 | Complete    | 2026-07-25 |
| 15.1 Fact-Derived Tier & Conversational Onboarding (INSERTED) | 7/7 | Complete (goal-verified 6/6) | 2026-07-26 |
| 15.2 Vault Universal Format Recognition & Extraction Fan-Out (INSERTED) | 8/8 | Complete and pushed to `main` | 2026-07-30 |
| 15.3 Vault Folders - Folder Ingest, Synthesis & Drill-In (INSERTED) | 9/9 | Implementation complete + OWNER-APPROVED 2026-08-05. Drive rail shipped, plus a picker we render OURSELVES (the paste-a-link entry point is deleted; Google's Picker SDK is deliberately not mounted because drive.readonly already returns the folders). **LIVE GATE IS PARTIAL** — the scope widening, the reauth gate against a real pre-widening token, real folder listing/drill-in and the empty_folder guard are all live-verified; **the IMPORT PATH and the SHARED-DRIVE half have never run** ($0 spent on this rail). VALT-13 stays Pending | - |
| 15.4 Vault Redesign & Scoped Browse Correctness (INSERTED) | 4/4 | Complete (full gates + connected Playwright 2/2 + owner-approved UAT) | 2026-08-05 |
| 16. Research Sub-Agent & Web Research | 9/9 | Complete (gate `14feb4b7` 34/34, $0.3456; five skills activated) | 2026-08-08 |
| 17. Calendar Actions | 4/4 | Complete offline; goal verification is `human_needed` for owner UAT M1-M5 | 2026-07-30 |
| 17.1 Business Blueprint - Corpus Synthesis & Agent Spine (INSERTED) | 9/10 | In Progress (17.1-01..09 complete; profile confirmation surface landed; next 17.1-10 live gate) | 2026-07-30 |
| 18. Document & Content Creation | 8/10 | In Progress (waves 1-6 complete through 18-08, whose `cockpit-agent` teaching is CERTIFIED LIVE at v17 by gate `14feb4b7` 34/34 on 2026-08-08; 18-09 and 18-10 remain) | 2026-08-08 |
| 19. Contacts, CRM & Follow-ups | 5/10 | In Progress (19-01 complete — pure contacts core, the THREE tables, `tenantProfiles.postalAddress`, and `contacts-crm.md` registered in `watch.json`. 19-03 complete — the CAN-SPAM postal address end to end: refused blank-after-trim at the `saveFacts` write boundary, a `Postal address` textarea on `/dashboard/profile`, and provably NOT an onboarding slot. 19-02 complete — `convex/contacts.ts`, the person store: six tenant-scoped writes, five send-path/unsubscribe internals, the `UNSUBSCRIBE_SECRET`-signed opaque token fail-closed in ONE place, and a 40-test BETA-05 isolation block carrying the exact `{contactId, addressHash}` audit key set and the no-opportunities structural scan. 19-04 complete — the phase's ONLY public unauthenticated route: `GET/POST /unsubscribe/<raw>.<hmac>` on `convex/http.ts`, the GET inert by contract and mutation-proven by row count, the POST the only mutating verb and idempotent on replay, one bare 404 for every rejection, no second env guard and no rate limiter (both argued in source). 19-05 complete — THE TRUST BOUNDARY: the send path converges TWICE and both points are now guarded. `executePlan` drops suppressed addresses PER ADDRESS before the group join and before the CAS patch (a refusal after it leaves a half-approved plan nothing can resume), refuses `no_postal_address` and `all_recipients_suppressed`, and returns `withheld[]` on a partial send; `gmail.send` refuses a suppressed recipient before a credential is even minted and appends the CAN-SPAM footer at the `buildMime` CALL SITE (never inside it — `notifyExternal`'s service notice and the V4 byte-identity tests are the two reasons); a post-approve suppression terminates as `blocked` via `recordDeliveryTerminal`'s third outcome, decrementing `recipientTotal` so the counters balance. **`gmail.send` has TWO production callers, not the one the plan asserted — `pipeline.ts` is the other and is guarded too.** **`UNSUBSCRIBE_SECRET` is now set on the LOCAL deployment; a hosted deployment still needs its own or every link 404s and every send is refused.**). PIPE-01 contradiction resolved 2026-08-09 in favour of the requirement: no opportunities, no stage, no money. Unblocks 26-18, Phase 28 (×2) and Phase 31 | 2026-08-09 |
| 20. Media Canvas | 12/19 | In Progress (Waves 1-7 complete: 20-01 pure media core + price table, 20-02 schema/trace freeze, 20-13 the assemble contract, 20-03 the `media-director` skill row, 20-04 the media budget rail + the transactional job reservation, 20-18 the D5 reconciliation readers, 20-19 the scheduled vendor-drift detector, 20-05 the fal submit adapter, 20-06 the HMAC webhook + landing plane, 20-07 the `externalAction` arm, 20-08 the dispatch surface, 20-14 the voiceover stage; next is Wave 8 — 20-15 the token-free renderer, which carries a BLOCKING owner checkpoint on the Vercel tier and max sandbox duration) | 2026-08-02 |
| 21. User-Authored Skills & Routines | 0/TBD | Not started | - |
| 22. Owner Authorization Primitive | 3/3 | UAT: server boundary PROVEN live; DOM half outstanding | - |
| 22.1 Beta Admission Readiness (INSERTED) | 2/3 | In Progress (22.1-01 disconnect owner live-verified; 22.1-02 per-tenant budget keying complete + smoke 7/7 live-verified 2026-08-01; CI/typecheck gate open) | - |
| 23. Agent-Authored Skills | 0/TBD | Not started | - |
| 24. ISO 9001 Conformance Map | 0/TBD | Not started | - |
| 25. Private Beta Productionization | 0/14 | Planned — execution blocked on 25-00 prerequisite evidence; two lanes (19, 31) run ahead of it | - |
| 26. Connected Product Pages | 8/20 | In Progress|  |
| **Milestone: Marketing (pulled pre-beta 2026-08-07, ADR-015)** | | | |
| 31. Marketing Surface & Funnel v0 (tranche A) | 0/TBD | Not started — schedulable; depends on Phase 19 | - |
| 32. Channel Connection, Publishing & Metrics (tranche B) | 0/TBD | **BLOCKED — legal entity not started.** Do not plan | - |
