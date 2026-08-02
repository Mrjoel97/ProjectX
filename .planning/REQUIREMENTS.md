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
- [ ] **DLVR-02**: Approved responses can be delivered via Microsoft Graph (Outlook) through the same adapter
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
- [ ] **VALT-05**: User can upload a company folder as a unit (up to 1.5 GB total, 200 MB per file) and the vault tracks it as one thing
- [ ] **VALT-06**: A folder's cost is estimated and the whole folder is reserved before the first paid call, or the folder is refused intact with its estimate, remaining budget and shortfall named
- [ ] **VALT-07**: A folder's documents are excluded from retrieval until the folder completes
- [ ] **VALT-08**: A folder completes with an honest manifest of what failed and why, and the digest states what it could not read
- [ ] **VALT-09**: A folder-level digest is synthesised as a vault document that embeds, retrieves and grounds through the existing rails
- [ ] **VALT-10**: Digest staleness is surfaced with a one-click rebuild, and no model call fires until the user asks
- [ ] **VALT-11**: User can drill into a folder and browse its documents rather than one flat grid
- [ ] **VALT-12**: Documents carry a machine-derived type and identity line that the user can correct, and a user correction is never overwritten
- [ ] **VALT-13**: User can import a Google Drive folder once and re-import on demand, bounded by the same budget rail
- [ ] **VALT-14**: The vault read surfaces remain within Convex's per-transaction read cap at folder-scale document counts

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

- [ ] **BETA-01**: New users can sign up only with a valid invite code (Convex Auth)
- [ ] **BETA-02**: All data — requests, vault, cache, audit, telemetry — is isolated per user across every table and index
- [ ] **BETA-03**: A new user reaches their first delivered result within minutes via a guided conversational onboarding
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
- [ ] **DOCV-01**: The user can upload a report, have it ingested and understood in the vault, discuss it by voice with the grounded agent, and receive surfaced insights/patterns/gaps plus a memo or gap-bridging plan — with an honest "no gaps" outcome and the user deciding after the discussion
- [x] **BLPR-01**: A single cited business blueprint is synthesized from the user's typed profile, their vault documents, and the extracted entity graph. Typed values are AUTHORITATIVE and are never overwritten by derivation; derived claims carry a source citation and require explicit user confirmation before reaching any agent. Both entry routes (typing and uploading) remain permanent and compose — a one-line profile edit costs no model call and no confirmation step
- [x] **BLPR-02**: The confirmed blueprint is standing context for the agent — present on EVERY cockpit turn via the turn prompt (not only on turns that search the vault), and available to the two grounding-driven callers (`evaluations.ts`, `voiceDoc.ts`) via an explicit `spine` field. It distinguishes user-stated from system-derived claims, carries its own staleness signal when documents are unincorporated, and — when the user rebuilds — proposes a reviewable diff rather than ever silently changing. *(Scope note 2026-07-27: unincorporated-document DETECTION is automatic and free; the rebuild is user-triggered. Automatic triggering is deferred until a bulk-ingest completion event exists — see Phase 17.1 context.)*

### S2 — Breadth of Action

- [x] **DISP-01**: Real sub-agent dispatch — specialized sub-agents are swappable (skill body, tool-set) pairs run by the single governed loop, with a depth cap, a shared root cost budget, cycle refusal, and recorded lineage (no nested loops, no agents-spawning-agents)
- [x] **ACTN-01**: A generalized governed action executor lets an approved plan execute actions beyond `gmail.send` (the approve→execute spine becomes action-agnostic)
- [ ] **DISP-02**: A first exemplar specialist sub-agent (Research) is dispatched through DISP-01
- [ ] **ACTN-02**: The agent can schedule and manage calendar events (Google / Microsoft) as governed actions
- [ ] **ACTN-03**: The agent can perform web research through a grounded, injection/SSRF-hardened tool, storing findings in the vault
- [ ] **ACTN-04**: The agent can create standalone documents/content artifacts (beyond email attachments)
- [ ] **ACTN-05**: The agent can track contacts / CRM state and follow-ups scoped to the user

### S3 — Creation & Self-Extension

- [ ] **MEDIA-01**: A media-creation canvas produces images and video — a finished short-form reel assembled from clips of ≤15 s each, capped at 60 s by BUDGET rather than by capability — via a server-to-server provider API (fal.ai) behind a deployment secret, as async governed jobs with a separate capped budget; generation is wrapped, not rebuilt. **Corrected 2026-08-03 (plan 20-11).** The original wording carried two premises the Phase-20 spike refuted: no model generates 3 minutes (the ceiling is 15 s across 28 models from eight labs), and the Pikar-Ai MCP is a claude.ai CLIENT-side account connector, structurally unreachable from a Convex action (ADR-011). The re-scope then PARTLY UN-REFUTED the first: a 12-block reel IS two minutes and is refused only by `MEDIA_JOB_CAP_USD`, not by the models (ADR-012). So the honest line is neither the original nor a flat "5 or 10 seconds"
- [ ] **SKILL-01**: The user can author skills adapted to their business through the eval-gated skills registry
- [ ] **SKILL-02**: The agent can author skills as candidates only — structurally unable to self-activate; activation requires the eval gate plus owner approval

### S4 — Governance & Open the Beta

- [ ] **GOVN-01**: A `requireOwner` primitive gates the three Phase-8 functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) and the admin surface so non-owners cannot reach them — pulled early, since it gates S3 agent-authored skills and S4 multi-user
- [ ] **GOVN-02**: An ISO 9001:2015 QMS conformance foundation maps the existing audit / skill-versioning / GSD-playbook change-control to the relevant clauses and fills the gaps — a conformance map, not process theater
- [ ] **GOVN-03**: Every user-exercisable data and connection control the published privacy policy promises actually exists in the product and does what the policy says — the policy is the specification, not the marketing. Covers in-app disconnection of a connected account WITH revocation at the provider (not merely a local token delete), and tenant data deletion and export. Minted 2026-08-01 after `apps/web/app/privacy/page.tsx:312` was found promising an in-app Google disconnect that had no implementation anywhere in the repo.
- [x] **BETA-05**: Cross-tenant isolation assertions are written as each new surface ships (S1–S3), culminating in a two-user test covering every new table and index

*(S4 also consumes the carried-in BETA-01 invite/waitlist, BETA-02 isolation, BETA-03 fast onboarding, and DLVR-02 Outlook — the productionization detailed in `09-CONTEXT.md`, executed as the milestone's final phase.)*

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
| VALT-05 | Phase 15.3 | Pending |
| VALT-06 | Phase 15.3 | Pending |
| VALT-07 | Phase 15.3 | Pending |
| VALT-08 | Phase 15.3 | Pending |
| VALT-09 | Phase 15.3 | Pending |
| VALT-10 | Phase 15.3 | Pending |
| VALT-11 | Phase 15.3 | Pending |
| VALT-12 | Phase 15.3 | Pending |
| VALT-13 | Phase 15.3 | Pending |
| VALT-14 | Phase 15.3 | Pending |
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
| DOCV-01 | Phase 14 | Pending |
| BLPR-01 | Phase 17.1 | Complete |
| BLPR-02 | Phase 17.1 | Complete |
| DISP-01 | Phase 15 | Complete (seams 15-01; registry + loop seam 15-02; governed dispatcher — depth cap, cycle refusal, shared envelope, refs-only lineage, SC#5 isolation — 15-03; "Act on this" runs the specialist onto the single Approve gate 15-04; action-type dispatcher 15-05; runnable specialist bodies + multi-pin eval gate 15-06. CAVEAT: the 15-06 body rewrite's eval gate is UNPAID — the candidates are parked and the ACTIVE v1 bodies stay live, so a dispatched specialist still runs the OLD body until the owner runs the gate) |
| ACTN-01 | Phase 15 | Complete (closed action-type union + `actionTypeOf` landed 15-01; 15-05 generalized `executePlan` into an exhaustive `armFor(actionTypeOf(plan.kind))` switch with an `assertNever` backstop, retiring 12-05's ad-hoc `kind === "memo"` branch. `deliverApprovedPlan.ts` is byte-unchanged — the gmail terminal was generalized around, not widened) |
| DISP-02 | Phase 16 | Pending |
| ACTN-03 | Phase 16 | Pending |
| ACTN-02 | Phase 17 | Pending |
| ACTN-04 | Phase 18 | Pending |
| ACTN-05 | Phase 19 | Pending |
| MEDIA-01 | Phase 20 | Pending |
| SKILL-01 | Phase 21 | Pending |
| GOVN-01 | Phase 22 | Pending |
| SKILL-02 | Phase 23 | Pending |
| GOVN-02 | Phase 24 | Pending |
| GOVN-03 | Phase 22.1 | Pending |
| BETA-05 | Phase 25 | Complete |

**Coverage:**
- v1 requirements: **49 total** (history: header originally said "36"; corrected to the actual 40 distinct IDs during roadmap creation; +3 CKPT IDs minted 2026-07-12 for cockpit slices 2–4 — count discrepancy CLOSED; +1 SCHD-01 minted 2026-07-12 for deferred send; +2 EVAL IDs minted 2026-07-14 for the agent eval gate, Phase 3.6; +1 CKPT-04 minted 2026-07-14 for inbox briefing, Phase 3.7; +1 CKPT-05 minted 2026-07-17 for agent activity streaming, Phase 3.9; +1 RPLY-01 minted 2026-07-19 for inbox reply, Phase 3.11)
- Mapped to phases: 49
- Unmapped: 0 ✓

**v2.0 coverage (milestone v2.0 - Platform -> Private Beta, mapped 2026-07-24):**
- v2.0 requirements: **27 total** - 23 new (VGND-01; ONBD-01/02; BEVL-01/02/03; DOCV-01; BLPR-01/02; DISP-01/02; ACTN-01/02/03/04/05; MEDIA-01; SKILL-01/02; GOVN-01/02/03; BETA-05) + 4 carried-in (BETA-01, BETA-02, BETA-03, DLVR-02, repointed from the superseded Phase 9 to Phase 25). GOVN-03 minted 2026-08-01 for Phase 22.1, which until then carried no requirement id at all.
- Mapped to phases 10-25: 27
- Unmapped: 0 ✓
- Each v2.0 requirement maps to exactly one phase; no orphans, no duplicates.

---
*Requirements defined: 2026-07-09*
*Last updated: 2026-07-19 — re-baselined: REVW-01 redefined to plan-level approval; CKPT-01..03 minted (Email Cockpit); count 40→43; SCHD-01 minted (deferred send, Phase 3.5); count 43→44; EVAL-01/02 minted (agent eval gate, Phase 3.6, 2026-07-14), count 44→46; CKPT-04 minted (inbox briefing, Phase 3.7, 2026-07-14), count 46→47; CKPT-05 minted (agent activity streaming, Phase 3.9, 2026-07-17), count 47→48; RPLY-01 minted (inbox reply, Phase 3.11, 2026-07-19), count 48→49*
