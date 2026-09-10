// Bounded Approvals page adapter. Content stays on the existing plan/evaluation planes; this
// module returns only refs, enums, timestamps and counts suitable for a tenant dashboard.
import {
  CASH_INPUTS,
  type CashInputField,
  compareDashboardOrder,
  createDashboardBound,
  type DashboardBound,
  validateCashInput,
} from "@pikar/core";
import type { Scorecard } from "@pikar/core/growth/index";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { applyScorecardAnswer } from "./evaluations";
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

/** The Approvals page's plan-kind enum. NOT `plans.kind` verbatim: `media` splits into `reel` and
 *  `image` for the badge. Widening `plans.kind` fails to compile HERE first (19-06 added
 *  `crm_write`), which is what drags the second approve surface into the same commit. */
function planKind(plan: Doc<"plans">):
  | "email"
  | "memo"
  | "calendar_event"
  | "crm_write"
  | "finance_write"
  // 17-05 (ACTN-02 gap closure): the seventh `plans.kind` member, and this line is again where
  // the widening first failed to compile — exactly as the comment above promised it would.
  | "calendar_manage"
  | "reel"
  | "image" {
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

function paginationBound(
  returned: number,
  limit: number,
  nextCursor: string | null,
): DashboardBound {
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

/** G2: a bounded cross-thread read of work already owned by the plan and vault planes.
 * At most two full rows in each of seven lanes: fourteen 1-MiB documents stay below the
 * transaction's 16-MiB read ceiling. A full lane is conservatively marked partial without
 * fetching an extra row. Upgrade to a metadata projection before increasing this ceiling.
 * This is a status view, not a liveness claim; caption-only work on done plans is not covered. */
export const runningWork = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const limit = 2;
    const planWindows = await Promise.all(
      (["collecting", "proposed", "approved", "delivering"] as const).map((status) =>
        ctx.db
          .query("plans")
          .withIndex("by_tenant_status_createdAt", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("status", status),
          )
          .order("desc")
          .take(limit),
      ),
    );
    const documentWindows = await Promise.all(
      (["pending_extraction", "extracting", "processing"] as const).map((status) =>
        ctx.db
          .query("vaultDocuments")
          .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", status))
          .order("desc")
          .take(limit),
      ),
    );
    const plans = planWindows
      .flatMap((rows) => rows.slice(0, limit))
      .filter(
        (plan) =>
          plan.status === "delivering" ||
          (plan.status === "collecting" && plan.kind === "memo" && !!plan.workflowId) ||
          plan.renderStatus === "pending" ||
          plan.renderStatus === "rendering",
      )
      .map((plan) => ({
        id: String(plan._id),
        threadId: plan.threadId,
        kind: planKind(plan),
        stage:
          plan.renderStatus === "pending" || plan.renderStatus === "rendering"
            ? ("rendering" as const)
            : plan.status === "delivering"
              ? ("delivering" as const)
              : ("preparing" as const),
        createdAt: plan.createdAt,
      }));
    const documents = documentWindows
      .flatMap((rows) => rows.slice(0, limit))
      .map((doc) => ({
        id: String(doc._id),
        threadId: null,
        kind: "document" as const,
        stage: doc.status === "pending_extraction" ? ("queued" as const) : ("processing" as const),
        createdAt: doc.createdAt,
      }));
    const rows = [...plans, ...documents].sort((a, b) =>
      compareDashboardOrder(
        { createdAt: a.createdAt, id: a.id },
        { createdAt: b.createdAt, id: b.id },
      ),
    );
    return {
      items: rows.slice(0, 20),
      partial:
        rows.length > 20 ||
        [...planWindows, ...documentWindows].some((rows) => rows.length >= limit),
    };
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
              q.eq("tenantId", ctx.tenantId).eq("status", status).gte("createdAt", sinceMs),
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
            ? { state: "legacy-unknown" as const }
            : {
                state: "known" as const,
                kind: plan.cancelKind,
                canceledAt: plan.canceledAt ?? null,
              },
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
  {
    field: "financials.grossProfitPerPurchase",
    valueType: "number",
    label: "Gross profit per purchase",
    prompt: "What is your gross profit on one sale, after the cost of delivering it?",
  },
  {
    field: "financials.purchasesPerLifetime",
    valueType: "number",
    label: "Purchases per customer lifetime",
    prompt: "How many times does an average customer buy from you in total?",
  },
  {
    field: "financials.customerCount",
    valueType: "number",
    label: "Customers so far",
    prompt: "How many customers are these figures based on?",
  },
  // `leadCard.referralPct` is deliberately NOT here: this catalogue is gated on a `financials`
  // section entry (`hasFinancialQuestion`), and a lead metric surfacing behind a financial gate
  // would be a category error. It stays a panel-and-cockpit input (`cash.ts`).
] as const;

type QuestionField = (typeof QUESTION_CATALOG)[number]["field"];

/** A dot-path read over the Scorecard. Mirrors `cash.ts`'s `scorecardValue` on the read side. */
function fieldValue(scorecard: unknown, field: QuestionField): unknown {
  return field
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | null)?.[key],
      scorecard as Partial<Scorecard>,
    );
}

/** `QUESTION_CATALOG` field → the `CashInputField` that carries its bounds, for the numeric fields
 *  the two collection surfaces share. `financials.ltgp` and `modelCard.thirtyDayPayback` are
 *  deliberately absent — `ltgp` is never written from a cash input (it is derived from components,
 *  Task 5), and the boolean question has no numeric bound to route. */
const CASH_FIELD_BY_QUESTION = new Map<string, CashInputField>(
  CASH_INPUTS.filter((spec) => spec.store === "scorecard" && spec.path !== undefined).map(
    (spec) => [spec.path as string, spec.field],
  ),
);

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
  v.literal("financials.grossProfitPerPurchase"),
  v.literal("financials.purchasesPerLifetime"),
  v.literal("financials.customerCount"),
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
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first();
    if (!row) throw new Error("NOT_FOUND");
    if (!hasFinancialQuestion(row) || fieldValue(row.scorecard, answer.field) != null) {
      throw new Error("DECISION_NOT_OPEN");
    }
    if (typeof answer.value === "number") {
      // Route through the SAME validator the panel uses (`validateCashInput`) for every field the
      // two collection surfaces share — `purchasesPerLifetime: 0.5` is refused here for the same
      // reason and in the same words as in `cash.ts`'s NumbersPanel, one validator either way.
      // `financials.ltgp` carries no CashInputField (it is never a cash input, Task 5) and keeps the
      // original finite/non-negative check.
      const cashField = CASH_FIELD_BY_QUESTION.get(answer.field);
      if (cashField) {
        const check = validateCashInput(cashField, answer.value);
        if (!check.ok) throw new Error(`INVALID_VALUE: ${check.reason}`);
      } else if (!Number.isFinite(answer.value) || answer.value < 0) {
        throw new Error("INVALID_VALUE");
      }
    }

    // ONE writer: the same `applyScorecardAnswer` the panel (`cash.ts`) and the cockpit tool
    // (`recordScorecardAnswer`) use, so an answer given here, in conversation, or in the panel land
    // in the same place and carry forward the same way (design §5's anti-drift rule).
    await applyScorecardAnswer(ctx.db, ctx.tenantId, threadId, answer.field, answer.value, {
      actor: "user",
      origin: "stated",
      source: "approvals:answerDecision",
      at: Date.now(),
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
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "new"));
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
    };
  },
});
