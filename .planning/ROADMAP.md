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
- [ ] **Phase 3.3: Attachment Generation** (INSERTED) - Agent generates a document and attaches it to an outgoing email
- [ ] **Phase 3.4: Per-Recipient Personalization** (INSERTED) - Tailored wording per recipient in a multi-recipient send (beyond slice-1 same-content)
- [ ] **Phase 3.5: Deferred Send** (INSERTED) - "Send this at 4 AM": a plan carries a future send time, shown absolute on the PLAN card before the single Approve; execution scheduled through the same governed fan-out, cancellable until it fires (recurring sends stay out of v1 â `.planning/design/scheduled-send.md`)
- [ ] **Phase 4: Attachment & Voice-Dictation Intake** - Attachments classified/OCR'd/transcribed and voice dictation, both into the pipeline
- [ ] **Phase 5: Knowledge Vault & GraphRAG** - Briefs/docs stored, embedded, graph-extracted, and grounded via hybrid retrieval per user
- [ ] **Phase 6: Live Voice Sessions** - 15-min bidirectional voice with server watchdog â durable brief â optional executable plan
- [ ] **Phase 7: Resilience & Operations Hardening** - Timeouts, retry escalation, notifications, dead-letter completeness, WORM archival export
- [ ] **Phase 8: Self-Improvement** - Feedback capture â eval-gated autonomous prompt optimization with versioning + rollback + kill switch
- [ ] **Phase 9: Private Beta Productionization** - Invite-only signup, verified per-user isolation, guided onboarding, Microsoft Graph as second provider

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
- [ ] 03.3-06-PLAN.md — smoke:fanout/guardrails + cockpit-attachment E2E + human-verify + playbook close (Wave 4)

### Phase 3.4: Per-Recipient Personalization (INSERTED)
**Goal**: A multi-recipient send can tailor wording per recipient, moving beyond slice-1 same-content-to-all while keeping the single plan-approval gate.
**Depends on**: Phase 3.1 (multi-recipient fan-out); Phase 3.2 (inbox context strengthens personalization)
**Requirements**: CKPT-03 (minted 2026-07-12)
**Success Criteria** (what must be TRUE):
  1. For a multi-recipient plan, each recipient can receive individually tailored wording, shown per recipient on the PLAN card before the single Approve.
  2. Personalized content passes the same PII/cost/review guardrails and per-recipient audit/telemetry as same-content sends.
**Plans**: TBD

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
**Plans**: TBD

### Phase 4: Attachment & Voice-Dictation Intake
**Goal**: Users can enrich requests with files and speak requests aloud, both flowing through the same governed pipeline â grouped because dictation reuses the attachment audio-transcription path and Python sidecar.
**Depends on**: Phase 2 (pipeline); guardrails from Phase 3 apply to enriched context
**Requirements**: INTK-02, INTK-03
**Success Criteria** (what must be TRUE):
  1. User attaches an image, PDF, audio, or document and the system classifies it and OCRs/extracts/transcribes it, merging the result into the request context.
  2. User dictates a request by voice; it is recorded, transcribed, and enters the same pipeline as a typed request.
  3. A delivered result reflects content that originated from an attachment or a dictated recording, having passed the same PII/cost/review guardrails.
**Plans**: TBD

### Phase 5: Knowledge Vault & GraphRAG
**Goal**: The system remembers â briefs and documents become groundable, searchable memory scoped to each user via hybrid vector + graph retrieval.
**Depends on**: Phase 4 (extraction feeds ingestion); Phase 2 (pipeline grounding step)
**Requirements**: VALT-01, VALT-02, VALT-03, VALT-04
**Success Criteria** (what must be TRUE):
  1. Briefs and documents are stored and embedded (`text-embedding-3-small` @1536, under Convex's 2048-dim cap) and appear in the user's vault.
  2. Graphify extracts entities/relationships from vault content at ingestion; the resulting nodes/edges are stored and queryable in Convex `graphNodes`/`graphEdges` tables.
  3. A request is grounded using hybrid retrieval â vector similarity plus hop-capped graph traversal â scoped to only the requesting user's data.
  4. User can browse and search their own vault contents.
**Plans**: TBD

### Phase 6: Live Voice Sessions
**Goal**: Users can hold a live strategy conversation with the Executive Agent that safely becomes a durable brief and, optionally, an executable plan â the product's identity feature, isolated from the durable pipeline and cost-metered.
**Depends on**: Phase 5 (briefs land in the vault); Phase 4 (transcription)
**Requirements**: VOIC-01, VOIC-02, VOIC-03, VOIC-04
**Success Criteria** (what must be TRUE):
  1. User holds a live bidirectional voice conversation with the Executive Agent (WebRTC, browser-direct) and can end it with an End-session button.
  2. A server-side watchdog hard-caps every session at 15 minutes and terminates cleanly even if the tab closes or the network drops, with per-session token metering to prevent cost blowout.
  3. An ended session (clean or abnormal) produces a detailed structured markdown brief that is stored and indexed in the knowledge vault.
  4. At session end the agent asks permission to convert the brief into a step-by-step plan; an approved plan enters the normal request pipeline with the review gate.
**Plans**: TBD

### Phase 7: Resilience & Operations Hardening
**Goal**: Every failure path â agent/review timeouts, retry-threshold breaches, dead-letters â is caught, notified, escalated, and archived immutably.
**Depends on**: Phase 6 (hardens error paths across all prior feature phases)
**Requirements**: AGNT-04, REVW-02, REVW-03, OPSG-03, OPSG-05
**Success Criteria** (what must be TRUE):
  1. Edit and reject retry counters enforce thresholds; a breach escalates, notifies, and terminates the request safely.
  2. A review-inactivity timeout and an Executive Agent timeout each fire an escalation notification (via the scheduled-event race on the review gate).
  3. Notifications fire for validation rejection, escalations, retry-limit breaches, timeouts, and dead-letter events.
  4. Completed request trails export on schedule to immutable (WORM) archival storage, and the hot audit copy is swept per the retention policy.
**Plans**: TBD

### Phase 8: Self-Improvement
**Goal**: The system learns from real feedback and improves its own skills (versioned agent skill documents, optimized via the SkillOpt sidecar's held-out-validation loop â see research/SKILLOPT.md) under automated evaluation guardrails with instant rollback â sequenced last because the loop is meaningless until review/feedback data has accumulated.
**Depends on**: Phase 7 (needs delivered-response feedback and a stable pipeline)
**Requirements**: IMPR-01, IMPR-02, IMPR-03
**Success Criteria** (what must be TRUE):
  1. User can rate and comment on delivered responses, and the feedback is captured against the originating request.
  2. A feedback threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks (held-out set the optimizer never sees), with a one-click rollback and a kill switch.
  3. Prompts are versioned; every optimization records the before/after versions and the triggering evidence.
**Plans**: TBD

### Phase 9: Private Beta Productionization
**Goal**: Invited users beyond the owner can sign up, stay fully isolated from each other, onboard fast to a first delivered result, and deliver via either email provider â the week-4 definition of "production" (not billing/public launch).
**Depends on**: Phase 8
**Requirements**: BETA-01, BETA-02, BETA-03, DLVR-02
**Success Criteria** (what must be TRUE):
  1. A new user can sign up only with a valid invite code (Convex Auth + `betaInvites`).
  2. User A cannot read User B's requests, vault, cache, audit, or telemetry â isolation holds across every table and index, verified by an explicit cross-user test.
  3. A new user reaches their first delivered result within minutes via a guided conversational onboarding.
  4. An approved response can be delivered via Microsoft Graph (Outlook) through the same provider-agnostic adapter that already serves Gmail (delegated `Mail.Send`, built only after Gmail works end-to-end).
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 â 2 â 3 â 3.1 â 3.2 â 3.3 â 3.4 â 4 â 5 â 6 â 7 â 8 â 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Governance Substrate | 7/9 | In progress | - |
| 2. Thin End-to-End Slice | 7/9 (+2 superseded by 3.1) | Spine complete; UI superseded | 2026-07-12 |
| 3. Guardrails | 0/5 | Planned | - |
| 3.1 Cockpit Core (INSERTED) | 8/9 | In Progress (Waves 1â4 done; Wave 5 E2E + human checkpoint next) | 2026-07-12 |
| 3.2 Inbox Reading (INSERTED) | 6/6 | Complete | 2026-07-12 |
| 3.2.1 Agent-Driven Cockpit (INSERTED) | 6/6 | Complete (goal-verified + human-verified) | 2026-07-13 |
| 3.3 Attachment Generation (INSERTED) | 5/6 | In Progress | - |
| 3.4 Per-Recipient Personalization (INSERTED) | 0/TBD | Not started | - |
| 4. Attachment & Voice-Dictation Intake | 0/TBD | Not started | - |
| 5. Knowledge Vault & GraphRAG | 0/TBD | Not started | - |
| 6. Live Voice Sessions | 0/TBD | Not started | - |
| 7. Resilience & Operations Hardening | 0/TBD | Not started | - |
| 8. Self-Improvement | 0/TBD | Not started | - |
| 9. Private Beta Productionization | 0/TBD | Not started | - |
