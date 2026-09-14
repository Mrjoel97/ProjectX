// A requested research PDF is a deterministic presentation of the exact persisted findings row.
// This is a one-shot workflow, not recurrence: one staged dependency starts at most one workflow,
// and neither the completion terminal nor a retry schedules another run.
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./index";

export const RESEARCH_DELIVERABLE_REASON = v.union(
  v.literal("research_failed"),
  v.literal("research_incomplete"),
  v.literal("source_missing"),
  v.literal("source_deleted"),
  v.literal("source_mismatch"),
  v.literal("plan_canceled"),
  v.literal("render_failed"),
);

const MATERIALIZE_ARGS = {
  tenantId: v.string(),
  planId: v.id("plans"),
  requestId: v.string(),
  sourceVaultDocId: v.id("vaultDocuments"),
  sourceContentHash: v.string(),
};

/** Refuse a dependency without touching the memo or its source document. */
export const refuse = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    requestId: v.string(),
    reason: RESEARCH_DELIVERABLE_REASON,
  },
  handler: async (ctx, a): Promise<boolean> => {
    const plan = await ctx.db.get(a.planId);
    const dependency = plan?.researchDeliverable;
    if (!plan || plan.tenantId !== a.tenantId || dependency?.requestId !== a.requestId)
      return false;
    if (
      dependency.status === "ready" ||
      dependency.status === "refused" ||
      dependency.status === "canceled"
    ) {
      return false;
    }
    const canceled = plan.status === "canceled" || a.reason === "plan_canceled";
    await ctx.db.patch(a.planId, {
      researchDeliverable: {
        ...dependency,
        status: canceled ? ("canceled" as const) : ("refused" as const),
        reason: canceled ? ("plan_canceled" as const) : a.reason,
      },
    });
    return true;
  },
});

/** Exact content-plane load for the deterministic renderer. */
export const loadExactSource = internalQuery({
  args: MATERIALIZE_ARGS,
  handler: async (
    ctx,
    a,
  ): Promise<
    | {
        ok: true;
        title: string;
        markdown: string;
        existingStorageId?: Id<"_storage">;
      }
    | { ok: false; reason: "source_deleted" | "source_mismatch" | "plan_canceled" }
  > => {
    const [plan, doc] = await Promise.all([ctx.db.get(a.planId), ctx.db.get(a.sourceVaultDocId)]);
    if (!plan || plan.tenantId !== a.tenantId) return { ok: false, reason: "source_mismatch" };
    if (plan.status === "canceled" || plan.researchDeliverable?.status === "canceled") {
      return { ok: false, reason: "plan_canceled" };
    }
    if (!doc) return { ok: false, reason: "source_deleted" };
    const dependency = plan.researchDeliverable;
    if (
      !dependency ||
      (dependency.status !== "materializing" && dependency.status !== "ready") ||
      dependency.requestId !== a.requestId ||
      dependency.sourceVaultDocId !== a.sourceVaultDocId ||
      dependency.sourceContentHash !== a.sourceContentHash ||
      doc.tenantId !== a.tenantId ||
      doc.kind !== "web_research" ||
      doc.source !== "web_research" ||
      doc.sourcePlanId !== a.planId ||
      doc.contentHash !== a.sourceContentHash ||
      doc.mimeType !== "text/markdown" ||
      typeof doc.text !== "string" ||
      doc.text.length === 0 ||
      (dependency.status === "ready" &&
        (!doc.storageId || doc.storedMimeType !== "application/pdf"))
    ) {
      return { ok: false, reason: "source_mismatch" };
    }
    return {
      ok: true,
      title: doc.title,
      markdown: doc.text,
      ...(doc.storageId && doc.storedMimeType === "application/pdf"
        ? { existingStorageId: doc.storageId }
        : {}),
    };
  },
});

export const materialize = workflow.define({
  args: MATERIALIZE_ARGS,
  handler: async (step, args): Promise<null> => {
    // The operation is deterministic and has no model/spend. Retrying is safe: the final mutation
    // is a CAS and the action deletes a losing blob after it learns which storage ref won.
    await step.runAction(internal.llm.materializeResearchPdf, args, { retry: true });
    return null;
  },
});

/** Start once after the exact findings row has committed. Concurrent/replayed starts reuse it. */
export const start = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    requestId: v.string(),
    sourceVaultDocId: v.id("vaultDocuments"),
  },
  handler: async (
    ctx,
    a,
  ): Promise<
    | { ok: true; state: "materializing"; workflowId: string; reused: boolean }
    | { ok: true; state: "ready"; reused: true }
    | {
        ok: false;
        reason: "source_missing" | "source_deleted" | "source_mismatch" | "plan_canceled";
      }
  > => {
    const [plan, doc] = await Promise.all([ctx.db.get(a.planId), ctx.db.get(a.sourceVaultDocId)]);
    const dependency = plan?.researchDeliverable;
    if (!plan || plan.tenantId !== a.tenantId || dependency?.requestId !== a.requestId) {
      return { ok: false, reason: "source_mismatch" };
    }
    if (plan.status === "canceled" || dependency.status === "canceled") {
      await ctx.db.patch(a.planId, {
        researchDeliverable: { ...dependency, status: "canceled", reason: "plan_canceled" },
      });
      return { ok: false, reason: "plan_canceled" };
    }
    if (dependency.status === "refused") return { ok: false, reason: "source_mismatch" };
    if (!doc) {
      const reason = dependency.status === "pending" ? "source_missing" : "source_deleted";
      if (dependency.status !== "ready") {
        await ctx.db.patch(a.planId, {
          researchDeliverable: { ...dependency, status: "refused", reason },
        });
      }
      return { ok: false, reason };
    }
    const baseMismatch =
      doc.tenantId !== a.tenantId ||
      doc.kind !== "web_research" ||
      doc.source !== "web_research" ||
      doc.sourcePlanId !== a.planId ||
      doc.mimeType !== "text/markdown" ||
      typeof doc.text !== "string" ||
      doc.text.length === 0;
    const frozenExact =
      dependency.sourceVaultDocId === a.sourceVaultDocId &&
      dependency.sourceContentHash === doc.contentHash;
    const readyExact =
      dependency.status === "ready" &&
      frozenExact &&
      !!doc.storageId &&
      doc.storedMimeType === "application/pdf";
    const materializingExact =
      dependency.status === "materializing" && frozenExact && !!dependency.workflowId;
    if (baseMismatch || (dependency.status !== "pending" && !readyExact && !materializingExact)) {
      // A replay carrying a different row must not poison a legitimate in-flight or completed
      // dependency. Only the original pending transition owns the right to terminalize itself.
      if (dependency.status === "pending") {
        await ctx.db.patch(a.planId, {
          researchDeliverable: { ...dependency, status: "refused", reason: "source_mismatch" },
        });
      }
      return { ok: false, reason: "source_mismatch" };
    }
    if (readyExact) return { ok: true, state: "ready", reused: true };
    if (materializingExact) {
      return {
        ok: true,
        state: "materializing",
        workflowId: dependency.workflowId as string,
        reused: true,
      };
    }
    const sourceContentHash = doc.contentHash;
    const args = { ...a, sourceContentHash };
    const workflowId = await workflow.start(ctx, internal.researchDeliverable.materialize, args, {
      onComplete: internal.researchDeliverable.onComplete,
      context: args,
    });
    await ctx.db.patch(a.planId, {
      researchDeliverable: {
        ...dependency,
        status: "materializing",
        sourceVaultDocId: a.sourceVaultDocId,
        sourceContentHash,
        workflowId,
        reason: undefined,
      },
    });
    return { ok: true, state: "materializing", workflowId, reused: false };
  },
});

/** Workflow-level failure terminal. The successful action owns every semantic refusal itself. */
export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object(MATERIALIZE_ARGS),
  },
  handler: async (ctx, { result, context }): Promise<void> => {
    if (result.kind === "success") return;
    await ctx.runMutation(internal.researchDeliverable.refuse, {
      tenantId: context.tenantId,
      planId: context.planId,
      requestId: context.requestId,
      reason: "render_failed",
    });
  },
});
