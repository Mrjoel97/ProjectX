# Phase 2: Thin End-to-End Slice - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A typed goal travels the full spine and comes out as a real email: submit (text +
optional attachments) → Executive Agent routes and plans → durable review gate
(approve/edit/regenerate/reject) → Gmail delivery — with per-request telemetry, a
full audit trail, live-updating UI, and dead-letter failures surfaced to the operator.

Phase 2 also builds the **Gmail OAuth connect flow** (the code half of deferred plan
01-09) and the **sign-in UI**, because neither exists and nothing in this phase works
without them.

**Requirements:** INTK-01, INTK-04, AGNT-01, AGNT-02, AGNT-03, REVW-01, DLVR-01,
DLVR-03, OPSG-01, OPSG-06, OPSG-07, BETA-04

**Not in this phase:** attachment *content* processing (INTK-02, Phase 4), PII
redaction (GRDL-01, Phase 3), LLM fallback + cache + cost guardrails (GRDL-03/04/05,
Phase 3), rate limiting and kill-switch (GRDL-06, Phase 3), retry thresholds and the
full notification matrix (REVW-02, OPSG-05, Phase 7), Microsoft Graph delivery
(DLVR-02, Phase 9), OAuth verification submission and public deploy (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### Review gate — granularity and semantics

- **One collapsed gate**, not two. Phase 2's plan has exactly one actionable step, so
  plan-approval and response-approval are the same moment. The gate displays the
  routing decision, the step plan, the recipient, and the drafted email together.
  Multi-step plans in later phases split this naturally.
- **Decision union:** `approve | edit_text | regenerate | reject`. This replaces the
  untyped `decision: v.string()` currently in `convex/review.ts:63`.
  - `edit_text` — user edits subject/body inline; the edited text is sent verbatim.
    No second LLM call.
  - `regenerate` — user supplies a free-text instruction; the draft is regenerated and
    the gate re-arms. This is the only decision that loops.
  - `reject` — terminates the request. Captures an **optional free-text reason**
    (stored on the request row, hashed into audit). Rationale: IMPR-03 requires
    "triggering evidence" for the Phase 8 optimization loop, and a rejection reason is
    the highest-signal evidence available. It cannot be collected retroactively.
- **`regenerate` is hard-capped** at a small constant (`MAX_REGENERATE = 3`). On breach
  the gate stops offering regenerate; approve/edit/reject remain. No counter table.
  Mark with `ponytail:` naming Phase 7's REVW-02 (real thresholds + escalation) as the
  upgrade path.
- **The step plan is read-only** at the gate. AGNT-02 requires the user *sees* the plan;
  editing it is meaningless when it has one actionable step.
- **Review timeout: 7 days.** On fire → status `expired`, audit event, **no delivery**.
  Silence never becomes consent. Chosen to match the Gmail refresh-token expiry so a
  request cannot outlive the token that would deliver it. Phase 7's REVW-03 adds the
  escalation notification on top without changing this behavior.
- **Do not dead-letter a timeout.** A timeout is an expected outcome, not a failure.
  Polluting the DLQ with non-bugs dulls the signal OPSG-07 exists to sharpen.
- **Concurrency: unbounded.** Each request is its own durable workflow with its own
  correlationId. Bounding it costs code and would make the review queue permanently
  length 1, undercutting BETA-04's live-list demonstration.

### Review queue and status model

- **The review queue is a real list**, backed by a reactive `useQuery` over `requests`
  filtered to `status = "awaiting_review"` — not a single-request takeover screen. A
  list is what actually demonstrates BETA-04's live subscription.
- **Explicit status union**, one value per observable stage:
  `submitted → routing → drafting → awaiting_review → approved → delivering → sent`
  Terminals: `rejected`, `expired`, `failed`. Plus the hold state `awaiting_reauth`.
  Rationale: BETA-04 promises the user watches pipeline status change live — you cannot
  animate a status that does not exist.
- **The terminal success state is `sent`, not `delivered`.** Gmail's API confirms it
  accepted the message and returns a message ID; it does not confirm inbox arrival.
  The audit event records the Gmail message ID as a ref. Real delivery/bounce tracking
  is a later phase. (Note: the roadmap's SC-3 says "delivered" — the *behavior* is
  unchanged, only the claim is made honest.)

### Content plane vs log plane (CLAUDE.md §4 boundary)

- **`requests` holds raw content** — the user's goal text, the recipient, the draft and
  edited email body, and the optional reject reason.
- **`audit.payload` and `deadLetters.payload` hold refs, hashes, ids, and counts only** —
  `correlationId`, `contentHash`, `decision`, counters. Never raw text.
- This makes CLAUDE.md §4's boundary explicit and documentable: **one table is the
  content plane; the log plane is hash-only.** The rule is "the audit log must never
  become a PII honeypot," not "no raw content anywhere" — the email body has to exist
  somewhere to be edited and sent.

### Intake, validation, attachments

- **Recipient is an explicit, validated `To:` field on the submit form.** Never
  model-derived. Re-displayed at the review gate before approval. Rationale: sending
  mail is irreversible and outward-facing; a hallucinated address delivers someone's
  business correspondence to a stranger. This is the phase's highest-severity failure
  mode and **it is not named in any requirement** — it was surfaced during discussion.
  Making it structurally impossible beats making it statistically unlikely.
- **INTK-04 rejection criteria** (all checked before any workflow starts; each writes the
  audit event and notifies):
  1. no authenticated identity (`tenantQuery`/`tenantMutation` already throw)
  2. `goal.trim() === ""`
  3. `goal.length > MAX_GOAL_LEN`
  4. attachment mimeType outside the allowlist
  5. attachment size over the cap
  No LLM-based abuse/injection screening — that is EXPN-04 (post-beta).
- **Attachments: stored, metadata-only to the agent.** File → Convex file storage; an
  `attachments` row links it to the request. The agent receives filename, mimeType, and
  size — **never contents**. Phase 4's INTK-02 fills the `extracted` field.
  - Rationale: an uploaded file the agent silently ignores is worse than no upload
    button — the user assumes their PDF informed the draft, and it did not.
  - **The UI says so explicitly:** "Attached. Pikar can't read file contents yet."
    One line of copy; delete it the day Phase 4 ships.
- **Multiple attachments, capped at ~5.** `attachmentRefs` is already plural in
  PROJECT.md's contract list. Modelling it as an array now costs nothing; widening a
  single field later is a migration.
- **Type allowlist + ~10MB cap**, matching what Phase 4 will process: images
  (png/jpg/webp), pdf, audio (mp3/m4a/wav), documents (txt/md/docx). Rejecting an
  unsupported type at upload is validation at a trust boundary.
- **Upload first, then submit with storageIds.** Files upload as the user picks them;
  the submit mutation receives ready storageIds and creates request + attachments +
  workflow atomically. A failed upload is caught before any request exists — no
  orphaned half-requests, nothing to reap.

### Executive Agent — routing and LLM surface

- **Routes:** `direct_llm` (draft an email) and `direct_tool` (send user-supplied text
  without drafting) are implemented. `sub_agent` is a valid enum member with **no
  implementation** → dead-letters with reason `route_not_implemented`. Any unparseable
  or unknown value → dead-letters with `unknown_route`. **No silent default**, per
  AGNT-03. Both DLQ paths are exercised in Phase 2.
- **Routing decision is schema-constrained structured output**, validated by a Zod
  schema in `packages/contracts` (where PROJECT.md already places `routingDecision`).
  A parse failure dead-letters — it is never retried into a default. This puts AGNT-03's
  guarantee in the type system rather than in a comment.
- **The step plan is model-generated**, returned as `steps[]` alongside `route` in the
  same schema. In Phase 2 it will usually read: `1. Draft email  2. Send via Gmail`.
- **Two skill-registry rows**, not one: `executive-router` and `email-drafter`
  (CLAUDE.md §5 — no hardcoded prompts). Rationale: routing and drafting have different
  failure modes and Phase 8's SkillOpt loop optimizes them against different evidence —
  a rejected draft says nothing about whether routing was correct. Merging later is
  easy; unmerging is not.
- **Primary provider: OpenAI, reached through Vercel AI Gateway.** One vendor
  relationship covers Phase 4 transcription (`gpt-4o-transcribe`), Phase 5 embeddings
  (`text-embedding-3-small` @1536), and Phase 6 Realtime voice — so one DPA covers all
  of it. Exact model IDs chosen at implementation time against current docs. Fallback
  is GRDL-05 (Phase 3).
- **Direct AI SDK call inside a workflow step** — *not* `@convex-dev/agent`, despite it
  being installed and registered. Phase 2 makes two stateless calls (route, then draft);
  the Agent component's value is threads, message history, and tool loops, none of which
  exist here. `ponytail:` skipping the component until conversation state exists (Phase
  6 live voice, Phase 8). Avoids stacking a second pre-1.0 API churn surface on Workflow's.
- **Gmail delivery runs as a workflow step wrapped by `retrier`** — already constructed
  in `convex/index.ts:14` and documented there as the "reliable wrapper around external
  (sidecar/LLM/email) fetch calls." Phase 1 built it for exactly this. Transient 5xx
  retries with backoff; terminal failure flows `onComplete` → `deadLetters` → OPSG-07.

### Auth, Gmail OAuth, tokens

- **Sign-in: Google via Convex Auth**, requesting only `openid email profile`. Reuses
  the Google Cloud OAuth client already being created for Gmail — one provider, one
  consent screen, one set of credentials.
- **`gmail.modify` is a separate, later, explicit consent** on a `/connect-gmail` page —
  the incremental-authorization pattern. The restricted scope stays out of the front door.
- **Phase 2 owns the Gmail OAuth *connect flow* (code); Phase 9 keeps *verification*.**
  Splitting deferred plan 01-09: the consent redirect, callback, token storage, refresh,
  and `/connect-gmail` page must exist for SC-3 to be true. Only the verification
  submission — which needs a privacy policy naming a real data controller — is blocked
  on the legal entity. Testing mode (100 users, 7-day refresh expiry) carries Phases 2–8,
  exactly as STATE.md records.
- **Tokens live in a dedicated tenant-scoped `gmailTokens` table.** Read only by internal
  functions. Never returned to a client-facing query, never in the browser, never in an
  audit payload. The UI learns `connected: boolean` and `expiresAt: number` and nothing
  more. These tokens grant restricted-scope mailbox access — they are the crown jewels.
  Deliberately *not* stored on `authAccounts`, whose shape `@convex-dev/auth` (0.0.94,
  beta) controls rather than we do.
- **Phase 2 uses `gmail.modify` for sending only.** Requesting broadly ≠ using broadly.
  Reading and organising the mailbox need their own phase, their own review-gate
  semantics, and their own audit events — and reading pulls third-party personal data
  (STATE.md: "the single most exposed GDPR claim") into the LLM.
- **Token-expiry race, resolved in favor of the user's consent.** A request approved
  after its refresh token died does **not** fail and does **not** re-prompt for approval.
  It enters `awaiting_reauth`; the UI prompts "Reconnect Gmail to send this"; on
  reconnect, delivery resumes from the already-approved draft.
- **DLVR-03 is both proactive and reactive:** a daily cron checks token age and shows a
  "Reconnect Gmail" banner within ~24h of expiry (this is the "before tokens break" the
  requirement asks for), and `awaiting_reauth` is the safety net when the banner is ignored.

### Telemetry, aggregate, migrations

- **One telemetry row per request, written once at terminal state**
  (`sent | rejected | expired | failed`). All OPSG-01 fields present or explicitly null:
  tokens, cost, duration, decision/retry counters (including the regenerate count),
  review outcome. Written *from* the outcome, so it cannot drift from it. No incremental
  patching — that adds OCC contention on a hot row and leaves half-written rows on crash
  that look complete.
- **`@convex-dev/aggregate` indexes `audit` only.** The roadmap's warning is specifically
  that `audit` is append-only and unbounded, so a `.collect()`-based count eventually
  exceeds Convex read limits and **hard-fails rather than degrades**. The `telemetry`
  table is bounded by request count — query it directly. Each tool where its cost model fits.
- **`@convex-dev/migrations`: install the component AND ship one migration that actually
  runs.** Phase 2 only adds tables, so there is nothing to backfill — but an untested
  migration harness discovered during Phase 3's first breaking change is precisely the
  failure OPSG-06 exists to prevent. **A migration that has never run is a migration that
  does not work.** Install before the first schema change, per the roadmap.

### Operator visibility and notifications

- **OPSG-07: an in-app ops page plus a persistent badge.** A reactive `useQuery` over
  `deadLetters where status = "new"`, surfaced as a count badge in the app shell that
  does not clear until resolved. Zero new infrastructure — the same Convex subscription
  primitive BETA-04 already requires, pointed at another table.
  - **Deliberately not email.** A DLQ alert delivered by email depends on the email path,
    and Gmail token expiry is one of the failures it must report. A failure alert that
    cannot send because the mailer broke is the failure nobody sees.
- **Ops page ships "Mark resolved" only; replay is deferred.** `deadLetters.status`
  already declares a `"replayed"` member (Phase 1) but nothing writes it. Replay needs
  idempotency thinking that has not been done — does it re-draft? re-send? A bug there
  sends a real email twice, in the one phase whose entire point is not sending things the
  user did not approve. `ponytail:` unimplemented enum member; add replay once idempotency
  is specified.
- **Ops page is tenant-scoped, not owner-gated.** It shows *your* dead letters via
  `tenantQuery`, like everything else. PROJECT.md: v1 has a single user role; RBAC is
  EXPN-03. A beta user seeing their own failed requests is correct behavior.
- **INTK-04's "notification" in Phase 2 = inline error + a `notifications` table row**
  rendered in-app. Nothing leaves the browser. That table is the seam Phase 7's OPSG-05
  grows into — it adds channels (email, push) reading the same rows.

### Correlation and identifiers

- **`correlationId` is generated server-side** in the submit mutation via
  `crypto.randomUUID()`, stored on the request row, and passed to the workflow.
  **Never client-supplied.** `review:${correlationId}` is an event name that resumes a
  durable workflow — accepting attacker-chosen input there is a trust-boundary failure.
  Also not the Convex `_id`, which would couple the compliance log's correlation key to
  a storage-layer identifier.

### Accepted risks

- **Phase 2 sends unredacted user text to OpenAI.** GRDL-01 (PII scan → `safeText` before
  any external model call) is Phase 3. This is a known, bounded risk: only the owner uses
  Phase 2, no beta users exist until Phase 9, and GRDL-01 lands in Phase 3 — before any
  third party's data flows. **Structure the workflow so a `redact` step slots in ahead of
  the LLM call** rather than being retrofitted through it. `ponytail:` comment at the call
  site naming Phase 3 as the upgrade path. Do not hand-roll a partial regex redactor —
  a redactor that half-works invites trusting it.
- **No rate limiting in Phase 2.** `@convex-dev/rate-limiter` is installed but GRDL-06 is
  Phase 3. Phase 2 has one user; `MAX_REGENERATE` bounds the only loop that spends money
  in a cycle. `ponytail:` no limiter until a second user exists.

### Claude's Discretion

- App shell layout, navigation, and visual design
- Exact model IDs and generation parameters (chosen against current docs at implementation)
- Zod schema field shapes for `routingDecision` and the step plan
- `MAX_GOAL_LEN` value; exact size cap constant
- Migration internals and the specific first migration's body
- Loading/skeleton states, error copy, empty states
- Whether the regenerate instruction is stored or only hashed
- `crypto.randomUUID()` vs an equivalent server-side generator

</decisions>

<specifics>
## Specific Ideas

- The review gate shows **route + plan + recipient + draft in one view**, with
  `[Approve] [Edit] [Ask for changes] [Reject]`. "Edit" is inline text editing;
  "Ask for changes" is the regenerate loop. Two distinct buttons, not one overloaded one.
- The ops badge is a **red count that persists** — modeled on an unread-mail badge, not a
  toast. Toasts are missable; OPSG-07 exists because "a failure nobody sees is a failure
  nobody fixes."
- The submit form is `To:` → `Goal:` → `Attach:` → `[Submit]`. Recipient first, because it
  is the field with the irreversible consequence.
- The attachment chip carries the honest caveat inline, not in a tooltip.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`convex/review.ts`** — the review gate already exists and solves the hard part: the
  `awaitEvent`-timeout race (Workflow issue #177). It implements *both* defensive rules —
  cancel the scheduled timeout on a real decision (`sendDecision`, line 62) *and*
  namespace events by correlationId (`review:${correlationId}`). **Reuse it; do not
  rebuild it.** Two changes needed:
  1. `sendDecision`'s `decision: v.string()` (line 63) becomes the real 4-member union.
  2. **The regenerate loop reuses the event name across iterations.** Since the gate now
     cycles, `review:${correlationId}` must gain an attempt suffix
     (e.g. `review:${correlationId}:${attempt}`) or a late event from attempt N can be
     consumed by attempt N+1 — reintroducing exactly the bug the namespacing prevents.
  3. `sendDecision` scans `pendingTimeouts` fully (line 67, marked `ponytail:` full scan).
     With unbounded concurrent requests this table is no longer trivially small — add the
     `by_correlation` index the comment already anticipates.
- **`convex/index.ts`** — `workflow` (WorkflowManager, default retry: 3 attempts, exp
  backoff) and `retrier` (ActionRetrier), the latter documented as the wrapper for
  external LLM/email calls. Both ready for Phase 2's use.
- **`convex/lib/functions.ts`** — `tenantQuery` / `tenantMutation` inject `tenantId` from
  identity. **Mandatory** for every new function (CLAUDE.md §2; enforced by a Biome
  `noRestrictedImports` rule and the `importGuard.test.ts` static scan).
- **`convex/audit.ts`** — insert-only write surface. Immutability enforced by convention
  plus `auditImmutability.test.ts`. No patch/replace/delete exists; do not add any.
- **`convex/deadLetter.ts`** — populated from workflow `onComplete`. Guards with
  `if (result.kind === "success") return;` so any unrecognized result kind fails *into*
  the DLQ. Note the Phase-1 finding: a failed run's kind is `"failed"`, **not** `"error"`.
- **`convex/skills.ts`** — versioned skill registry with `activateSkill` flip and
  rollback-by-reactivation. Skills are immutable per version. Seed bodies ship as derived
  `.ts` constants (Convex cannot `fs.read` repo files), kept in sync with canonical `.md`
  by a vitest assertion.
- **`convex/crons.ts`** — exists (WORM export). The DLVR-03 token-expiry check is a new
  cron alongside it.
- **`packages/contracts`** — source-export workspace package, proven to resolve through
  the Convex bundler (`schema.ts` imports it). Home for the `routingDecision` Zod schema.

### Established Patterns

- **Tenant scoping is the multi-tenant linchpin.** `tenantId` = `userId`, injected by the
  wrappers. Raw `query`/`mutation`/`action` imports outside `lib/functions.ts` are banned
  and lint-enforced.
- **Redact-then-write is a step-ordering contract**, not a filter. Payload shape is decided
  before the write, not scrubbed after.
- **Pre-1.0 components are pinned to exact versions** (CLAUDE.md §6). Workflow 0.4.4,
  Agent 0.6.4, RAG 0.7.5, Rate-Limiter 0.3.2, Action-Retrier 0.3.1, Auth 0.0.94.
  `@convex-dev/migrations` and `@convex-dev/aggregate` must be pinned the same way.
- **A `"use node"` module may contain ONLY actions.** DB-touching helpers live in a
  separate module reached via `ctx.runQuery`/`runMutation` (learned in 01-07 —
  `worm.ts` / `wormCursor.ts`). The Gmail send action will hit this.
- **Convex CLI exit codes are unreliable on Windows/Node 24** (`UV_HANDLE_CLOSING`) on
  both success and failure paths. `scripts/smokeRun.mjs` matches the CLI failure banner in
  output instead. Never trust `npx convex run` exit codes here.
- **`convex dev` must run continuously** (not `--once`) — `--once` pushes then stops the
  workpool, so async `onComplete`/scheduler steps never advance and smoke scripts hang.

### Integration Points

- **`convex/schema.ts`** — new tables: `requests`, `attachments`, `telemetry`,
  `notifications`, `gmailTokens`. **This is the first schema change**, so
  `@convex-dev/migrations` must be registered before it.
- **`convex/convex.config.ts`** — register `migrations` and `aggregate` alongside the five
  Phase-1 components.
- **`apps/web/app/`** — currently only `privacy/` and `terms/`. Everything user-facing is
  new: app shell, sign-in, submit form, request list, review queue, ops page,
  `/connect-gmail`.
- **`apps/web/app/privacy/`** — the processor list **must gain Vercel (AI Gateway) and
  OpenAI** in this phase. The pipeline starts sending user content to both; a privacy
  policy that omits an active processor is defective. This is a text edit, not a project.
- **`apps/web/app/sitemap.ts`** — DISC-02 requires every new *public* page be added.
  Authenticated app routes are not public; `/connect-gmail` is behind auth.
- **`convex/http.ts`** — the Gmail OAuth callback route lands here.

</code_context>

<deferred>
## Deferred Ideas

Captured during discussion, explicitly out of scope for Phase 2.

- **Dead-letter replay** — `deadLetters.status: "replayed"` exists but nothing writes it.
  Needs idempotency semantics (re-draft? re-send? re-charge?) before it can be safe.
- **Mailbox reading for draft context** — `gmail.modify` permits it and it would improve
  reply quality, but it pulls third-party personal data into the LLM. Its own phase, with
  its own review-gate semantics and audit events.
- **Editable step plans** — meaningful only once plans have more than one actionable step.
- **Bounce / real delivery tracking** — Phase 2 asserts `sent` (Gmail accepted, message ID
  recorded). Confirming inbox arrival needs webhooks and is a later phase.
- **LLM-based abuse / prompt-injection screening on submitted goals** — EXPN-04, post-beta.
- **Per-user rate limiting on submissions** — GRDL-06, Phase 3. Component already installed.
- **AI Gateway multi-provider failover** — the gateway ships in Phase 2 but its routing/
  fallback value is GRDL-05, Phase 3.
- **Application-level encryption of `requests` content at rest** — considered and set aside:
  Convex encrypts at rest, and Pikar must decrypt to send, so it mostly guards against a
  Convex-dashboard reader (i.e. the owner). Revisit if beta scale changes the threat model.

</deferred>

<open_items>
## Non-Code Follow-Ups

These are not implementation tasks but they gate the phase's correctness.

- **OpenAI Zero Data Retention must be applied for and approved** on the endpoints Phase 2
  uses. It is not the default. STATE.md makes this a hard constraint, not a preference:
  Google's restricted-scope policy forbids using `gmail.modify` data to train or improve
  generalised models.
- **Vercel AI Gateway becomes a processor of restricted-scope Gmail content.** It needs its
  own zero-retention/no-training terms — a gateway does not inherit the model provider's
  DPA — and it must appear in the privacy policy processor list and survive CASA review.
- **CASA Tier-2 assessment** (~$500–$4,500/yr, annual) is a permanent recurring cost of
  `gmail.modify`. Not payable in Phase 2, but the clock starts at verification (Phase 9).

</open_items>

---

*Phase: 02-thin-end-to-end-slice*
*Context gathered: 2026-07-10*
