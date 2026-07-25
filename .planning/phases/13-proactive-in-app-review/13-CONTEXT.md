# Phase 13: Proactive In-App Review - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A Convex cron runs the existing Phase-12 evaluation engine (`internal.evaluations.runEvaluation`)
per tenant on a weekly cadence and delivers the result **in-app** — an evaluation card plus an
in-app notification — touching **no OAuth mailbox token**. Proactivity must survive past the
Google 7-day testing-token expiry; any scheduled Google-bound call is deferred to production
OAuth (Stage S4).

The evaluation ENGINE is not being changed. This phase schedules it, delivers it, and marks
what changed. Requirement: **BEVL-03**.

</domain>

<decisions>
## Implementation Decisions

### Where the review lands

- **Synthetic review thread.** The cron writes the evaluation under a deterministic per-tenant
  thread id (e.g. `proactive-review`) so the existing `evaluations.byThread` → `EvaluationCard`
  path renders it with no new card infrastructure. The existing `?thread=<id>` deep-link
  (built for the VOIC-04 voice→plan handoff) is the routing — no new route.
- **One persistent review thread per tenant, NOT a new thread per week.** This is load-bearing:
  `runEvaluation` carries the prior Scorecard and `userProvided` keys forward via
  `lastForThread`, which is scoped to the SAME threadId. A weekly thread id would silently reset
  the Scorecard every week and re-ask figures the user already answered. Append-only rows on one
  stable thread give carry-forward for free.
- **Pinned workspace tab.** A "Weekly review" tab is always rendered in the workspace tab strip.
  Because the thread id is deterministic, this needs NO tab persistence (page.tsx:27 notes tabs
  are session-only view state) — the tab is static and always known.
- **Tab is always visible, with empty-state copy before the first run** — e.g. "Your first
  weekly review runs Monday. It reads your vault — nothing to do." One extra branch in the card.
- **The review thread is NOT added to "Past chats".** It has no cockpit turns; the history menu
  stays a chat-only surface.
- **Same card, dated header.** The proactive review renders the identical `EvaluationCard` body
  with a header line: `Weekly review · Jul 27`. No new card idiom.
- **Live swap is fine.** Convex subscriptions will replace the card contents if a new review
  lands while the tab is open. That is the correct outcome and costs zero code.
- **Latest review only — no history UI.** Rows accumulate append-only for free; a "previous
  reviews" list is deferred until someone asks.
- **Notification copy is a static line, no counts:** "Your weekly business review is ready."
  Zero §4 exposure. The card carries all substance.

### Cadence and tenant selection

- **One weekly UTC cron**, matching the existing `worm-export` / `gmail-token-expiry-scan`
  pattern: `crons.weekly("proactive-review", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.proactiveReview.runWeekly, {})`. Convex crons are deploy-time and UTC-only; no
  per-tenant timezone handling in this phase (there is no tenant tz field today).
- **Tenants are enumerated from `vaultDocuments` where `kind === "business_profile"`** — the same
  rows `internal.vault.profileSeedDocs` already keys on. Semantics: *onboarded ⇒ reviewed*. There
  is no `tenants` table; both existing crons enumerate by scanning a domain table, so this
  follows precedent.
- **No opt-out toggle this phase.** One notification per week at private-beta scale does not
  justify a settings table + settings UI. Deferred (below).
- **Fan-out: one scheduled job per tenant.** `runWeekly` is a cheap `internalMutation` that
  enumerates tenants and calls `ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne,
  { tenantId })` per tenant. Each review is its own isolated transaction — one tenant's failure
  cannot stall or affect another. This is the same seam `notifications.notify` already uses to
  hand off to `notifyExternal`.
- **Failures ARE surfaced to the user** (not silently skipped). A failed review writes an in-app
  notification: "We couldn't run your weekly review — open the cockpit to run one now.", which
  deep-links to `/dashboard/workspace` where the Phase-12 on-demand `evaluateBusiness` path is
  already live. The failure reason is NEVER put on the notification plane (§4).

### What the review says

- **Full re-run of the existing engine** — `reviewOne` calls `internal.evaluations.runEvaluation`
  with no engine changes. Output is identical to an on-demand assessment.
- **Plus a stored "what changed" delta line.** Computed at WRITE time by the cron (which already
  holds `prev` from carry-forward and `next`), stored on the evaluation row in a new **optional**
  `delta` field → no migration. Keeps `EvaluationCard` a single-row dumb renderer. An on-demand
  run has no `delta` → the line is simply hidden.
- **Delta is keyed on `gap.route`, not on labels.** `route` is a bounded specialist-skill
  identifier (`money-model-designer`, etc.); `label` is prose from `diagnose()` and any wording
  change would read as "closed + new". Findings get a count-only comparison.
  Shape: `{ newFindings: number, gapsClosed: string[], gapsOpened: string[] }` (routes).
  Rendered as e.g. `2 new findings · 1 gap closed · 1 new gap`.
- **Framework carries forward from last week's row**, falling back to the engine default on the
  first run (`framework = last?.framework` → `undefined` → existing default behavior). The user
  compares like with like week over week.

### Sparse and empty cases

- **Always write the evaluation row; notify ONLY on change.** The card stays current every week
  and history accrues, but a notification fires only when: it is the first review ever, OR the
  verdict changed since last week, OR the delta is non-empty. An idea-stage tenant (Phase 11
  admits users with only a one-line description) gets ONE "not enough data" notification and then
  silence — a weekly unchanging ping is the fastest way to get the bell ignored.
- **The not-enough-data card links to `/dashboard/profile`** — the Phase-11 enrichment surface —
  turning a dead end into the one action that unblocks it.
- **A healthy business going quiet is correct.** Silence is the signal: nothing changed, nothing
  needs you. The card still refreshes weekly with the healthy banner. No monthly heartbeat.
- **No unread dot / badge on the pinned tab.** The dated card header (`Weekly review · Jul 27`)
  is the freshness signal — no per-tenant read state to add or maintain.

### Governance (SC#2 and SC#3)

- **The no-mailbox-token guarantee gets a STATIC GUARD TEST**, following the established
  `importGuard.test.ts` / `llmRedaction.test.ts` precedent. It asserts:
  1. the review module imports neither `./gmail` nor `./notifyExternal`;
  2. `"weekly_review"` is absent from `NOTIFICATION_KINDS` (an unregistered kind makes
     `notifyExternal.dispatch` return *before* `freshAccessToken` is ever called);
  3. the review path inserts into `notifications` **directly**, never via `notifications.notify`.
  Rationale: `notifications.notify` unconditionally schedules `internal.notifyExternal.dispatch`,
  which calls `freshAccessToken` and sends Gmail — routing the review through it would violate
  SC#1/SC#2. `gmailAuth.flagExpiringTokens` already sets the bypass precedent (direct insert,
  unregistered `gmail_reconnect` kind). A test makes the invariant fail in CI instead of silently
  breaking in production week 2.
- **No new audit row.** `runEvaluation` already writes a refs/counts-only `evaluation.ran` audit
  row. The cron adds nothing — a `review.delivered` row would duplicate it.
- **Explicit `tenantId` on every internal function + a scoping assertion in the same guard test.**
  The cron runs with no authenticated identity, so `requireTenant` / `tenantQuery` do not apply.
  Every read and write in the review path carries an explicit validated `tenantId`, following the
  established internal-twin convention (`recordScorecardAnswerInternal`, `runEvaluation`). The
  guard test asserts no unscoped table scan exists in the review path.
- **Live verification runs `internal.proactiveReview.runWeekly` from the Convex dashboard**
  function runner with `{}`. No dev-only UI trigger is added; this exercises the exact production
  path including fan-out. Document the invocation in the playbook.

### Claude's Discretion

- Exact module name/layout (`proactiveReview.ts` assumed but not locked) and function naming.
- Exact delta line wording and its placement within the card header region.
- Exact empty-state and failure-notification microcopy (decisions above fix the substance and the
  §4 constraint, not the final characters). Follow `docs/design/BRAND.md` voice.
- Whether the pinned-tab label reads "Weekly review" or similar.
- Test file layout and how the static source assertions are implemented.

</decisions>

<specifics>
## Specific Ideas

- "Onboarded ⇒ reviewed" — completing Phase-11 onboarding is what enrolls a tenant, not a
  separate opt-in.
- The bell must stay meaningful. Notify-on-change exists specifically so the weekly review never
  becomes ignorable noise; that is a product requirement, not an optimization.
- Reuse over invention throughout: existing card, existing deep-link, existing engine, existing
  audit row, existing cron file, existing direct-insert notification precedent.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/backend/convex/crons.ts` — 2 existing crons (`worm-export` daily 03:00 UTC,
  `gmail-token-expiry-scan` daily 04:00 UTC). The new cron is one added line here; logic lives in
  its own module, mirroring `worm-export → worm.ts`.
- `internal.evaluations.runEvaluation` (evaluations.ts:144) — `internalAction` taking explicit
  `{ tenantId, threadId, framework?, query? }`. Deterministic (no LLM narrative in v1); grounds
  via `vaultGroundHydrated` + `vault.profileSeedDocs`. **Fails open** into an "insufficient"
  verdict. Already writes the `evaluation.ran` audit row and the `evaluateBusiness` agent step.
- `internal.evaluations.lastForThread` (evaluations.ts:112) — the carry-forward read; also the
  source of `prev` for the delta computation and of the framework to carry forward.
- `internal.evaluations.insertEvaluation` (evaluations.ts:123) — the ONE content-plane write
  surface for an evaluation row; where the new optional `delta` field is written.
- `evaluations.byThread` (evaluations.ts:601) — `tenantQuery`, `.order("desc").first()`. The card
  read. Unchanged by this phase.
- `EvaluationCard` (apps/web/app/(app)/dashboard/workspace/cards.tsx:1385) — a deliberate dumb
  renderer over `byThread`; already has healthy-banner and distinct not-enough-data variants,
  H/M/L confidence chips, citations, ≤5 ranked gaps + more, and the "Act on this" → `actOnGap`
  memo flow. Gains: dated header, delta line, profile link on the not-enough-data variant.
- `internal.vault.profileSeedDocs` (vault.ts:467) — keys on `vaultDocuments.kind ===
  "business_profile"`; the same predicate the cron uses to enumerate onboarded tenants.
- `gmailAuth.flagExpiringTokens` (gmailAuth.ts:169) — **the pattern to copy**: a cron
  `internalMutation` that scans a domain table and inserts `notifications` rows DIRECTLY,
  bypassing `notifications.notify` (and therefore the Gmail send) with an unregistered kind.
- `importGuard.test.ts` / `llmRedaction.test.ts` — the static source-assertion test precedent for
  the no-OAuth and scoping guards.
- The `?thread=<id>` workspace deep-link (workspace/page.tsx:161-166) — built for VOIC-04, reused
  verbatim by the notification click.

### Established Patterns

- **CLAUDE.md §2** — no raw `query`/`mutation`/`action` imports outside `lib/functions.ts`; the
  cron path uses `internalMutation` / `internalAction` / `internalQuery` (the sanctioned internal
  builders) with explicit `tenantId` args.
- **CLAUDE.md §4** — audit and notification payloads carry refs, hashes, ids and counts only. The
  static notification message and the reuse of `evaluation.ran` both hold this.
- **Internal-twin convention** — an internal function that runs without live identity takes
  `tenantId` explicitly (`recordScorecardAnswerInternal`, `runEvaluation`, `lastForThread`).
- **`scheduler.runAfter(0, …)` as the isolation seam** — `notifications.notify` → `notifyExternal`
  is the in-repo precedent for handing slow/failure-prone work out of a fast transaction.
- **Optional schema fields → no migration** — the repo's standing rule (the `threadId`/`inReplyTo`
  precedent, schema.ts:139). The `delta` field follows it.
- **Append-only content rows** — `briefings` and `evaluations` both insert rather than patch; the
  reader takes `.order("desc").first()`.

### Integration Points

- `crons.ts` — one new `crons.weekly(...)` line.
- New backend module (assumed `proactiveReview.ts`) — `runWeekly` (internalMutation, enumerate +
  fan out) and `reviewOne` (internalAction: run evaluation, compute delta, insert notification).
- `schema.ts` `evaluations` table — one new **optional** `delta` object field.
- `evaluations.insertEvaluation` — accepts and persists `delta`.
- `cards.tsx` `EvaluationCard` — dated header, delta line, profile link on not-enough-data,
  pre-first-run empty state.
- `workspace/page.tsx` — static pinned "Weekly review" tab on the deterministic thread id.
- `NotificationsBanner.tsx` — renders the new `weekly_review` / `weekly_review_failed` kinds and
  their click destinations.
- Playbooks: the touched subsystems' playbooks must be updated in the same phase (CLAUDE.md §9),
  and the dashboard verification invocation documented.

### Constraints Worth Flagging to the Planner

- `notifications.notify` MUST NOT be used by this path — it sends Gmail. Insert directly.
- The thread id MUST be stable per tenant or carry-forward silently breaks.
- Convex crons are UTC and deploy-time; there is no per-tenant timezone field in the schema.

</code_context>

<deferred>
## Deferred Ideas

- **Per-tenant opt-out / mute toggle** for the weekly review — needs a settings row + settings UI.
  Add when a beta user asks.
- **Tenant-local delivery time** (e.g. Monday 08:00 local) — needs a per-tenant timezone field and
  an hourly cron with a due-filter. Revisit if UTC delivery proves annoying.
- **Review history UI** ("previous reviews" list) — rows already accumulate append-only, so this is
  purely a read surface whenever it's wanted.
- **Unread state on the pinned tab** — deferred with the dated header standing in as the freshness
  signal.
- **Any scheduled Google-bound call** (emailing the review, calendar-aware timing) — explicitly
  deferred to production OAuth in Stage S4 / Phase 25, per the roadmap.
- **Monthly "still healthy" heartbeat notification** — considered and rejected for now; revisit if
  users report feeling the system went silent.
- **Rich LLM narrative in the review** — already deferred by Phase 12; the engine stays
  deterministic here.

</deferred>

---

*Phase: 13-proactive-in-app-review*
*Context gathered: 2026-07-25*
