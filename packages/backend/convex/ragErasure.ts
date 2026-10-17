import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./lib/tenantLifecycle";

const stepRef = makeFunctionReference<"mutation", { tenantId: string }, null>("ragErasure:step");

/** Native erasure only: the fence and scheduling commit with the caller's page deletion. */
export async function ensureRagErasure(ctx: MutationCtx, tenantId: string): Promise<boolean> {
  const fence = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", tenantId))
    .unique();
  if (!fence?.state) return false;
  if (!fence.ragCleanup) {
    await ctx.db.patch(fence._id, { ragCleanup: { state: "pending" } });
    await ctx.scheduler.runAfter(0, stepRef, { tenantId });
  } else if (fence.ragCleanup.state === "stalled") {
    // Operator resume only observes the existing component operation; never resends it.
    await ctx.db.patch(fence._id, {
      ragCleanup: { ...fence.ragCleanup, state: "pending", polls: 0 },
    });
    await ctx.scheduler.runAfter(0, stepRef, { tenantId });
  }
  return true;
}

/** Resume only an already-authorized erased/deleting identity; never admits a live tenant. */
export const start = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<null> => {
    if (!(await ensureRagErasure(ctx, tenantId))) throw new Error("TENANT_ERASURE_REQUIRED");
    return null;
  },
});

/** One entry or namespace per transaction. The component owns large-chunk continuation. */
export const step = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<null> => {
    const fence = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", tenantId))
      .unique();
    if (!fence?.state || !fence.ragCleanup) throw new Error("TENANT_ERASURE_REQUIRED");
    if (fence.ragCleanup.state !== "pending") return null;
    const pending = fence.ragCleanup.pendingEntryId;
    if (pending) {
      const entry = await ctx.runQuery(components.rag.entries.get, { entryId: pending });
      if (entry) {
        // Never enqueue the same delete twice: the component has durable continuation work.
        const polls = (fence.ragCleanup.polls ?? 0) + 1;
        await ctx.db.patch(fence._id, {
          ragCleanup: {
            state: polls >= 60 ? "stalled" : "pending",
            pendingEntryId: pending,
            polls,
          },
        });
        if (polls < 60) await ctx.scheduler.runAfter(5000, stepRef, { tenantId });
        return null;
      }
    }
    const page = await ctx.runQuery(components.rag.namespaces.listNamespaceVersions, {
      namespace: tenantId,
      paginationOpts: { cursor: null, numItems: 1 },
    });
    const namespace = page.page[0];
    if (!namespace) {
      await ctx.db.patch(fence._id, { ragCleanup: { state: "complete" } });
      return null;
    }
    if (namespace.namespace !== tenantId) throw new Error("RAG_ERASURE_SCOPE_MISMATCH");
    for (const status of ["pending", "ready", "replaced"] as const) {
      const entries = await ctx.runQuery(components.rag.entries.list, {
        namespaceId: namespace.namespaceId,
        status,
        paginationOpts: { cursor: null, numItems: 1 },
      });
      const entry = entries.page[0];
      if (!entry) continue;
      await ctx.runMutation(components.rag.entries.deleteAsync, {
        entryId: entry.entryId,
        startOrder: 0,
      });
      await ctx.db.patch(fence._id, {
        ragCleanup: { state: "pending", pendingEntryId: entry.entryId, polls: 0 },
      });
      await ctx.scheduler.runAfter(5000, stepRef, { tenantId });
      return null;
    }
    await ctx.runMutation(components.rag.namespaces.deleteNamespace, {
      namespaceId: namespace.namespaceId,
    });
    await ctx.db.patch(fence._id, { ragCleanup: { state: "pending" } });
    await ctx.scheduler.runAfter(0, stepRef, { tenantId });
    return null;
  },
});
