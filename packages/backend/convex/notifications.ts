// In-app notifications (INTK-04 seam).
//
// Phase-2 notifications are IN-APP ONLY — nothing leaves the browser (CONTEXT).
// This `notifications` table is the seam Phase-7 OPSG-05 grows channels
// (email/push) onto; deliberately no channel logic here.
// ponytail: in-app only until OPSG-05 — add channel dispatch in `notify` then.
import { v } from "convex/values";
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
 * Insert an in-app notification. Internal so trusted callers (submit rejection,
 * the token-age cron in 02-05) pass an already-resolved tenantId.
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
  },
});
