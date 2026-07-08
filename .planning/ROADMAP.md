# Roadmap: Pikar-AI

## Overview

Pikar-AI reaches a private beta in ~4 weeks (target ~2026-08-05) by building the governed request pipeline outward from an immutable foundation. We first lay the Convex data/orchestration substrate that bakes in tenant isolation, insert-only audit, durable workflows, and the dead-letter/timeout patterns every later feature reuses — then prove the core value with one thin end-to-end slice (type a goal → plan → review → email → audit). Guardrails (PII, cost, cache, kill-switch) slot into the existing pipeline steps, followed by richer intake (attachments + voice dictation), the knowledge vault with GraphRAG memory, and the identity-defining live voice sessions. We then harden every failure path, add the self-improvement loop, and finish with private-beta productionization: invite-only signup, verified per-user isolation, fast onboarding, and the second email provider. Voice is deliberately staged (dictation before live) and email providers are strictly sequenced (Gmail before Microsoft Graph) to keep the highest-risk, least-controllable work off the critical path.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Governance Substrate** - Convex/Next.js monorepo, tenant scoping, insert-only audit, DLQ + timeout patterns, graphify, OAuth paperwork started
- [ ] **Phase 2: Thin End-to-End Slice** - Text request → plan → human review → Gmail delivery → live status + full audit trail
- [ ] **Phase 3: Guardrails** - PII redaction, cost estimate/downgrade, tenant-namespaced cache, fallback, rate-limit + cost kill-switch
- [ ] **Phase 4: Attachment & Voice-Dictation Intake** - Attachments classified/OCR'd/transcribed and voice dictation, both into the pipeline
- [ ] **Phase 5: Knowledge Vault & GraphRAG** - Briefs/docs stored, embedded, graph-extracted, and grounded via hybrid retrieval per user
- [ ] **Phase 6: Live Voice Sessions** - 15-min bidirectional voice with server watchdog → durable brief → optional executable plan
- [ ] **Phase 7: Resilience & Operations Hardening** - Timeouts, retry escalation, notifications, dead-letter completeness, WORM archival export
- [ ] **Phase 8: Self-Improvement** - Feedback capture → eval-gated autonomous prompt optimization with versioning + rollback + kill switch
- [ ] **Phase 9: Private Beta Productionization** - Invite-only signup, verified per-user isolation, guided onboarding, Microsoft Graph as second provider

## Phase Details

### Phase 1: Foundation & Governance Substrate
**Goal**: The governed data + orchestration substrate exists so every later feature inherits tenant isolation, immutable audit, durable workflows, and failure handling for free — the decisions that are cheap now and expensive to retrofit.
**Depends on**: Nothing (first phase)
**Requirements**: OPSG-02, OPSG-04
**Success Criteria** (what must be TRUE):
  1. The full stack (Next.js + Convex + Python sidecars) boots from a clean clone by following the README, with the Workflow/Agent/RAG/RateLimiter/ActionRetrier components wired and all domain logic living in pure-TS `packages/*` imported by a thin `convex/` adapter.
  2. Every write flows through the `customQuery`/`customMutation` tenant wrapper — a query that omits `tenantId` scope cannot be written.
  3. Any state change appends to the insert-only audit module (no update/delete functions exist), and a deliberately failed smoke-test workflow lands in the dead-letter table via `onComplete`.
  4. The `awaitEvent`-timeout race pattern and the WORM (S3 Object Lock) export cron stub are demonstrated on a smoke-test workflow.
  5. Google OAuth verification paperwork (privacy policy, verified domain, homepage) is submitted in Week 1, and graphify (git hook + MCP) is active on the repository.
**Plans**: TBD

### Phase 2: Thin End-to-End Slice
**Goal**: A user submits a typed goal and follows it all the way to a delivered email, approving it at a durable review gate, with the entire trail audited and visible live — the MVP spine that proves the core value proposition.
**Depends on**: Phase 1
**Requirements**: INTK-01, INTK-04, AGNT-01, AGNT-02, AGNT-03, REVW-01, DLVR-01, DLVR-03, OPSG-01, BETA-04
**Success Criteria** (what must be TRUE):
  1. User submits a text request (with optional attachment upload) and watches its pipeline status and review queue update in real time via reactive `useQuery` subscriptions — no refresh.
  2. User sees the Executive Agent's routing decision and step plan before anything runs, and can approve, edit, or reject the generated response.
  3. An approved response is delivered to a real inbox via Gmail (Testing mode); an invalid/unauthenticated request is rejected with a notification and an auditable "Request Rejected — Validation Failed" outcome.
  4. An unknown/invalid routing value is sent to the dead-letter store instead of silently defaulting.
  5. Every request produces telemetry (tokens, cost, duration, decision counts, review outcome) and a full audit trail, and a Gmail token nearing its 7-day expiry prompts the user to re-auth before it breaks.
**Plans**: TBD

### Phase 3: Guardrails
**Goal**: Every request passes cost, PII, and quality guardrails before any external model call, and runaway spend is structurally impossible — governance as a shipped product feature, slotted into the existing pipeline steps.
**Depends on**: Phase 2
**Requirements**: GRDL-01, GRDL-02, GRDL-03, GRDL-04, GRDL-05, GRDL-06
**Success Criteria** (what must be TRUE):
  1. Every request is PII-scanned and redacted to `safeText` before any external model call, and an unknown/null scan result fails closed (request stops rather than proceeding).
  2. No raw PII appears in any log, telemetry record, or cache key — redaction always precedes logging (redact-then-log ordering enforced as a step contract).
  3. Over-budget requests (estimated from `safeText`) automatically downgrade to a cheaper model, and a per-user rate limit plus a cost kill-switch hard-stop runaway spend; unknown/null cost results fail closed.
  4. Two different users submitting identical redacted input receive isolated, tenant-namespaced cache entries, and a cache hit returns without a model call.
  5. A primary model failure or timeout transparently triggers fallback generation.
**Plans**: TBD

### Phase 4: Attachment & Voice-Dictation Intake
**Goal**: Users can enrich requests with files and speak requests aloud, both flowing through the same governed pipeline — grouped because dictation reuses the attachment audio-transcription path and Python sidecar.
**Depends on**: Phase 2 (pipeline); guardrails from Phase 3 apply to enriched context
**Requirements**: INTK-02, INTK-03
**Success Criteria** (what must be TRUE):
  1. User attaches an image, PDF, audio, or document and the system classifies it and OCRs/extracts/transcribes it, merging the result into the request context.
  2. User dictates a request by voice; it is recorded, transcribed, and enters the same pipeline as a typed request.
  3. A delivered result reflects content that originated from an attachment or a dictated recording, having passed the same PII/cost/review guardrails.
**Plans**: TBD

### Phase 5: Knowledge Vault & GraphRAG
**Goal**: The system remembers — briefs and documents become groundable, searchable memory scoped to each user via hybrid vector + graph retrieval.
**Depends on**: Phase 4 (extraction feeds ingestion); Phase 2 (pipeline grounding step)
**Requirements**: VALT-01, VALT-02, VALT-03, VALT-04
**Success Criteria** (what must be TRUE):
  1. Briefs and documents are stored and embedded (`text-embedding-3-small` @1536, under Convex's 2048-dim cap) and appear in the user's vault.
  2. Graphify extracts entities/relationships from vault content at ingestion; the resulting nodes/edges are stored and queryable in Convex `graphNodes`/`graphEdges` tables.
  3. A request is grounded using hybrid retrieval — vector similarity plus hop-capped graph traversal — scoped to only the requesting user's data.
  4. User can browse and search their own vault contents.
**Plans**: TBD

### Phase 6: Live Voice Sessions
**Goal**: Users can hold a live strategy conversation with the Executive Agent that safely becomes a durable brief and, optionally, an executable plan — the product's identity feature, isolated from the durable pipeline and cost-metered.
**Depends on**: Phase 5 (briefs land in the vault); Phase 4 (transcription)
**Requirements**: VOIC-01, VOIC-02, VOIC-03, VOIC-04
**Success Criteria** (what must be TRUE):
  1. User holds a live bidirectional voice conversation with the Executive Agent (WebRTC, browser-direct) and can end it with an End-session button.
  2. A server-side watchdog hard-caps every session at 15 minutes and terminates cleanly even if the tab closes or the network drops, with per-session token metering to prevent cost blowout.
  3. An ended session (clean or abnormal) produces a detailed structured markdown brief that is stored and indexed in the knowledge vault.
  4. At session end the agent asks permission to convert the brief into a step-by-step plan; an approved plan enters the normal request pipeline with the review gate.
**Plans**: TBD

### Phase 7: Resilience & Operations Hardening
**Goal**: Every failure path — agent/review timeouts, retry-threshold breaches, dead-letters — is caught, notified, escalated, and archived immutably.
**Depends on**: Phase 6 (hardens error paths across all prior feature phases)
**Requirements**: AGNT-04, REVW-02, REVW-03, OPSG-03, OPSG-05
**Success Criteria** (what must be TRUE):
  1. Edit and reject retry counters enforce thresholds; a breach escalates, notifies, and terminates the request safely.
  2. A review-inactivity timeout and an Executive Agent timeout each fire an escalation notification (via the scheduled-event race on the review gate).
  3. Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events.
  4. Completed request trails export on schedule to immutable (WORM) archival storage, and the hot audit copy is swept per the retention policy.
**Plans**: TBD

### Phase 8: Self-Improvement
**Goal**: The system learns from real feedback and improves its own prompts under automated evaluation guardrails with instant rollback — sequenced last because the loop is meaningless until review/feedback data has accumulated.
**Depends on**: Phase 7 (needs delivered-response feedback and a stable pipeline)
**Requirements**: IMPR-01, IMPR-02, IMPR-03
**Success Criteria** (what must be TRUE):
  1. User can rate and comment on delivered responses, and the feedback is captured against the originating request.
  2. A feedback threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks (held-out set the optimizer never sees), with a one-click rollback and a kill switch.
  3. Prompts are versioned; every optimization records the before/after versions and the triggering evidence.
**Plans**: TBD

### Phase 9: Private Beta Productionization
**Goal**: Invited users beyond the owner can sign up, stay fully isolated from each other, onboard fast to a first delivered result, and deliver via either email provider — the week-4 definition of "production" (not billing/public launch).
**Depends on**: Phase 8
**Requirements**: BETA-01, BETA-02, BETA-03, DLVR-02
**Success Criteria** (what must be TRUE):
  1. A new user can sign up only with a valid invite code (Convex Auth + `betaInvites`).
  2. User A cannot read User B's requests, vault, cache, audit, or telemetry — isolation holds across every table and index, verified by an explicit cross-user test.
  3. A new user reaches their first delivered result within minutes via a guided conversational onboarding.
  4. An approved response can be delivered via Microsoft Graph (Outlook) through the same provider-agnostic adapter that already serves Gmail (delegated `Mail.Send`, built only after Gmail works end-to-end).
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Governance Substrate | 0/TBD | Not started | - |
| 2. Thin End-to-End Slice | 0/TBD | Not started | - |
| 3. Guardrails | 0/TBD | Not started | - |
| 4. Attachment & Voice-Dictation Intake | 0/TBD | Not started | - |
| 5. Knowledge Vault & GraphRAG | 0/TBD | Not started | - |
| 6. Live Voice Sessions | 0/TBD | Not started | - |
| 7. Resilience & Operations Hardening | 0/TBD | Not started | - |
| 8. Self-Improvement | 0/TBD | Not started | - |
| 9. Private Beta Productionization | 0/TBD | Not started | - |
