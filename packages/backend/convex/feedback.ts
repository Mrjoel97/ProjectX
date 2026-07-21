// IMPR-01 feedback capture. A thumbs up/down (+ optional comment) on a delivered response,
// tied through requestId → the exact skill version that produced it, so a rating becomes a
// rollout score for SkillOpt later. Tenant-owned: written ONLY through the tenant-scoped
// wrappers (CLAUDE.md §2 — never raw mutation/query), so a rating can never cross a tenant.
//
// Editable/undoable by design (CONTEXT: "a mis-tap shouldn't poison the signal"): one row per
// (tenant, request) via the by_tenant_request unique index — a re-tap patches it, undo deletes it.
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/functions";

/**
 * Load the caller's own delivered request or fail closed. A cross-tenant id reads as "not found"
 * (never leaks another tenant's row); a request with no resolvable skillVersion is unattributable
 * — an unattributable rating is not training signal (RESEARCH Pitfall 1), so we refuse to store it.
 */
async function requireAttributableRequest(
  ctx: { db: { get: (id: unknown) => Promise<unknown> }; tenantId: string },
  requestId: unknown,
) {
  const request = (await ctx.db.get(requestId)) as
    | { tenantId: string; skillVersion?: number }
    | null;
  if (!request || request.tenantId !== ctx.tenantId) throw new Error("request not found");
  if (request.skillVersion === undefined)
    throw new Error("unattributable: request has no skillVersion (feedback not stored)");
  return request.skillVersion;
}

/**
 * Submit OR edit a rating on a delivered response. Upserts the single by_tenant_request row:
 * first tap inserts (attributed to the request's skillVersion + COCKPIT_AGENT_SKILL), a re-tap
 * patches rating/comment/updatedAt on the SAME row (createdAt frozen — a mis-tap fix, not a new
 * signal). ponytail: `comment` is content-plane (raw at rest on this tenant-owned row, like
 * requests.goal); it is PII-scrubbed at the export boundary (Plan 04) and NEVER written to
 * audit/DLQ (CLAUDE.md §4).
 */
export const submitFeedback = tenantMutation({
  args: {
    requestId: v.id("requests"),
    rating: v.union(v.literal("up"), v.literal("down")),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, rating, comment }) => {
    const skillVersion = await requireAttributableRequest(ctx, requestId);
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_tenant_request", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("requestId", requestId),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { rating, comment, updatedAt: now });
      return;
    }
    await ctx.db.insert("feedback", {
      tenantId: ctx.tenantId,
      requestId,
      skillName: COCKPIT_AGENT_SKILL,
      skillVersion,
      rating,
      comment,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Undo a rating (a mis-tap is fully reversible). Deletes the (tenant, request) row if present;
 * idempotent — a second undo on an already-cleared request is a no-op.
 */
export const undoFeedback = tenantMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_tenant_request", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("requestId", requestId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** The current rating for a request (or null) so the UI can render the persisted state. */
export const myFeedback = tenantQuery({
  args: { requestId: v.id("requests") },
  handler: (ctx, { requestId }) =>
    ctx.db
      .query("feedback")
      .withIndex("by_tenant_request", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("requestId", requestId),
      )
      .unique(),
});
