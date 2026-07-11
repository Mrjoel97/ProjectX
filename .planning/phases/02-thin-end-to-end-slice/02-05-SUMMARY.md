---
phase: 02-thin-end-to-end-slice
plan: 05
subsystem: delivery
tags: [convex, gmail, oauth, gmail.modify, delivery, dlvr-01, dlvr-03, cron, use-node]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "ActionRetrier (retrier.run wrapper), insert-only audit.log, tenant wrappers, use-node/DB-module split rule (worm.ts vs wormCursor.ts)"
  - phase: 02-thin-end-to-end-slice (02-01)
    provides: "requests table + status union, pipeline.setStatus reusable status setter, gmailTokens table"
  - phase: 02-thin-end-to-end-slice (02-03)
    provides: "notifications table + notify internalMutation (INTK-04 seam)"
provides:
  - "gmail.modify offline+consent OAuth connect flow storing a tenant-scoped refresh token read ONLY by internal functions (DLVR-03)"
  - "gmail.send use-node internalAction: on-demand access-token refresh + Gmail REST send, message id recorded as an audit ref (DLVR-01)"
  - "Reactive safety net: dead/refresh-failed token routes the request to awaiting_reauth WITHOUT throwing (approved draft preserved)"
  - "Proactive banner: daily cron flags tokens within ~24h of the 7-day refresh expiry into an in-app Reconnect notification (DLVR-03)"
  - "Pure tokenExpiry helper (isExpiringSoon / isDead) + window constants"
affects: [02-06-pipeline, phase-9-microsoft-graph, ops-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "use-node action module (gmail.ts) + non-node DB-helper module (gmailAuth.ts) reached via ctx.runQuery/runMutation — the worm.ts/wormCursor.ts rule applied to delivery"
    - "HMAC(tenantId, client_secret) as an opaque, tamper-evident OAuth `state` — no nonce table for the beta"
    - "Crown-jewel refresh tokens: read only by internal functions, never a client query, never an audit payload; gmailStatus exposes connected/expiresAt only"
    - "Token-death resolves the expiry race in the user's favor: awaiting_reauth, not a thrown failure that would burn retrier attempts and DLQ an approved draft"
    - "Explicit return-type annotations on use-node actions to stay under Convex's internal-graph circular-inference limit (guidelines §96)"

key-files:
  created:
    - packages/backend/convex/gmail.ts
  modified:
    - packages/backend/convex/gmailAuth.ts
    - packages/backend/convex/crons.ts
    - packages/backend/convex/llm.ts
  created-in-task-1:
    - packages/backend/convex/gmailAuth.ts
    - packages/backend/convex/http.ts
    - packages/backend/convex/lib/allowlist.ts
    - packages/core/src/tokenExpiry.ts
    - packages/core/src/tokenExpiry.test.ts

key-decisions:
  - "gmail.ts inserts nothing directly — every DB touch goes through internal queries/mutations (use-node holds only actions)"
  - "Token-age cron logic lives in gmailAuth.ts (flagExpiringTokens), cron only registers it — mirrors worm-export -> worm.ts"
  - "flagExpiringTokens inserts the notification row directly rather than routing through notifications.notify, to avoid pulling the whole `internal` graph into gmailAuth and creating a type cycle"
  - "gmail.send entering the internal graph tipped llm.ts past TS's circular-inference limit; fixed in-plan with return-type annotations (Convex guidelines §96), not deferred"

patterns-established:
  - "A new use-node action module joining the internal graph can tip sibling use-node actions past TS's circular-inference limit — annotate action return types (and runQuery results) proactively"

requirements-completed: [DLVR-01, DLVR-03]

# Metrics
duration: 30min
completed: 2026-07-11
---

# Phase 2 Plan 05: Gmail Delivery Integration Summary

**Shipped the gmail.modify offline+consent connect flow (tenant-scoped refresh token stored internally), a use-node send action that refreshes on demand and delivers via the Gmail REST API recording the message id as an audit ref, and both halves of DLVR-03 — a reactive awaiting_reauth safety net on token death plus a daily cron that flags near-expiry tokens into an in-app reconnect banner.**

## Performance

- **Duration:** ~30 min (resume — Task 1 pre-committed)
- **Completed:** 2026-07-11
- **Tasks:** 3 (Task 1 already committed at resume; Tasks 2-3 executed this session) + 1 deviation fix
- **Files:** 1 created, 3 modified this session (5 more created in the pre-committed Task 1)

## Accomplishments

- **Task 2 — `gmail.send`** (`gmail.ts`, `"use node"`): loads the token + request draft via internal queries, refreshes the access token at `oauth2.googleapis.com/token`, base64url-encodes an RFC-2822 MIME and POSTs to `gmail.googleapis.com/.../messages/send`. A 5xx **throws** (retrier retries → terminal failure DLQs); a refresh failure or missing token routes to `awaiting_reauth` and **returns** (no throw). Success records `{ requestId, messageId }` via `audit.log` (refs only) and returns — the pipeline owns the `sent` transition.
- **Task 3 — daily token-age cron:** `gmailAuth.flagExpiringTokens` scans `gmailTokens`, and for any row whose `_creationTime + REFRESH_TOKEN_TTL_MS` is within ~24h (`isExpiringSoon`) inserts an in-app `gmail_reconnect` notification. Registered as a second daily cron at 04:00 UTC; `worm-export` untouched. In-app only — an expiry alert must not depend on the mail path it reports on.
- Verified the pre-committed **Task 1** (token store, HMAC-state OAuth connect flow, `/gmail/callback` httpAction, `gmailStatus` client-safe query, pure `tokenExpiry` + tests) satisfies its done-criteria: importGuard 13/13, tokenExpiry 6/6.

## Task Commits

1. **Task 1 (pre-committed at resume): token store + gmail.modify OAuth connect flow** — `638c316` (feat), `19a5ac4` (test RED)
2. **Task 2: gmail send action (refresh + REST + awaiting_reauth)** — `a1edbb5` (feat)
3. **Task 3: daily gmail token-expiry scan cron** — `35fecd1` (feat)
4. **Deviation fix: break internal-graph circular type inference** — `5d567e7` (fix)

## Decisions Made

- **Cron logic in gmailAuth.ts, not crons.ts.** Convex crons reference a registered function; `crons.ts` can't hold DB logic inline. Put `flagExpiringTokens` in the gmail DB module (mirrors `worm-export` → `worm.ts`) and registered the schedule in `crons.ts`.
- **Direct notification insert in flagExpiringTokens.** Routing through `notifications.notify` would require importing the whole `internal` API into `gmailAuth.ts`, creating a `gmailAuth ⇄ internal` type cycle that collapses `llm.ts`'s inference. Since the mutation already has `ctx.db`, it inserts the row directly. `ponytail:` comment marks the OPSG-05 upgrade path (route through `notify` once channel dispatch lands).
- **Refresh clock = `_creationTime`.** `store` deletes+re-inserts on every fresh consent, so `_creationTime` always reflects the last connect — the 7-day Testing-mode window restarts on reconnect rather than inheriting a dead one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Broke internal-graph circular type inference tipped by gmail.ts**
- **Found during:** Task 2 verification (`pnpm --filter @pikar/backend typecheck`)
- **Issue:** Once `gmail.ts` (a second `"use node"` action module reaching `internal.gmailAuth.getForDelivery`) entered the generated `internal` graph, TS's circular-inference limit was exceeded and `llm.ts`'s `route`/`draft` actions collapsed to `any` (12 × TS7022/7023). Verified this was NOT caused by Task 3 (stashed Task 3 → llm.ts still broken) and NOT present until `_generated` regenerated to include `gmail.ts` (first typecheck, stale codegen → clean).
- **Fix:** Explicit return-type annotations per Convex guidelines §96 — `SendResult` on `gmail.send`; on `llm.ts` both handlers' return types (`{ routing: RoutingDecision; usage: GenUsage }` / `{ subject; body; usage }`) plus typed `runQuery` result consts. `GenUsage` lifts the AI-SDK usage type from `generateObject` (version-independent).
- **Files modified:** packages/backend/convex/gmail.ts, packages/backend/convex/llm.ts
- **Verification:** whole-tree `tsc` back to the exact 18-error pre-existing baseline (llm.ts fully clean); importGuard 13/13; tokenExpiry 6/6.
- **Committed in:** `5d567e7`

---

**Total deviations:** 1 auto-fixed (1 blocking). The fix touched `llm.ts` (02-02's file) because that is where TS reports the circularity and where the guidelines-blessed remedy applies; my `gmail.ts` was the entrant that surfaced it.

## Issues Encountered

- **Pre-existing whole-tree `tsc` red (18 errors).** Test files use `import.meta.glob` (tsc needs `vite/client`) and `smoke.ts` carries the same self-referential-workflow circular pattern. Pre-existing and out of scope (logged in `deferred-items.md`, now re-confirmed for 02-05 with the proven annotation remedy noted for the eventual `smoke.ts` cleanup). The authoritative backend typecheck remains `npx convex codegen` (uses `convex/tsconfig.json`, exit 0). My changes are net-zero against this baseline.
- **Background `convex dev` regenerates `_generated` mid-session** — the reason the circular-inference error appeared only after `gmail.ts` was committed and codegen picked it up (not a code regression).

## Authentication Gates

None during execution. The runtime OAuth consent (visiting the Google unverified-app screen) + real-inbox receipt are the manual-only checks defined in `02-VALIDATION.md` — not automatable here.

## User Setup Required

Convex env vars must be set for the connect flow + send to run against a real deployment (already named in the plan's `<interfaces>`): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI` (`{CONVEX_SITE_URL}/gmail/callback`). Gmail runs in Testing mode (7-day token expiry) — the DLVR-03 cron + `awaiting_reauth` net handle re-auth prompting.

## Next Phase Readiness

- **Ready for 02-06 (pipeline):** invoke delivery via `retrier.run(ctx, internal.gmail.send, { requestId })`; the pipeline owns the `sent` transition after `retrier.run` returns (do NOT set `sent` inside `send`). Token death surfaces as a returned `{ delivered: false, reason }` + a request already moved to `awaiting_reauth`.
- **Note for 02-06:** accumulate LLM `usages` from `llm.route`/`llm.draft` (now concretely typed) for `telemetry.writeTerminal`.

## Self-Check: PASSED

- Files: gmail.ts, gmailAuth.ts, crons.ts, tokenExpiry.ts, tokenExpiry.test.ts, http.ts, allowlist.ts — all FOUND.
- Commits: 638c316, 19a5ac4, a1edbb5, 35fecd1, 5d567e7 — all FOUND in git log.
- Gates: importGuard 13/13 green; tokenExpiry 6/6 green; whole-tree tsc at pre-existing 18-error baseline (zero new errors from this plan).

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*
