// BEVL-03 — the chief-of-staff initiates. A weekly cron runs the Phase-12 evaluation engine per
// tenant and delivers the result IN-APP: an evaluation card on a stable per-tenant review thread
// plus a notification. It touches NO OAuth mailbox token, so proactivity cannot break on the
// Google 7-day testing-token expiry (SC#2). Any Google-bound scheduled call is deferred to
// production OAuth (Stage S4 / Phase 25).
//
// The cron runs with NO authenticated identity, so `tenantQuery`/`tenantMutation` (which call
// requireTenant → ctx.auth) are structurally uncallable. Every function here takes an explicit
// validated `tenantId` — the established internal-twin convention (runEvaluation, lastForThread,
// recordScorecardAnswerInternal) — and every scoped read/write carries it (SC#3).
import { REVIEW_FAILED_MESSAGE, REVIEW_READY_MESSAGE, REVIEW_THREAD_ID } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * The weekly entry point: enumerate onboarded tenants and fan out one review each.
 *
 * Enumerates over `vaultDocuments.by_kind` — the ONE deliberately cross-tenant index in the repo
 * (13-01). Onboarded ⇒ reviewed: a `business_profile` doc is exactly the artifact onboarding
 * commits, so its existence IS the "this tenant has something to review" predicate. The
 * alternative — a `.collect()` over `by_tenant` — would read every document's `text` blob, and
 * this table holds book-sized uploads, so the 16 MiB / 32k-doc transaction cap is reachable at
 * beta scale.
 *
 * Dedupe is required, not defensive: a tenant can hold more than one profile-kind doc (profile
 * enrichment re-commits leave the old one), and ONE review per tenant per week is the contract.
 *
 * `runAfter(0, …)` is not stylistic — a mutation cannot call an action inline, and the scheduler
 * is also what isolates one tenant's failed review from every other tenant's.
 *
 * ponytail: reads the full profile docs to get their tenantIds (Convex has no projection). Fine
 * while profiles are a few KB each; if beta scale makes this transaction heavy, add a dedicated
 * `onboarded` marker table rather than widening the read.
 */
export const runWeekly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seen = new Set<string>();
    for (const doc of await ctx.db
      .query("vaultDocuments")
      .withIndex("by_kind", (q) => q.eq("kind", "business_profile"))
      .collect()) {
      if (seen.has(doc.tenantId)) continue;
      seen.add(doc.tenantId);
      await ctx.scheduler.runAfter(0, internal.proactiveReview.reviewOne, {
        tenantId: doc.tenantId,
      });
    }
  },
});

/**
 * One tenant's weekly review: run the engine on the stable review thread, then notify IF something
 * changed. The evaluation row is written every week regardless (the engine always persists) —
 * only the notification is conditional, so the card is always current and the bell stays quiet.
 */
export const reviewOne = internalAction({
  args: { tenantId: v.string() },
  // Explicit `Promise<void>` + explicit local types on every runQuery/runAction result: this repo
  // has twice had a new cross-module internal call collapse TypeScript's inference of the WHOLE
  // generated API graph (Pitfall 9 — see the EvaluationDelta note in evaluations.ts and the
  // ponytail note at gmailAuth.ts:164). Do not let these be inferred.
  handler: async (ctx, { tenantId }): Promise<void> => {
    try {
      // ONE read serves both jobs: carry last week's framework forward (compare like with like)
      // and supply the previous verdict for the notify-on-change decision.
      const last: Doc<"evaluations"> | null = await ctx.runQuery(
        internal.evaluations.lastForThread,
        { tenantId, threadId: REVIEW_THREAD_ID },
      );
      const res: {
        verdict: string;
        delta?: { newFindings: number; gapsClosed: string[]; gapsOpened: string[] };
      } = await ctx.runAction(internal.evaluations.runEvaluation, {
        tenantId,
        threadId: REVIEW_THREAD_ID, // STABLE, never per-week: lastForThread is indexed on
        // (tenantId, threadId), so a weekly id would silently reset the Scorecard and re-ask
        // answered figures. Carry last week's framework forward to compare like with like —
        // EXCEPT the Phase-14 voice-doc literal, which runEvaluation refuses at its validator
        // (see the pin at evaluations.ts runEvaluation args). A "document-review" row cannot
        // reach this thread today (those live on synthetic `voice-doc:<sessionId>` threads), so
        // this is a type-level guard, not a live branch: fall back to the engine's auto-pick
        // rather than throw, because the weekly review must never fail on a framework it can
        // simply re-derive.
        framework: last?.framework === "document-review" ? undefined : last?.framework,
        withDelta: true,
      });
      const d = res.delta;
      // Notify-on-change keeps the bell meaningful: first review ever, verdict moved, or the delta
      // is non-empty. An idea-stage tenant gets ONE "not enough data" ping, then silence.
      const changed =
        !last ||
        last.verdict !== res.verdict ||
        Boolean(d && (d.newFindings > 0 || d.gapsClosed.length > 0 || d.gapsOpened.length > 0));
      if (changed) {
        await ctx.runMutation(internal.proactiveReview.insertReviewNotification, {
          tenantId,
          kind: "weekly_review",
        });
      }
    } catch {
      // runEvaluation itself FAILS OPEN (a thin-data verdict is a result, not a failure) — this
      // catches the transaction/scheduler level. Surface it: silence would look identical to a
      // healthy quiet week. The REASON never reaches the notification plane (§4).
      await ctx.runMutation(internal.proactiveReview.insertReviewNotification, {
        tenantId,
        kind: "weekly_review_failed",
      });
    }
  },
});

/**
 * The in-app delivery surface for the review.
 *
 * SC#2, load-bearing: this does NOT go through `notifications.notify`. `notify` unconditionally
 * schedules `internal.notifyExternal.dispatch` (there is no conditional around the schedule),
 * which calls `freshAccessToken` → the Gmail refresh path. A direct insert is the same bypass
 * `gmailAuth.flagExpiringTokens` already uses. Second, INDEPENDENT barrier: both kinds are absent
 * from `NOTIFICATION_KINDS`, so even a future refactor through `notify` returns at
 * `if (!KINDS.has(kind)) return;` before any token work. Both are asserted by the guard test.
 */
export const insertReviewNotification = internalMutation({
  args: {
    tenantId: v.string(),
    kind: v.union(v.literal("weekly_review"), v.literal("weekly_review_failed")),
  },
  handler: async (ctx, { tenantId, kind }) => {
    await ctx.db.insert("notifications", {
      tenantId,
      kind,
      // Static labels from the §4 firewall file — never a failure reason, never grounded prose.
      message: kind === "weekly_review" ? REVIEW_READY_MESSAGE : REVIEW_FAILED_MESSAGE,
      read: false,
      createdAt: Date.now(),
    });
  },
});
