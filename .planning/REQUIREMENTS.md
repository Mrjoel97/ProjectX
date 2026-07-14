# Requirements: Pikar-AI

**Defined:** 2026-07-09
**Core Value:** A user speaks or types a goal and the system reliably plans it, shows the plan for a single approval before anything leaves the building (approve once → hands-off governed execution, with stage notifications and a halt control), executes it with guardrails (cost, PII, quality), and follows through to real delivery (email) — with a full audit trail. *(Approval granularity moved to per-plan 2026-07-10.)*

## v1 Requirements

Requirements for the 4-week private beta. Each maps to roadmap phases.

### Intake & Enrichment

- [x] **INTK-01**: User can submit a request as text with optional file attachments
- [ ] **INTK-02**: Attachments are classified (image/PDF/audio/document) and OCR'd/extracted/transcribed, with results merged into the request context
- [ ] **INTK-03**: User can dictate a request by voice (record → transcribe → same request pipeline)
- [x] **INTK-04**: Requests are validated and authenticated; invalid requests are rejected with a notification and an auditable "Request Rejected — Validation Failed" outcome

### Executive Agent & Planning

- [x] **AGNT-01**: Executive Agent classifies each request and produces a routing decision (direct tool / specialized sub-agent / direct LLM response)
- [x] **AGNT-02**: User can see the plan (routing decision + step list) before approving any execution
- [x] **AGNT-03**: Unknown/invalid routing values route to an explicit error branch (dead-letter), never a silent default
- [ ] **AGNT-04**: Executive Agent timeout triggers notification and escalation/timeout handling

### Guardrails

- [x] **GRDL-01**: Every request is PII-scanned and redacted to safeText before any external model call; unknown/null scan results fail closed
- [x] **GRDL-02**: Pipeline enforces redact-then-log ordering — no raw PII in logs, telemetry, or cache keys
- [x] **GRDL-03**: Cost is estimated from safeText and checked against budget; over-budget requests downgrade to a cheaper model; unknown/null results fail closed
- [x] **GRDL-04**: LLM responses are cached keyed on tenant-namespaced safeTextHash; cache hits return without a model call
- [x] **GRDL-05**: Primary LLM generation failure or timeout triggers fallback generation
- [x] **GRDL-06**: Per-user rate limiting and a cost kill-switch cap runaway spend

### Human Review & Delivery

- [x] **REVW-01**: User reviews and can approve, edit, or reject **at a single plan-level gate before execution** — approve once, then hands-off governed execution with stage notifications and a halt control. *(Redefined 2026-07-10 from per-response review. Phase 2 shipped the interim per-response gate — mechanics smoke-tested; the plan-level gate ships with the cockpit, Phase 3.1, whose manual checkpoint carries the end-user verification.)*
- [ ] **REVW-02**: Edit and reject retry counters enforce thresholds; breaches escalate, notify, and terminate the request safely
- [ ] **REVW-03**: Review inactivity timeout triggers an escalation notification (scheduled-event race on the review gate)
- [x] **DLVR-01**: Approved responses can be delivered via Gmail through the provider-agnostic email adapter
- [ ] **DLVR-02**: Approved responses can be delivered via Microsoft Graph (Outlook) through the same adapter
- [x] **DLVR-03**: OAuth token lifecycle is managed (Google testing-mode 7-day refresh expiry handled; user prompted to re-auth before tokens break)

### Email Cockpit

*Added 2026-07-12 from the approved Email Chat Cockpit design (`.planning/design/email-chat-cockpit.md`). Slice 1 (Phase 3.1) reshapes INTK-01 / AGNT-02 / REVW-01 / DLVR-01 UX and mints no new ID; slices 2–4 are new capabilities.*

- [x] **CKPT-01**: Agent can search/read the user's connected mailbox (via the already-granted `gmail.modify` scope) to surface people and context into the guided conversation — scoped to the requesting user only, with reads audited as refs/ids/counts (never raw message content), and nothing sent as a side effect of reading
- [x] **CKPT-02**: Agent can generate a document and attach it to an outgoing email within an approved plan, flowing through the same governed send (audit, telemetry, DLQ) — distinct from INTK-02, which is *inbound* attachment ingestion
- [ ] **CKPT-03**: A multi-recipient send can tailor wording per recipient behind the same single plan approval, with per-recipient content shown on the PLAN card before approval and passing the same PII/cost guardrails and per-recipient audit/telemetry

### Scheduling

*Added 2026-07-12 from the scheduled-send design (`.planning/design/scheduled-send.md`). Tier 1 only; recurring/standing-instruction sends are out of v1 scope (7-day Testing-mode tokens + unmade re-draft governance decision — see the design record).*

- [ ] **SCHD-01**: A plan can carry a user-specified future send time expressed in natural language — the PLAN card shows the resolved absolute time (user's timezone) before the single Approve; approval schedules (never immediately starts) the same governed delivery fan-out; the user can cancel any time before it fires (cancellation audited); a token dead at fire time degrades to `awaiting_reauth` + notification exactly like an immediate send

### Knowledge Vault

- [ ] **VALT-01**: Briefs and documents are stored and embedded (text-embedding-3-small @1536) for vector retrieval
- [x] **VALT-02**: Graphify extracts entities/relationships from vault content at ingestion; nodes/edges stored in Convex
- [x] **VALT-03**: Request grounding uses hybrid retrieval — vector similarity plus hop-capped graph traversal — scoped to the requesting user
- [ ] **VALT-04**: User can browse and search their vault contents

### Live Voice Sessions

- [ ] **VOIC-01**: User can hold a live bidirectional voice conversation with the Executive Agent (WebRTC realtime) with an End-session button
- [ ] **VOIC-02**: A server-side watchdog hard-caps sessions at 15 minutes and terminates cleanly
- [ ] **VOIC-03**: Ended sessions are transcribed into a detailed structured markdown brief, stored and indexed in the knowledge vault
- [ ] **VOIC-04**: At session end, the agent asks permission to convert the brief into a step-by-step plan; approved plans enter the normal request pipeline (with the review gate)

### Self-Improvement

- [ ] **IMPR-01**: User feedback (rating/comment) is captured on delivered responses
- [ ] **IMPR-02**: Feedback threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks, with one-click rollback and a kill switch
- [ ] **IMPR-03**: Prompts are versioned; every optimization records before/after versions and the triggering evidence

### Governance & Operations

- [x] **OPSG-01**: Per-request telemetry captures tokens, cost, duration, decision/retry counters, and review outcome
- [x] **OPSG-02**: Every request, redaction, routing decision, model call, review action, and delivery is written to an insert-only audit log
- [ ] **OPSG-03**: Completed request trails are exported on schedule to immutable (WORM) archival storage
- [x] **OPSG-04**: Failed/unhandled requests are archived to a dead-letter store with payload, error details, and correlation ID
- [ ] **OPSG-05**: Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events
- [x] **OPSG-06**: Schema changes ship as tracked, resumable migrations — no ad-hoc backfills against a live deployment
- [x] **OPSG-07**: A dead-letter write or workflow failure is surfaced to the operator without inspecting the database — a failure nobody sees is a failure nobody fixes. (Narrow, Phase-2 slice of operator visibility; OPSG-05's full user-facing notification matrix stays in Phase 7.)

### Discoverability

- [x] **DISC-01**: Every public page emits valid JSON-LD structured data. No field is fabricated — `aggregateRating`, `review`, and `logo` stay absent until genuine ratings and a crawlable logo exist, because inventing them earns a Google manual action
- [x] **DISC-02**: The site is crawlable and machine-readable: `robots.txt` (allowing AI crawlers), `sitemap.xml` listing every public route, canonical URLs, and `/llms.txt` so agents that browse the web can understand what Pikar is. **Every new public page must be added to `app/sitemap.ts`** — a page absent from the sitemap may never be crawled

### Private Beta

- [ ] **BETA-01**: New users can sign up only with a valid invite code (Convex Auth)
- [ ] **BETA-02**: All data — requests, vault, cache, audit, telemetry — is isolated per user across every table and index
- [ ] **BETA-03**: A new user reaches their first delivered result within minutes via a guided conversational onboarding
- [x] **BETA-04**: User sees live pipeline status and their review queue update in real time (Convex subscriptions)

## v2 Requirements

Deferred to post-beta releases. Tracked but not in the current roadmap.

### Expansion

- **EXPN-01**: Slack intake and multi-channel workflows
- **EXPN-02**: Additional integrations (docs write-back, calendar, CRM connectors)
- **EXPN-03**: Enterprise RBAC (Admin/Developer/EndUser) and multi-reviewer escalation chains
- **EXPN-04**: Billing, public signup, and abuse protection
- **EXPN-05**: Custom skills registry for third-party capability shipping
- **EXPN-06**: Team/multiplayer workspaces

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| UiPath platform (Apps, Action Center, Maestro) | Code-first stack chosen; BPMN doc is the spec, not the runtime |
| Thousands of integrations (Zapier/Lindy breadth) | Each connector is auth+maintenance surface; email done well is the beta bar |
| Computer-use / desktop RPA | Brittle, high support cost; API/browser tools only |
| Fully autonomous mode (no review gate) | Conflicts with governance identity and EU AI Act oversight |
| Calendar/scheduling engine | A whole product; commoditized; defer |
| Mobile native app | Responsive web serves voice-first mobile use |
| Unlimited voice session length | Cost blowout; 15-min cap is a product constraint |
| Postgres/Redis/Inngest stack | Superseded by owner's Convex decision (2026-07-09) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INTK-01 | Phase 2 | Complete |
| INTK-02 | Phase 4 | Pending |
| INTK-03 | Phase 4 | Pending |
| INTK-04 | Phase 2 | Complete |
| AGNT-01 | Phase 2 | Complete |
| AGNT-02 | Phase 2 | Complete |
| AGNT-03 | Phase 2 | Complete |
| AGNT-04 | Phase 7 | Pending |
| GRDL-01 | Phase 3 | Complete |
| GRDL-02 | Phase 3 | Complete |
| GRDL-03 | Phase 3 | Complete |
| GRDL-04 | Phase 3 | Complete |
| GRDL-05 | Phase 3 | Complete |
| GRDL-06 | Phase 3 | Complete |
| REVW-01 | Phase 2 | Complete |
| REVW-02 | Phase 7 | Pending |
| REVW-03 | Phase 7 | Pending |
| DLVR-01 | Phase 2 | Complete |
| DLVR-02 | Phase 9 | Pending |
| DLVR-03 | Phase 2 | Complete |
| CKPT-01 | Phase 3.2 | Complete |
| CKPT-02 | Phase 3.3 | Complete |
| CKPT-03 | Phase 3.4 | Pending |
| SCHD-01 | Phase 3.5 | Pending |
| VALT-01 | Phase 5 | Pending |
| VALT-02 | Phase 5 | Complete |
| VALT-03 | Phase 5 | Complete |
| VALT-04 | Phase 5 | Pending |
| VOIC-01 | Phase 6 | Pending |
| VOIC-02 | Phase 6 | Pending |
| VOIC-03 | Phase 6 | Pending |
| VOIC-04 | Phase 6 | Pending |
| IMPR-01 | Phase 8 | Pending |
| IMPR-02 | Phase 8 | Pending |
| IMPR-03 | Phase 8 | Pending |
| OPSG-01 | Phase 2 | Complete |
| OPSG-02 | Phase 1 | Complete |
| OPSG-03 | Phase 7 | Pending |
| OPSG-04 | Phase 1 | Complete |
| OPSG-05 | Phase 7 | Pending |
| OPSG-06 | Phase 2 | Complete |
| OPSG-07 | Phase 2 | Complete |
| DISC-01 | Phase 1 | Complete |
| DISC-02 | Phase 1 | Complete |
| BETA-01 | Phase 9 | Pending |
| BETA-02 | Phase 9 | Pending |
| BETA-03 | Phase 9 | Pending |
| BETA-04 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: **44 total** (history: header originally said "36"; corrected to the actual 40 distinct IDs during roadmap creation; +3 CKPT IDs minted 2026-07-12 for cockpit slices 2–4 — count discrepancy CLOSED; +1 SCHD-01 minted 2026-07-12 for deferred send)
- Mapped to phases: 44
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-09*
*Last updated: 2026-07-12 — re-baselined: REVW-01 redefined to plan-level approval; CKPT-01..03 minted (Email Cockpit); count 40→43; SCHD-01 minted (deferred send, Phase 3.5); count 43→44*
