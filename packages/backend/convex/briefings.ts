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
    // The digest's cross-message lede (optional — a pre-07 caller omits it). Content-plane only:
    // it never rides the counts-only tool return nor the refs-only briefing.created audit (§4).
    synopsis: v.optional(v.string()),
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

/** The Command Center's briefing card. Max rows before it says so rather than growing unbounded. */
const LATEST_ITEM_CAP = 5;

/**
 * A BOUNDED PROJECTION of one briefing row — NOT the row. `byThread` above returns the raw `Doc`
 * because the workspace card was written against it; copying that here would quietly ship every
 * future column to a second surface (the `savedPrompts` rule).
 *
 * THE ONE MODEL-OWNED FIELD is `synopsis`, and it is labelled as such by `synopsisOrigin` below.
 *
 * WHAT IS DELIBERATELY ABSENT, and why: `gist`, `category` and `deadline` are MODEL-OWNED prose
 * (schema.ts calls `deadline` "a model-extracted SUGGESTION string — rendered, never parsed into
 * an action"). This card is a summary with a LINK BACK TO THE WORKSPACE, so none of them appears
 * next to anything that reads like a control, and there is no affordance here that promises an
 * action: the chat → PLAN → Approve gate stays the only route to acting on a briefing (SC-4).
 * `id`/`sender`/`subject`/`ts`/`bucket` are code-owned Gmail facts (ADR-004), never model output.
 *
 * This is a READ. It writes nothing — no log-plane row (the module property asserted statically in
 * llmRedaction.test.ts), and no "seen" marker either.
 */
export type LatestBriefing = {
  createdAt: number;
  range: string;
  tz: string;
  listedCount: number;
  itemCount: number;
  synopsis: string | null;
  /**
   * CODE-OWNED PROVENANCE for the field above, constant by construction and never read from the
   * row: `synopsis` is the MODEL's cross-message lede (written at `llm.ts` from `digestInbox`),
   * unlike every other field here, which is a Gmail/DB fact. It ships because the card renders
   * the lede; it ships MARKED so no renderer can present a model sentence as the owner's own
   * word without the wire having said otherwise.
   */
  synopsisOrigin: "model";
  items: {
    id: string;
    bucket: "today" | "yesterday" | "thisWeek";
    sender: string;
    subject: string;
    ts: number;
    needsReply: boolean;
  }[];
  capped: boolean;
};

/**
 * The tenant's newest briefing across every thread → the Command Center card.
 *
 * `by_tenant_createdAt` (already on the table; no schema change) and NOT `by_thread`: a tenant-only
 * prefix on `by_thread` orders by `threadId`, which would return the alphabetically-last thread's
 * briefing and call it the newest. This orders on the WRITTEN `createdAt`, which is also the field
 * the recency assertion below reads — `byThread`'s `_creationTime` order can disagree with it for a
 * back-dated row, so the two readers are deliberately indexed on different columns.
 */
export const latestForTenant = tenantQuery({
  args: {},
  handler: async (ctx): Promise<LatestBriefing | null> => {
    const row = await ctx.db
      .query("briefings")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .first();
    // `null`, never `{}`: "this tenant has never been briefed" is a state the card renders, not a
    // failure and not an empty briefing.
    if (row === null) return null;
    return {
      createdAt: row.createdAt,
      range: row.range,
      tz: row.tz,
      listedCount: row.listedCount,
      // The row's TRUE item count, kept beside the capped projection so "5 of 12" is sayable.
      itemCount: row.items.length,
      synopsis: row.synopsis ?? null,
      synopsisOrigin: "model",
      items: row.items.slice(0, LATEST_ITEM_CAP).map((item) => ({
        id: item.id,
        bucket: item.bucket,
        sender: item.sender,
        subject: item.subject,
        ts: item.ts,
        needsReply: item.needsReply,
      })),
      capped: row.items.length > LATEST_ITEM_CAP,
    };
  },
});
