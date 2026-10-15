// DLVR-02: the two-arm send dispatcher. THE seam every production send goes through.
//
// Deliberately thin. It answers one question — which mailbox does this row go out through — and
// hands off. All governance (suppression, the CAN-SPAM footer, attachment resolution, the audit
// ref) lives in the provider actions and, for the parts that must not diverge, in the single
// `prepareGovernedMessage` both of them call.
//
// WHY A DISPATCHER RATHER THAN A PROVIDER FIELD READ AT EACH CALLER: there are two production
// callers (`deliverApprovedPlan.ts` and `pipeline.ts`) and each is inside a retrier/workflow with
// its own terminal handling. Putting the routing decision in both means two places to add the
// third provider, and two places for the `?? "google"` legacy default to drift.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { tenantMutation } from "./lib/functions";
import { internalAction, internalMutation } from "./lib/tenantLifecycle";

/**
 * The union of both arms' results. `messageId` is `""` on the Microsoft arm because Graph's
 * `sendMail` returns 202 with an empty body and has no id to give — see graph.ts.
 *
 * Explicit (guidelines §96): inferring this would resolve `internal.{gmail,graph}` through the
 * internal-api graph and collapse sibling actions to `any`.
 */
export type DeliveryResult =
  | {
      delivered: false;
      reason:
        | "not_connected"
        | "refresh_failed"
        | "suppressed"
        | "mail_scope_missing"
        | "outcome_unknown"
        | "too_large";
    }
  | { delivered: true; messageId: string };

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<DeliveryResult> => {
    const attempt = await ctx.runQuery(internal.delivery.receipt, { requestId });
    if (attempt?.state === "confirmed")
      return { delivered: true, messageId: attempt.messageId ?? "" };
    if (attempt) return { delivered: false, reason: "outcome_unknown" };
    const provider = await ctx.runQuery(internal.gmailAuth.mailProviderFor, { requestId });
    // ABSENCE MEANS GOOGLE, and that is the whole migration story. Every `requests` row written
    // before 25-05 predates the second provider and was a Gmail send; `mailProvider` is optional
    // precisely so those rows keep delivering with no backfill and no schema surgery.
    return provider === "microsoft"
      ? await ctx.runAction(internal.graph.send, { requestId })
      : await ctx.runAction(internal.gmail.send, { requestId });
  },
});

export const receipt = internalQuery({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => (await ctx.db.get(requestId))?.deliveryAttempt ?? null,
});

/** Called immediately before provider POST, after all local preparation and token checks. */
export const claim = internalMutation({
  args: {
    requestId: v.id("requests"),
    provider: v.union(v.literal("google"), v.literal("microsoft")),
  },
  handler: async (
    ctx,
    { requestId, provider },
  ): Promise<{ proceed: true } | { proceed: false; result: DeliveryResult }> => {
    const row = await ctx.db.get(requestId);
    if (!row) throw new Error("DELIVERY_REQUEST_MISSING");
    const prior = row.deliveryAttempt;
    if (prior?.state === "confirmed")
      return { proceed: false, result: { delivered: true, messageId: prior.messageId ?? "" } };
    if (prior || row.status === "sent") {
      return { proceed: false, result: { delivered: false, reason: "outcome_unknown" } };
    }
    await ctx.db.patch(requestId, {
      deliveryAttempt: { state: "in_flight", provider, startedAt: Date.now() },
    });
    // A process crash cannot leave an attempt silently in-flight forever.
    await ctx.scheduler.runAfter(120_000, internal.delivery.markUnknown, { requestId });
    return { proceed: true };
  },
});

/** No exception text crosses this boundary. Unknown means reconcile, never automatically resend. */
export const markUnknown = internalMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<void> => {
    const row = await ctx.db.get(requestId);
    if (row?.deliveryAttempt?.state !== "in_flight") return;
    await ctx.db.patch(requestId, {
      deliveryAttempt: { ...row.deliveryAttempt, state: "unknown" },
    });
    await ctx.db.insert("notifications", {
      tenantId: row.tenantId,
      requestId,
      kind: "delivery.unknown",
      message:
        "Email delivery outcome is unknown. Check the sending mailbox before attempting another send.",
      read: false,
      createdAt: Date.now(),
    });
  },
});

/** Records the user's mailbox check; it never retries or claims a provider receipt. */
export const reconcile = tenantMutation({
  args: {
    requestId: v.id("requests"),
    startedAt: v.number(),
    outcome: v.union(v.literal("sent"), v.literal("not_sent")),
  },
  handler: async (ctx, { requestId, startedAt, outcome }): Promise<void> => {
    const row = await ctx.db.get(requestId);
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("NOT_FOUND");
    const attempt = row.deliveryAttempt;
    if (attempt?.state !== "unknown" || attempt.startedAt !== startedAt)
      throw new Error("STALE_DELIVERY_REVIEW");
    // Allow any in-flight action to finish before accepting a manual terminal decision.
    if (Date.now() - startedAt < 10 * 60_000) throw new Error("DELIVERY_REVIEW_TOO_EARLY");
    if (attempt.reviewedOutcome) {
      if (attempt.reviewedOutcome === outcome) return;
      throw new Error("DELIVERY_ALREADY_REVIEWED");
    }
    await ctx.db.patch(requestId, { deliveryAttempt: { ...attempt, reviewedOutcome: outcome } });
    if (row.planId) {
      await ctx.runMutation(internal.plans.recordDeliveryTerminal, {
        planId: row.planId,
        requestId,
        outcome: outcome === "sent" ? "sent" : "failed",
      });
    } else {
      await ctx.db.patch(requestId, { status: outcome === "sent" ? "sent" : "failed" });
    }
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: row.correlationId,
      eventType: "delivery.user_reconciled",
      actor: "user",
      payload: { requestId, outcome },
    });
  },
});

/** Provider receipt and audit commit together. Failure leaves a non-retryable uncertain attempt. */
export const confirm = internalMutation({
  args: { requestId: v.id("requests"), messageId: v.string() },
  handler: async (ctx, { requestId, messageId }): Promise<void> => {
    const row = await ctx.db.get(requestId);
    if (!row?.deliveryAttempt) throw new Error("DELIVERY_ATTEMPT_MISSING");
    if (row.deliveryAttempt.state === "confirmed") return;
    await ctx.db.patch(requestId, {
      deliveryAttempt: { ...row.deliveryAttempt, state: "confirmed", messageId },
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: row.tenantId,
      correlationId: row.correlationId,
      eventType: row.deliveryAttempt.provider === "google" ? "gmail.sent" : "graph.sent",
      actor: "system",
      payload:
        row.deliveryAttempt.provider === "google"
          ? { requestId, messageId }
          : { requestId, provider: "microsoft" },
    });
  },
});
