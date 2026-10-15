// In-app notifications (INTK-04 seam) — the OPSG-05 notify choke point.
//
// `notify` is the SINGLE choke point every failure terminal in the phase routes through: it always
// inserts the in-app row (the fail-closed floor), THEN best-effort dispatches an external email via
// the governed Gmail send (internal.notifyExternal.dispatch, scheduled runAfter 0). External is
// fail-closed to in-app and loop-guarded — see notifyExternal.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { internalMutation } from "./lib/tenantLifecycle";

export const NOTIFICATION_WINDOW_SIZE = 100;

/** The calling tenant's notifications, unread-first then newest-first. */
export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    // Compatibility reader: bounded groups. UI uses unreadWindow for explicit truncation.
    const groups = await Promise.all(
      [false, true].map((read) =>
        ctx.db
          .query("notifications")
          .withIndex("by_tenant_read_createdAt", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("read", read),
          )
          .order("desc")
          .take(NOTIFICATION_WINDOW_SIZE),
      ),
    );
    return groups.flat();
  },
});

/** Dismissing a visible row reactively reveals the next older unread row. */
export const unreadWindow = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("read", false),
      )
      .order("desc")
      .take(NOTIFICATION_WINDOW_SIZE + 1);
    return {
      items: rows.slice(0, NOTIFICATION_WINDOW_SIZE),
      truncated: rows.length > NOTIFICATION_WINDOW_SIZE,
    };
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

/** OAuth consent retires only warnings that existed at that consent,100 per transaction. */
export const retireReconnectWarnings = internalMutation({
  args: {
    tenantId: v.string(),
    kind: v.union(v.literal("gmail_reconnect"), v.literal("microsoft_calendar_reconnect")),
    before: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_tenant_kind_read_created", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("kind", args.kind)
          .eq("read", false)
          .lte("createdAt", args.before),
      )
      .take(100);
    for (const row of rows) await ctx.db.patch(row._id, { read: true });
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.notifications.retireReconnectWarnings, args);
  },
});
