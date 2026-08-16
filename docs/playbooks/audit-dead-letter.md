# Playbook: Audit Log & Dead-Letter Pipeline

> Touched 2026-08-16 (eval-gate session) to clear the §9 Stop hook — **NOT a verification**, and
> deliberately not a `Last verified` line. **`packages/backend/convex/tenantDelete.ts` +
> `tenantDelete.test.ts` are newly REGISTERED to this playbook in `watch.json` by this session, and
> that registration is the ONLY thing done for them.** They arrived from the concurrent 22.1-05
> lane (`344d4be`, "revoke providers before tenant erasure") when the shared working tree switched
> branches mid-session; this session ran the eval gate and fixed `evaluations.ts`, and has neither
> read nor exercised tenant erasure.
>
> They were registered HERE rather than under `_unassigned` on purpose: `_unassigned` asserts a path
> genuinely needs no playbook, which is false for a tenant-ERASURE path with audit and retention
> consequences, and this playbook already owns its direct sibling `tenantExport.ts` — export and
> erasure being the two halves of the tenant data lifecycle. **Registration is not documentation:
> nothing below describes the erasure path, and the 22.1-05 lane still owes this playbook a real
> entry and a real `Last verified` bump.** The registration exists so the hook can protect that
> file from here on, not to imply it is covered.

> Last verified: 2026-08-16 (export budget is PER TABLE now — the global cap starved every
> table after the first big one. `exportableTables()` is a fixed order with `agentSteps` 10th
> and `telemetry` 15th, ahead of contacts/goals/proposals/vaultDocuments, so one 128-row global
> budget was spent before the business data was reached and those tables exported as NOTHING —
> silently, under a "portable record of the data Pikar AI holds for your account" promise.
> Coverage was an artefact of table position, not of what the tenant owns. Now
> `TENANT_EXPORT_ROWS_PER_TABLE = 500` per table, with `TENANT_EXPORT_TOTAL_ROW_CAP = 20_000`
> demoted to a memory bound on the single JSON blob the browser assembles, and page size 16 ->
> 256. `truncated` became STICKY in the cursor: the client overwrites `limits` with every page,
> so a table cut short twenty pages earlier would otherwise vanish from the final envelope.
> Cursor validation moved from `>` to `>=` on both ceilings — a legitimate cursor is never
> minted at either one, so an at-ceiling cursor is forged, and it used to reach `paginate` with
> `numItems: 0`. PROVEN NON-VACUOUS by mutation: forcing the total cap back to 128 turns both
> new tests red, and `tables.demoItems` comes back `undefined` — the starvation reproduced.
> tenantExport 4/4, tenantDelete 6/6, web dataControls 2/2.)

> Last verified: 2026-08-16 (22.1-04 — tenant data export). `tenantData.ts` classifies the
> `audit` table as `audit_immutable`; both `audit` and the refs-only dead-letter compliance plane are
> excluded from Art. 15/20 tenant exports with an explicit reason in the JSON file. This exclusion
> is safe only while the §4 refs/hashes/ids/counts-only write contract holds: personal data found in
> either payload is a write-site redaction defect, never a reason to widen the export. Credential
> tables are exported only as connected state, `updatedAt`, and scope-token lengths; OAuth token
> material never crosses the export boundary.
>
> Last verified: 2026-08-14 (17-06, ADR-018 — **a SECOND reconnect kind, and it stays OUT of
> `NOTIFICATION_KINDS` for the same reason the two review kinds do.**) `notificationTemplates.ts`
> gains `RECONNECT_PROVIDERS` / `RECONNECT` / `RECONNECT_KINDS`, a small table carrying the kind
> string, message, href and CTA for `gmail_reconnect` and the new `microsoft_calendar_reconnect`.
>
> **`NOTIFICATION_KINDS` IS BYTE-IDENTICAL, and that is the guarantee, not an omission.** That list
> is what arms `notifyExternal.dispatch`, which reaches `freshAccessToken` and sends MAIL. A
> reconnect prompt says "your connection is dying"; routing it through the connection it reports on
> is the loop this playbook's direct-insert bypass exists to avoid. The table lives beside the list
> it must stay out of precisely because that is where a future reader stands when tempted to add it.
>
> **The direct-insert bypass list now has THREE enumerated users**, not two:
> `gmailAuth.flagExpiringTokens`, `proactiveReview.insertReviewNotification`, and
> `microsoftAuth.store` — which does not insert but PATCHES `read: true`, retiring only
> `microsoft_calendar_reconnect` rows. Mutation-proven: relaxing that filter to
> `endsWith("_reconnect")` clears the user's `gmail_reconnect` banner and hides a Google connection
> that is still genuinely broken.
>
> ONE new audit eventType: `microsoft.disconnected`, written by `microsoftAuth.disconnectMicrosoft`,
> `actor:"user"`, correlationId `microsoft-disconnect:<tenantId>` (the `google.disconnected`
> precedent), payload EXACTLY `{deleted:boolean, revokedAtProvider:boolean}`. **`revokedAtProvider`
> is a HARD `false`, never a placeholder** — the Microsoft v2 delegated flow has no revocation
> endpoint, so the audit trail must record that the provider-side grant was NOT revoked and a later
> compliance read must not mistake this for a Google-style disconnect. `microsoftAuth.test.ts`
> asserts no audit row anywhere contains token material. `@pikar/core` `notificationTemplates.test.ts`
> stays green (the no-kind-arms-the-mail-path assertion is unaffected).

> Last verified: 2026-08-03 (15.3-04 repair — **a daily `vaultSweep` cron now backstops the extraction watchdog.** 15.3-04 moved watchdog arming from queue-time to work-start so queue depth can no longer fabricate `extraction_stalled` failures; the cost is that a row enqueued but whose action never reaches its handler body (deployment restart, dropped job) has no per-attempt clock at all. The resumable, batched, self-gating sweep now runs daily instead of only on an operator . `{ reset: true }` is REQUIRED, not decorative — `sweepPendingExtraction` is a @convex-dev/migrations migration and a completed migration NO-OPS on a bare invocation, the 2026-07-18 stranded-.xlsm lesson. Each re-queued extraction still self-gates on the kill switch and the budget.)
>
> Last verified: 2026-07-31 (22.1-01 — the Gmail disconnect). ONE new audit eventType: `google.disconnected`, written by `gmailAuth.disconnectGoogle`, `actor:"user"`, correlationId `google-disconnect:<tenantId>` (the `owner.granted` synthetic-id precedent), payload EXACTLY `{revoked:boolean, status:number}` — a flag and an HTTP status, nothing else. This is the single highest-risk audit row in the repo, because the function holds the refresh token in scope one line above the `log` call; `calendar.test.ts` asserts the exact key set AND that the serialized row contains neither the refresh nor the access token. One row per user action, on the transition only — a disconnect on an already-empty tenant still records `{revoked:false, status:0}`. No notification, no DLQ entry, no cron change; `NOTIFICATION_KINDS` byte-identical. Note the direct-insert bypass list below still has exactly two users: deleting the token row stops `flagExpiringTokens` producing NEW expiry notifications, but already-inserted unread ones survive a disconnect by design (see cockpit.md's Known gaps). Prior: 2026-07-25 (13-03 — the review's in-app surface). NO audit/DLQ/notification-plane behavior change: no new kind, no new audit eventType, `NOTIFICATION_KINDS` still byte-identical. ONE addition here — the `KIND_HREF` bullet in the Notification matrix: `NotificationsBanner` now renders a message as a `<Link>` when its kind has an entry in a code-owned kind→href map, and as today's plain `<span>` when it does not (opt-in per kind, two BEVL-03 entries, no new route). Web typecheck + `check-playbooks` exit 0; backend untouched. Prior: 2026-07-25 (13-02 — the proactive weekly review lands). NO audit/DLQ behavior change and NO new audit eventType: the review rides the existing refs-only `evaluation.ran` row (a `review.delivered` row would duplicate it). Two additions here: a **Cron jobs** section (the new `crons.weekly("proactive-review", monday 06:00 UTC)` alongside the two dailies, plus the `crons.weekly`-over-`crons.cron` override and its reason), and a Notification-matrix bullet recording that the DIRECT-insert bypass now has TWO enumerated users — `gmailAuth.flagExpiringTokens` and `proactiveReview.insertReviewNotification` — both bypassing `notify` because `notify` schedules `notifyExternal.dispatch` unconditionally. `NOTIFICATION_KINDS` is still byte-identical (the two review kinds stay out; that absence is the second barrier). Backend 494/495, sole red the pre-existing `audit.test.ts auditCounts`. Prior: 2026-07-25 (13-01 — proactive review groundwork). NO audit/DLQ/notification behavior change. `packages/core/src/notificationTemplates.ts` gained three static review constants (`REVIEW_THREAD_ID`, `REVIEW_READY_MESSAGE`, `REVIEW_FAILED_MESSAGE`) that are NOT notification kinds — see the last bullet of the Notification matrix for why that absence is the guarantee. `NOTIFICATION_KINDS` is byte-identical; `@pikar/core` 195/195 green including `notificationTemplates.test.ts`.
> Prior: 2026-07-24 (10-02 — vault grounding). New refs-only audit event `vault.searched` written by the `searchVault` cockpit tool (`llm.ts`): payload is EXACTLY `{ queryHash, resultCount }` — the raw search query is NEVER stored, only its `contentHash` fingerprint (§4); `resultCount` is the grounded-doc count. No content, no chunk substring, no doc title (titles live on the `vaultSources` content-plane row, never the audit). Asserted by `cockpitTools.test.ts` (SC3). NO DLQ/WORM behavior change.
> Last verified: 2026-07-24 (08-08 phase close — §9 sweep) — NO audit/DLQ behavior change. Phase 8 (self-improvement) touched two audit-dead-letter.md-watched paths: `packages/core/src/notificationTemplates.ts` gained the `optimizer.candidate` notification kind (the "candidate ready" owner notify — a static §4 label, no refs/content), and `packages/pii/` `scanText` is now ALSO the scrubber for the `/skillopt/export` trajectory plane (a SEPARATE PII-scrubbed export plane from the refs-only audit log; the names-in-prose gap is a recorded Phase-9 blocker in skill-registry.md). The new refs/counts-only `skill.optimized` audit row (`{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}`) is written by `/skillopt/writeback` and honors the §3 insert-only / §4 no-content contract. Bumped so the §9 Stop hook clears against the phase baseline.
> Last verified: 2026-07-21 (07-06 phase close) — full offline sweep GREEN (backend 398/399, sole red the documented `audit.test.ts auditCounts` component-not-registered non-regression; `@pikar/core` 145/145; `check-playbooks` exit 0), the four fail-closed grep-proofs hold (pipeline escalate→`return null` never DELIVER; cockpit `executePlan` `review_escalated` before the CAS flip; `worm.advanceCursor` only after `s3.send` resolves; notify sites carry only `notificationMessage(kind)` static labels). Runnable live smokes PASSED against :3210 — `smoke:worm` (stub-skip path, no `WORM_BUCKET`), `smoke:pipeline` (approve→awaiting_reauth, timeout→`expired`+`review.expired`, breach→`escalated`+`retry.limit`, NO send on either terminal), `smoke:dlq` (`deadLetters` row + `deadletter.written` audit + `deadletter` notify). **Owner-approved 2026-07-21; TWO cloud-infra-only checks owner-DEFERRED as Manual-Only (07-VALIDATION, phases 3.8/6 precedent — NOT silent gaps): (1) a real S3 object under COMPLIANCE Object Lock that refuses deletion (needs an AWS Object-Lock bucket + creds in the Convex deployment env; the export code + stub-skip are proven, only real-bucket durability deferred); (2) a real external email delivered to a live mailbox (needs a Gmail-connected user; the choke point + external dispatch + no-loop are unit-proven, only real deliverability deferred).** ALSO (07-06 gap-closure, same session — a live human-verify finding): the OPSG-05 **in-app render surface** `NotificationsBanner` was added + mounted in the app shell (renders unread `notifications.list` excl. `gmail_reconnect`, Dismiss→`markRead`). The email channel was live-proven (`Pikar: review.expired` delivered to the owner's real mailbox); the in-app row previously had no general render surface (only `ReconnectBanner`'s narrow `gmail_reconnect` filter) — a user-flagged gap now closed. **OWNER LIVE-VERIFIED 2026-07-21 ('I approve, I've seen it myself'): the banner rendered `agent.timeout` at the top of the app shell with a working Dismiss, confirmed on a PRODUCTION build (the local Next dev server had been serving a stale bundle — an env artifact, not a code defect; `next build` compiled the surface cleanly first try). VERIFICATION.md → passed; only real S3 Object-Lock durability stays owner-deferred.** PRIOR: against 07-05
> Build history: `.planning/phases/01-foundation-governance-substrate/`, `.planning/phases/03-guardrails/` · Related ADRs: [002](../decisions/002-insert-only-audit.md)

## Purpose

The **audit log** (`audit` table) is the insert-only, tenant-scoped ledger of every
governance event — every request, redaction, model call, tool execution, and review
action, from day one (a hard project constraint). The **dead-letter queue**
(`deadLetters` table) archives failed/canceled workflow runs so failures are never
silent: each dead letter also emits a `deadletter.written` audit event, drives the
request to a `failed` terminal state, and surfaces in the app shell's red badge.

## Key files

- `packages/backend/convex/schema.ts` — `audit`, `deadLetters`, `exportCursors` tables; raw content lives ONLY in `requests`/`plans`
- `packages/contracts/src/audit.ts` — `AuditPayload` type: refs/hashes/numbers/bools/string[] only, no nested objects
- `packages/backend/convex/audit.ts` — the SOLE audit write surface: `log` (internalMutation) + count helpers. No patch/replace/delete exists.
- `packages/backend/convex/deadLetter.ts` — DLQ **writers**: `onPipelineComplete` (workflow onComplete), `deadLetterRecipient` (per-recipient fan-out isolation)
- `packages/backend/convex/deadLetters.ts` — DLQ **operator read/resolve** surface: `newCount`, `listNew`, `markResolved` (tenant-scoped). Distinct file from `deadLetter.ts` — writers vs. readers.
- `packages/backend/convex/notifications.ts` — the OPSG-05 **notify choke point**: `notify` inserts the in-app row (always) then schedules the external channel. `list`/`markRead` are the tenant-scoped read surface.
- `packages/backend/convex/notifyExternal.ts` — the **external channel** (`dispatch`, "use node"): best-effort email of a STATIC kind label to the user's own mailbox via the governed Gmail send; fail-closed to in-app, loop-guarded.
- `packages/core/src/notificationTemplates.ts` — `NotificationKind` union + `notificationMessage(kind)`: the §4 static-label firewall (no content parameter exists to interpolate a body through).
- `apps/web/app/(app)/_components/NotificationsBanner.tsx` — the in-app **render surface** for the matrix: subscribes to `notifications.list` and renders every unread row (excluding `gmail_reconnect`, which `ReconnectBanner` owns) as a neutral dismissible banner row; Dismiss → `markRead`. Mounted in the app shell (`layout.tsx`), stacked with the sibling banners.
- `packages/pii/src/scan.ts` — the redaction engine: `scanText` → `{ safeText, counts, entities }`; pure TS, fail-closed (see `.planning/design/pii-engine.md`)
- `packages/backend/convex/worm.ts` + `wormCursor.ts` + `crons.ts` — WORM S3 export: daily 03:00 UTC cron. `worm.ts` ("use node") does the real `@aws-sdk/client-s3` PutObject; `wormCursor.ts` holds the cursor query/mutation + the index-backed `auditSince` window; the pure serialization/key/retention math is `@pikar/core` retention.ts
- Tests: `auditImmutability.test.ts`, `audit.test.ts`, `deadLetters.test.ts`, `worm.test.ts`, `llmRedaction.test.ts`, `packages/pii/src/scan.test.ts`

## Dependencies & blast radius

`graphify query "audit dead letter"`. Nearly every backend module writes audit
(`pipeline.ts`, `llm.ts`, `cockpit.ts`, `gmail.ts`, `deliverApprovedPlan.ts`,
`requests.ts`, `deadLetter.ts`, `smoke.ts`) — changing `audit.log`'s signature or the
`AuditPayload` type touches all of them. Couplings graphify cannot see:
- Workflows must be started with `{ onComplete: internal.deadLetter.onPipelineComplete, context }` or their failures vanish
- `WORM_BUCKET` env (unset ⇒ export is a clean no-op); AWS creds live in the Convex deployment env, not Vercel

## Data flow

1. **Audit write**: any internal mutation/action calls `internal.audit.log` with an already-redacted payload; `log` inserts the row and mirrors it into the `auditCounts` aggregate.
2. **Workflow failure**: `onPipelineComplete` fires on workflow completion; on `failed`/`canceled` it inserts a `deadLetters` row (status `new`), writes a `deadletter.written` audit event, fires a `deadletter` **user notification** (OPSG-05 — only when a `requestId` ref is present in `context.payload`; synthetic smokes skip it), patches the request to `failed`, and writes exactly one `failed` telemetry row (idempotent by correlationId). Success returns early.
3. **Per-recipient failure**: `deadLetterRecipient` does the same for one recipient row inside the fan-out loop (including the `deadletter` notification), so one bad recipient never poisons the batch.
4. **Resolve**: operator calls `markResolved` (`new → resolved`, idempotent). There is NO replay — the `replayed` status enum member exists in the schema but is deliberately unwritten until idempotency is specified.
5. **WORM export**: the daily cron reads audit rows past the cursor via the index-backed `auditSince` window and, when `WORM_BUCKET` is set, PutObjects them to S3 as NDJSON under COMPLIANCE-mode Object Lock with a SHA256 checksum, then advances the cursor **only after** the PutObject resolves. With `WORM_BUCKET` unset it takes the clean stub-skip path (no PutObject, no advance). An empty window returns `{ exported: 0 }` without a PutObject. **Export only** — the hot `audit` table is never deleted/swept (owner ruling; SC#4's sweep clause is deferred).

## Notification matrix (OPSG-05)

Every failure terminal in Phase 7 surfaces to the user through ONE wiring layer. `internal.notifications.notify`
is the **single choke point**: it always inserts the in-app row first (the fail-closed floor), then
`ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, { tenantId, kind })` best-effort dispatches an
external email. Scheduling an action from the mutation keeps the notify transaction fast and isolates a slow/failing
send from the in-app write.

- **Sites** (each fires `notify` beside its audit/telemetry): `validation.rejected` + `guardrail.blocked` (submit /
  pipeline), `review.expired` + `review.escalated` / `retry.limit` (review gate, 07-03/04), `agent.timeout` (cockpit,
  07-04), `awaiting_reauth`, and `deadletter` (both DLQ terminals, 07-05).
- **External is fail-closed to in-app**: `notifyExternal.dispatch` emails the user's OWN mailbox (send-to-self,
  resolved via a read-only `users/me/profile` GET) reusing gmail.ts's `freshAccessToken`/`buildMime`/`base64Url` +
  the governed `SEND_ENDPOINT`. No connected mailbox / refresh fail / send error → it returns silently. The in-app
  row already written is the guarantee; email is a bonus channel.
- **Loop guard**: a failed external send NEVER throws, NEVER calls `notify`, NEVER writes a `deadLetter` — the whole
  dispatch is wrapped in a `try/catch` that logs a refs-only `console.warn` and returns. A dead-lettered external
  send that re-notified would recurse; this is why the dispatch is the ONLY place that path lives.
- **§4 firewall**: every message is `notificationMessage(kind)` (static) or a static-label interpolation
  (`${LABELS[reason]}`) — never interpolated content. The external mail carries only the kind enum member (subject) +
  `notificationMessage(kind)` (body): no requestId, no content. Enforced statically by `llmRedaction.test.ts`'s
  two 07-05 scans (mutation-checked: injecting `${…body}` into any notify message, or a content field into the
  external mail, trips them RED).
- **In-app render surface**: `NotificationsBanner` (app shell) renders every UNREAD `notifications.list` row —
  excluding `gmail_reconnect`, which `ReconnectBanner` owns (no double-surfacing) — as a neutral dismissible banner
  (Dismiss → `markRead`). This is the in-app HALF of the matrix: the in-app row + this surface are the fail-closed
  floor, the email is the bonus channel. Neutral styling only — NOT amber (`--held` is the approval gate's alone,
  BRAND §2); meaning is carried by the message text, never colour (§6). The `message` is `notificationMessage(kind)`
  (static, §4), so rendering it carries no content/PII.
- **The weekly review's two labels are DELIBERATELY OUTSIDE this matrix (13-01, BEVL-03)** —
  `notificationTemplates.ts` also exports `REVIEW_THREAD_ID` (the deterministic thread id the
  backend cron and the web pinned tab must both agree on), `REVIEW_READY_MESSAGE` and
  `REVIEW_FAILED_MESSAGE`. Both messages are static, refs/counts-free §4 labels — but the two review
  kinds are NOT members of `NotificationKind`/`NOTIFICATION_KINDS`, and that ABSENCE is the security
  property, not an oversight: `notifyExternal.dispatch` returns at `if (!KINDS.has(kind)) return;`
  BEFORE `freshAccessToken`, so an unregistered kind can never reach a Gmail token or the mailbox
  path. The proactive review is an IN-APP surface only. Adding them to `NOTIFICATION_KINDS` would
  arm the email channel for it and break `notificationTemplates.test.ts`'s element-by-element
  assertion on the closed array. Do not.
- **The DIRECT-insert bypass now has TWO users (13-02)** — `gmailAuth.flagExpiringTokens`
  (`gmail_reconnect`) and `proactiveReview.insertReviewNotification`
  (`weekly_review` / `weekly_review_failed`). Both write `ctx.db.insert("notifications", …)`
  themselves instead of calling `notify`, and for the SAME structural reason in both cases: `notify`
  schedules `notifyExternal.dispatch` UNCONDITIONALLY (there is no conditional around the schedule),
  and a notification ABOUT the mail path must not depend on the mail path. This is a deliberate,
  enumerated exception list — not a pattern to copy casually. Anything that should reach email goes
  through `notify`. `proactiveReview.test.ts`'s SC#2 guard asserts the review module imports no
  `gmail`/`gmailAuth`/`notifyExternal`, never names `notifications.notify`, and DOES perform the
  direct insert (so a module that quietly stopped notifying could not pass by doing nothing).
- **`KIND_HREF` — the per-kind click destination (13-03)** — `NotificationsBanner` holds a
  `Record<string, string>` mapping a `kind` to an in-app href. A kind WITH an entry renders its
  message as a `next/link` `<Link className="notif-msg">`; a kind WITHOUT one keeps today's plain
  `<span className="notif-msg">`. It is therefore OPT-IN per kind, and absence is the default — no
  existing kind changed behaviour. Two entries today, both BEVL-03: `weekly_review` →
  `/dashboard/workspace?thread=<REVIEW_THREAD_ID>` (the existing VOIC-04 deep-link — no new route
  was added) and `weekly_review_failed` → `/dashboard/workspace` (where the on-demand
  `evaluateBusiness` path lives). The href is a code-owned CONSTANT built from `@pikar/core`, never
  from notification data, so no row can steer a user anywhere; and `message` is a static §4 label by
  contract, so using it as link TEXT carries no PII. The Dismiss button, the `gmail_reconnect`
  exclusion, and the `notif-*` classes are untouched. The link is distinguished by the default
  anchor underline (`globals.css` sets only `a { color: inherit }`), not by colour alone (BRAND §6).

## Cron jobs (`packages/backend/convex/crons.ts`)

Three registrations, each a one-liner delegating to a module that owns the logic:

| Cron | Schedule (UTC) | Target | Notes |
|------|----------------|--------|-------|
| `worm-export` | daily 03:00 | `internal.worm.exportAudit` | S3 Object-Lock export; clean stub-skip with `WORM_BUCKET` unset |
| `gmail-token-expiry-scan` | daily 04:00 | `internal.gmailAuth.flagExpiringTokens` | in-app `gmail_reconnect` before delivery breaks (DLVR-03) |
| `proactive-review` | **weekly, monday 06:00** | `internal.proactiveReview.runWeekly` | BEVL-03; in-app only, no mailbox token (see `business-evaluation.md`) |

- `crons.weekly` is used DELIBERATELY over `crons.cron` for the review.
  `_generated/ai/guidelines.md:287` bans the named helpers, but that file is Convex-authored codegen
  output, not a repo decision — this file already runs two `crons.daily` jobs, and `weekly` is a
  fully-typed, non-deprecated public API in the pinned `convex@1.42.1` (`WeeklySchedule` /
  `CronJobs.weekly`). Do not re-litigate.
- `dayOfWeek` MUST be lowercase (`"monday"`). The runtime validator rejects `"Monday"`; the JSDoc
  example is wrong.

## Invariants — what must never break

- **Insert-only audit** (CLAUDE.md §3): `audit.ts` exposes only inserts; no `.patch`/`.replace`/`.delete` on audit anywhere; no public builder writes audit. Enforced statically by `auditImmutability.test.ts`.
- **Redaction-safe payloads** (CLAUDE.md §4): audit/DLQ/telemetry payloads carry refs, hashes, ids, counts only — never raw content or PII. Enforced by the `AuditPayload` type (no nested objects), `llmRedaction.test.ts` (static), and `assertNoRawPiiFanout` in `smoke:fanout` (runtime).
- **Redact-then-write ordering**: `scanText` runs BEFORE any log write; only `safeText`/`safeTextHash`/`counts` cross into log planes. Raw `entities` from the scanner are never destructured in llm/guardrails/pipeline code (checked by `llmRedaction.test.ts`).
- **Tenant scoping**: operator DLQ surface goes through `tenantQuery`/`tenantMutation`; cross-tenant `markResolved` rejection and unauth fail-closed are tested in `deadLetters.test.ts`.
- **Advance only after a durable write** — the WORM cursor advances ONLY after the PutObject promise resolves. On any throw (or the `WORM_BUCKET`-unset stub-skip path) the cursor stays put and the next cron retries the SAME window; the deterministic object key ⇒ byte-identical NDJSON body ⇒ idempotent overwrite under Object Lock. Advancing before a durable write would mark unexported rows as exported — a permanent compliance hole. Tested in `worm.test.ts` (mocked S3 send: durable→advance, throw→no-advance, empty→skip).
- **Object-Lock bucket precondition** — the S3 bucket MUST be created with Object Lock ENABLED (it cannot be enabled after creation) and a default COMPLIANCE retention. Object-Lock retention requires the checksum header (SDK v3 flexible checksums), which the export sends. AWS creds + `WORM_BUCKET`/`AWS_REGION` live in the **Convex deployment env** (`npx convex env set`), NEVER Vercel (§7).
- **DLQ writes idempotent by correlationId** — never a second terminal telemetry row.

## How to change safely

- **New audit event type**: redact first, build a payload of refs/counts only, call `internal.audit.log`. If the writer is a new file, extend `llmRedaction.test.ts`'s scan scope to cover it. Event-type examples: `briefing.created` `{ briefingId, range, listedCount, digestedCount }`, `mailbox.searched` `{ queryHash, resultCount }`, and (10-02) `vault.searched` `{ queryHash, resultCount }` — the vault-grounding fingerprint: `queryHash = contentHash(query)` (the raw query never stored, §4), `resultCount` = grounded docs.
- **New workflow**: always pass `onComplete: internal.deadLetter.onPipelineComplete` with a refs-only `context` payload, or failures are silent.
- **New notification site**: add the kind to `NotificationKind` (`@pikar/core`, forces a `Record` message entry) and call `internal.notifications.notify` with `message: notificationMessage(kind)` — never interpolate content. The in-app + external channels come for free through the choke point; do NOT call `notifyExternal.dispatch` directly (it must only ever be the scheduled best-effort tail, never a caller-facing seam, or the loop guard is bypassed).
- **Never** add a mutating audit function, a public audit writer, or a payload field that could carry user content. If a debugging need tempts you to store content, store it in the content plane (`requests`/`plans`) and put the ref in the payload.
- **Changing the WORM export (OPSG-03)**: the real export lives in `worm.ts` ("use node", `@aws-sdk/client-s3`). Keep the two invariants intact: (1) the `WORM_BUCKET`-unset stub-skip branch never advances the cursor; (2) `advanceCursor` runs ONLY after the PutObject resolves — never move it before the `await s3.send(...)` or into a `.catch`. Serialization/key/retention math stays pure in `@pikar/core` retention.ts (`serializeAuditNdjson` sorts keys → byte-identical re-export → idempotent PutObject; `wormObjectKey`; `retainUntilDate`/`RETENTION_MS`) — do not inline it. Never add a delete/sweep of the hot `audit` table here (export-only, owner ruling).
- **DLQ replay**: blocked on specifying idempotency; the `replayed` status is reserved for it.

## How to verify

- `pnpm --filter @pikar/backend test` — immutability scan, audit round-trip, DLQ surface + tenant rejection, WORM cursor safety, redaction static scan
- `pnpm --filter @pikar/pii test` — no raw PII survives into `safeText`
- Live smokes (need a running deployment; workflows don't run under convex-test): `smoke:dlq`, `smoke:fanout`, `smoke:guardrails`, `smoke:pipeline`, `smoke:worm` (see `packages/backend/package.json`). `smoke:worm` has two modes: with `WORM_BUCKET` unset it asserts the stub-skip path; with `WORM_BUCKET` set (deployment env + AWS creds also set) it runs the real export and asserts an export count — then a human confirms ONE object in the S3 console carries ObjectLockMode + RetainUntilDate + checksum, and that a delete attempt is refused (Node cannot assert S3 durability; 07-VALIDATION Manual-Only).

## Operational notes

- **Unseeded skills dead-letter every request** with `NO_ACTIVE_SKILL: executive-router` — run `skills:seedSkills` (skill names are hyphenated: `executive-router`, not `executive_router`)
- Retention: nothing is ever deleted in Convex; the immutable copy is the S3 export. Object Lock retention period = `RETENTION_MS` (7 years, `@pikar/core`) — a ponytail default; lift to a per-tenant/regulatory policy if retention rules diverge.
- Dead-letter reasons are distinct and explicit (`unknown_route` vs `route_not_implemented`) — never add a silent default reason
- Operator visibility: red badge in the app shell bound to `deadLetters.newCount`

## Known gaps & deferred work

- WORM export is REAL (07-02): daily cron → S3 COMPLIANCE Object Lock + checksum, cursor advances only after a durable write. **SC#4 is PARTIALLY met — the WORM export is implemented; the hot-audit-copy sweep/delete is DEFERRED per owner ruling (2026-07-21, export-only; §3/ADR-002 stay literally intact, no new ADR). A future phase may add a §3-reconciling retention-delete path.** This is never a silent gap — the deferral is recorded here for the goal-backward verifier. Retention is specified: `RETENTION_MS` = 7 years (`@pikar/core`).
- No DLQ replay path yet (`replayed` status reserved)
- The `audit` table now has a global `by_ts` index (07-01) that backs `auditSince` (was a full scan) and the cross-tenant WORM export window
- Not every `audit.log` caller's payload is covered by the static scan (e.g. `gmail.ts`, `deliverApprovedPlan.ts`) — extend `llmRedaction.test.ts` when touching those
