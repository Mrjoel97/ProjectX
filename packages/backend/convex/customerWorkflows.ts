import { DOCUMENT_DRAFTER_SKILL } from "@pikar/contracts/skill";
import {
  validateCustomerWorkflow,
  validateCustomerWorkflowBrief,
} from "@pikar/core/customerWorkflows";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCustomerSpecialistVersion } from "./customerSpecialists";
import {
  customerWorkflowPilotEnabled,
  requireCustomerWorkflowPilot,
} from "./lib/customerWorkflowPilot";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { internalMutation } from "./lib/tenantLifecycle";

async function ownedWorkflow(ctx: QueryCtx, tenantId: string, id: Id<"customerWorkflows">) {
  const row = await ctx.db.get(id);
  if (!row || row.tenantId !== tenantId || row.archived) throw new Error("WORKFLOW_UNAVAILABLE");
  return row;
}

async function ownedRun(ctx: QueryCtx, tenantId: string, id: Id<"customerWorkflowRuns">) {
  const row = await ctx.db.get(id);
  if (!row || row.tenantId !== tenantId) throw new Error("WORKFLOW_RUN_UNAVAILABLE");
  return row;
}

const runView = (run: Doc<"customerWorkflowRuns">) => ({
  _id: run._id,
  workflowId: run.workflowId,
  workflowRevision: run.workflowRevision,
  status: run.status,
  threadId: run.threadId,
  outputDocumentId: run.outputDocumentId,
  createdAt: run.createdAt,
});

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const enabled = customerWorkflowPilotEnabled(ctx.tenantId);
    if (!enabled) return { enabled, workflows: [], runs: [] };
    const workflows = await ctx.db
      .query("customerWorkflows")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(100);
    const runs = await ctx.db
      .query("customerWorkflowRuns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(50);
    const unresolved = await Promise.all(
      (["running", "needs_review"] as const).map((status) =>
        ctx.db
          .query("customerWorkflowRuns")
          .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", status))
          .take(100),
      ),
    );
    const visibleRuns = new Map([...unresolved.flat(), ...runs].map((run) => [run._id, run]));
    return {
      enabled,
      workflows: workflows.filter((w) => !w.archived),
      runs: [...visibleRuns.values()].sort((a, b) => b.createdAt - a.createdAt).map(runView),
    };
  },
});

export const save = tenantMutation({
  args: {
    id: v.optional(v.id("customerWorkflows")),
    expectedRevision: v.optional(v.number()),
    name: v.string(),
    specialistId: v.id("customerSpecialists"),
    specialistRevision: v.number(),
    steps: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(ctx);
    const content = validateCustomerWorkflow(args);
    await getCustomerSpecialistVersion(
      ctx,
      ctx.tenantId,
      args.specialistId,
      args.specialistRevision,
      { requireCurrent: true },
    );
    const value = {
      ...content,
      specialistId: args.specialistId,
      specialistRevision: args.specialistRevision,
      updatedAt: Date.now(),
    };
    if (args.id) {
      const row = await ownedWorkflow(ctx, ctx.tenantId, args.id);
      if (row.revision !== args.expectedRevision) throw new Error("STALE_WORKFLOW");
      await ctx.db.patch(row._id, { ...value, revision: row.revision + 1 });
      return { id: row._id, revision: row.revision + 1 };
    }
    const existing = await ctx.db
      .query("customerWorkflows")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(100);
    if (existing.length >= 100) throw new Error("WORKFLOW_LIMIT_REACHED");
    const id = await ctx.db.insert("customerWorkflows", {
      ...value,
      tenantId: ctx.tenantId,
      revision: 1,
      archived: false,
      createdAt: Date.now(),
    });
    return { id, revision: 1 };
  },
});

export const archive = tenantMutation({
  args: { id: v.id("customerWorkflows"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(ctx);
    const row = await ownedWorkflow(ctx, ctx.tenantId, args.id);
    if (row.revision !== args.expectedRevision) throw new Error("STALE_WORKFLOW");
    await ctx.db.patch(row._id, {
      archived: true,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
  },
});

export const claim = internalMutation({
  args: {
    tenantId: v.string(),
    workflowId: v.id("customerWorkflows"),
    expectedRevision: v.number(),
    brief: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(args);
    const brief = validateCustomerWorkflowBrief(args.brief, args.requestId);
    const prior = await ctx.db
      .query("customerWorkflowRuns")
      .withIndex("by_tenant_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.workflowId !== args.workflowId ||
        prior.workflowRevision !== args.expectedRevision ||
        prior.brief !== brief
      )
        throw new Error("WORKFLOW_REQUEST_CHANGED");
      return { claimed: false, ...runView(prior) };
    }
    const workflow = await ownedWorkflow(ctx, args.tenantId, args.workflowId);
    if (workflow.revision !== args.expectedRevision) throw new Error("STALE_WORKFLOW");
    const specialist = await getCustomerSpecialistVersion(
      ctx,
      args.tenantId,
      workflow.specialistId,
      workflow.specialistRevision,
      { requireCurrent: true },
    );
    const knowledge = await Promise.all(
      specialist.knowledgeDocumentIds.map(async (id) => {
        const doc = await ctx.db.get(id);
        if (!doc || doc.tenantId !== args.tenantId) throw new Error("WORKFLOW_KNOWLEDGE_CHANGED");
        return {
          documentId: id,
          contentHash: doc.contentHash,
          title: doc.title,
          text: (doc.text ?? "").slice(0, 6000),
          truncated: (doc.text?.length ?? 0) > 6000,
        };
      }),
    );
    for (const status of ["running", "needs_review"] as const) {
      const active = await ctx.db
        .query("customerWorkflowRuns")
        .withIndex("by_tenant_workflow_status", (q) =>
          q.eq("tenantId", args.tenantId).eq("workflowId", workflow._id).eq("status", status),
        )
        .first();
      if (active) throw new Error("WORKFLOW_RUN_UNRESOLVED");
    }
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) =>
        q.eq("name", DOCUMENT_DRAFTER_SKILL).eq("status", "active"),
      )
      .unique();
    if (!skill) throw new Error("WORKFLOW_EXECUTOR_UNAVAILABLE");
    const now = Date.now();
    const id = await ctx.db.insert("customerWorkflowRuns", {
      tenantId: args.tenantId,
      workflowId: workflow._id,
      workflowRevision: workflow.revision,
      name: workflow.name,
      steps: workflow.steps,
      specialistId: workflow.specialistId,
      specialistRevision: workflow.specialistRevision,
      executorSkillName: DOCUMENT_DRAFTER_SKILL,
      executorSkillVersion: skill.version,
      brief,
      knowledge,
      requestId: args.requestId,
      status: "running",
      agentStarted: false,
      modelCompleted: false,
      createdAt: now,
      updatedAt: now,
    });
    const run = await ctx.db.get(id);
    if (!run) throw new Error("WORKFLOW_RUN_UNAVAILABLE");
    return { claimed: true, ...runView(run) };
  },
});

export const bindThread = internalMutation({
  args: {
    tenantId: v.string(),
    runId: v.id("customerWorkflowRuns"),
    threadId: v.string(),
    planId: v.id("plans"),
  },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(args);
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    const plan = await ctx.db.get(args.planId);
    if (
      run.status !== "running" ||
      run.threadId ||
      !plan ||
      plan.tenantId !== args.tenantId ||
      plan.threadId !== args.threadId
    )
      throw new Error("WORKFLOW_RUN_CHANGED");
    await ctx.db.patch(run._id, {
      threadId: args.threadId,
      planId: args.planId,
      updatedAt: Date.now(),
    });
  },
});

export const executionContext = internalQuery({
  args: { tenantId: v.string(), runId: v.id("customerWorkflowRuns") },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(args);
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    if (run.status !== "running" || !run.threadId || !run.planId)
      throw new Error("WORKFLOW_RUN_CHANGED");
    await ownedWorkflow(ctx, args.tenantId, run.workflowId);
    const specialist = await getCustomerSpecialistVersion(
      ctx,
      args.tenantId,
      run.specialistId,
      run.specialistRevision,
    );
    for (const source of run.knowledge) {
      const doc = await ctx.db.get(source.documentId);
      if (!doc || doc.tenantId !== args.tenantId || doc.contentHash !== source.contentHash)
        throw new Error("WORKFLOW_KNOWLEDGE_CHANGED");
    }
    return { ...run, threadId: run.threadId, planId: run.planId, specialist };
  },
});

export const markAgentStarted = internalMutation({
  args: { tenantId: v.string(), runId: v.id("customerWorkflowRuns") },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(args);
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    if (run.status !== "running" || run.agentStarted) throw new Error("WORKFLOW_RUN_CHANGED");
    await ctx.db.patch(run._id, { agentStarted: true, updatedAt: Date.now() });
  },
});

export const finish = internalMutation({
  args: {
    tenantId: v.string(),
    runId: v.id("customerWorkflowRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    if (run.status !== "running") return runView(run);
    return settleRun(ctx, run);
  },
});

export const recordReservation = internalMutation({
  args: {
    tenantId: v.string(),
    runId: v.id("customerWorkflowRuns"),
    reservationId: v.id("spendEvents"),
  },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(args);
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    const reservation = await ctx.db.get(args.reservationId);
    if (
      run.status !== "running" ||
      !run.agentStarted ||
      run.reservationId ||
      !reservation ||
      reservation.tenantId !== args.tenantId ||
      reservation.phase !== "reserved" ||
      reservation.kind !== "paid_call"
    )
      throw new Error("WORKFLOW_RESERVATION_INVALID");
    await ctx.db.patch(run._id, { reservationId: args.reservationId });
  },
});

export const recordResult = internalMutation({
  args: {
    tenantId: v.string(),
    runId: v.id("customerWorkflowRuns"),
    resultHash: v.string(),
    incomplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.tenantId, args.runId);
    if (
      run.status !== "running" ||
      !run.agentStarted ||
      run.modelCompleted ||
      !/^[a-f0-9]{64}$/.test(args.resultHash)
    )
      throw new Error("WORKFLOW_RESULT_INVALID");
    await ctx.db.patch(run._id, {
      modelCompleted: true,
      resultHash: args.resultHash,
      resultIncomplete: args.incomplete,
    });
  },
});

async function settleRun(ctx: MutationCtx, run: Doc<"customerWorkflowRuns">) {
  const documents = run.threadId
    ? await ctx.db
        .query("vaultDocuments")
        .withIndex("by_tenant_sourceThread", (q) =>
          q.eq("tenantId", run.tenantId).eq("sourceThreadId", run.threadId),
        )
        .take(10)
    : [];
  const output = documents.find(
    (doc) =>
      doc.kind === "created_document" &&
      doc.origin === "agent" &&
      doc.sourcePlanId === run.planId &&
      doc.contentHash === run.resultHash &&
      Boolean(doc.storageId),
  );
  let settled = false;
  if (run.reservationId) {
    const reservation = await ctx.db.get(run.reservationId);
    if (
      reservation?.tenantId === run.tenantId &&
      reservation.phase === "reserved" &&
      reservation.kind === "paid_call"
    ) {
      const ledger = await ctx.db
        .query("spendEvents")
        .withIndex("by_correlation", (q) => q.eq("correlationId", reservation.correlationId))
        .take(8);
      settled = ledger.some(
        (row) =>
          row.tenantId === run.tenantId &&
          row.kind === "paid_call" &&
          (row.phase === "actual" || (row.phase === "refunded" && row.evalActualUsd === 0)),
      );
    }
  }
  const status: Doc<"customerWorkflowRuns">["status"] =
    run.modelCompleted && output && !run.resultIncomplete
      ? "completed"
      : run.modelCompleted || settled || !run.reservationId
        ? "failed"
        : "needs_review";
  await ctx.db.patch(run._id, { status, outputDocumentId: output?._id, updatedAt: Date.now() });
  return { ...runView(run), status, outputDocumentId: output?._id };
}

export const reconcile = tenantMutation({
  args: { runId: v.id("customerWorkflowRuns") },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, ctx.tenantId, args.runId);
    if (run.status === "completed" || run.status === "failed") return runView(run);
    // The action's maximum lifetime is ten minutes. A live run cannot be unlocked by a second tab.
    if (run.status === "running" && Date.now() - run.createdAt < 10 * 60 * 1000)
      return runView(run);
    return settleRun(ctx, run);
  },
});
