// Inbox-briefing content-plane adapter (CLAUDE.md §1: thin adapter — every decision about
// what a briefing CONTAINS is pure @pikar/core; this module only reads and writes rows).
//
// Mirrors plans.ts exactly, including its most important property: this module writes NO
// log-plane row. The briefing's audit trail (mailbox.listed / briefing.created) is written by
// the ACTING module (gmail.ts / llm.ts) with refs + counts only, so the raw senders and gists
// held here can never reach a payload (CLAUDE.md §4 — asserted statically in llmRedaction.test.ts).
//
// The writer is internal (called by the briefInbox tool's action); the reader is a tenantQuery
// so the browser subscribes and the BRIEFING card fills live, guarded on ctx.tenantId.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";
import schema from "./schema";

// DERIVED from schema.ts — the single source of truth for the row shape (which mirrors @pikar/core's
// BriefingItem, Plan 01). This was a hand-copied duplicate and it did exactly what hand-copied
// duplicates do: adding `id`/`subject` to the schema left this validator behind, and `insert`
// rejected rows the schema considered valid ("Unexpected field `id`"). Deriving it means the next
// field lands in ONE place. ponytail rung 2 — the validator already exists, so don't retype it.
const ITEMS = schema.tables.briefings.validator.fields.items;

/**
 * Persist one briefing for a thread. Append-only: a re-brief inserts a NEW row rather than
 * patching (the old briefing stays a truthful record of what was said at the time, and
 * `byThread` reads the latest). `items` arrive already joined by @pikar/core's joinDigest —
 * id/sender/subject/ts/bucket are code-owned facts, never model output (ADR-004).
 */
export const insert = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    range: v.string(),
    tz: v.string(),
    items: ITEMS,
    listedCount: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("briefings", args),
});

/**
 * The tenant's LATEST briefing for a thread → feeds the BRIEFING card (by_thread).
 *
 * Explicit return type (Convex guidelines §96): inferred through the generated api it would
 * collapse sibling functions to `any`. Rows are append-only per thread, so index order
 * (_creationTime) IS recency — `.order("desc").first()` is the whole "latest" story, no scan.
 */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<Doc<"briefings"> | null> =>
    await ctx.db
      .query("briefings")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .first(),
});
