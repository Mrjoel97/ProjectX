// Bounded Approvals page adapter. Content stays on the existing plan/evaluation planes; this
// module returns only refs, enums, timestamps and counts suitable for a tenant dashboard.
import {
  compareDashboardOrder,
  createDashboardBound,
  type DashboardBound,
} from "@pikar/core";
import type { Scorecard } from "@pikar/core/growth/index";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";

const PAGE_LIMIT = 50;
const SUMMARY_LIMIT = 100;
const DECISION_SCAN_LIMIT = 100;
const DECISION_LIMIT = 20;
const BLOCKED_LIMIT = 20;

function pageSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(PAGE_LIMIT, Math.floor(value)));
}

function listLimit(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function planKind(plan: Doc<"plans">): "email" | "memo" | "calendar_event" | "reel" | "image" {
  if (plan.kind !== "media") return plan.kind ?? "email";
  return plan.mediaMode === "image" ? "image" : "reel";
}

function exactProgress(plan: Doc<"plans">) {
  const values = [plan.recipientTotal, plan.sentCount, plan.failedCount, plan.queuedCount];
  if (
    plan.counterComplete !== true ||
    values.some((value) => !Number.isSafeInteger(value) || (value ?? -1) < 0) ||
    (plan.sentCount ?? 0) + (plan.failedCount ?? 0) + (plan.queuedCount ?? 0) !==
      plan.recipientTotal
  ) {
    return { state: "partial" as const, reason: "legacy-window" as const };
  }
  return {
    state: "exact" as const,
    total: plan.recipientTotal as number,
    sent: plan.sentCount as number,
    failed: plan.failedCount as number,
    queued: plan.queuedCount as number,
  };
}

function planRef(plan: Doc<"plans">) {
  return {
    planId: plan._id,
    threadId: plan.threadId,
    kind: planKind(plan),
    status: plan.status,
    createdAt: plan.createdAt,
    recipientCount: plan.recipients?.length ?? 0,
    attachmentCount: plan.attachments?.length ?? 0,
    cost: { state: "unknown" as const },
  };
}

function paginationBound(returned: number, limit: number, nextCursor: string | null): DashboardBound {
  return createDashboardBound({
    returned,
    limit,
    nextCursor,
    partial: nextCursor !== null,
    ...(nextCursor === null ? {} : { partialReason: "row-cap" as const }),
  });
}

export const summary = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const base = () =>
      ctx.db
        .query("plans")
        .withIndex("by_tenant_status_createdAt", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("status", "proposed"),
        );
    const [countWindow, oldest] = await Promise.all([
      base().take(SUMMARY_LIMIT + 1),
      base().order("asc").first(),
    ]);
    return {
      awaitingCount: Math.min(countWindow.length, SUMMARY_LIMIT),
      awaitingCountCapped: countWindow.length > SUMMARY_LIMIT,
      oldestWaitingAt: oldest?.createdAt ?? null,
    };
  },
});

async function paginatePlans(
  ctx: QueryCtx & { tenantId: string },
  status: "proposed" | "scheduled" | "delivering",
  paginationOpts: { numItems: number; cursor: string | null },
) {
  const limit = pageSize(paginationOpts.numItems);
  const page = await ctx.db
    .query("plans")
    .withIndex("by_tenant_status_createdAt", (q) =>
      q.eq("tenantId", ctx.tenantId).eq("status", status),
    )
    .order("desc")
    .paginate({ ...paginationOpts, numItems: limit });
  const nextCursor = page.isDone ? null : page.continueCursor;
  return { page, limit, nextCursor };
}

export const listAwaiting = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { page, limit, nextCursor } = await paginatePlans(ctx, "proposed", paginationOpts);
    const items = page.page.map(planRef);
    return { items, nextCursor, bound: paginationBound(items.length, limit, nextCursor) };
  },
});

export const listScheduled = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { page, limit, nextCursor } = await paginatePlans(ctx, "scheduled", paginationOpts);
    const items = page.page.map((plan) => ({
      ...planRef(plan),
      scheduledAt: plan.sendAt ?? null,
      scheduleState: plan.sendAt === undefined ? ("legacy-unknown" as const) : ("known" as const),
    }));
    return { items, nextCursor, bound: paginationBound(items.length, limit, nextCursor) };
  },
});

export const listInFlight = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const { page, limit, nextCursor } = await paginatePlans(ctx, "delivering", paginationOpts);
    const items = page.page.map((plan) => ({ ...planRef(plan), progress: exactProgress(plan) }));
    return { items, nextCursor, bound: paginationBound(items.length, limit, nextCursor) };
  },
});

export const listCleared = tenantQuery({
  args: { sinceMs: v.number(), limit: v.number() },
  handler: async (ctx, { sinceMs, limit: requestedLimit }) => {
    if (!Number.isSafeInteger(sinceMs) || sinceMs < 0) throw new Error("INVALID_WINDOW");
    const limit = listLimit(requestedLimit, PAGE_LIMIT);
    const rows = (
      await Promise.all(
        (["done", "canceled"] as const).map((status) =>
          ctx.db
            .query("plans")
            .withIndex("by_tenant_status_createdAt", (q) =>
              q
                .eq("tenantId", ctx.tenantId)
                .eq("status", status)
                .gte("createdAt", sinceMs),
            )
            .order("desc")
            .take(limit + 1),
        ),
      )
    )
      .flat()
      .sort((a, b) =>
        compareDashboardOrder(
          { createdAt: a.createdAt, id: a._id },
          { createdAt: b.createdAt, id: b._id },
        ),
      );
    const partial = rows.length > limit;
    const items = rows.slice(0, limit).map((plan) => ({
      ...planRef(plan),
      progress: exactProgress(plan),
      cancellation:
        plan.status !== "canceled"
          ? null
          : plan.cancelKind === undefined
            ? ({ state: "legacy-unknown" as const })
            : ({ state: "known" as const, kind: plan.cancelKind, canceledAt: plan.canceledAt ?? null }),
    }));
    return {
      items,
      bound: createDashboardBound({
        returned: items.length,
        limit,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});

const QUESTION_CATALOG = [
  {
    field: "financials.cac",
    valueType: "number",
    label: "Customer acquisition cost",
    prompt: "What is your current customer acquisition cost?",
  },
  {
    field: "financials.ltgp",
    valueType: "number",
    label: "Lifetime gross profit",
    prompt: "What is your lifetime gross profit per customer?",
  },
  {
    field: "financials.thirtyDayCashPerCustomer",
    valueType: "number",
    label: "30-day cash per customer",
    prompt: "How much cash do you collect per customer in the first 30 days?",
  },
  {
    field: "modelCard.thirtyDayPayback",
    valueType: "boolean",
    label: "30-day acquisition payback",
    prompt: "Is acquisition cost recovered within 30 days?",
  },
] as const;

type QuestionField = (typeof QUESTION_CATALOG)[number]["field"];

function fieldValue(scorecard: unknown, field: QuestionField): unknown {
  const value = scorecard as Partial<Scorecard>;
  if (field === "modelCard.thirtyDayPayback") return value.modelCard?.thirtyDayPayback;
  if (field === "financials.cac") return value.financials?.cac;
  if (field === "financials.ltgp") return value.financials?.ltgp;
  return value.financials?.thirtyDayCashPerCustomer;
}

function hasFinancialQuestion(row: Doc<"evaluations">): boolean {
  return row.notEnoughData.some((question) => question.section === "financials");
}

export const listDecisions = tenantQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit: requestedLimit }) => {
    const limit = listLimit(requestedLimit, DECISION_LIMIT);
    const rows = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(DECISION_SCAN_LIMIT + 1);
    const seenThreads = new Set<string>();
    const candidates = [];
    for (const row of rows.slice(0, DECISION_SCAN_LIMIT)) {
      if (seenThreads.has(row.threadId)) continue;
      seenThreads.add(row.threadId);
      if (!hasFinancialQuestion(row)) continue;
      for (const [questionOrder, question] of QUESTION_CATALOG.entries()) {
        if (fieldValue(row.scorecard, question.field) != null) continue;
        candidates.push({
          evaluationId: row._id,
          threadId: row.threadId,
          createdAt: row.createdAt,
          field: question.field,
          valueType: question.valueType,
          label: question.label,
          prompt: question.prompt,
          latestValue: null,
          questionOrder,
        });
      }
    }
    candidates.sort((a, b) => {
      const rowOrder = compareDashboardOrder(
        { createdAt: a.createdAt, id: `${a.evaluationId}:${a.field}` },
        { createdAt: b.createdAt, id: `${b.evaluationId}:${b.field}` },
      );
      return a.evaluationId === b.evaluationId ? a.questionOrder - b.questionOrder : rowOrder;
    });
    const partial = candidates.length > limit || rows.length > DECISION_SCAN_LIMIT;
    const items = candidates.slice(0, limit).map(({ questionOrder: _, ...question }) => question);
    return {
      items,
      bound: createDashboardBound({
        returned: items.length,
        limit,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});

const numericField = v.union(
  v.literal("financials.cac"),
  v.literal("financials.ltgp"),
  v.literal("financials.thirtyDayCashPerCustomer"),
);

export const answerDecision = tenantMutation({
  args: {
    threadId: v.string(),
    answer: v.union(
      v.object({ field: numericField, value: v.number() }),
      v.object({ field: v.literal("modelCard.thirtyDayPayback"), value: v.boolean() }),
    ),
  },
  handler: async (ctx, { threadId, answer }) => {
    const row = await ctx.db
      .query("evaluations")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", threadId),
      )
      .order("desc")
      .first();
    if (!row) throw new Error("NOT_FOUND");
    if (!hasFinancialQuestion(row) || fieldValue(row.scorecard, answer.field) != null) {
      throw new Error("DECISION_NOT_OPEN");
    }
    if (typeof answer.value === "number" && (!Number.isFinite(answer.value) || answer.value < 0)) {
      throw new Error("INVALID_VALUE");
    }

    const scorecard = structuredClone(row.scorecard as Scorecard);
    if (answer.field === "modelCard.thirtyDayPayback") {
      scorecard.modelCard.thirtyDayPayback = answer.value;
    } else if (answer.field === "financials.cac") {
      scorecard.financials.cac = answer.value;
    } else if (answer.field === "financials.ltgp") {
      scorecard.financials.ltgp = answer.value;
    } else {
      scorecard.financials.thirtyDayCashPerCustomer = answer.value;
    }
    await ctx.db.patch(row._id, {
      scorecard,
      userProvided: row.userProvided.includes(answer.field)
        ? row.userProvided
        : [...row.userProvided, answer.field],
    });
    return { recorded: true as const };
  },
});

export const blockedSummary = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const base = () =>
      ctx.db
        .query("deadLetters")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("status", "new"),
        );
    const [countWindow, oldest, newest] = await Promise.all([
      base().take(BLOCKED_LIMIT + 1),
      base().order("asc").first(),
      base().order("desc").first(),
    ]);
    return {
      count: Math.min(countWindow.length, BLOCKED_LIMIT),
      countCapped: countWindow.length > BLOCKED_LIMIT,
      oldestCreatedAt: oldest?.createdAt ?? null,
      newestCreatedAt: newest?.createdAt ?? null,
      href: "/ops" as const,
    };
  },
});
