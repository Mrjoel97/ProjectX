import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { MANAGED_SERVICE_RUN_LIFETIME_MS } from "@pikar/core/managedServices";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { appendAudit } from "./audit";
import { cockpitAgent, ensureThreadAndPlan } from "./cockpit";
import { dispatchWorkflowLive } from "./dispatchRun";
import { workflow } from "./index";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import {
  managedServiceSpend,
  reconcileStandingServiceAccounting,
  standingServiceBinding,
} from "./lib/managedServiceBudget";
import { internalMutation } from "./lib/tenantLifecycle";
import { managedServiceConfig, managedServiceReadiness } from "./managedServices";
import { serviceKnowledgeFor } from "./serviceConversations";

const runArgs = { tenantId: v.string(), runId: v.id("managedServiceRuns") };
const unavailable = (): never => {
  throw new Error("SERVICE_EXECUTION_UNAVAILABLE");
};
const view = (run: Doc<"managedServiceRuns">) => ({
  runId: run._id,
  serviceId: run.serviceId,
  configRevision: run.configRevision,
  controlRevision: run.controlRevision,
  state: run.state,
  threadId: run.threadId ?? null,
  planId: run.planId ?? null,
  terminalCode: run.terminalCode ?? null,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});
const supported = (service: Doc<"managedServices">) =>
  service.operationIds.every((op) => op === "social.prepare" || op === "social.report");

async function currentService(ctx: QueryCtx, run: Doc<"managedServiceRuns">) {
  if (
    !Number.isSafeInteger(run.createdAt) ||
    run.createdAt > Date.now() ||
    Date.now() - run.createdAt >= MANAGED_SERVICE_RUN_LIFETIME_MS
  )
    return unavailable();
  const service = await ctx.db.get(run.serviceId);
  if (
    !service ||
    service.tenantId !== run.tenantId ||
    service.revision !== run.configRevision ||
    service.controlRevision !== run.controlRevision ||
    service.controlState !== "active" ||
    service.budgetLimitCents !== run.budgetLimitCents
  )
    return unavailable();
  if (!supported(service) || !(await managedServiceReadiness(ctx, service)).ready)
    return unavailable();
  if (service.operationIds.includes("social.prepare")) {
    const knowledge = await serviceKnowledgeFor(ctx, service);
    if (
      !knowledge.assessment.ready ||
      !run.knowledgeHash ||
      run.knowledgeHash !== knowledge.sourceHash
    )
      throw new Error("SERVICE_KNOWLEDGE_CHANGED");
  }
  await standingServiceBinding(ctx, run, true);
  return service;
}

/** Reused by atomic local write mutations and queried again before every scoped tool. */
export async function executionContextFor(
  ctx: QueryCtx,
  args: {
    tenantId: string;
    runId: Id<"managedServiceRuns">;
    threadId?: string;
    planId?: Id<"plans">;
  },
) {
  const run = await ctx.db.get(args.runId);
  if (
    !run ||
    run.tenantId !== args.tenantId ||
    run.state !== "running" ||
    !run.threadId ||
    !run.planId ||
    !run.turnId ||
    (args.threadId !== undefined && args.threadId !== run.threadId) ||
    (args.planId !== undefined && args.planId !== run.planId)
  )
    return unavailable();
  const service = await currentService(ctx, run);
  const plan = await ctx.db.get(run.planId);
  if (
    !plan ||
    plan.tenantId !== run.tenantId ||
    plan.threadId !== run.threadId ||
    plan.parentPlanId !== undefined ||
    (plan.status !== "collecting" && plan.status !== "proposed")
  )
    return unavailable();
  const config = managedServiceConfig(service);
  return {
    tenantId: run.tenantId,
    runId: run._id,
    serviceId: service._id,
    configRevision: run.configRevision,
    controlRevision: run.controlRevision,
    threadId: run.threadId,
    planId: run.planId,
    turnId: run.turnId,
    goal: config.goal,
    operationIds: config.operationIds,
    accounts: config.accounts,
    skills: config.skills,
    budgetLimitCents: run.budgetLimitCents,
  };
}

export const getExecutionContext = internalQuery({
  args: { ...runArgs, threadId: v.optional(v.string()), planId: v.optional(v.id("plans")) },
  handler: executionContextFor,
});

export const claim = internalMutation({
  args: {
    tenantId: v.string(),
    serviceId: v.string(),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(args.requestKey))
      throw new Error("SERVICE_INVALID_REQUEST_KEY");
    const service = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", args.tenantId).eq("serviceId", args.serviceId),
      )
      .unique();
    if (!service) return unavailable();
    const previous = await ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_request", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("serviceId", service._id)
          .eq("requestKey", args.requestKey),
      )
      .unique();
    if (previous) {
      if (
        previous.configRevision !== args.expectedRevision ||
        previous.controlRevision !== args.expectedControlRevision
      )
        throw new Error("SERVICE_REQUEST_KEY_REUSED");
      return { ...view(previous), existing: true };
    }
    for (const state of ["claimed", "running", "unknown"] as const) {
      const overlap = await ctx.db
        .query("managedServiceRuns")
        .withIndex("by_service_state", (q) =>
          q.eq("tenantId", args.tenantId).eq("serviceId", service._id).eq("state", state),
        )
        .first();
      if (overlap) throw new Error("SERVICE_RUN_ALREADY_PENDING");
    }
    if (
      service.revision !== args.expectedRevision ||
      service.controlRevision !== args.expectedControlRevision ||
      service.controlState !== "active" ||
      !supported(service) ||
      !(await managedServiceReadiness(ctx, service)).ready
    )
      return unavailable();
    const knowledge = service.operationIds.includes("social.prepare")
      ? await serviceKnowledgeFor(ctx, service)
      : null;
    if (knowledge && !knowledge.assessment.ready) return unavailable();
    const now = Date.now();
    const id = await ctx.db.insert("managedServiceRuns", {
      tenantId: args.tenantId,
      serviceId: service._id,
      configRevision: service.revision,
      controlRevision: service.controlRevision,
      budgetLimitCents: service.budgetLimitCents,
      ...(knowledge ? { knowledgeHash: knowledge.sourceHash } : {}),
      ...(service.goalId ? { goalId: service.goalId } : {}),
      requestKey: args.requestKey,
      state: "claimed",
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(id);
    if (!row) return unavailable();
    return { ...view(row), existing: false };
  },
});

/** Exactly one paid action step, with the shared workflow manager's retries disabled. */
export const runService = workflow.define({
  args: runArgs,
  handler: async (step, args): Promise<null> => {
    await step.runAction(internal.managedServiceExecution.execute, args, { retry: false });
    return null;
  },
});

export const bindAndStart = internalMutation({
  args: { ...runArgs, threadId: v.string(), planId: v.id("plans") },
  handler: async (ctx, args): Promise<string> => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.tenantId !== args.tenantId ||
      run.state !== "claimed" ||
      run.threadId ||
      run.planId ||
      run.workflowId
    )
      return unavailable();
    await currentService(ctx, run);
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.tenantId !== args.tenantId || plan.threadId !== args.threadId)
      return unavailable();
    await cockpitAgent.saveMessage(ctx, {
      threadId: args.threadId,
      prompt: (await currentService(ctx, run)).goal,
      skipEmbeddings: true,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.managedServiceRuns.runService,
      { tenantId: args.tenantId, runId: args.runId },
      {
        onComplete: internal.managedServiceRuns.onComplete,
        context: { tenantId: args.tenantId, runId: args.runId },
      },
    );
    await ctx.db.patch(run._id, {
      state: "running",
      threadId: args.threadId,
      planId: args.planId,
      turnId: `managed-service:${run._id}`,
      workflowId,
      updatedAt: Date.now(),
    });
    return workflowId;
  },
});

export const setupFailed = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.tenantId !== args.tenantId || run.state !== "claimed") return;
    await ctx.db.patch(run._id, {
      state: "failed",
      terminalCode: "setup_incomplete",
      updatedAt: Date.now(),
    });
    await reconcileStandingServiceAccounting(ctx, run.tenantId, run._id, true);
  },
});

export const start = tenantAction({
  args: {
    serviceId: v.string(),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
    requestKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: Id<"managedServiceRuns">;
    state: string;
    existing: boolean;
    threadId: string | null;
    planId: Id<"plans"> | null;
  }> => {
    const claimed = await ctx.runMutation(internal.managedServiceRuns.claim, {
      ...args,
      tenantId: ctx.tenantId,
    });
    if (claimed.existing) return claimed;
    try {
      const service = await ctx.runQuery(internal.managedServiceRuns.claimedGoal, {
        tenantId: ctx.tenantId,
        runId: claimed.runId,
      });
      const refs = await ensureThreadAndPlan(ctx, undefined, service.goal);
      await ctx.runMutation(internal.managedServiceRuns.bindAndStart, {
        tenantId: ctx.tenantId,
        runId: claimed.runId,
        ...refs,
      });
      return { runId: claimed.runId, state: "running", existing: false, ...refs };
    } catch {
      await ctx.runMutation(internal.managedServiceRuns.setupFailed, {
        tenantId: ctx.tenantId,
        runId: claimed.runId,
      });
      throw new Error("SERVICE_START_UNCERTAIN");
    }
  },
});

export const claimedGoal = internalQuery({
  args: runArgs,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.tenantId !== args.tenantId || run.state !== "claimed") return unavailable();
    return { goal: (await currentService(ctx, run)).goal };
  },
});

export const finish = internalMutation({
  args: {
    ...runArgs,
    reply: v.optional(v.string()),
    outcome: v.union(
      v.literal("completed"),
      v.literal("governed_stop"),
      v.literal("execution_uncertain"),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.tenantId !== args.tenantId || run.state !== "running") return;
    const service = await ctx.db.get(run.serviceId);
    const fenced =
      !service ||
      service.tenantId !== run.tenantId ||
      service.revision !== run.configRevision ||
      service.controlRevision !== run.controlRevision ||
      service.controlState !== "active";
    let spendUnknown = false;
    try {
      const spend = await managedServiceSpend(ctx, run.tenantId, run._id);
      spendUnknown =
        spend.breached ||
        spend.outstandingNanos !== 0 ||
        spend.reservationCount !== spend.settledCount;
    } catch {
      spendUnknown = true;
    }
    let validContext = !fenced;
    if (validContext) {
      try {
        await executionContextFor(ctx, { tenantId: run.tenantId, runId: run._id });
      } catch {
        validContext = false;
      }
    }
    const uncertain =
      spendUnknown ||
      (validContext && (args.outcome === "execution_uncertain" || args.reply === undefined));
    const state = uncertain
      ? "unknown"
      : !validContext
        ? "stopped"
        : args.outcome === "completed"
          ? "completed"
          : "failed";
    if ((state === "completed" || state === "failed") && args.reply !== undefined && run.threadId)
      await cockpitAgent.saveMessage(ctx, {
        threadId: run.threadId,
        message: { role: "assistant", content: args.reply },
        skipEmbeddings: true,
      });
    await ctx.db.patch(run._id, {
      state,
      terminalCode: uncertain
        ? "execution_uncertain"
        : !validContext
          ? "control_changed"
          : args.outcome,
      updatedAt: Date.now(),
    });
    await reconcileStandingServiceAccounting(ctx, run.tenantId, run._id, !uncertain);
  },
});

export const onComplete = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: v.object(runArgs) },
  handler: async (ctx, { workflowId, result, context }) => {
    const run = await ctx.db.get(context.runId);
    if (
      !run ||
      run.tenantId !== context.tenantId ||
      run.workflowId !== workflowId ||
      run.state !== "running"
    )
      return;
    // Even a successful workflow without its terminal observation is uncertain, never replayed.
    await ctx.db.patch(run._id, {
      state: "unknown",
      terminalCode: result.kind === "canceled" ? "cancelled" : "execution_uncertain",
      updatedAt: Date.now(),
    });
    await reconcileStandingServiceAccounting(ctx, run.tenantId, run._id, false);
  },
});

export const status = tenantQuery({
  args: { runId: v.id("managedServiceRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run?.tenantId === ctx.tenantId ? view(run) : null;
  },
});

export const list = tenantQuery({
  args: { serviceId: v.string() },
  handler: async (ctx, args) => {
    const service = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", args.serviceId),
      )
      .unique();
    if (!service) return { items: [], truncated: false };
    const rows = await ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", service._id),
      )
      .order("desc")
      .take(21);
    return { items: rows.slice(0, 20).map(view), truncated: rows.length > 20 };
  },
});

/** Explicit recovery only: never turns an uncertain attempt into success or repeats its action. */
export const reconcile = tenantMutation({
  args: {
    runId: v.id("managedServiceRuns"),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.tenantId !== ctx.tenantId) return unavailable();
    const service = await ctx.db.get(run.serviceId);
    if (
      !service ||
      service.tenantId !== ctx.tenantId ||
      service.revision !== args.expectedRevision ||
      service.controlRevision !== args.expectedControlRevision
    )
      throw new Error("SERVICE_STALE_REVISION");
    if (["completed", "failed", "stopped"].includes(run.state))
      return { resolved: true, state: run.state, reason: "already_terminal" as const };
    const abandonedClaim =
      run.state === "claimed" &&
      !run.workflowId &&
      !run.threadId &&
      !run.planId &&
      Number.isSafeInteger(run.createdAt) &&
      Date.now() - run.createdAt >= MANAGED_SERVICE_RUN_LIFETIME_MS;
    if (!abandonedClaim) {
      if (!run.workflowId)
        return { resolved: false, state: run.state, reason: "status_unavailable" as const };
      const live = await dispatchWorkflowLive(ctx, run.workflowId);
      if (live !== false)
        return {
          resolved: false,
          state: run.state,
          reason: live === true ? ("still_running" as const) : ("status_unavailable" as const),
        };
    }
    try {
      const spend = await managedServiceSpend(ctx, ctx.tenantId, run._id);
      if (spend.outstandingNanos !== 0 || spend.reservationCount !== spend.settledCount)
        return { resolved: false, state: run.state, reason: "unsettled_cost" as const };
      // A known overrun is an immutable bill, not unknown usage. A definitively finished
      // workflow may close stopped once all calls settle; its breach receipts remain intact.
    } catch {
      return { resolved: false, state: run.state, reason: "unsettled_cost" as const };
    }
    await ctx.db.patch(run._id, {
      state: "stopped",
      terminalCode: "reconciled_interruption",
      updatedAt: Date.now(),
    });
    await reconcileStandingServiceAccounting(ctx, run.tenantId, run._id, true);
    await appendAudit(ctx, {
      tenantId: ctx.tenantId,
      correlationId: `managed-service-recovery:${run._id}`,
      eventType: "managed_service.run_reconciled",
      actor: "user",
      payload: {
        serviceRef: service._id,
        runRef: run._id,
        revision: run.configRevision,
        controlRevision: run.controlRevision,
      },
    });
    return { resolved: true, state: "stopped" as const, reason: "interruption_closed" as const };
  },
});
