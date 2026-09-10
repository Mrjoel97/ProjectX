// Internal WORM checkpoint adapters. Audit remains insert-only.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

/** Shared with the owner-facing governance report. */
export const CURSOR_NAME = "worm-audit";

/** Compatibility metric, not an export position. Event timestamps can be backdated. */
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

/** Freeze a bounded batch before external IO. Retry reads the SAME immutable IDs.
 * New writes atomically enqueue an audit reference, so late commits cannot land
 * behind a timestamp cursor. Legacy timestamp-only checkpoints replay ALL legacy
 * rows once; their previous max-ts cannot prove coverage of equal-ts page tails.
 */
export const beginExport = internalMutation({
  args: { pageSize: v.number() },
  handler: async (ctx, { pageSize }) => {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10_000) {
      throw new Error("WORM pageSize must be an integer between 1 and 10000");
    }
    const checkpoint = await ctx.db
      .query("exportCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    const revision = checkpoint?.revision ?? 0;
    const rows: Doc<"audit">[] = [];
    if (checkpoint?.pendingAuditIds) {
      for (const id of checkpoint.pendingAuditIds) {
        const row = await ctx.db.get(id);
        if (!row) throw new Error("WORM pending audit row missing");
        rows.push(row);
      }
      return { rows, revision, lastExportedTs: checkpoint.lastExportedTs };
    }

    let pending: Pick<
      Doc<"exportCursors">,
      "pendingAuditIds" | "pendingQueueIds" | "pendingLegacyCursor" | "pendingLegacyDone"
    >;
    if (!checkpoint?.legacyDone) {
      const page = await ctx.db
        .query("audit")
        .withIndex("by_export_version", (q) => q.eq("exportVersion", undefined))
        .paginate({
          cursor: checkpoint?.legacyCursor ?? null,
          numItems: Math.min(pageSize, 1000),
          maximumBytesRead: 2_000_000,
        });
      rows.push(...page.page);
      pending = {
        pendingAuditIds: rows.map((row) => row._id),
        pendingLegacyCursor: page.continueCursor,
        pendingLegacyDone: page.isDone,
      };
    } else {
      // Queue refs are small. Stop fetching audit bodies at a byte ceiling so
      // a few unusually large payloads cannot exceed the transaction read limit.
      const queued = await ctx.db.query("auditExportQueue").take(Math.min(pageSize, 1000));
      if (queued.length === 0) return null;
      const pendingQueueIds: Doc<"auditExportQueue">["_id"][] = [];
      let bytes = 0;
      for (const item of queued) {
        const row = await ctx.db.get(item.auditId);
        if (!row) throw new Error("WORM queued audit row missing");
        rows.push(row);
        pendingQueueIds.push(item._id);
        bytes += new TextEncoder().encode(JSON.stringify(row)).length;
        if (bytes >= 2_000_000) break;
      }
      pending = { pendingAuditIds: rows.map((row) => row._id), pendingQueueIds };
    }
    if (checkpoint) await ctx.db.patch(checkpoint._id, { ...pending, revision });
    else
      await ctx.db.insert("exportCursors", {
        name: CURSOR_NAME,
        lastExportedTs: 0,
        revision,
        ...pending,
      });
    return { rows, revision, lastExportedTs: checkpoint?.lastExportedTs ?? 0 };
  },
});

/** Dequeue ONLY after S3 acknowledges the frozen batch. CAS prevents overlapping
 * exporters from deleting another batch or rolling progress backwards. Empty
 * legacy pages advance only their scan position; they require no S3 object.
 */
export const advanceCursor = internalMutation({
  args: { revision: v.number(), ts: v.number() },
  handler: async (ctx, { revision, ts }) => {
    const row = await ctx.db
      .query("exportCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    if (!row || row.revision !== revision || !row.pendingAuditIds) return false;
    for (const id of row.pendingQueueIds ?? []) await ctx.db.delete(id);
    await ctx.db.patch(row._id, {
      lastExportedTs: Math.max(row.lastExportedTs, ts),
      ...(row.pendingAuditIds.length > 0 ? { lastExportedAt: Date.now() } : {}),
      revision: revision + 1,
      ...(row.pendingLegacyCursor !== undefined
        ? {
            legacyCursor: row.pendingLegacyDone ? undefined : row.pendingLegacyCursor,
            legacyDone: row.pendingLegacyDone,
          }
        : {}),
      pendingAuditIds: undefined,
      pendingQueueIds: undefined,
      pendingLegacyCursor: undefined,
      pendingLegacyDone: undefined,
    });
    return true;
  },
});
