// WORM export cursor + audit-window helpers (SC-4).
//
// These are the DB-touching internal query/mutation for the WORM export. They live
// here (a normal, non-"use node" module) rather than in worm.ts because a "use node"
// module may contain ONLY actions — Convex rejects queries/mutations defined in a
// Node.js module. worm.ts (the "use node" action) reads/advances the cursor through
// these via ctx.runQuery / ctx.runMutation, since actions cannot touch ctx.db.
//
// Allow-listed for internal builders (lib/allowlist.ts).
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const CURSOR_NAME = "worm-audit";

/** Last audit ts exported to immutable storage; 0 baseline until the first export. */
export const getCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("exportCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    return row?.lastExportedTs ?? 0;
  },
});

/** Audit rows strictly after `since`, oldest-first — the incremental export window. */
export const auditSince = internalQuery({
  args: { since: v.number(), limit: v.optional(v.number()) },
  handler: (ctx, { since, limit }) =>
    // Index range read on the global by_ts index (07-01): rows come back
    // ts-ascending straight from the index, so no manual filter/sort — and no
    // full .collect() scan of the unbounded audit table.
    ctx.db
      .query("audit")
      .withIndex("by_ts", (q) => q.gt("ts", since))
      .take(limit ?? 10_000),
});

/** Advance the cursor after a CONFIRMED durable export (upsert — one row per cursor). */
export const advanceCursor = internalMutation({
  args: { ts: v.number() },
  handler: async (ctx, { ts }) => {
    const row = await ctx.db
      .query("exportCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    if (row) await ctx.db.patch(row._id, { lastExportedTs: ts });
    else await ctx.db.insert("exportCursors", { name: CURSOR_NAME, lastExportedTs: ts });
  },
});
