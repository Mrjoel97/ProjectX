---
phase: 13-proactive-in-app-review
verified: 2026-07-25T18:40:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 13: Proactive In-App Review Verification Report

**Phase Goal:** Scheduled recurring in-app business review, using no OAuth mailbox token (BEVL-03).
**Verified:** 2026-07-25T18:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A weekly Convex cron runs the evaluation engine once per onboarded tenant | ✓ VERIFIED | `crons.ts:28` registers `crons.weekly("proactive-review", { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 }, internal.proactiveReview.runWeekly, {})`; `proactiveReview.ts:37-52` `runWeekly` enumerates `vaultDocuments` via the `by_kind` index (`kind === "business_profile"`), dedupes by tenant, fans out via `ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne, …)`. Live-verified: `13-04-SUMMARY.md` records two real `runWeekly` invocations via `npx convex run` that each produced the expected DB writes. |
| 2 | Each run writes an evaluation row on that tenant's stable review thread | ✓ VERIFIED | `proactiveReview.ts:59-105` `reviewOne` calls `internal.evaluations.runEvaluation({ tenantId, threadId: REVIEW_THREAD_ID, framework: last?.framework, withDelta: true })`, `REVIEW_THREAD_ID = "proactive-review"` (`notificationTemplates.ts:49`). Test `proactiveReview.test.ts > writes a review card and a notification` passes; live run confirmed an `evaluations` row with `threadId: "proactive-review"` created on both invocations (13-04-SUMMARY.md). |
| 3 | An in-app notification appears when the review is new/changed, silent when unchanged | ✓ VERIFIED | `reviewOne`'s `changed` predicate (`!last \|\| last.verdict !== res.verdict \|\| delta non-empty`) gates the notification insert. Test `notifies only on change` passes (2 evaluation rows, exactly 1 notification). Live run reproduced this exactly: 2 `evaluations` rows, 1 `weekly_review` notification, `delta` on row 2 = `{gapsClosed: [], gapsOpened: [], newFindings: 0}`. |
| 4 | A failed review still tells the user in-app, with no failure detail on the notification plane | ✓ VERIFIED | `reviewOne`'s `catch` block inserts `kind: "weekly_review_failed"` with the static `REVIEW_FAILED_MESSAGE` (no exception detail passed through). `insertReviewNotification` only accepts the two static kinds/messages — no free-text failure reason is representable in its args shape. |
| 5 | No code path in the review touches Gmail, notifyExternal, or notifications.notify | ✓ VERIFIED | `proactiveReview.ts` imports only `@pikar/core`, `convex/values`, `./_generated/*` — no gmail/notifyExternal import. Static guard test `no mailbox token` (SC#2) asserts (comment-stripped source) no import of `gmail`/`gmailAuth`/`notifyExternal`, no `notifications.notify` call, and that neither `weekly_review` nor `weekly_review_failed` is in `NOTIFICATION_KINDS` (confirmed: the 9-member array in `notificationTemplates.ts:28-39` does not include either). Live run: Gmail was disconnected throughout and the review still generated/notified/rendered (13-04-SUMMARY.md, "SC#2 — proven the hard way"). |
| 6 | Tenant A's review is unreadable by tenant B | ✓ VERIFIED | Static guard test `tenant-scoped` (SC#3) walks every `ctx.db.query(...)` in the module source and asserts each `.withIndex(` first `q.eq(` is `"tenantId"`, with exactly one named `by_kind` exception (the enumerator), and every `ctx.db.insert(` carries `tenantId`. Behavior test `cross-tenant isolation` passes: tenant B's rows carry only B's tenantId and tenant B's `api.evaluations.byThread` read never surfaces tenant A's row. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/backend/convex/schema.ts` | `evaluations.delta` optional field + `vaultDocuments.by_kind` index | ✓ VERIFIED | Line 370 `delta: v.optional(v.object(...))`; line 611 `.index("by_kind", ["kind"])` with cross-tenant rationale comment. |
| `packages/backend/convex/evaluations.ts` | `withDelta` arg, in-engine delta computation, delta persisted + returned | ✓ VERIFIED | Confirmed via `evaluations.test.ts` (11/11 passing incl. 4 delta tests); `insertEvaluation` remains the sole write surface (no `patch` added, per 13-01-SUMMARY self-check). |
| `packages/core/src/notificationTemplates.ts` | `REVIEW_THREAD_ID` / `REVIEW_READY_MESSAGE` / `REVIEW_FAILED_MESSAGE`, kinds NOT in `NOTIFICATION_KINDS` | ✓ VERIFIED | Lines 43-52; `NOTIFICATION_KINDS` (lines 28-39) has its original 9 members, review kinds absent. |
| `docs/playbooks/watch.json` | playbook coverage for `proactiveReview.ts`/`.test.ts` | ✓ VERIFIED | `business-evaluation.md` array includes both paths (lines 9-10). |
| `packages/backend/convex/proactiveReview.ts` | `runWeekly`, `reviewOne`, `insertReviewNotification`, ~60+ lines | ✓ VERIFIED | 133 lines, all three exports present, wired to `crons.ts` and `evaluations.ts`. |
| `packages/backend/convex/proactiveReview.test.ts` | SC#1 behavior tests + SC#2/SC#3 static guards, 100+ lines | ✓ VERIFIED | 8 tests, all passing (`vitest run convex/proactiveReview.test.ts` → 8/8). |
| `packages/backend/convex/crons.ts` | weekly registration | ✓ VERIFIED | `crons.weekly("proactive-review", { dayOfWeek: "monday", ... })` present, three total cron jobs registered. |
| `apps/web/app/(app)/dashboard/workspace/page.tsx` | pinned non-closable review tab + composer suppression | ✓ VERIFIED | `REVIEW_TAB` seeded into initial `tabs` state; pinned tab drops `has-close`/close button; `closeTab` early-returns on `REVIEW_THREAD_ID`; left pane renders explainer instead of `ChatPane` when `threadId === REVIEW_THREAD_ID`, checked before the gmail-status branch. |
| `apps/web/app/(app)/dashboard/workspace/cards.tsx` | dated header, delta line, profile CTA, pre-first-run empty state | ✓ VERIFIED | `isReview`, `deltaLine()`, `evaluation-empty` testid gated on `evaluation === null` (not `undefined`), `/dashboard/profile` CTA link inside the insufficient-data box. |
| `apps/web/app/(app)/_components/NotificationsBanner.tsx` | per-kind click destination | ✓ VERIFIED | `KIND_HREF` map with `weekly_review` → `/dashboard/workspace?thread=proactive-review`, `weekly_review_failed` → `/dashboard/workspace`; rendered as `<Link>` when present. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `crons.ts` | `internal.proactiveReview.runWeekly` | `crons.weekly(...)` registration | ✓ WIRED | Confirmed at `crons.ts:28`. |
| `proactiveReview.ts` (`runWeekly`) | `internal.proactiveReview.reviewOne` | `ctx.scheduler.runAfter(0, …)` per tenant | ✓ WIRED | `proactiveReview.ts:47-49`. |
| `proactiveReview.ts` (`reviewOne`) | `internal.evaluations.runEvaluation` | `ctx.runAction` with `withDelta: true` on `REVIEW_THREAD_ID` | ✓ WIRED | `proactiveReview.ts:76-81`. |
| `proactiveReview.ts` | `notifications` table | `ctx.db.insert` DIRECTLY, never `notifications.notify` | ✓ WIRED | `insertReviewNotification` (`proactiveReview.ts:117-132`) inserts directly; static guard test confirms absence of `notifications.notify` call. |
| `page.tsx` | `ChatPane` | NOT rendered when `threadId === REVIEW_THREAD_ID` | ✓ WIRED | Confirmed at `page.tsx:324-331`; live-verified in browser (no composer/textarea on review tab). |
| `cards.tsx` | `evaluation.delta` | delta line rendered from the persisted row | ✓ WIRED | `deltaLine(evaluation.delta)` called and rendered conditionally (`cards.tsx:1384,1434,1447`). |
| `NotificationsBanner.tsx` | `/dashboard/workspace?thread=proactive-review` | `KIND_HREF` lookup rendering the message as a `Link` | ✓ WIRED | Confirmed; live-verified clickable link opened the review tab with dedupe (no duplicate tab). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| BEVL-03 | 13-01, 13-02, 13-03, 13-04 (all four plans declare it) | A proactive business review is delivered in-app on a recurring cadence, using no OAuth mailbox token | ✓ SATISFIED | REQUIREMENTS.md:122 already marked `[x]` and REQUIREMENTS.md:242 maps it to Phase 13 "Complete". All 6 truths above verified; live production-entry-point run (13-04-SUMMARY.md) confirms end-to-end behavior with Gmail disconnected throughout. No orphaned requirement IDs found for Phase 13 in REQUIREMENTS.md beyond BEVL-03. |

No orphaned requirements: BEVL-03 is the only ID mapped to Phase 13 in REQUIREMENTS.md and it appears in every plan's `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | A scan of `proactiveReview.ts`, the schema/notification-template additions, and the three web files found no TODO/FIXME/placeholder markers, no stub returns, and no console.log-only handlers. Two intentional `ponytail:` comments exist (`proactiveReview.ts:33` reads full profile docs rather than a projected field — documented ceiling and upgrade path) — this is a marked, deliberate simplification, not a gap. |

### Human Verification Required

None outstanding. The phase's one manual gate (Task 2 of 13-04-PLAN.md, `checkpoint:human-verify`) was already executed and recorded in `13-04-SUMMARY.md`: two real `proactiveReview:runWeekly` invocations via the Convex CLI (functionally identical production entry point to the dashboard runner named in the plan), producing 2 `proactive-review` evaluation rows, exactly 1 `weekly_review` notification, a stable `findingCount: 8` across the unchanged re-run (proving the provenance-collapse fix holds in production), refs-only audit with no new eventType, a pinned tab with composer suppressed, a clickable notification with working deep-link dedupe, and Gmail disconnected throughout (proving SC#2). This satisfies plan 13-04's `<resume-signal>` and `<done>` criteria.

### Gaps Summary

None. All 6 observable truths verified against actual source and tests; all 11 required artifacts exist, are substantive, and are wired; all 7 key links confirmed; the sole requirement (BEVL-03) is satisfied with both automated and live human-verified evidence. The three pre-existing conditions noted in the verification brief (auditCounts test failure, 52 backend test-file typecheck errors, load-sensitive test timeouts) were independently re-confirmed as unchanged baselines during this verification and are not attributed to Phase 13.

---

*Verified: 2026-07-25T18:40:00Z*
*Verifier: Claude (gsd-verifier)*
