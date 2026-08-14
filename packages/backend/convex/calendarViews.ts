// Calendar-availability content-plane adapter (CLAUDE.md §1: thin adapter — this module only
// reads and writes rows; every decision about WHICH blocks are busy belongs to the provider
// actions, calendar.ts and microsoftCalendar.ts).
//
// Mirrors briefings.ts exactly, including its most important property: this module writes NO
// log-plane row. The availability audit (`calendar.availability`, refs + counts only) is written
// by the ACTING module, so the instants held here can never reach a payload (CLAUDE.md §4).
//
// The writer is internal (called by the checkAvailability tool's action); the reader is a
// tenantQuery so the browser subscribes and the CALENDAR card fills live, guarded on ctx.tenantId.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";
import schema from "./schema";

// DERIVED from schema.ts, for the reason briefings.ts learned the hard way: a hand-copied validator
// silently drifts from the table and `insert` starts rejecting rows the schema considers valid.
// Deriving means the next field lands in ONE place. ponytail rung 2 — it already exists, don't retype it.
const BUSY = schema.tables.calendarViews.validator.fields.busy;
const PROVIDER = schema.tables.calendarViews.validator.fields.provider;

/**
 * Persist one availability read for a thread. Append-only: a re-check inserts a NEW row rather
 * than patching, so the old view stays a truthful record of what was shown at the time, and
 * `byThread` reads the latest. `busy` arrives code-owned from the provider action (ADR-004).
 *
 * CALLED ON THE EMPTY READ TOO. `busy: []` is the answer "nothing scheduled", not the absence of
 * an answer — see the schema comment. Do not add a `busy.length > 0` guard here or at the caller.
 */
export const insert = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    provider: PROVIDER,
    range: v.string(),
    tz: v.string(),
    busy: BUSY,
    truncated: v.optional(v.boolean()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("calendarViews", args),
});

/**
 * The tenant's LATEST availability read for a thread → feeds the CALENDAR card (by_thread).
 *
 * Explicit return type (Convex guidelines §96): inferred through the generated api it would
 * collapse sibling functions to `any`. Rows are append-only per thread, so index order
 * (_creationTime) IS recency — `.order("desc").first()` is the whole "latest" story, no scan.
 */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<Doc<"calendarViews"> | null> =>
    await ctx.db
      .query("calendarViews")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first(),
});
