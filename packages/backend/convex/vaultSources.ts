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
 * Persist one card row for a thread. Append-only: a re-search — or a revise — inserts a NEW row
 * rather than patching (byThread reads the latest). titles = labels-to-UI, docIds = stable refs.
 *
 * Phase-18 (ACTN-04) made this table DUAL-PURPOSE. `role` absent ⇒ the grounding SOURCE card (every
 * row that exists today); `role: "created"` ⇒ the Output card for artifacts the agent authored this
 * turn, carrying a `snippet` preview and the `form` its UPPERCASE type badge renders.
 *
 * ONE row per turn carries ALL N docIds — that is what makes `#index` addressable for the locked
 * replace-in-place revise (`vault.patchCreatedDoc` resolves `docIds[index - 1]`). Do not split a
 * multi-document turn into N rows later without moving that resolution too.
 */
export const insert = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    docIds: v.array(v.id("vaultDocuments")),
    titles: v.array(v.string()),
    count: v.number(),
    role: v.optional(v.literal("created")),
    snippet: v.optional(v.string()), // first ~240 chars of the artifact — the card's preview
    form: v.optional(v.union(v.literal("short"), v.literal("long"))),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("vaultSources", args),
});

/**
 * The tenant's LATEST card row of a given kind for a thread (by_thread). `role` absent feeds the
 * shipped SOURCE card + its PreviewModal click-through; `role: "created"` feeds the Phase-18
 * Output card. Two `useQuery` call sites, one query.
 *
 * ⚠ THE ROLE FILTER IS LOAD-BEARING — do NOT simplify it back to `.first()`. The table is
 * append-only per thread and by_thread is latest-wins, so a bare `.first()` returns whatever the
 * LAST turn wrote, whichever kind that was: one searchVault turn between a create and a revise and
 * the Output card starts rendering a grounding row (and `patchCreatedDoc` resolves `#1` to a
 * USER-UPLOADED doc, where its origin guard correctly refuses and the locked "make that one
 * shorter" silently stops working — it fails safe, but it fails). Symmetrically, the SOURCE card
 * must not start rendering created rows now that they share this table.
 *
 * Explicit return type (Convex guidelines §96): inferred through the generated api it would
 * collapse sibling functions to `any`.
 */
export const byThread = tenantQuery({
  args: { threadId: v.string(), role: v.optional(v.literal("created")) },
  handler: async (ctx, { threadId, role }): Promise<Doc<"vaultSources"> | null> =>
    (
      await ctx.db
        .query("vaultSources")
        .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
        .order("desc")
        // ponytail: 20-row window, not a full scan — index order IS recency, so the match is
        // almost always row 1. Raise it only if a thread can put >20 turns of the OTHER kind
        // between two turns of the kind being asked for.
        .take(20)
    ).find((r) => r.role === role) ?? null,
});
