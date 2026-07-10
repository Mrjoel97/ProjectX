# Phase 2: Thin End-to-End Slice - Research

**Researched:** 2026-07-10
**Domain:** Convex durable workflows + AI SDK structured output + Gmail OAuth delivery + reactive Next.js UI
**Confidence:** HIGH (stack, components, wiring all verified against current docs and the existing repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

The 02-CONTEXT.md file locks 43 decisions across 9 areas. These are **binding** — the planner
must honor them verbatim and NOT re-explore alternatives. Reproduced by area below.

### Locked Decisions

**Review gate — granularity and semantics**
- One collapsed gate (plan-approval + response-approval are the same moment). Displays routing decision, step plan, recipient, drafted email together.
- Decision union: `approve | edit_text | regenerate | reject` — replaces the untyped `decision: v.string()` at `convex/review.ts:63`.
  - `edit_text`: user edits subject/body inline, sent verbatim, no second LLM call.
  - `regenerate`: user supplies free-text instruction, draft regenerated, gate re-arms (the only looping decision).
  - `reject`: terminates; captures optional free-text reason (stored on request row, hashed into audit) — IMPR-03 triggering evidence.
- `regenerate` hard-capped at `MAX_REGENERATE = 3`. On breach, approve/edit/reject remain. No counter table. `ponytail:` comment names Phase 7 REVW-02 as upgrade path.
- Step plan is read-only at the gate (AGNT-02 requires the user *sees* it).
- Review timeout: 7 days → status `expired`, audit event, NO delivery. Matches Gmail refresh-token expiry.
- Do NOT dead-letter a timeout (it is an expected outcome, not a failure).
- Concurrency: unbounded. Each request is its own durable workflow with its own correlationId.

**Review queue and status model**
- Review queue is a real list — reactive `useQuery` over `requests` filtered to `status = "awaiting_review"`, not a single-request takeover.
- Explicit status union: `submitted → routing → drafting → awaiting_review → approved → delivering → sent`. Terminals: `rejected`, `expired`, `failed`. Hold state: `awaiting_reauth`.
- Terminal success state is `sent`, not `delivered` (Gmail confirms acceptance + message ID, not inbox arrival). Audit records the Gmail message ID as a ref.

**Content plane vs log plane (CLAUDE.md §4)**
- `requests` holds raw content (goal text, recipient, draft/edited body, reject reason).
- `audit.payload` and `deadLetters.payload` hold refs/hashes/ids/counts ONLY — never raw text.

**Intake, validation, attachments**
- Recipient is an explicit, validated `To:` field on the submit form. NEVER model-derived. Re-displayed at the gate before approval.
- INTK-04 rejection criteria (all checked before any workflow starts; each writes audit event + notifies): (1) no authenticated identity, (2) `goal.trim() === ""`, (3) `goal.length > MAX_GOAL_LEN`, (4) attachment mimeType outside allowlist, (5) attachment size over cap. No LLM-based abuse screening (that is EXPN-04).
- Attachments: stored, metadata-only to the agent. File → Convex file storage; `attachments` row links to request. Agent receives filename/mimeType/size — NEVER contents. UI says: "Attached. Pikar can't read file contents yet."
- Multiple attachments, capped at ~5. `attachmentRefs` modeled as an array now.
- Type allowlist + ~10MB cap: images (png/jpg/webp), pdf, audio (mp3/m4a/wav), documents (txt/md/docx).
- Upload first, then submit with storageIds (submit mutation receives ready storageIds; creates request + attachments + workflow atomically).

**Executive Agent — routing and LLM surface**
- Routes: `direct_llm` (draft email) and `direct_tool` (send user text without drafting) are implemented. `sub_agent` is a valid enum member with NO implementation → dead-letters `route_not_implemented`. Unknown/unparseable → dead-letters `unknown_route`. NO silent default (AGNT-03). Both DLQ paths exercised in Phase 2.
- Routing decision is schema-constrained structured output validated by a Zod schema in `packages/contracts`. Parse failure dead-letters — never retried into a default.
- Step plan is model-generated, returned as `steps[]` alongside `route` in the same schema.
- Two skill-registry rows: `executive-router` and `email-drafter` (CLAUDE.md §5 — no hardcoded prompts).
- Primary provider: OpenAI, reached through Vercel AI Gateway. Exact model IDs chosen at implementation time. Fallback is GRDL-05 (Phase 3).
- Direct AI SDK call inside a workflow step — NOT `@convex-dev/agent`. `ponytail:` skipping the Agent component until conversation state exists (Phase 6/8).
- Gmail delivery runs as a workflow step wrapped by `retrier` (already in `convex/index.ts:14`). Transient 5xx retries with backoff; terminal failure flows `onComplete` → `deadLetters` → OPSG-07.

**Auth, Gmail OAuth, tokens**
- Sign-in: Google via Convex Auth, requesting only `openid email profile`. Reuses the Google Cloud OAuth client also used for Gmail.
- `gmail.modify` is a separate, later, explicit consent on a `/connect-gmail` page (incremental-authorization pattern).
- Phase 2 owns the Gmail OAuth *connect flow* (code); Phase 9 keeps *verification*. Consent redirect, callback, token storage, refresh, `/connect-gmail` page must exist for SC-3.
- Tokens live in a dedicated tenant-scoped `gmailTokens` table. Read only by internal functions. Never returned to a client query, never in the browser, never in an audit payload. UI learns `connected: boolean` and `expiresAt: number` only. NOT stored on `authAccounts`.
- Phase 2 uses `gmail.modify` for sending only. (Requesting broadly ≠ using broadly.)
- Token-expiry race resolved in favor of the user's consent: a request approved after its refresh token died enters `awaiting_reauth`; UI prompts "Reconnect Gmail to send this"; on reconnect, delivery resumes from the already-approved draft. Does NOT re-prompt for approval.
- DLVR-03 is proactive AND reactive: a daily cron checks token age and shows a "Reconnect Gmail" banner within ~24h of expiry; `awaiting_reauth` is the safety net.

**Telemetry, aggregate, migrations**
- One telemetry row per request, written ONCE at terminal state (`sent | rejected | expired | failed`). All OPSG-01 fields present or explicitly null. Written *from* the outcome. No incremental patching.
- `@convex-dev/aggregate` indexes `audit` ONLY (append-only, unbounded). `telemetry` is bounded by request count — query it directly.
- `@convex-dev/migrations`: install the component AND ship one migration that actually runs. Install before the first schema change.

**Operator visibility and notifications**
- OPSG-07: in-app ops page + persistent badge. Reactive `useQuery` over `deadLetters where status = "new"`, surfaced as a count badge in the app shell that does not clear until resolved. Deliberately NOT email.
- Ops page ships "Mark resolved" only; replay is deferred (`deadLetters.status: "replayed"` stays unimplemented). `ponytail:` comment.
- Ops page is tenant-scoped, not owner-gated (`tenantQuery`).
- INTK-04's "notification" in Phase 2 = inline error + a `notifications` table row rendered in-app. Nothing leaves the browser.

**Correlation and identifiers**
- `correlationId` generated server-side in the submit mutation via `crypto.randomUUID()`. NEVER client-supplied. Event name `review:${correlationId}` resumes a durable workflow — attacker-chosen input there is a trust-boundary failure.

**Accepted risks**
- Phase 2 sends unredacted user text to OpenAI (GRDL-01 is Phase 3). Structure the workflow so a `redact` step slots in ahead of the LLM call. `ponytail:` comment naming Phase 3. Do NOT hand-roll a partial regex redactor.
- No rate limiting in Phase 2 (`@convex-dev/rate-limiter` installed but GRDL-06 is Phase 3). `MAX_REGENERATE` bounds the only money-spending loop. `ponytail:` no limiter until a second user exists.

### Claude's Discretion
- App shell layout, navigation, visual design.
- Exact model IDs and generation parameters (chosen against current docs at implementation).
- Zod schema field shapes for `routingDecision` and the step plan.
- `MAX_GOAL_LEN` value; exact size-cap constant.
- Migration internals and the specific first migration's body.
- Loading/skeleton states, error copy, empty states.
- Whether the regenerate instruction is stored or only hashed.
- `crypto.randomUUID()` vs an equivalent server-side generator.

### Deferred Ideas (OUT OF SCOPE)
- Dead-letter replay (`deadLetters.status: "replayed"` exists but nothing writes it).
- Mailbox reading for draft context.
- Editable step plans.
- Bounce / real delivery tracking.
- LLM-based abuse / prompt-injection screening (EXPN-04).
- Per-user rate limiting on submissions (GRDL-06, Phase 3).
- AI Gateway multi-provider failover (GRDL-05, Phase 3).
- Application-level encryption of `requests` content at rest.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTK-01 | Submit request as text + optional file attachments | Convex file storage `generateUploadUrl` (upload-first pattern) + `attachments` table + `requests` table. See Standard Stack, Code Examples §Attachment upload. |
| INTK-04 | Requests validated + authenticated; invalid → notification + auditable "Request Rejected — Validation Failed" | `tenantMutation` already fails-closed on no identity; goal/mime/size checks in submit mutation before `workflow.start`; audit `request.rejected` + `notifications` row. See Architecture §Submit-time validation gate. |
| AGNT-01 | Executive Agent produces routing decision (direct tool / sub-agent / direct LLM) | AI SDK `generateObject` + Zod `routingDecision` schema in `packages/contracts`; skill body from `executive-router` registry row. See Code Examples §Structured routing. |
| AGNT-02 | User sees plan (routing decision + step list) before approving | Step plan returned in same schema as `steps[]`; rendered read-only at the collapsed review gate. |
| AGNT-03 | Unknown/invalid routing → dead-letter, never silent default | Zod `.safeParse` failure and `sub_agent`/unknown enum → throw inside workflow step → `onComplete` → `deadLetters` (existing `deadLetter.ts`). See Architecture §Route dispatch. |
| REVW-01 | User reviews every response, can approve/edit/reject before delivery | Reuse `convex/review.ts` gate; widen `decision` to the 4-member union; attempt-suffixed event name for regenerate loop. See Architecture §Review gate reuse. |
| DLVR-01 | Approved responses delivered via Gmail through provider-agnostic adapter | `"use node"` Gmail send action wrapped by `retrier`; raw REST `POST /gmail/v1/users/me/messages/send`. See Code Examples §Gmail send. |
| DLVR-03 | OAuth token lifecycle managed (7-day refresh expiry; user re-prompted before break) | Custom Google OAuth2 code flow → `gmailTokens` table; daily cron age check → banner; `awaiting_reauth` hold state. See Architecture §Gmail OAuth + token lifecycle. |
| OPSG-01 | Per-request telemetry: tokens, cost, duration, decision/retry counters, review outcome | One `telemetry` row written once at terminal state; token/cost from AI SDK `usage`. See Architecture §Telemetry. |
| OPSG-06 | Schema changes as tracked, resumable migrations | `@convex-dev/migrations` 0.3.5 registered BEFORE first schema change + one migration that runs. See Standard Stack + Code Examples §Migration. |
| OPSG-07 | Dead-letter/failure surfaced to operator without DB inspection | Reactive `useQuery` over `deadLetters where status="new"` → persistent count badge + ops page with "Mark resolved". |
| BETA-04 | Live pipeline status + review queue via Convex subscriptions | `useQuery` reactivity over `requests` (status) and the awaiting_review list. No new infra. |
</phase_requirements>

## Summary

Phase 2 is almost entirely an **integration and wiring** phase, not a greenfield-invention phase.
The hard durable-orchestration primitives already exist in the repo (`workflow`, `retrier`, the
`review.ts` awaitEvent-timeout gate, insert-only `audit`, `deadLetter.onComplete`, the `skills`
registry, `tenantQuery`/`tenantMutation`). Phase 2 stitches them into one pipeline workflow and
builds the entire user-facing surface (currently only `privacy/` and `terms/` exist under
`apps/web/app/`).

Four external integration points need current-docs precision, and all four are verified below:
(1) the **AI SDK** structured-output call through the **Vercel AI Gateway** (a plain `"openai/…"`
model string routes automatically when `AI_GATEWAY_API_KEY` is set — no provider package needed);
(2) **Gmail send** via raw REST (`googleapis` is too heavy for a Convex action — use `fetch` to the
send endpoint and the token endpoint); (3) the **custom Google OAuth2 code flow** for the
incremental `gmail.modify` consent (Convex Auth handles sign-in, but the second-scope consent is a
separate hand-rolled flow landing in `http.ts`); (4) the two new **Convex components**
(`@convex-dev/migrations` 0.3.5, `@convex-dev/aggregate` 0.2.2), both registered in
`convex.config.ts` alongside the five Phase-1 components.

**Primary recommendation:** Build one `pipelineWorkflow` (`workflow.define`) whose steps are
route → draft → arm review gate → (loop on regenerate) → deliver, each step a `runAction`/
`runMutation` into a thin adapter; put the LLM calls in a `"use node"` action using `generateObject`
+ Zod through the AI Gateway string model; put Gmail send in a separate `"use node"` action wrapped
by `retrier`; write telemetry once in `onComplete`/terminal transition; and surface everything with
`useQuery` reactivity.

## Standard Stack

### Core (new dependencies to add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@convex-dev/migrations` | `0.3.5` (pin exact) | OPSG-06 tracked/resumable migrations | The official Convex migration component; batched, resumable, state-tracked. Register before first schema change. |
| `@convex-dev/aggregate` | `0.2.2` (pin exact) | OPSG-01 unbounded `audit` counts without `.collect()` | Official Convex component; O(log n) counts via a backing tree, survives unbounded tables. |
| `ai` | `7.0.20` | `generateObject` structured output + AI Gateway routing | The AI SDK is the de-facto standard for typed LLM calls; v5+ routes plain `provider/model` strings through the Vercel AI Gateway by default. |
| `zod` | `^4.4.3` (already in web app) | `routingDecision` schema in `packages/contracts` | Already the repo's schema lib; AI SDK consumes Zod schemas natively. Add to `packages/contracts` deps. |

**Note on the AI Gateway model string:** With `ai` v5+, passing a plain string
`model: "openai/gpt-4o-mini"` to `generateObject` routes through the Vercel AI Gateway
automatically when `AI_GATEWAY_API_KEY` is present in the environment. **You do NOT need
`@ai-sdk/openai`** for the gateway path — the gateway is the default global provider. This is the
lazy-correct path (one dependency, one env var). Only add `@ai-sdk/openai` if you later need to
bypass the gateway and talk to OpenAI directly.

### Supporting (already installed — reuse, do not re-add)
| Library | Version | Purpose |
|---------|---------|---------|
| `@convex-dev/workflow` | `0.4.4` | `pipelineWorkflow` durable orchestration (`workflow` in `index.ts`). |
| `@convex-dev/action-retrier` | `0.3.1` | Wrap the Gmail send action (`retrier` in `index.ts`). |
| `@convex-dev/auth` | `0.0.94` | Google sign-in provider (swap the current `Password` provider). |
| `convex` | `1.42.1` | File storage (`generateUploadUrl`, `storage.getUrl`), `httpAction` for the OAuth callback. |
| `convex-helpers` | `0.1.120` | `customMutation`/`customCtx` (already used by `lib/functions.ts`); `Triggers` if wiring the aggregate via triggers. |

### Do NOT add
| Considered | Why not | Use instead |
|------------|---------|-------------|
| `googleapis` (173.0.0) | ~Heavy multi-hundred-MB metapackage; overkill for two REST calls in a bundled Convex action. | Raw `fetch` to `gmail.googleapis.com` + `oauth2.googleapis.com/token`. |
| `google-auth-library` (10.9.0) | Same — token refresh is one `fetch` POST. | Raw `fetch` refresh (see Code Examples). |
| `@ai-sdk/openai` | Gateway routes by string; provider package not required for Phase 2. | Gateway string model + `AI_GATEWAY_API_KEY`. |
| `@convex-dev/agent` (installed) | Threads/message-history/tool-loops — none exist in Phase 2's two stateless calls. | Direct `generateObject` call in a `"use node"` action (per CONTEXT locked decision). |

**Installation:**
```bash
pnpm --filter @pikar/backend add @convex-dev/migrations@0.3.5 @convex-dev/aggregate@0.2.2 ai@7.0.20
pnpm --filter @pikar/contracts add zod@^4.4.3
```
(Pin the two Convex components to EXACT versions per CLAUDE.md §6.)

**New env vars (set via `npx convex env set`):**
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Convex Auth Google sign-in.
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway auth (non-Vercel host needs the explicit key).
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — same Google Cloud client, used by the custom `gmail.modify` flow (can be the same as `AUTH_GOOGLE_*`).
- `GMAIL_OAUTH_REDIRECT_URI` — the `http.ts` callback URL (`{CONVEX_SITE_URL}/gmail/callback`).

## Architecture Patterns

### New schema tables (first schema change → register migrations FIRST)
Add to `convex/schema.ts` (all tenant-scoped, all with a `by_tenant`/status index for reactive queries):
```
requests       — content plane: goal, recipient, draft, editedBody, rejectReason?, status, correlationId, attachmentRefs[], workflowId?, createdAt
attachments    — storageId, filename, mimeType, size, requestId, tenantId (extracted field added Phase 4)
telemetry      — one row per request at terminal state: tokens, cost, durationMs, decisionCounts, regenerateCount, reviewOutcome, correlationId
notifications  — tenantId, kind, requestId?, message, read, createdAt (in-app only in Phase 2)
gmailTokens    — tenantId, refreshToken, accessToken?, expiresAt, scope, updatedAt (internal-only reads)
```
Status union on `requests`: `submitted | routing | drafting | awaiting_review | approved | delivering | sent | rejected | expired | failed | awaiting_reauth`.

### Recommended module structure (backend)
```
convex/
├── convex.config.ts     # +migrations +aggregate (order after the five)
├── schema.ts            # +5 tables
├── requests.ts          # tenantMutation submit (validate → create rows → workflow.start); tenantQuery list/get for UI
├── pipeline.ts          # workflow.define: route → draft → gate → deliver; the spine
├── llm.ts               # "use node" action: generateObject route + draft (AI SDK); returns usage
├── gmail.ts             # "use node" action: send via REST, wrapped by retrier; token refresh
├── gmailAuth.ts         # DB helpers for gmailTokens (NOT "use node"); internal-only
├── gmailOAuth (http.ts) # httpAction callback: code → tokens → gmailTokens
├── review.ts            # EXTEND: decision union + attempt-suffixed event + by_correlation index
├── telemetry.ts         # internalMutation: write-once terminal row
├── aggregates.ts        # TableAggregate over audit (count by tenant)
├── migrations.ts        # Migrations client + first migration + runner
├── crons.ts             # EXTEND: +daily gmail-token-age check
└── notifications.ts     # tenantMutation/Query for in-app notifications
```

### Pattern 1: The pipeline workflow (reuse the smoke.ts shape)
**What:** A single `workflow.define` whose handler sequences steps via `step.runAction`/
`step.runMutation`, exactly like `smoke.ts:reviewGate`/`failingPipeline`.
**When:** The whole Phase-2 spine.
```typescript
// Source: existing convex/smoke.ts (established repo pattern) + Workflow 0.4.4
export const pipelineWorkflow = workflow.define({
  args: { correlationId: v.string(), requestId: v.id("requests"), tenantId: v.string() },
  handler: async (step, { correlationId, requestId, tenantId }): Promise<null> => {
    // 1. route (LLM structured output) — throws on unknown/parse-fail → onComplete → DLQ
    const routing = await step.runAction(internal.llm.route, { requestId });
    if (routing.route === "sub_agent") throw new Error("route_not_implemented");
    // 2. draft (or pass user text for direct_tool)
    const draft = routing.route === "direct_llm"
      ? await step.runAction(internal.llm.draft, { requestId })
      : /* direct_tool: use user text verbatim */ null;
    // 3. arm review gate + await the union event (attempt-suffixed for regenerate loop)
    let attempt = 0;
    while (true) {
      await step.runMutation(internal.review.armTimeout, { workflowId: step.workflowId, correlationId, timeoutMs: SEVEN_DAYS, attempt });
      const evt = await step.awaitEvent({ name: `review:${correlationId}:${attempt}`, validator: reviewEventValidator });
      if (evt.kind === "timeout") { /* status=expired, audit, NO delivery */ return null; }
      if (evt.decision === "reject") { /* status=rejected, capture reason */ return null; }
      if (evt.decision === "regenerate" && attempt < MAX_REGENERATE) { attempt++; continue; }
      break; // approve or edit_text → proceed
    }
    // 4. deliver via Gmail (retrier-wrapped) — token-dead → awaiting_reauth (not failure)
    await step.runAction(internal.gmail.send, { requestId });
    return null;
  },
});
```
Start it with `onComplete: internal.deadLetter.onPipelineComplete` and a redaction-safe `context`
(refs/ids only), exactly as `smoke.ts:runFailingPipeline` does — this gives OPSG-07/DLQ for free.

### Pattern 2: Submit-time validation gate (INTK-04)
**What:** All five rejection checks run in the `tenantMutation` submit BEFORE `workflow.start`.
`tenantMutation` already throws `UNAUTHENTICATED` (check 1) — the other four are cheap guards.
On any failure: insert audit `request.rejected` (refs only) + a `notifications` row; do NOT start a
workflow. Recipient is validated here too (structural email check) — the highest-severity failure mode.

### Pattern 3: Route dispatch = throw-into-DLQ, never default (AGNT-03)
**What:** `generateObject` with `.safeParse` OR the Zod schema itself constrains `route` to the enum.
An unparseable structured output, or the `sub_agent` member, throws inside the workflow step. A thrown
step (with retries exhausted/disabled) fails the workflow → `onComplete` sees `result.kind === "failed"`
→ `deadLetter.ts` archives it. **The DLQ reason string distinguishes `unknown_route` vs
`route_not_implemented`** (pass it in the thrown error / context payload). Both paths are deliberately
exercised in Phase 2.

### Pattern 4: Review gate reuse (REVW-01) — three required edits to `review.ts`
The gate already solves the hard awaitEvent-timeout race (issue #177 — cancel scheduled timeout on
real decision AND namespace by correlationId). **Reuse it.** Three changes:
1. `sendDecision`'s `decision: v.string()` (line 63) → the 4-member union `approve | edit_text | regenerate | reject`, plus the edited text / regenerate instruction / reject reason as optional fields.
2. **Attempt-suffix the event name**: `review:${correlationId}:${attempt}`. Because the gate now loops on `regenerate`, a late event from attempt N must not be consumed by attempt N+1 (re-introduces exactly the bug the namespacing prevents). `armTimeout` and `sendDecision` both take `attempt`.
3. Add the `by_correlation` index on `pendingTimeouts` and use it in `sendDecision` (currently a full `.collect()` scan marked `ponytail:`). Unbounded concurrent requests make the full scan a read-limit risk.

### Pattern 5: Gmail OAuth + token lifecycle (DLVR-03)
**Two distinct OAuth interactions — keep them separate:**
- **Sign-in** (`openid email profile`): Convex Auth `Google` provider. Swap `Password` in `auth.ts`.
- **`gmail.modify` connect** (restricted scope): a *custom* OAuth2 authorization-code flow, NOT through Convex Auth (Convex Auth does not do incremental second-scope consent). The `/connect-gmail` page links to Google's authorize URL with `access_type=offline&prompt=consent&include_granted_scopes=true&scope=https://www.googleapis.com/auth/gmail.modify`. The callback lands in `http.ts` as an `httpAction`, exchanges `code` for `{refresh_token, access_token, expires_in}`, and stores them in `gmailTokens` (internal write). `prompt=consent` + `access_type=offline` is required to actually receive a `refresh_token`.
- **Refresh:** access tokens expire in ~1h → refresh on demand in `gmail.send` via a `fetch` POST to `oauth2.googleapis.com/token` with `grant_type=refresh_token`. In Testing mode the *refresh* token itself expires after 7 days.
- **Token-dead handling:** if refresh fails (7-day expiry), the send step sets `requests.status = awaiting_reauth` and returns WITHOUT failing the workflow — the approved draft is preserved. UI shows "Reconnect Gmail to send this." On reconnect, re-fire the delivery step.
- **Proactive banner (cron):** extend `crons.ts` with a daily job that scans `gmailTokens` for `expiresAt` within ~24h and flags a "Reconnect Gmail" banner (a `notifications` row or a reactive query the shell reads).

### Pattern 6: Telemetry write-once (OPSG-01)
Write exactly one `telemetry` row at the terminal transition (`sent | rejected | expired | failed`),
built from the outcome. Token/cost come from the AI SDK result's `usage` field (accumulate route +
draft + each regenerate). No incremental patching (avoids OCC contention + half-written rows).

### Pattern 7: Aggregate over `audit` only (OPSG-01 counts)
`TableAggregate` namespaced by `tenantId`, keyed by `ts`. Keep it in sync either via `Triggers`
(wrap a dedicated audit `internalMutation` builder) OR — the lazier single-surface path — call
`auditAggregate.insert(ctx, doc)` inside `audit.log` right after `ctx.db.insert` (audit.log is
already the SOLE insert surface, so one call site covers it). Query counts with
`auditAggregate.count(ctx, { namespace, bounds })` — never `.collect().length` on `audit`.

### Anti-Patterns to Avoid
- **Deriving the recipient from the model.** Locked decision: `To:` is an explicit validated form field, re-shown at the gate. A hallucinated address sends real mail to a stranger.
- **Reusing the review event name across regenerate iterations.** Re-introduces the issue-#177 race. Attempt-suffix it.
- **`.collect()` on `audit` to count.** Hard-fails at read limits on an unbounded table. Use the aggregate.
- **Putting the AI SDK call in a non-Node action.** The AI SDK needs the Node runtime → `"use node"` module containing ONLY actions (repo rule from 01-07); DB reads/writes go through `ctx.runQuery`/`runMutation`.
- **Storing Gmail tokens on `authAccounts`.** Its shape is owned by `@convex-dev/auth` (beta). Use the dedicated `gmailTokens` table.
- **Raw content in `audit.payload`/`deadLetters.payload`.** Refs/hashes/ids/counts only (CLAUDE.md §4).
- **Bumping any pinned pre-1.0 component.** Pin the two new components exact (CLAUDE.md §6).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Counting unbounded `audit` rows | A `.collect().length` counter | `@convex-dev/aggregate` `TableAggregate.count` | `.collect()` hard-fails at Convex read limits on unbounded tables. |
| Schema migrations / backfills | Ad-hoc one-off mutation scripts | `@convex-dev/migrations` | Batched, resumable, state-tracked; an untested harness discovered mid-Phase-3 is the OPSG-06 failure. |
| awaitEvent-timeout review race | A new gate | Existing `convex/review.ts` | Already solves issue #177 with both defensive rules. Reuse + 3 edits. |
| DLQ on workflow failure | Custom error catcher | Existing `deadLetter.onComplete` | Already wired; `result.kind === "failed"` archives + audits. |
| Structured LLM output parsing | Hand-rolled JSON.parse + validation | AI SDK `generateObject` + Zod | Enforces the schema at the model boundary; retries malformed output; typed result. |
| LLM provider routing | Custom HTTP to OpenAI | AI SDK + Vercel AI Gateway string model | One env var, one vendor relationship covering Phases 4/5/6; fallback slots in at GRDL-05. |
| Gmail auth client | `googleapis` / `google-auth-library` | Raw `fetch` to two Google endpoints | Two REST calls don't justify a hundreds-of-MB dependency in a bundled action. |
| PII redaction | A partial regex redactor | Nothing in Phase 2 — leave a `redact` step seam for GRDL-01 (Phase 3) | "A redactor that half-works invites trusting it" (locked decision). |
| Rate limiting | A counter | Nothing in Phase 2 — `MAX_REGENERATE` bounds the only spend loop | GRDL-06 is Phase 3; component already installed. |

**Key insight:** Phase 2's job is to *compose* the Phase-1 primitives and two new Convex components,
not to build new orchestration machinery. Every "hard" concurrency/immutability problem already has
a home in this repo.

## Common Pitfalls

### Pitfall 1: convex-test cannot exercise component-backed workflows
**What goes wrong:** Unit tests that try to drive the pipeline workflow (or the review gate) under
`convex-test` hang or no-op — the Workflow component's workpool/scheduler is not emulated.
**Why:** Documented in `smoke.ts` header and STATE.md; the component runs against a real deployment.
**How to avoid:** Test the pipeline end-to-end via **dev-deployment smoke scripts** (the established
`scripts/run-smoke-*.mjs` + `smokeRun.mjs` pattern). Unit-test the *pure* pieces (Zod routing schema,
validation guards, telemetry-row builder) with `convex-test`/vitest. See Validation Architecture.

### Pitfall 2: `--once` and Windows exit codes
**What goes wrong:** `convex dev --once` pushes then stops the workpool → async `onComplete`/scheduler
steps never advance → smoke scripts hang. And `npx convex run` returns bogus exit codes on
Windows/Node 24 (`UV_HANDLE_CLOSING`) on BOTH success and failure.
**How to avoid:** Run `convex dev` continuously; judge pass/fail by matching the CLI failure banner in
output (existing `smokeRun.mjs`), never by exit code. Check `curl 127.0.0.1:3210/version` for liveness.

### Pitfall 3: missing `refresh_token` from the Gmail consent
**What goes wrong:** The OAuth callback receives an `access_token` but no `refresh_token`, so delivery
breaks in ~1h with no way to refresh.
**Why:** Google only returns a `refresh_token` when `access_type=offline` AND (on repeat consents)
`prompt=consent` are set.
**How to avoid:** Always include `access_type=offline&prompt=consent` on the authorize URL. Store the
`refresh_token` durably; treat its absence on callback as a hard error surfaced to the user.

### Pitfall 4: `_generated` not present / codegen order
**What goes wrong:** `migrations.ts` imports `./_generated/schema.js` and `components.migrations`; if
the component isn't registered in `convex.config.ts` before codegen, the import fails.
**How to avoid:** Register `migrations` + `aggregate` in `convex.config.ts` FIRST, run `convex dev`
(codegen), THEN write the clients and the first schema change. Migrations must be registered before
the first schema change (locked decision).

### Pitfall 5: raw `query`/`mutation` import ban
**What goes wrong:** A new feature file imports `mutation` from `_generated/server` → Biome
`noRestrictedImports` + `importGuard.test.ts` fail the build.
**How to avoid:** Every new tenant-facing function uses `tenantQuery`/`tenantMutation` from
`lib/functions.ts`. Internal-only functions (workflow steps, `armTimeout`, telemetry writer) use
`internalMutation`/`internalAction` — confirm these are on the allow-list (as `skills.ts`,
`audit.ts`, `review.ts`, `deadLetter.ts` already are).

### Pitfall 6: AI SDK in Convex Node runtime
**What goes wrong:** Importing `ai` into a normal (V8) Convex function fails — it needs Node APIs.
**How to avoid:** The LLM action module starts with `"use node"` and contains ONLY actions. It reads
the request row and skill body via `ctx.runQuery`, calls `generateObject`, and returns the result +
`usage` to the workflow step.

## Code Examples

### convex.config.ts — register the two new components (verified)
```typescript
// Source: get-convex/migrations + get-convex/aggregate READMEs (2026-07)
import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(actionRetrier);
app.use(migrations);
app.use(aggregate, { name: "auditCounts" });   // named instance for the audit aggregate
export default app;
```

### Migration client + first migration (verified)
```typescript
// Source: get-convex/migrations README
// convex/migrations.ts
import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

// A migration that ACTUALLY RUNS (locked decision). Phase 2 only adds tables, so
// pick a real no-op-safe backfill, e.g. normalize a new optional field on requests.
export const backfillRequestDefaults = migrations.define({
  table: "requests",
  migrateOne: async (_ctx, row) => (row.regenerateCount === undefined ? { regenerateCount: 0 } : undefined),
});
// Run: npx convex run migrations:run '{fn: "migrations:backfillRequestDefaults"}'
```

### Aggregate over audit (verified pattern)
```typescript
// Source: get-convex/aggregate README
// convex/aggregates.ts
import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const auditCounts = new TableAggregate<{
  Namespace: string;      // tenantId
  Key: number;            // ts
  DataModel: DataModel;
  TableName: "audit";
}>(components.auditCounts, {
  namespace: (doc) => doc.tenantId,
  sortKey: (doc) => doc.ts,
});
// In audit.log, after ctx.db.insert(...): const doc = await ctx.db.get(id); await auditCounts.insert(ctx, doc);
// Count for a tenant: await auditCounts.count(ctx, { namespace: tenantId });
```

### Structured routing via AI Gateway (verified pattern)
```typescript
// Source: ai-sdk.dev generateObject + AI Gateway (routes "openai/…" via AI_GATEWAY_API_KEY)
"use node";
import { generateObject } from "ai";
import { z } from "zod";
// routingDecision schema lives in packages/contracts (locked decision)
const routingSchema = z.object({
  route: z.enum(["direct_llm", "direct_tool", "sub_agent"]),
  steps: z.array(z.object({ n: z.number(), description: z.string() })),
  rationale: z.string(),
});
const { object, usage } = await generateObject({
  model: "openai/gpt-4o-mini",           // gateway routes this string; no provider import
  schema: routingSchema,
  system: routerSkillBody,               // loaded from skills registry (executive-router)
  prompt: userGoal,                      // ponytail: unredacted in P2; redact step slots in at GRDL-01
});
// usage.inputTokens / usage.outputTokens → telemetry (OPSG-01)
```

### Gmail send via raw REST, wrapped by retrier (verified endpoints)
```typescript
// Source: Google Gmail API docs (users.messages.send) + OAuth2 token endpoint
"use node";
// 1. refresh access token (tokens fetched from gmailTokens via ctx.runQuery)
const tok = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
if (!tok.ok) { /* 7-day expiry → status=awaiting_reauth, return (do NOT throw) */ }
const { access_token } = await tok.json();
// 2. RFC-2822 MIME → base64url
const mime = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
const raw = Buffer.from(mime).toString("base64url");
// 3. send — 5xx throws (retrier retries); returns message id
const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
  method: "POST",
  headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ raw }),
});
// record res.json().id as a ref in audit; set status=sent
```
Wrap the send action with `retrier.run(ctx, internal.gmail.send, args)` for the transient-5xx retries
(the `retrier` in `index.ts` is documented for exactly this).

### Attachment upload (Convex file storage, standard pattern)
```typescript
// Source: Convex file storage docs (generateUploadUrl)
// tenantMutation: return await ctx.storage.generateUploadUrl();
// client: POST file to that URL → { storageId }; collect storageIds → pass to submit mutation
// submit mutation: insert request + one attachments row per storageId (filename/mimeType/size), then workflow.start
// agent NEVER receives contents — only the metadata (locked decision)
```

### Convex Auth Google sign-in (verified)
```typescript
// Source: labs.convex.dev/auth Google provider
// convex/auth.ts — swap Password for Google
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google({ authorization: { params: { scope: "openid email profile" } } })],
});
// env: AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
```
Next.js side (`@convex-dev/auth/nextjs`): `ConvexAuthNextjsServerProvider` in `layout.tsx`,
`convexAuthNextjsMiddleware` + `createRouteMatcher` in `middleware.ts` to gate app routes, and
`useQuery` reactivity for the live UI. `@convex-dev/auth` (0.0.94, beta) is pinned — do not bump.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `generateObject` from `@ai-sdk/openai` provider instance | Plain `"provider/model"` string routed through AI Gateway (`ai` v5+) | AI SDK v5 (2025) | One dependency, one key; no per-provider imports. `generateObject` still the structured-output call. |
| `googleapis` client for Gmail | Raw REST `fetch` to `messages/send` + token endpoint | n/a (always available) | Avoids a huge dependency in a bundled Convex action. |
| Convex Auth `Password` (Phase 1 owner login) | Convex Auth `Google` provider | Phase 2 | Reuses the Google Cloud client the Gmail flow needs anyway. |
| `.collect()` counts | `@convex-dev/aggregate` | Component GA | Survives unbounded `audit`. |

**Deprecated/outdated:** In `ai` v5+, `Output.object()` on `generateText` and the standalone
`generateObject` coexist — prefer `generateObject` for a single typed result (simpler, still current).
Older tutorials importing `openai(...)` from `@ai-sdk/openai` to build a model instance are
unnecessary for the gateway path.

## Open Questions

1. **Exact model ID for router vs drafter.**
   - Known: OpenAI via gateway; `gpt-4o-mini` class is the cost-appropriate default for routing.
   - Unclear: whether drafting warrants a larger model. Locked decision leaves model IDs to implementation time.
   - Recommendation: default both to a mini-class model string; make it a single constant so GRDL-03/05 (Phase 3) can vary it.

2. **Aggregate sync: trigger vs manual insert in `audit.log`.**
   - Known: both work; audit.log is the sole insert surface.
   - Unclear: whether a future non-`audit.log` writer could bypass a manual insert.
   - Recommendation: manual `auditCounts.insert` inside `audit.log` (single call site, matches the "sole surface" invariant). Add a `Triggers` wrapper only if a second writer ever appears.

3. **AI Gateway zero-data-retention / no-training terms.**
   - Known (from CONTEXT open-items): Vercel AI Gateway becomes a processor of (future) restricted-scope content and needs its own zero-retention terms; OpenAI ZDR must be applied for. These are NON-CODE follow-ups, not Phase-2 implementation blockers (no beta users until Phase 9).
   - Recommendation: planner records these as phase follow-ups (privacy-policy processor list edit IS in scope — add Vercel + OpenAI). The contractual approvals are tracked, not coded.

4. **`direct_tool` semantics in Phase 2.**
   - Known: sends user-supplied text without drafting.
   - Unclear: whether `direct_tool` still passes through the review gate (it should — REVW-01 says *every* response is reviewed).
   - Recommendation: route `direct_tool` through the same gate showing the verbatim text as the "draft"; only the drafting step is skipped.

## Validation Architecture

nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` ^3.2.7 + `convex-test` 0.0.54 (unit); dev-deployment smoke scripts (workflow/integration) |
| Config file | per-package vitest (backend `test` script); Node smoke runners under `scripts/` |
| Quick run command | `pnpm --filter @pikar/backend test` |
| Full suite command | `pnpm test` (turbo, all packages) + `pnpm boot:check` |

**Critical constraint:** `convex-test` CANNOT drive component-backed workflows (Workflow/Agent/Retrier)
— confirmed in `smoke.ts` and STATE.md. Pipeline/gate/delivery behaviors are validated by
**dev-deployment smoke scripts** (the existing `scripts/run-smoke-*.mjs` + `smokeRun.mjs` banner-match
pattern), NOT by `convex-test`. Pure logic is unit-tested.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01/03 | Routing Zod schema accepts valid, rejects unknown → DLQ reason | unit | `pnpm --filter @pikar/backend test routing` | ❌ Wave 0 |
| INTK-04 | Submit rejects empty/oversized/bad-mime/unauth → audit + notification, no workflow | unit | `pnpm --filter @pikar/backend test submitValidation` | ❌ Wave 0 |
| REVW-01 | Decision union + attempt-suffixed event resumes correct gate; regenerate cap | smoke | `pnpm --filter @pikar/backend smoke:reviewgate` (extend existing) | ⚠️ extend |
| AGNT-03 | Unknown route + `sub_agent` land in `deadLetters` with distinct reasons | smoke | `node scripts/run-smoke-dlq.mjs` (extend) | ⚠️ extend |
| DLVR-01/03 | Gmail send happy path (message id) + token-dead → `awaiting_reauth` | smoke | `node scripts/run-smoke-pipeline.mjs` | ❌ Wave 0 |
| OPSG-01 | Terminal telemetry row has all fields (tokens/cost/duration/counts/outcome) | unit | `pnpm --filter @pikar/backend test telemetry` | ❌ Wave 0 |
| OPSG-06 | First migration runs + is tracked/resumable | smoke | `npx convex run migrations:run '{fn:"migrations:backfillRequestDefaults"}'` | ❌ Wave 0 |
| OPSG-07 | `deadLetters where status="new"` count drives the badge; "Mark resolved" clears | unit | `pnpm --filter @pikar/backend test deadLetterQuery` | ❌ Wave 0 |
| BETA-04 | `useQuery` over requests/queue updates reactively | manual | UI check against dev deployment | manual-only (reactivity is a Convex guarantee; assert query shape in unit) |

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/backend test` (fast unit) + `pnpm --filter @pikar/backend typecheck`.
- **Per wave merge:** `pnpm test` + relevant `smoke:*` scripts against a running `convex dev`.
- **Phase gate:** full suite + `pnpm boot:check` green, both DLQ paths + gate loop + Gmail send demonstrated on the dev deployment, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `convex/routing.test.ts` — routing Zod schema valid/invalid → covers AGNT-01/03.
- [ ] `convex/submitValidation.test.ts` — the five INTK-04 rejection checks.
- [ ] `convex/telemetry.test.ts` — terminal-row builder completeness → OPSG-01.
- [ ] `convex/deadLetterQuery.test.ts` — `status="new"` count + mark-resolved → OPSG-07.
- [ ] `scripts/run-smoke-pipeline.mjs` — full spine (route→gate→send) + `awaiting_reauth` path → DLVR-01/03, REVW-01.
- [ ] Extend `run-smoke-dlq.mjs` with the two AGNT-03 route paths; extend `smoke:reviewgate` with the decision union + attempt suffix.
- [ ] Component install/registration: `pnpm --filter @pikar/backend add …` then `convex dev` codegen (blocks everything).

## Sources

### Primary (HIGH confidence)
- Existing repo: `convex/review.ts`, `smoke.ts`, `index.ts`, `deadLetter.ts`, `audit.ts`, `skills.ts`, `lib/functions.ts`, `schema.ts`, `convex.config.ts`, `crons.ts`, `auth.ts`, `http.ts` — the established patterns Phase 2 reuses.
- get-convex/migrations README — `convex.config.ts` registration, `Migrations` client, `migrations.define`, `runner()`, CLI run. https://github.com/get-convex/migrations
- get-convex/aggregate README — `app.use(aggregate,{name})`, `TableAggregate`, triggers, `count()`. https://github.com/get-convex/aggregate
- ai-sdk.dev — `generateObject`/structured output + AI Gateway default string routing. https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- Google Gmail API — `users.messages.send`, base64url raw MIME. https://developers.google.com/workspace/gmail/api/guides/sending
- Google OAuth2 — token endpoint, refresh_token, offline access. https://developers.google.com/identity/protocols/oauth2
- labs.convex.dev/auth — Google provider config + Next.js integration. https://labs.convex.dev/auth
- npm registry — verified current versions (migrations 0.3.5, aggregate 0.2.2, ai 7.0.20).

### Secondary (MEDIUM confidence)
- Vercel AI Gateway auth docs — `AI_GATEWAY_API_KEY` fallback on non-Vercel hosts. https://vercel.com/docs/ai-gateway/authentication-and-byok

### Tertiary (LOW confidence — validate at implementation)
- Exact `usage` field names on the AI SDK v7 `generateObject` result (`inputTokens`/`outputTokens` vs `promptTokens`/`completionTokens`) — confirm against installed version.
- Whether `AUTH_GOOGLE_*` and `GOOGLE_OAUTH_*` can be a single shared client without redirect-URI conflicts — confirm in Google Cloud console at implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified on npm; component APIs verified against source READMEs.
- Architecture: HIGH — reuses existing, already-tested repo primitives; new wiring is mechanical.
- Pitfalls: HIGH — most are already documented in-repo (convex-test limits, Windows exit codes, import ban); Gmail `refresh_token` pitfall verified against Google docs.
- Gmail/AI Gateway env specifics: MEDIUM — API keys/scopes verified; exact field names flagged LOW.

**Research date:** 2026-07-10
**Valid until:** ~2026-08-10 (30 days; pre-1.0 Convex components and AI SDK move fast — re-verify versions if planning slips past a month).
