// Operator-created containment for two real UI turns. No model execution or owner grant here.
import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { AUTHORING_PROBE_AUDIT_NAMESPACE, appendAudit } from "./audit";

export async function probeControl(ctx: QueryCtx, budgetId: Id<"spendEvents">) {
  const rows = await ctx.db
    .query("audit")
    .withIndex("by_correlation", (q) => q.eq("correlationId", `authoring-probe:${budgetId}`))
    .take(69);
  if (rows.length > 68) throw new Error("AUTHORING_PROBE_CONTROL_LIMIT");
  return rows.filter((row) => row.tenantId === AUTHORING_PROBE_AUDIT_NAMESPACE);
}

export const prepare = internalMutation({
  args: { userId: v.id("users"), capCents: v.number(), authorizationSha256: v.string() },
  handler: async (
    ctx,
    { userId, capCents, authorizationSha256 },
  ): Promise<{ threadId: string; budgetId: Id<"spendEvents"> }> => {
    if (!(await ctx.db.get(userId))?.owner) throw new Error("AUTHORING_PROBE_OWNER_REQUIRED");
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: "Skill authoring acceptance",
    });
    await ctx.runMutation(internal.plans.insertPlan, { tenantId: userId, threadId });
    const budgetId = await ctx.runMutation(internal.guardrails.openEvalBudget, {
      tenantIds: [userId],
      capCents,
      family: "golden",
      authoringProbe: { threadId, authorizationSha256 },
    });
    return { threadId, budgetId };
  },
});

export const claimTurn = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), turnId: v.string() },
  handler: async (ctx, { tenantId, threadId, turnId }): Promise<Id<"spendEvents"> | null> => {
    const envelope = await ctx.db
      .query("spendEvents")
      .withIndex("by_probe_thread", (q) =>
        q.eq("tenantId", tenantId).eq("evalAuthoringProbe.threadId", threadId),
      )
      .unique();
    if (!envelope) return null;
    if (
      !/^[a-f0-9-]{36}$/.test(turnId) ||
      !envelope.evalEnvelope ||
      Date.now() >= envelope.evalEnvelope.expiresAt
    )
      throw new Error("AUTHORING_PROBE_EXPIRED_OR_INVALID");
    const ledger = await ctx.db
      .query("spendEvents")
      .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", envelope._id))
      .take(1502);
    if (
      ledger.length > 1501 ||
      ledger.some((row) => row.kind === "eval_budget_closed" || row.evalBreach)
    )
      throw new Error("AUTHORING_PROBE_CLOSED");
    if (
      ledger.some(
        (row) =>
          row.phase === "reserved" &&
          !ledger.some(
            (done) => done.correlationId === row.correlationId && done.evalActualUsd !== undefined,
          ),
      )
    )
      throw new Error("AUTHORING_PROBE_PROVIDER_UNRESOLVED");
    const rows = await probeControl(ctx, envelope._id);
    const starts = rows.filter((row) => row.eventType === "authoring_probe.started");
    if (
      starts.length >= 2 ||
      rows.some((row) => row.eventType === "authoring_probe.failed") ||
      starts.some(
        (row) =>
          !rows.some(
            (done) =>
              done.eventType === "authoring_probe.finished" &&
              done.payload.turnId === row.payload.turnId,
          ),
      )
    )
      throw new Error("AUTHORING_PROBE_TURN_LIMIT_OR_UNRESOLVED");
    await appendAudit(ctx, {
      tenantId: AUTHORING_PROBE_AUDIT_NAMESPACE,
      correlationId: `authoring-probe:${envelope._id}`,
      eventType: "authoring_probe.started",
      actor: "system",
      payload: { turnId },
    });
    return envelope._id;
  },
});

export const finishTurn = internalMutation({
  args: {
    tenantId: v.string(),
    budgetId: v.id("spendEvents"),
    turnId: v.string(),
    failed: v.boolean(),
  },
  handler: async (ctx, { tenantId, budgetId, turnId, failed }) => {
    const envelope = await ctx.db.get(budgetId);
    if (envelope?.tenantId !== tenantId || !envelope.evalAuthoringProbe)
      throw new Error("AUTHORING_PROBE_NOT_FOUND");
    const rows = await probeControl(ctx, budgetId);
    if (
      !rows.some(
        (row) => row.eventType === "authoring_probe.started" && row.payload.turnId === turnId,
      )
    )
      throw new Error("AUTHORING_PROBE_TURN_UNKNOWN");
    const eventType = failed ? "authoring_probe.failed" : "authoring_probe.finished";
    const prior = rows.find(
      (row) =>
        ["authoring_probe.finished", "authoring_probe.failed"].includes(row.eventType) &&
        row.payload.turnId === turnId,
    );
    if (prior) {
      if (prior.eventType !== eventType) throw new Error("AUTHORING_PROBE_FINISH_MISMATCH");
      return;
    }
    await appendAudit(ctx, {
      tenantId: AUTHORING_PROBE_AUDIT_NAMESPACE,
      correlationId: `authoring-probe:${budgetId}`,
      eventType,
      actor: "system",
      payload: { turnId },
    });
  },
});

export const context = internalQuery({
  args: { tenantId: v.string(), budgetId: v.id("spendEvents") },
  handler: async (ctx, { tenantId, budgetId }) => {
    const envelope = await ctx.db.get(budgetId);
    if (!envelope?.evalEnvelope?.tenantIds.includes(tenantId))
      throw new Error("EVAL_BUDGET_NOT_FOUND");
    return envelope.evalAuthoringProbe ?? null;
  },
});

export const assertUnregisteredThread = internalQuery({
  args: { tenantId: v.string(), threadId: v.string() },
  handler: async (ctx, { tenantId, threadId }) => {
    if (
      await ctx.db
        .query("spendEvents")
        .withIndex("by_probe_thread", (q) =>
          q.eq("tenantId", tenantId).eq("evalAuthoringProbe.threadId", threadId),
        )
        .first()
    )
      throw new Error("AUTHORING_PROBE_ALTERNATE_ENTRY_REFUSED");
    return null;
  },
});

export const containTool = internalMutation({
  args: { tenantId: v.string(), budgetId: v.id("spendEvents"), toolName: v.string() },
  handler: async (ctx, { tenantId, budgetId, toolName }) => {
    const envelope = await ctx.db.get(budgetId);
    if (
      envelope?.tenantId !== tenantId ||
      !envelope.evalAuthoringProbe ||
      !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(toolName)
    )
      throw new Error("AUTHORING_PROBE_NOT_FOUND");
    const rows = await probeControl(ctx, budgetId);
    const active = rows.find(
      (row) =>
        row.eventType === "authoring_probe.started" &&
        !rows.some(
          (done) =>
            ["authoring_probe.finished", "authoring_probe.failed"].includes(done.eventType) &&
            done.payload.turnId === row.payload.turnId,
        ),
    );
    if (!active || rows.filter((row) => row.eventType === "authoring_probe.contained").length >= 64)
      throw new Error("AUTHORING_PROBE_CONTROL_LIMIT");
    await appendAudit(ctx, {
      tenantId: AUTHORING_PROBE_AUDIT_NAMESPACE,
      correlationId: `authoring-probe:${budgetId}`,
      eventType: "authoring_probe.contained",
      actor: "system",
      payload: { turnId: active.payload.turnId, toolName },
    });
  },
});

export const inspect = internalQuery({
  args: { budgetId: v.id("spendEvents") },
  handler: async (ctx, { budgetId }) => {
    const envelope = await ctx.db.get(budgetId);
    if (!envelope?.evalAuthoringProbe) throw new Error("AUTHORING_PROBE_NOT_FOUND");
    const rows = await probeControl(ctx, budgetId);
    return {
      tenantId: envelope.tenantId,
      ...envelope.evalAuthoringProbe,
      expiresAt: envelope.evalEnvelope?.expiresAt,
      started: rows.filter((r) => r.eventType === "authoring_probe.started").length,
      finished: rows.filter((r) => r.eventType === "authoring_probe.finished").length,
      failed: rows.filter((r) => r.eventType === "authoring_probe.failed").length,
      containmentRefusals: rows.filter((r) => r.eventType === "authoring_probe.contained").length,
      policyAcceptanceEstablished: false,
    };
  },
});
