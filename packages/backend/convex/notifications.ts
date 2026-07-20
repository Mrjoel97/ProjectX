// In-app notifications (INTK-04 seam) — the OPSG-05 notify choke point.
//
// `notify` is the SINGLE choke point every failure terminal in the phase routes through: it always
// inserts the in-app row (the fail-closed floor), THEN best-effort dispatches an external email via
// the governed Gmail send (internal.notifyExternal.dispatch, scheduled runAfter 0). External is
// fail-closed to in-app and loop-guarded — see notifyExternal.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";

/** The calling tenant's notifications, unread-first then newest-first. */
export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    // unread (read=false=0) first; newest within each group.
    return rows.sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt - a.createdAt);
  },
});

/** Mark one of the caller's notifications read (tenant-scoped). */
export const markRead = tenantMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const row = await ctx.db.get(notificationId);
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("NOT_FOUND");
    await ctx.db.patch(notificationId, { read: true });
  },
});

/**
 * The notify choke point. Insert the in-app notification (always — the fail-closed floor), then
 * schedule a best-effort external email dispatch. Internal so trusted callers (submit rejection,
 * the token-age cron in 02-05, the DLQ terminals, the review gate) pass an already-resolved tenantId.
 *
 * The external dispatch is scheduled (runAfter 0), never inline: scheduling an action from a mutation
 * is the correct seam, and it keeps this transaction fast + isolates a slow/failing send from the
 * in-app write. A failed send never throws back here and never re-notifies (loop guard lives in
 * notifyExternal). `message` stays refs/counts-only (§4) — callers pass notificationMessage(kind).
 */
export const notify = internalMutation({
  args: {
    tenantId: v.string(),
    kind: v.string(),
    message: v.string(),
    requestId: v.optional(v.id("requests")),
  },
  handler: async (ctx, { tenantId, kind, message, requestId }) => {
    await ctx.db.insert("notifications", {
      tenantId,
      kind,
      requestId,
      message,
      read: false,
      createdAt: Date.now(),
    });
    // Best-effort external channel — never blocks/rolls back the in-app row above.
    await ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, { tenantId, kind });
  },
});
