# Requirements: Pikar-AI

**Defined:** 2026-07-09
**Core Value:** A user speaks or types a goal and the system reliably plans it, shows the plan for a single approval before anything leaves the building (approve once → hands-off governed execution, with stage notifications and a halt control), executes it with guardrails (cost, PII, quality), and follows through to real delivery (email) — with a full audit trail. *(Approval granularity moved to per-plan 2026-07-10.)*

## v1 Requirements

Requirements for the 4-week private beta. Each maps to roadmap phases.

### Intake & Enrichment

- [x] **INTK-01**: User can submit a request as text with optional file attachments
- [x] **INTK-02**: Attachments are classified (image/PDF/audio/document) and OCR'd/extracted/transcribed, with results merged into the request context
- [x] **INTK-03**: User can dictate a request by voice (record → transcribe → same request pipeline)
- [x] **INTK-04**: Requests are validated and authenticated; invalid requests are rejected with a notification and an auditable "Request Rejected — Validation Failed" outcome

### Executive Agent & Planning

- [x] **AGNT-01**: Executive Agent classifies each request and produces a routing decision (direct tool / specialized sub-agent / direct LLM response)
- [x] **AGNT-02**: User can see the plan (routing decision + step list) before approving any execution
- [x] **AGNT-03**: Unknown/invalid routing values route to an explicit error branch (dead-letter), never a silent default
- [x] **AGNT-04**: Executive Agent timeout triggers notification and escalation/timeout handling

### Guardrails

- [x] **GRDL-01**: Every request is PII-scanned and redacted to safeText before any external model call; unknown/null scan results fail closed
- [x] **GRDL-02**: Pipeline enforces redact-then-log ordering — no raw PII in logs, telemetry, or cache keys
- [x] **GRDL-03**: Cost is estimated from safeText and checked against budget; over-budget requests downgrade to a cheaper model; unknown/null results fail closed
- [x] **GRDL-04**: LLM responses are cached keyed on tenant-namespaced safeTextHash; cache hits return without a model call
- [x] **GRDL-05**: Primary LLM generation failure or timeout triggers fallback generation
- [x] **GRDL-06**: Per-user rate limiting and a cost kill-switch cap runaway spend

### Human Review & Delivery

- [x] **REVW-01**: User reviews and can approve, edit, or reject **at a single plan-level gate before execution** — approve once, then hands-off governed execution with stage notifications and a halt control. *(Redefined 2026-07-10 from per-response review. Phase 2 shipped the interim per-response gate — mechanics smoke-tested; the plan-level gate ships with the cockpit, Phase 3.1, whose manual checkpoint carries the end-user verification.)*
- [x] **REVW-02**: Edit and reject retry counters enforce thresholds; breaches escalate, notify, and terminate the request safely
- [x] **REVW-03**: Review inactivity timeout triggers an escalation notification (scheduled-event race on the review gate)
- [x] **DLVR-01**: Approved responses can be delivered via Gmail through the provider-agnostic email adapter
- [ ] **DLVR-02**: Approved responses can be delivered via Microsoft Graph (Outlook) through the same adapter *(open: the Graph send arm shipped in 25-05, but Microsoft is env-gated and its 2026-08-16 concurrency probe failed — no live delivery)*
- [x] **DLVR-03**: OAuth token lifecycle is managed (Google testing-mode 7-day refresh expiry handled; user prompted to re-auth before tokens break)

### Email Cockpit

*Added 2026-07-12 from the approved Email Chat Cockpit design (`.planning/design/email-chat-cockpit.md`). Slice 1 (Phase 3.1) reshapes INTK-01 / AGNT-02 / REVW-01 / DLVR-01 UX and mints no new ID; slices 2–4 are new capabilities.*

- [x] **CKPT-01**: Agent can search/read the user's connected mailbox (via the already-granted `gmail.modify` scope) to surface people and context into the guided conversation — scoped to the requesting user only, with reads audited as refs/ids/counts (never raw message content), and nothing sent as a side effect of reading
- [x] **CKPT-02**: Agent can generate a document and attach it to an outgoing email within an approved plan, flowing through the same governed send (audit, telemetry, DLQ) — distinct from INTK-02, which is *inbound* attachment ingestion
- [x] **CKPT-03**: A multi-recipient send can tailor wording per recipient behind the same single plan approval, with per-recipient content shown on the PLAN card before approval and passing the same PII/cost guardrails and per-recipient audit/telemetry
- [x] **CKPT-04**: Agent can, on demand, read and summarize the user's inbox into a time-grouped briefing (today/yesterday/this week — grouped in pure code from message timestamps, never by the model) with a "Needs you" triage section — under the **toolless-ingestion invariant**: raw message bodies only ever reach an LLM inside toolless, schema-validated digest calls (no tool-bearing agent loop ingests raw bodies); reads are capped and snippet-first, audited refs/ids/counts only, with zero mailbox writes and zero sends; any action seeded from the briefing crosses the normal PLAN → human Approve gate *(minted 2026-07-14 from `.planning/design/inbox-briefing.md`, beyond the original four cockpit slices)*
- [x] **CKPT-05**: While the Executive Agent runs a turn, the workspace shows the steps it is taking as they happen and the chat shows an in-progress bubble — fed by append-only step rows the agent loop writes and the UI subscribes to via Convex reactivity (no polling, no new transport); step rows carry a closed tool-name enum + phase + counts ONLY (no free text, structurally), so no sender/subject/body can reach an audit or telemetry payload via this path; a step is terminal on success, failure, and fallback-retry — a running step never spins forever *(minted 2026-07-17 from the 03.7 UAT Gap 2 user report; cross-cutting cockpit UX, no backend governance change)*
- [x] **RPLY-01**: "Draft a reply to X" becomes a real reply — the agent resolves the recipient by message reference (the original's From address, refs-only, no panel round-trip), sets a `Re:` subject and Gmail in-thread threading (In-Reply-To/References headers + thread id), and drafts the body from the user's intent with the original message ingested as context under the **toolless-ingestion invariant** (the original body only ever reaches an LLM inside a toolless, schema-validated draft call — no tool-bearing loop ingests it); the reply is delivered through the unchanged plan → single human Approve → governed fan-out (audit/telemetry/DLQ), and an injected instruction in the original body is described-not-actuated *(minted 2026-07-19 from the approved inbox-reply phase plan, `.planning/phases/03.11-inbox-reply/`)*

### Scheduling

*Added 2026-07-12 from the scheduled-send design (`.planning/design/scheduled-send.md`). Tier 1 only; recurring/standing-instruction sends are out of v1 scope (7-day Testing-mode tokens + unmade re-draft governance decision — see the design record).*

- [x] **SCHD-01**: A plan can carry a user-specified future send time expressed in natural language — the PLAN card shows the resolved absolute time (user's timezone) before the single Approve; approval schedules (never immediately starts) the same governed delivery fan-out; the user can cancel any time before it fires (cancellation audited); a token dead at fire time degrades to `awaiting_reauth` + notification exactly like an immediate send

### Knowledge Vault

- [x] **VALT-01**: Briefs and documents are stored and embedded (text-embedding-3-small @1536) for vector retrieval
- [x] **VALT-02**: Graphify extracts entities/relationships from vault content at ingestion; nodes/edges stored in Convex
- [x] **VALT-03**: Request grounding uses hybrid retrieval — vector similarity plus hop-capped graph traversal — scoped to the requesting user
- [x] **VALT-04**: User can browse and search their vault contents
- [x] **VALT-05**: User can upload a company folder as a unit (up to 1.5 GB total, 200 MB per file) and the vault tracks it as one thing
- [x] **VALT-06**: A folder's cost is estimated and the whole folder is reserved before the first paid call, or the folder is refused intact with its estimate, remaining budget and shortfall named
- [x] **VALT-07**: A folder's documents are excluded from retrieval until the folder completes
- [x] **VALT-08**: A folder completes with an honest manifest of what failed and why, and the digest states what it could not read
- [x] **VALT-09**: A folder-level digest is synthesised as a vault document that embeds, retrieves and grounds through the existing rails
- [x] **VALT-10**: Digest staleness is surfaced with a one-click rebuild, and no model call fires until the user asks
- [x] **VALT-11**: User can drill into a folder and browse its documents rather than one flat grid
- [x] **VALT-12**: Documents carry a machine-derived type and identity line that the user can correct, and a user correction is never overwritten
- [ ] **VALT-13**: User can import a Google Drive folder once and re-import on demand, bounded by the same budget rail *(open: 15.3-VERIFICATION is `human_needed`; the owner UAT of folder import/re-import is not recorded)*
- [x] **VALT-14**: The vault read surfaces remain within Convex's per-transaction read cap at folder-scale document counts
- [ ] **VALT-15**: The Executive Agent can browse and search the user's Google Drive to answer "which folder has X", WITHOUT any path to importing it or to the ingest budget *(open: 20.1-01 defers closure to 20.1-02, which has not run)*
- [x] **VALT-16**: The Knowledge Vault matches the approved Nord Edge browse, folder, preview, and empty-state designs without regressing upload, Drive import, synthesis, metadata correction, citations, download, or delete; search is scoped to the current folder and the UI never fabricates exact counts the backend does not provide

### Live Voice Sessions

- [x] **VOIC-01**: User can hold a live bidirectional voice conversation with the Executive Agent (WebRTC realtime) with an End-session button
- [x] **VOIC-02**: A server-side watchdog hard-caps sessions at 15 minutes and terminates cleanly
- [x] **VOIC-03**: Ended sessions are transcribed into a detailed structured markdown brief, stored and indexed in the knowledge vault
- [x] **VOIC-04**: At session end, the agent asks permission to convert the brief into a step-by-step plan; approved plans enter the normal request pipeline (with the review gate)

### Self-Improvement

- [x] **IMPR-01**: User feedback (rating/comment) is captured on delivered responses
- [x] **IMPR-02**: Feedback threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks, with one-click rollback and a kill switch
- [x] **IMPR-03**: Prompts are versioned; every optimization records before/after versions and the triggering evidence

### Agent Evaluation

*Added 2026-07-14 from the agent-eval-gate design (`.planning/design/agent-eval-gate.md`). Pulls the eval substrate ahead of Phase 8 so agent-skill activations stop being blind; IMPR-02's optimizer later plugs into this harness instead of building its own.*

- [x] **EVAL-01**: A golden set of scripted cockpit conversations runs on demand against the live model and asserts on resulting plan/tool state (never reply text), with a hard cost cap and zero possibility of a real send; activating a never-before-active version of a gated agent skill requires a recorded passing eval run (evidence on the skill row, refs/counts only), while rollback to a previously-active version is structurally exempt and always works
- [x] **EVAL-02**: Production eval signals — approve/edit/reject rates, regenerate count, fallback count, DLQ rate, cost per delivered plan — are readable on the ops page from existing telemetry/audit data, with no new write paths

### Governance & Operations

- [x] **OPSG-01**: Per-request telemetry captures tokens, cost, duration, decision/retry counters, and review outcome
- [x] **OPSG-02**: Every request, redaction, routing decision, model call, review action, and delivery is written to an insert-only audit log
- [x] **OPSG-03**: Completed request trails are exported on schedule to immutable (WORM) archival storage
- [x] **OPSG-04**: Failed/unhandled requests are archived to a dead-letter store with payload, error details, and correlation ID
- [x] **OPSG-05**: Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events
- [x] **OPSG-06**: Schema changes ship as tracked, resumable migrations — no ad-hoc backfills against a live deployment
- [x] **OPSG-07**: A dead-letter write or workflow failure is surfaced to the operator without inspecting the database — a failure nobody sees is a failure nobody fixes. (Narrow, Phase-2 slice of operator visibility; OPSG-05's full user-facing notification matrix stays in Phase 7.)

### Discoverability

- [x] **DISC-01**: Every public page emits valid JSON-LD structured data. No field is fabricated — `aggregateRating`, `review`, and `logo` stay absent until genuine ratings and a crawlable logo exist, because inventing them earns a Google manual action
- [x] **DISC-02**: The site is crawlable and machine-readable: `robots.txt` (allowing AI crawlers), `sitemap.xml` listing every public route, canonical URLs, and `/llms.txt` so agents that browse the web can understand what Pikar is. **Every new public page must be added to `app/sitemap.ts`** — a page absent from the sitemap may never be crawled

### Private Beta

- [ ] **BETA-01**: New users can sign up only with a valid invite code (Convex Auth) *(open: 25-01/25-02 shipped invite-gated signup and decline to certify; the proof is one invited non-owner signup)*
  — **KNOWINGLY UNMET IN LIVE PRODUCTION as of 2026-08-15.** `www.pikar-ai.com` is deployed with
  signup fully OPEN; anyone can sign in with Google, get a tenant, and spend the owner's
  `OPENAI_API_KEY`. Owner was shown the exposure twice and chose to ship and stay open. See
  `docs/decisions/020-production-opened-without-an-admission-gate.md` — it records the accepted
  risk AND the implementation finding: the gate belongs in `requireScope`
  (`packages/backend/convex/lib/functions.ts`), because `tenantId` IS the auth user id and there
  is no tenant-creation event to guard.
- [ ] **BETA-02**: All data — requests, vault, cache, audit, telemetry — is isolated per user across every table and index *(open: the `requireTenant` wrapper scopes every table; the two-user proof (BETA-05) has not run)*
- [ ] **BETA-03**: A new user reaches their first delivered result within minutes via a guided conversational onboarding *(open: measured by the merged order's item 9 (time-to-first-outcome), not yet measured)*
- [x] **BETA-04**: User sees live pipeline status and their review queue update in real time (Convex subscriptions)

## v2.0 Platform Requirements

Milestone **v2.0 — Platform → Private Beta** (defined 2026-07-24). Grow the governed email cockpit
into a broadly-capable AI chief-of-staff, then open the invite-only beta on top of it. Grouped by the
four dependency-ordered stages (S1→S4). **Carried-in:** BETA-01/02/03 and DLVR-02 live in the v1
Private Beta section above and land in this milestone's **final** stage (S4) — the beta opens last.

### S1 — Foundation & Intelligence

- [x] **VGND-01**: The agent can retrieve from the user's knowledge vault mid-conversation via a governed `searchVault` tool — hydrated chunk text, tenant-scoped, refs-only audit, fails open (an empty/failed search never dead-ends the turn)
- [x] **ONBD-01**: A guided first-run onboarding identifies the user's persona (solopreneur / startup / SME); enterprise is deferred
- [x] **ONBD-02**: The user supplies their business/idea (files, pasted text, or a written/spoken brief) and a structured business profile is stored and indexed in the vault
- [x] **BEVL-01**: The agent produces an on-demand business assessment using persona-appropriate frameworks (SWOT / Lean / Business Model Canvas), grounded in the user's own vault data, with honest data-gap flags and no fabricated metrics or viability scores
- [x] **BEVL-02**: The assessment surfaces gaps and turns them into governed action proposals through the approve→execute spine; a healthy business honestly returns zero gaps
- [x] **BEVL-03**: A proactive business review is delivered in-app on a recurring cadence (weekly-style briefing) using no OAuth mailbox token
- [x] **DOCV-01**: The user can upload a report, have it ingested and understood in the vault, discuss it by voice with the grounded agent, and receive surfaced insights/patterns/gaps plus a memo or gap-bridging plan — with an honest "no gaps" outcome and the user deciding after the discussion
- [x] **BLPR-01**: A single cited business blueprint is synthesized from the user's typed profile, their vault documents, and the extracted entity graph. Typed values are AUTHORITATIVE and are never overwritten by derivation; derived claims carry a source citation and require explicit user confirmation before reaching any agent. Both entry routes (typing and uploading) remain permanent and compose — a one-line profile edit costs no model call and no confirmation step
- [x] **BLPR-02**: The confirmed blueprint is standing context for the agent — present on EVERY cockpit turn via the turn prompt (not only on turns that search the vault), and available to the two grounding-driven callers (`evaluations.ts`, `voiceDoc.ts`) via an explicit `spine` field. It distinguishes user-stated from system-derived claims, carries its own staleness signal when documents are unincorporated, and — when the user rebuilds — proposes a reviewable diff rather than ever silently changing. *(Scope note 2026-07-27: unincorporated-document DETECTION is automatic and free; the rebuild is user-triggered. Automatic triggering is deferred until a bulk-ingest completion event exists — see Phase 17.1 context.)*

### S2 — Breadth of Action

- [x] **DISP-01**: Real sub-agent dispatch — specialized sub-agents are swappable (skill body, tool-set) pairs run by the single governed loop, with a depth cap, a shared root cost budget, cycle refusal, and recorded lineage (no nested loops, no agents-spawning-agents)
- [x] **ACTN-01**: A generalized governed action executor lets an approved plan execute actions beyond `gmail.send` (the approve→execute spine becomes action-agnostic)
- [x] **DISP-02**: A first exemplar specialist sub-agent (Research) is dispatched through DISP-01
- [ ] **ACTN-02**: The agent can schedule and manage calendar events (Google / Microsoft) as governed actions *(open: the Google half is live (17-VERIFICATION `gaps_found`); the Microsoft half is blocked by the 2026-08-16 probe (If-Match ignored on DELETE))*
- [x] **ACTN-03**: The agent can perform web research through a grounded, injection/SSRF-hardened tool, storing findings in the vault
- [ ] **ACTN-04**: The agent can create standalone documents/content artifacts (beyond email attachments) *(open: Phase 18 is 8/10 — 18-09 and 18-10 open)*
- [x] **ACTN-05**: The agent can track contacts / CRM state and follow-ups scoped to the user

### S3 — Creation & Self-Extension

- [ ] **MEDIA-01**: A media-creation canvas produces images and video — a finished short-form reel assembled from clips of ≤15 s each, capped at 60 s by BUDGET rather than by capability — via a server-to-server provider API (fal.ai) behind a deployment secret, as async governed jobs with a separate capped budget; generation is wrapped, not rebuilt. **Corrected 2026-08-03 (plan 20-11).** The original wording carried two premises the Phase-20 spike refuted: no model generates 3 minutes (the ceiling is 15 s across 28 models from eight labs), and the Pikar-Ai MCP is a claude.ai CLIENT-side account connector, structurally unreachable from a Convex action (ADR-011). The re-scope then PARTLY UN-REFUTED the first: a 12-block reel IS two minutes and is refused only by `MEDIA_JOB_CAP_USD`, not by the models (ADR-012). So the honest line is neither the original nor a flat "5 or 10 seconds" *(open: 20.2 pending; media audit 2026-09-04: no reel has completed on the current rail)*
- [x] **SKILL-01**: The user can author skills adapted to their business through the eval-gated skills registry
- [ ] **SKILL-02**: The agent can author skills as candidates only — structurally unable to self-activate; activation requires the eval gate plus owner approval *(open: Phase 23 is 5/9 — the candidate-only invariant shipped in 23-01..05, 23-06..09 open)*

### S4 — Governance & Open the Beta

- [x] **GOVN-01**: A `requireOwner` primitive gates the three Phase-8 functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) and the admin surface so non-owners cannot reach them — pulled early, since it gates S3 agent-authored skills and S4 multi-user
- [ ] **GOVN-02**: An ISO 9001:2015 QMS conformance foundation maps the existing audit / skill-versioning / GSD-playbook change-control to the relevant clauses and fills the gaps — a conformance map, not process theater *(open: 24-01 closed with Clause 10.2 Partial until 24-02, which has not run)*
- [x] **GOVN-03**: Every user-exercisable data and connection control the published privacy policy promises actually exists in the product and does what the policy says — the policy is the specification, not the marketing. Covers in-app disconnection of a connected account WITH revocation at the provider (not merely a local token delete), and tenant data deletion and export. Minted 2026-08-01 after `apps/web/app/privacy/page.tsx:312` was found promising an in-app Google disconnect that had no implementation anywhere in the repo.
- [ ] **BETA-05**: Cross-tenant isolation assertions are written as each new surface ships (S1–S3), culminating in a two-user test covering every new table and index *(open: the two-user isolation test needs a second tenant via the invite path; not run end to end)*

*(S4 also consumes the carried-in BETA-01 invite/waitlist, BETA-02 isolation, BETA-03 fast onboarding, and DLVR-02 Outlook — the productionization detailed in `09-CONTEXT.md`, executed as the milestone's final phase.)*

### Connected Product Surfaces — Pulled Before Private Beta

*Added 2026-08-05 from the approved `pending-pages.html` integration map. Phase 26 is no longer
blanket-blocked by Phase 25; each surface carries only its real dependency.*

- [x] **DASH-01**: Every new dashboard route uses tenant-safe or owner-safe public projections, bounded pagination/time windows, honest loading/empty/partial/error/refusal states, named IANA timezone formatting, USD cost semantics, refs/counts-only audit for mutations, and remains disabled in navigation until connected browser verification passes
- [x] **APRV-01**: The user can review a tenant-wide approvals queue covering awaiting, scheduled, in-flight, decided and cleared work; approve, schedule, cancel, discard and revise actions have explicit server-side state guards, idempotent outcomes and scheduler-race handling, with calendar revisions returning to the originating cockpit until a safe inline availability/CAS contract exists
- [x] **FIN-01**: The user can inspect truthful reasoning, media and ingest spend as estimated, reserved, actual, refunded and unlanded movements from an append-only ledger with an explicit coverage start; tenant rails and owner-only deployment rails remain distinct, and missing history is shown as unknown rather than zero
- [x] **CONT-01**: The user can browse a bounded unified library of Vault artifacts (documents, approved memos, research briefs) and rendered media with stable provenance, ownership-checked signed downloads and processing states; reuse opens/prefills the cockpit and never silently duplicates or sends an artifact
  - _AMENDED 2026-08-22 (plan 26-11, owner decision): **"and sent mail" removed from the lane and reassigned to RPRT-01.** As ratified this requirement could never be checked off -- plans 26-11, 26-12 and 26-13 all exclude a sent-mail lane from Content, so the requirement's own text named a surface the whole chain declines to build. Amended rather than recorded as a deviation, because the narrowing is deliberate and permanent, not a slip._
- [x] **RPRT-01**: The user can view bounded business, operations and governance reports for a selected half-open time window, including a server-sanitized audit projection and the SENT-MAIL record; WORM, active-skill and deployment-budget facts remain owner-only, and board-pack generation lands as a governed downloadable artifact
  - _AMENDED 2026-08-22 (plan 26-11, owner decision): sent mail moved here from CONT-01. Delivery is a reporting fact, not a reusable artifact -- a sent message cannot be "reused" without re-sending it, which is the one thing CONT-01 forbids._
- [x] **PIPE-01** *(Phase 19 companion)*: The user can use a pipeline view over Phase 19's single tenant-scoped contacts/follow-up/consent/suppression substrate without creating a second CRM store; suppressed recipients are still refused in every product-email terminal and the first release does not invent opportunities, deal stages or monetary pipeline values
- [x] **HOME-01**: Command Center v2 composes stable bounded summaries from the landed Approvals, Finance, Content, Reports and Pipeline surfaces, produces a deterministic recommended next move and binding constraint with explainable inputs, and shows generic health to tenants while owner-only operational facts remain restricted

## Post-Beta Knowledge-Work Pack Requirements

*Added 2026-08-05 from the owner-approved knowledge-work plugin rollout. These phases are planned
now but execute after Phase 25 opens the private beta; they do not become a new beta-admission gate.
Anthropic's repository is an upstream workflow source, never a second plugin runtime or capability
boundary inside Pikar.*

### Curated Pack Pilot

- [x] **PACK-01**: Every adapted upstream workflow pins an exact source commit and file set, retains Apache-2.0 attribution and modification notices, records a source hash/provenance manifest, and can update only through an explicit reviewed diff — never an automatic production sync
- [x] **PACK-02**: Business Pulse, Campaign Plan, Customer Complaint Response, Sales Call Prep, Process/SOP Builder and Brand Review run as native Pikar workflows over the existing Executive Agent, Business Blueprint, Vault, research, document/content, calendar, inbox and approval surfaces; no second router, memory store, plugin runtime or duplicate output plane is introduced
- [x] **PACK-03**: Each pilot workflow has a complete operation-to-tool matrix; skill bodies remain registry-owned while every capability grant is code-owned and structurally absent when not allowed; connector content is fenced as untrusted, writes remain behind the plan gate, and each skill publishes as a candidate that must pass outcome-state evals plus an authenticated browser gate before exposure
- [x] **PACK-04**: Workflow-pack telemetry measures time-to-first-useful-outcome, recommendation acceptance, plan approve/edit/reject, missing-connector surprise rate, citation/unsupported-claim rate, completion outcome, cost and latency without placing raw content or PII in telemetry

### Connector-Backed Revenue Pack

- [ ] **REVN-01**: A server-side HubSpot adapter provides tenant-scoped read-only account, contact and pipeline projections after endpoint, OAuth, data-processing, rate-limit and commercial-terms review; no generic tenant-supplied MCP client is introduced
- [ ] **REVN-02**: A server-side QuickBooks adapter provides tenant-scoped read-only reports required for cash, receivables, payables and revenue analysis after the same suitability and terms gate
- [ ] **REVN-03**: Server-side Stripe and PayPal adapters provide tenant-scoped read-only payments, invoices, settlements and dispute context; tokens use revocable provider grants and encrypted storage, with honest partial/unavailable states
- [ ] **REVN-04**: Lead triage, call lists, pipeline review and customer pulse consume the Phase 19 person/consent/suppression substrate plus read-only connector projections without creating a second CRM or fabricating deal values/stages *(open: Phase 28 claims it in code; the revenue lane is parked by owner choice 2026-08-31)*
- [ ] **REVN-05**: Cash-flow and payroll-confidence results are computed in deterministic, tested pure TypeScript over validated normalized financial inputs with explicit provenance, coverage windows, confidence semantics and accountant-review disclaimers — never by LLM arithmetic *(open: Phase 28 claims it in code; the revenue lane is parked by owner choice 2026-08-31)*
- [ ] **REVN-06**: Invoice reminders are drafts until a user approves a governed plan; sending, refunds, credits, CRM mutations and financial writes are unreachable from read-only revenue specialists *(open: Phase 28 claims it in code; the revenue lane is parked by owner choice 2026-08-31 (28.2 unparked one connector's code half))*

### Pikar Billing, Invoicing and Tax (minted 2026-08-28 — Phase 28.1)

Pikar charging for ITSELF, from its OWN Stripe merchant account. Distinct from REVN-03, which reads
a TENANT’s Stripe account read-only. Opposite direction, opposite trust boundary, separate names
(`billing*` / `BILLING_STRIPE_*` here; `stripe*` / `STRIPE_APP_*` there).

- [ ] **BILL-01**: A tenant subscribes through Stripe-hosted Checkout with a free trial and a card on file that auto-converts; the tenant↔Stripe-customer mapping is stored on both sides and neither a Stripe customer without a tenant nor a tenant without a customer can be silently invented — an unmatched customer is dead-lettered by ref, never auto-provisioned *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*
- [ ] **BILL-02**: The webhook receiver verifies Stripe signatures before parsing, and is idempotent by construction — a `stripeEvents` row keyed on `event.id` is inserted before any side effect, so a Stripe retry or a Convex action retry cannot double-apply; every outbound mutating Stripe call carries an idempotency key *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*
- [ ] **BILL-03**: Billing outcomes reconcile into the existing append-only ledger, which remains the book of record; bank-transfer revenue is NOT recorded as `actual` on `invoice.paid` alone, because those funds land in the customer cash balance and settle later — cash-balance and funding-reversal events are handled, and unapplied funds are visible rather than assumed collected *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*
- [ ] **BILL-04**: Invoices are created programmatically on a schedule (accumulated invoice items rolled into one document), branded, and payable by card or bank transfer through the Stripe-hosted invoice page; no custom 3DS or card-data handling exists anywhere in the codebase *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*
- [ ] **BILL-05**: Tax posture is honest by construction. Every zero-tax outcome we store or render carries Stripe’s `taxability_reason`, so "no tax owed" (`not_collecting`) is distinguishable from "calculated as zero" (`zero_rated`, `not_subject_to_tax`) — a bare `Tax: 0.00` is never presented as a calculation. The product tax category is set to a real code (never the untaxed default `txcd_00000000`) and the head-office address is configured, because `not_collecting` is ambiguous between "unregistered" and "product coded untaxed" and only those two settings disambiguate it. *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*
  - **CORRECTED 2026-08-28, before any plan was written.** This requirement originally also demanded that "crossing a monitored threshold surfaces as an explicit alert". **That is not buildable and no plan may claim it.** Verified against Stripe’s own docs: threshold notifications are **email + Dashboard only — there is no `tax.threshold.*` webhook event**; they are **live-mode only**; and they require **10,000 USD of revenue in the previous year**, which this merchant does not have. A threshold monitor written in code today could never fire. Threshold monitoring is therefore an **operational/Dashboard control, not a code surface**, and belongs in the playbook as an owner duty with its preconditions stated. Writing it as code would have shipped a monitor that reads as protection and is structurally silent.
- [ ] **BILL-06**: Deleting a tenant terminates its billing relationship (no subscription keeps charging a deleted tenant), and all billing secrets live in the Convex deployment env, classified in `ENV_MANIFEST`, with no development fallback *(open: 28.1 is 11/11 in code; nothing has spoken to Stripe on a billing path (STATE 2026-08-29) and the tax country is unset pending the entity)*

### Unified Knowledge and Routines

- [x] **KNOW-01**: One tenant-scoped search experience decomposes a query across native Pikar sources (Vault, Drive, Gmail and landed CRM/support sources), returns cited and deduplicated answers with source authority/freshness/confidence, and names unavailable or partial sources honestly
- [x] **ROUT-01**: Phase 21's authoring seam becomes a user-facing workflow-pack authoring layer: users customize approved native templates and publish immutable tenant-scoped candidates through the existing eval gate, never arbitrary tool grants or executable code
- [ ] **ROUT-02**: Recurring routines ship only after the standing-instruction approval model, OAuth lifetime/re-auth behavior, missed-run semantics, timezone/DST handling, idempotency and pause/revoke controls are explicitly decided and tested; until then the safe deliverable remains a manually re-runnable pinned workflow *(open: 29 closed it as `defer`; 34 lists it pending — fail-closed until the standing-instruction approval model exists)*

### Research depth (minted 2026-09-06 — Phase 39, Track C step 11 / G4)

- [x] **RSCH-01**: The research specialist reads the pages it cites — a `readPage` tool bounded to URLs its own search returned, a per-run read cap, page-read vs snippet-only labels on every claim, a shared staleness window on stored findings, and a limits footer that states what the system did and did not do

### Document canvas (minted 2026-09-06 — Phase 40, Track C step 11 / G5)

- [x] **DOC-01**: Documents render in their true form wherever the browser can — the PDF a turn produced is framed inline in the workspace card for the thread the user is viewing, and an uploaded workbook shows as a capped grid of real rows and named sheets with its ceilings stated in words — the agent can deliver a real `.xlsx` on both the email and vault planes from a registry-owned spreadsheet drafter, and Office fidelity is a recorded decision (ADR-036: `pdf | html | xlsx` out, PDF twin at creation, text projection plus original download in, never DOCX/PPTX) rather than an accident

### Optional Vertical Packs

- [ ] **VERT-01**: Legal, HR, Product, Design, Engineering and Data packs are discoverable only when tenant tier, business profile and connected capabilities make them relevant; selection changes guidance and templates, never tool authority
- [ ] **VERT-02**: Each vertical pack is a separately versioned, provenance-tracked and eval-gated native pack with vertical-specific disclaimers, output contracts, failure states and authenticated UAT; high-stakes results remain assistive and require qualified human review
- [ ] **VERT-03**: Data analysis starts file-first and read-only; warehouse execution, HRIS/ATS, legal-system, design, source-control and monitoring connectors require their own server-side suitability/security/terms gate before activation
- [ ] **VERT-04**: Bio Research remains outside the general product and roadmap execution until behavioral demand, a named target persona, scientific validation, data/licensing review and a separate regulated-risk plan justify a dedicated vertical

### Marketing (minted 2026-08-07 — Phases 31-32, PULLED PRE-BETA per ADR-015)

*Admitted by explicit owner override of the admission rule at `PROJECT.md:51-53`, not by a Validated
line. ADR-015 is the override record. MKTG-04/05/06 are gated on the legal entity — see the EXTERNAL
BLOCKER section of `ROADMAP.md`.*

- [ ] **MKTG-01**: A Marketing surface renders every planned outbound channel with an honest state — connected, connectable, or blocked-with-reason naming the external gate — and never renders an unconnectable channel as a zero; the Executive Agent assists on this surface by proposing, never by publishing
- [ ] **MKTG-02**: Funnel v0 is link-only on the Convex `httpAction` plane: one unguessable token increments three integer counters (visits/claims/downloads) with `?s=` source attribution and 302s to stored bytes; it is the product's first unauthenticated read and does not widen `apps/web/middleware.ts`, add a public write, or ship an event table
- [ ] **MKTG-03**: A captured lead writes into Phase 19's single tenant-scoped person store with `origin`, `consentAt` and `consentSource` — never a second CRM plane — and the SEND-path suppression guard continues to refuse suppressed addresses in every product-email terminal
- [ ] **MKTG-04** *(gated on the legal entity)*: Each social channel passes an independent suitability/OAuth/security/terms review and exposes tenant-scoped, encrypted, revocable credentials with honest re-auth and error states, plus provider-side revocation on disconnect (GOVN-03's standard)
- [ ] **MKTG-05** *(gated on the legal entity)*: Publishing and scheduling to a channel stage into the existing plan gate and reuse the shipped deferred-send machinery; no new unattended authority is minted and approve-once-for-many remains deferred per ADR-004
- [ ] **MKTG-06** *(gated on the legal entity)*: Per-post engagement metrics store provider-issued ids, counts and timestamps only — never post text or recipient identity — under the same refs-and-counts contract that governs audit, and the table arrives with a connected channel rather than empty and ahead of one

## v2 Requirements

Deferred to post-beta releases. Tracked but not in the current roadmap.

### Expansion

- **EXPN-01**: Slack intake and multi-channel workflows
- **EXPN-02**: Additional integrations (docs write-back, calendar, CRM connectors)
- **EXPN-03**: Enterprise RBAC (Admin/Developer/EndUser) and multi-reviewer escalation chains
- **EXPN-04**: Billing, public signup, and abuse protection
- **EXPN-05**: Custom skills registry for third-party capability shipping
- **EXPN-06**: Team/multiplayer workspaces
- **EXPN-07**: External agent interoperability — MCP server exposure of Pikar's governed tools first, A2A (Agent2Agent) evaluation after — implemented strictly as an adapter over the existing governed tool boundary (ADR-004), never a second door around it: external agents are a third principal class (human / internal agent / external agent) with their own auth, every inbound message is treated as untrusted input, the human Approve gate is never bypassed, and the whole capability is gated on the scoped-grant machinery (deferred capabilities #2/#3) plus post-beta behavioral evidence per the moat-strategy Validated gate. *(Minted 2026-07-14; internal agents deliberately do NOT get a messaging protocol — they coordinate through shared governed state and workflows.)*

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
| INTK-02 | Phase 4 | Complete |
| INTK-03 | Phase 4 | Complete |
| INTK-04 | Phase 2 | Complete |
| AGNT-01 | Phase 2 | Complete |
| AGNT-02 | Phase 2 | Complete |
| AGNT-03 | Phase 2 | Complete |
| AGNT-04 | Phase 7 | Complete |
| GRDL-01 | Phase 3 | Complete |
| GRDL-02 | Phase 3 | Complete |
| GRDL-03 | Phase 3 | Complete |
| GRDL-04 | Phase 3 | Complete |
| GRDL-05 | Phase 3 | Complete |
| GRDL-06 | Phase 3 | Complete |
| REVW-01 | Phase 2 | Complete |
| REVW-02 | Phase 7 | Complete |
| REVW-03 | Phase 7 | Complete |
| DLVR-01 | Phase 2 | Complete |
| DLVR-02 | Phase 25 | Pending |
| DLVR-03 | Phase 2 | Complete |
| CKPT-01 | Phase 3.2 | Complete |
| CKPT-02 | Phase 3.3 | Complete |
| CKPT-03 | Phase 3.4 | Complete (4/4 plans; CKPT-03 human-verified 2026-07-14, incl. multi-name resolution gap-closure) |
| CKPT-04 | Phase 3.7 | Complete (human-verified 2026-07-17 — reads as an intelligent executive report, Gap 1 + Gap 2 (presentation) closed; inbox-digest v2 eval-gated & active) |
| CKPT-05 | Phase 3.9 | Complete (human-verified 2026-07-17, after 4 checkpoint-feedback fixes — see 03.9-04-SUMMARY) |
| RPLY-01 | Phase 3.11 | Complete (6/6 plans; owner live human-verify 2026-07-19 — a real "reply to X" landed IN the original Gmail thread with the correct Re: subject, addressed only the original sender) |
| SCHD-01 | Phase 3.5 | Complete |
| VALT-01 | Phase 5 | Complete |
| VALT-02 | Phase 5 | Complete |
| VALT-03 | Phase 5 | Complete |
| VALT-04 | Phase 5 | Complete |
| VALT-05 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — directory-only picker + one folder through `createFolder`/member upload/`reserveFolder`; `vaultFolders.test.ts` 23/23) |
| VALT-06 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — `folderEstimate`/`reserveFolder` parity, hard reserve, clamped idempotent `settleFolder`; 24-hour rollover remains a documented limitation, not a missing guard) |
| VALT-07 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — one `sealedIn` predicate across vector seeds, graph neighbors, browse search and blueprint drift; `vaultSealing.test.ts` 6/6) |
| VALT-08 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — folder counters cover every terminal outcome and a failed member is named in digest text with its reason) |
| VALT-09 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — `buildFolderDigest` starts normal ingest and `vaultDigest.test.ts` proves a real `ragEntryId` grounds through the normal rail, not an origin literal) |
| VALT-10 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — bounded `folderDigestState` set difference, explicit rebuild control, exact at 120 members, and no automatic rebuild call present) |
| VALT-11 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — folder-scoped `listVaultDocs` + `FolderBreadcrumb`, also exercised against a real Drive subfolder in the 2026-08-05 live session) |
| VALT-12 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — `vaultClassify.test.ts` 5/5 proves a user-set value survives reclassification byte-unchanged and an invalid model value never persists) |
| VALT-13 | Phase 15.3 | **Pending — the one open Phase 15.3 requirement.** Code is offline-green (`importDriveFolder` checks scope before refresh, reserves before bytes, diffs on `driveFileId + modifiedTime`), but no real Drive file has ever traversed `exportOne → landFile → fan-in → member ingest → digest` and this rail has spent $0. Closes on owner live gates H1 (populated folder) and H2 (real Shared Drive) — `15.3-VERIFICATION.md` |
| VALT-14 | Phase 15.3 | Complete (2026-08-10; `15.3-VERIFICATION.md` VERIFIED — `readVaultPage` stops on rows OR byte budget, list results project away `text`, folder completion is O(1); 50-member and 120-member cases covered) |
| VALT-15 | Phase 20.1 | Pending |
| VALT-16 | Phase 15.4 | Complete |
| VOIC-01 | Phase 6 | Complete (client shipped 06-06: /dashboard/voice WebRTC hook + pre-flight + live surface w/ End button + text fallback; typecheck-verified; live audio round-trip / barge-in at phase-gate human-verify) |
| VOIC-02 | Phase 6 | Complete (server engine unit-verified 06-05: watchdog cap + clean/abnormal CAS + fail-closed metering; live 15:00 hangup at phase-gate human-verify) |
| VOIC-03 | Phase 6 | Complete (server engine unit-verified 06-05: brief → vault ingest, refs-only session audit; live round-trip at phase-gate human-verify) |
| VOIC-04 | Phase 6 | Complete |
| IMPR-01 | Phase 8 | Complete |
| IMPR-02 | Phase 8 | Complete |
| IMPR-03 | Phase 8 | Complete |
| EVAL-01 | Phase 3.6 | Complete |
| EVAL-02 | Phase 3.6 | Complete |
| OPSG-01 | Phase 2 | Complete |
| OPSG-02 | Phase 1 | Complete |
| OPSG-03 | Phase 7 | Complete |
| OPSG-04 | Phase 1 | Complete |
| OPSG-05 | Phase 7 | Complete |
| OPSG-06 | Phase 2 | Complete |
| OPSG-07 | Phase 2 | Complete |
| DISC-01 | Phase 1 | Complete |
| DISC-02 | Phase 1 | Complete |
| BETA-01 | Phase 25 | Pending |
| BETA-02 | Phase 25 | Pending |
| BETA-03 | Phase 25 | Pending |
| BETA-04 | Phase 2 | Complete |
| VGND-01 | Phase 10 | Complete |
| ONBD-01 | Phase 11 | Complete |
| ONBD-02 | Phase 11 | Complete |
| BEVL-01 | Phase 12 | Complete |
| BEVL-02 | Phase 12 | Complete |
| BEVL-03 | Phase 13 | Complete |
| DOCV-01 | Phase 14 | Complete (2026-07-26; owner live-verified a real grounded call and both governed outcome paths; honest no-gap behavior is code/test-enforced. Tool-declaration branch and retrieval latency remain explicitly unmeasured observations, not requirement blockers) |
| BLPR-01 | Phase 17.1 | Complete |
| BLPR-02 | Phase 17.1 | Complete |
| DISP-01 | Phase 15 | Complete (seams 15-01; registry + loop seam 15-02; governed dispatcher — depth cap, cycle refusal, shared envelope, refs-only lineage, SC#5 isolation — 15-03; "Act on this" runs the specialist onto the single Approve gate 15-04; action-type dispatcher 15-05; runnable specialist bodies + multi-pin eval gate 15-06. CAVEAT: the 15-06 body rewrite's eval gate is UNPAID — the candidates are parked and the ACTIVE v1 bodies stay live, so a dispatched specialist still runs the OLD body until the owner runs the gate) |
| ACTN-01 | Phase 15 | Complete (closed action-type union + `actionTypeOf` landed 15-01; 15-05 generalized `executePlan` into an exhaustive `armFor(actionTypeOf(plan.kind))` switch with an `assertNever` backstop, retiring 12-05's ad-hoc `kind === "memo"` branch. `deliverApprovedPlan.ts` is byte-unchanged — the gmail terminal was generalized around, not widened) |
| DISP-02 | Phase 16 | Complete (2026-08-08; unfiltered gate `14feb4b7` 34/34, re-confirmed by `d17039a8`; `research-specialist@8` evidence recorded and activated, with end-to-end `subagent.completed` / `research.persisted` audit evidence) |
| ACTN-03 | Phase 16 | Complete |
| ACTN-02 | Phase 17 | Pending — `17-VERIFICATION.md` `gaps_found`. The Google availability read and plan-gated create are implemented and live-checkable; **"schedule and manage"** and **"(Google / Microsoft)"** are both unmet. Closes via plans 17-06…17-11 (management ops, then the Microsoft adapter), not via the H1-H3 live gates |
| ACTN-04 | Phase 18 | Pending |
| ACTN-05 | Phase 19 | Complete (2026-08-10) |
| MEDIA-01 | Phase 20 (+ Phase 20.2 Scene Timeline, registered 2026-08-14) | Pending — Phase 20 has 20-11/20-12 unexecuted and `20-VALIDATION.md` is `in_progress` with the owner-run fal/render gate unpaid; Phase 20.2 replaces the uniform block deck with the scene timeline and is part-executed (20.2-01…06) but still `status: proposed` |
| SKILL-01 | Phase 21 | Complete (2026-08-18) - proven live end to end: authored candidate `qx73bwsh...` (`offer-architect` v12, tenant `kn790hj6...`, author=user) left `candidate` ONLY through the passing eval `de976d8e` recorded on the row; owner activation made it current-effective; rollback to the exact baseline `qx73cg6g...` v1 worked with NO eval; a real non-owner (`kn735m0c...`, admitted through the BETA-01 invite door) got `OWNER_REQUIRED` with zero state change and could see neither the candidate nor its body nor the pinned prompt. **Recorded limit:** tenant RUNTIME attribution - which registry row a specialist run actually used - was NOT observed. The author tenant is a synthetic e2e row with no recoverable password, the only existing attribution rows belong to the harness tenants `eval-de976d8e`/`eval-a88a4597`, and a fresh specialist turn is a paid model call. See `21-LIVE-PARTIAL-2026-08-18.md` |
| GOVN-01 | Phase 22 | Complete (2026-08-16) — `22-VERIFICATION.md` `status: passed`, GOVN-01 row SATISFIED. All three Phase-8 functions are owner-wrapped at source: `setOptimizerEnabled` (`optimizerConfig.ts:93`), `activateCandidate` (`skills.ts:371`), `candidatesForReview` (`skills.ts:391`). The `/ops` presentation half closed at `29103e9` via `opsPresentation.test.ts` — React component/mount evidence across exact-owner/false/null/loading, **not** a live-DOM or browser observation; `22-VERIFICATION.md` records that limit itself |
| SKILL-02 | Phase 23 | Pending |
| GOVN-02 | Phase 24 | Pending |
| GOVN-03 | Phase 22.1 | Complete (2026-08-16) — export `22.1-04`, erasure `22.1-05`, both live-proven on production SHA `1ca7c6f`. Erasure request `a73023088f58ea6e`: 1,538 rows across 24 tables removed, `audit:countAudit` still **304** for that tenant — the §3 audit-immutability invariant proven on real data, not fixtures. **SCOPE NOTE, read before reopening:** the clause "disconnection WITH revocation at the provider" is met by IMPLEMENTATION for Google (`status: 200`) and by HONEST DISCLOSURE for Microsoft. Microsoft offers no per-application revocation an app can call for its own grant — `DELETE /oauth2PermissionGrants/{id}` needs admin-consent permissions we refuse to hold, and `revokeSignInSessions` would revoke every application's tokens. Both are deliberately declined; the policy and the erasure card state the limit and link Microsoft's own consent surface. The requirement's own test is "the policy is the specification, not the marketing", and the policy now describes exactly what happens. **Plan 25-06 Task 2 owns any change to that posture.** Not verified: the post-erasure re-export (the `users` row is deleted last, so the account cannot authenticate afterwards) |
| BETA-05 | Phase 25 | Pending |
| DASH-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26-01..26-06 (`requirements-completed: [DASH-01]`), 21/21 closed, deployed 2026-08-23 |
| APRV-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26 summaries claim it (`requirements-completed: [APRV-01]`), deployed 2026-08-23 |
| FIN-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26 summaries claim it (`requirements-completed: [FIN-01]`), deployed 2026-08-23 |
| CONT-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26-11/12/13 (`requirements: [CONT-01]`, as amended — sent mail moved to RPRT-01) |
| RPRT-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26-14/15/16 (`requirements: [RPRT-01]`), deployed 2026-08-23 |
| PIPE-01 | Phase 19 (consumed by Phase 26 nav/integration gate) | Complete (2026-08-10) |
| HOME-01 | Phase 26 | Complete (2026-09-06, Phase 37 repair) — 26 summaries claim it (`[HOME-01 backend]`, `[HOME-01]`), deployed 2026-08-23 |
| PACK-01 | Phase 27 | Complete (2026-09-06, Phase 37 repair) — 27 summaries (`requirements-completed: [PACK-01, …]`), 9/9 closed; live on dev, candidate on prod |
| PACK-02 | Phase 27 | Complete (2026-09-06, Phase 37 repair) — 27 summaries (`[PACK-02, PACK-03]`), 9/9 closed |
| PACK-03 | Phase 27 | Complete (2026-09-06, Phase 37 repair) — 27 summaries (`[PACK-02, PACK-03]`), 9/9 closed |
| PACK-04 | Phase 27 | Complete (2026-09-06, Phase 37 repair) — 27 summaries (`[PACK-04]`), 9/9 closed |
| BILL-01 | Phase 28.1 | Pending |
| BILL-02 | Phase 28.1 | Pending |
| BILL-03 | Phase 28.1 | Pending |
| BILL-04 | Phase 28.1 | Pending |
| BILL-05 | Phase 28.1 | Pending |
| BILL-06 | Phase 28.1 | Pending |
| REVN-01 | Phase 28 | Pending |
| REVN-02 | Phase 28 | Pending |
| REVN-03 | Phase 28 | Pending |
| REVN-04 | Phase 28 | Pending |
| REVN-05 | Phase 28 | Pending |
| REVN-06 | Phase 28 | Pending |
| KNOW-01 | Phase 29 | Complete (2026-09-06, Phase 37 repair) — 29 summaries (`[KNOW-01]`), 29-VERIFICATION present |
| ROUT-01 | Phase 29 | Complete (2026-09-06, Phase 37 repair) — 29 summaries (`[ROUT-01]`), 29-VERIFICATION present |
| ROUT-02 | Phase 29 | Pending |
| RSCH-01 | Phase 39 | Complete (2026-09-06) — 39-01-SUMMARY: readPage tool + containment tests, eval gate 46/46 on research-specialist@10 with readPage ×20 observed, footer + labels + staleness shipped |
| DOC-01 | Phase 40 | Complete (2026-09-06) — 40-01/02/03 summaries: `vaultSheets` grid at ingest + SheetGrid in the vault preview, `.xlsx` on both planes through `spreadsheet-drafter` (v1, ungated) with bytes read back as a workbook in test, inline PDF in OutputCard under the restated URL rule, ADR-036 accepted |
| VERT-01 | Phase 30 | Pending |
| VERT-02 | Phase 30 | Pending |
| VERT-03 | Phase 30 | Pending |
| VERT-04 | Phase 30 | Pending |
| MKTG-01 | Phase 31 | Pending |
| MKTG-02 | Phase 31 | Pending |
| MKTG-03 | Phase 31 | Pending |
| MKTG-04 | Phase 32 | **BLOCKED** (legal entity) |
| MKTG-05 | Phase 32 | **BLOCKED** (legal entity) |
| MKTG-06 | Phase 32 | **BLOCKED** (legal entity) |

**Marketing coverage (minted 2026-08-07, pulled pre-beta per ADR-015):**
- Requirements: **6 total** (MKTG-01..06)
- Mapped to phases 31-32: 6
- Unmapped: 0 ✓
- Of these, **3 are externally blocked** on a non-code prerequisite that has not started.

**Coverage:**
- v1 requirements: **49 total** (history: header originally said "36"; corrected to the actual 40 distinct IDs during roadmap creation; +3 CKPT IDs minted 2026-07-12 for cockpit slices 2–4 — count discrepancy CLOSED; +1 SCHD-01 minted 2026-07-12 for deferred send; +2 EVAL IDs minted 2026-07-14 for the agent eval gate, Phase 3.6; +1 CKPT-04 minted 2026-07-14 for inbox briefing, Phase 3.7; +1 CKPT-05 minted 2026-07-17 for agent activity streaming, Phase 3.9; +1 RPLY-01 minted 2026-07-19 for inbox reply, Phase 3.11)
- Mapped to phases: 49
- Unmapped: 0 ✓

**v2.0 coverage (milestone v2.0 - Platform -> Private Beta, mapped 2026-07-24):**
- v2.0 requirements: **27 total** - 23 new (VGND-01; ONBD-01/02; BEVL-01/02/03; DOCV-01; BLPR-01/02; DISP-01/02; ACTN-01/02/03/04/05; MEDIA-01; SKILL-01/02; GOVN-01/02/03; BETA-05) + 4 carried-in (BETA-01, BETA-02, BETA-03, DLVR-02, repointed from the superseded Phase 9 to Phase 25). GOVN-03 minted 2026-08-01 for Phase 22.1, which until then carried no requirement id at all.
- Mapped to phases 10-25: 27
- Unmapped: 0 ✓
- Each v2.0 requirement maps to exactly one phase; no orphans, no duplicates.

**Post-beta knowledge-work pack coverage (planned 2026-08-05):**
- Requirements: **17 total** (PACK-01..04; REVN-01..06; KNOW-01; ROUT-01..02; VERT-01..04)
- Mapped to phases 27-30: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-09*
*Last updated: 2026-07-19 — re-baselined: REVW-01 redefined to plan-level approval; CKPT-01..03 minted (Email Cockpit); count 40→43; SCHD-01 minted (deferred send, Phase 3.5); count 43→44; EVAL-01/02 minted (agent eval gate, Phase 3.6, 2026-07-14), count 44→46; CKPT-04 minted (inbox briefing, Phase 3.7, 2026-07-14), count 46→47; CKPT-05 minted (agent activity streaming, Phase 3.9, 2026-07-17), count 47→48; RPLY-01 minted (inbox reply, Phase 3.11, 2026-07-19), count 48→49*
