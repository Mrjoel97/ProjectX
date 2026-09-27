// BETA-03 measurement plane. Append-only refs/enums/timestamps only: content never reaches here.
import {
  costPerActiveUser,
  firstResultLatency,
  postOnboardingLatency,
  stepCompletion,
  weekTwoReturn,
} from "@pikar/core";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";

const EVENT_TYPE = v.union(
  v.literal("admission_succeeded"),
  v.literal("onboarding_completed"),
  v.literal("first_offer_shown"),
  v.literal("first_offer_started"),
  v.literal("prerequisite_recovered"),
  v.literal("approval_decided"),
  v.literal("delivery_sent"),
  v.literal("delivery_failed"),
  v.literal("delivery_suppressed"),
  v.literal("delivery_held"),
  v.literal("session_started"),
  v.literal("return_observed"),
);
const TERMINAL = v.union(
  v.literal("sent"),
  v.literal("failed"),
  v.literal("suppressed"),
  v.literal("held"),
);
const eventArgs = {
  tenantId: v.string(),
  eventType: EVENT_TYPE,
  idempotencyKey: v.string(),
  occurredAt: v.number(),
  inviteId: v.optional(v.id("betaInvites")),
  approvalId: v.optional(v.id("plans")),
  planId: v.optional(v.id("plans")),
  requestId: v.optional(v.id("requests")),
  auditId: v.optional(v.id("audit")),
  terminalOutcome: v.optional(TERMINAL),
};

type EventArgs = {
  tenantId: string;
  eventType:
    | "admission_succeeded"
    | "onboarding_completed"
    | "first_offer_shown"
    | "first_offer_started"
    | "prerequisite_recovered"
    | "approval_decided"
    | "delivery_sent"
    | "delivery_failed"
    | "delivery_suppressed"
    | "delivery_held"
    | "session_started"
    | "return_observed";
  idempotencyKey: string;
  occurredAt: number;
  inviteId?: Id<"betaInvites">;
  approvalId?: Id<"plans">;
  planId?: Id<"plans">;
  requestId?: Id<"requests">;
  auditId?: Id<"audit">;
  terminalOutcome?: "sent" | "failed" | "suppressed" | "held";
};

async function recordOnce(ctx: MutationCtx, args: EventArgs): Promise<Id<"betaJourneyEvents">> {
  const existing = await ctx.db
    .query("betaJourneyEvents")
    .withIndex("by_tenant_key", (q) =>
      q.eq("tenantId", args.tenantId).eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("betaJourneyEvents", args);
}

/** The only writer. Idempotency is scoped to the tenant, never a deployment-wide key. */
export const record = internalMutation({
  args: eventArgs,
  handler: recordOnce,
});

/** Browser metadata is bounded to a random session key and a coarse event timestamp. */
export const recordBrowserSession = tenantMutation({
  args: { sessionKey: v.string(), returned: v.boolean() },
  handler: async (ctx, { sessionKey, returned }) => {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionKey)) throw new Error("INVALID_BROWSER_SESSION");
    return await recordOnce(ctx, {
      tenantId: ctx.tenantId,
      eventType: returned ? "return_observed" : "session_started",
      idempotencyKey: `${returned ? "return" : "session"}:${sessionKey}`,
      occurredAt: Date.now(),
    });
  },
});

/** Records the real eligible offer mount, never a client-asserted recipient or content field. */
export const recordFirstOfferShown = tenantMutation({
  args: {},
  handler: async (ctx): Promise<Id<"betaJourneyEvents">> => {
    const user = await ctx.db.get(ctx.userId);
    const profile = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_kind", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("kind", "business_profile"),
      )
      .filter((q) => q.neq(q.field("status"), "failed"))
      .first();
    if (!user?.email?.trim() || !profile) throw new Error("FIRST_SEND_OFFER_INELIGIBLE");
    return await recordOnce(ctx, {
      tenantId: ctx.tenantId,
      eventType: "first_offer_shown",
      idempotencyKey: "first-offer:shown",
      occurredAt: Date.now(),
    });
  },
});

/** A recovery is measured only after the server can read the saved prerequisite on this tenant. */
export const recordPrerequisiteRecovered = tenantMutation({
  args: { planId: v.id("plans"), prerequisite: v.literal("postal_address") },
  handler: async (ctx, { planId, prerequisite }): Promise<Id<"betaJourneyEvents">> => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) throw new Error("PLAN_NOT_FOUND");
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (!(profile?.postalAddress ?? "").trim()) throw new Error("PREREQUISITE_NOT_RECOVERED");
    return await recordOnce(ctx, {
      tenantId: ctx.tenantId,
      eventType: "prerequisite_recovered",
      idempotencyKey: `prerequisite:${prerequisite}:${String(planId)}`,
      occurredAt: Date.now(),
      planId,
    });
  },
});

/** Newest-first, hard bounded DTO. It deliberately has no email, recipient, subject or body field. */
export const history = tenantQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit ?? 25)));
    return (
      await ctx.db
        .query("betaJourneyEvents")
        .withIndex("by_tenant_occurredAt", (q) => q.eq("tenantId", ctx.tenantId))
        .order("desc")
        .take(bounded)
    ).map((row) => ({
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      approvalId: row.approvalId ?? null,
      planId: row.planId ?? null,
      requestId: row.requestId ?? null,
      auditId: row.auditId ?? null,
      terminalOutcome: row.terminalOutcome ?? null,
    }));
  },
});

const METRIC_WINDOW_MAX_MS = 90 * 86_400_000;
const METRIC_ROW_LIMIT = 1_000;

/** Bounded product metrics. Spend is settled ledger truth; absent coverage remains unavailable. */
export const metrics = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, { sinceMs, untilMs }) => {
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs)
      throw new Error("INVALID_METRIC_WINDOW");
    if (untilMs - sinceMs > METRIC_WINDOW_MAX_MS) throw new Error("METRIC_WINDOW_TOO_LARGE");

    const rows = await ctx.db
      .query("betaJourneyEvents")
      .withIndex("by_tenant_occurredAt", (q) =>
        q.eq("tenantId", ctx.tenantId).gte("occurredAt", sinceMs).lt("occurredAt", untilMs),
      )
      .take(METRIC_ROW_LIMIT + 1);
    const spend = await ctx.db
      .query("spendEvents")
      .withIndex("by_tenant_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).gte("createdAt", sinceMs).lt("createdAt", untilMs),
      )
      .take(METRIC_ROW_LIMIT + 1);
    const coverage = await ctx.db
      .query("spendCoverage")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const truncated = rows.length > METRIC_ROW_LIMIT || spend.length > METRIC_ROW_LIMIT;
    if (truncated) {
      const unavailable = { state: "unavailable" as const, reason: "bounded-read-truncated" };
      return {
        window: { sinceMs, untilMs },
        truncated: true,
        firstResultLatency: unavailable,
        postOnboardingLatency: unavailable,
        onboardingCompletion: unavailable,
        weekTwoReturn: unavailable,
        costPerActiveUser: unavailable,
      };
    }

    const events = rows.map((row) => ({
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      actorId: ctx.tenantId,
      terminalOutcome: row.terminalOutcome,
    }));
    const admitted = events.filter((event) => event.eventType === "admission_succeeded").length;
    const activeIds = events.some((event) => event.eventType === "delivery_sent")
      ? [ctx.tenantId]
      : [];
    const covered = coverage !== null && coverage.coverageStartedAt <= sinceMs;
    const settled = spend.filter(
      (row) => row.phase === "actual" || row.phase === "adjustment" || row.phase === "refunded",
    );
    const landedCents = settled.reduce(
      (sum, row) => sum + (row.phase === "refunded" ? -row.amountCents : row.amountCents),
      0,
    );
    const settledUsd = covered && settled.length > 0 ? [Math.max(0, landedCents) / 100] : [];
    return {
      window: { sinceMs, untilMs },
      truncated: false,
      firstResultLatency: firstResultLatency(events),
      postOnboardingLatency: postOnboardingLatency(events),
      onboardingCompletion: stepCompletion(events, "onboarding_completed", admitted),
      weekTwoReturn: weekTwoReturn(events),
      costPerActiveUser: costPerActiveUser(settledUsd, activeIds),
    };
  },
});
