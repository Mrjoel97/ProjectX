// Vault-grounding content-plane adapter (CLAUDE.md §1: thin adapter — this module only reads and
// writes rows). Mirrors briefings.ts exactly, including its most important property: this module
// writes NO log-plane row. The refs-only vault.searched audit is written by the ACTING module
// (llm.ts) with a queryHash + resultCount only, so the doc titles held here can never reach a
// payload (CLAUDE.md §4). docIds are the PreviewModal click-through targets (Plan 03).
//
// The writer is internal (called by the searchVault tool's action); the reader is a tenantQuery
// so the browser subscribes and the SOURCE card fills live, guarded on ctx.tenantId.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/**
 * Persist one vault-source card for a thread. Append-only: a re-search inserts a NEW row rather
 * than patching (byThread reads the latest). titles = labels-to-UI, docIds = stable refs.
 */
export const insert = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    docIds: v.array(v.id("vaultDocuments")),
    titles: v.array(v.string()),
    count: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("vaultSources", args),
});

/**
 * The tenant's LATEST vault-source row for a thread → feeds the SOURCE card (by_thread). This is
 * the reader Plan 03 consumes for its card + PreviewModal click-through.
 *
 * Explicit return type (Convex guidelines §96): inferred through the generated api it would
 * collapse sibling functions to `any`. Rows are append-only per thread, so index order IS
 * recency — `.order("desc").first()` is the whole "latest" story, no scan.
 */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<Doc<"vaultSources"> | null> =>
    await ctx.db
      .query("vaultSources")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first(),
});
