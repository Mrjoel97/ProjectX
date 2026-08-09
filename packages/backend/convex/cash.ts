// CASH adapter — the READ side of the business-finance plane, tenant-scoped.
//
// THIS MODULE IS A READER AND ONE WRITER. Every derivation lives in `@pikar/core`'s `cash.ts`
// (CLAUDE.md §1); re-deriving anything here would create a second, silently-drifting definition of
// the business's money — the exact drift that produced two separate selector bugs on 2026-08-09.
//
// EVERY SECTION IS ITS OWN QUERY, on purpose. A failing scorecard read must take out unit economics
// and leave solvency, activity and the whole Pikar-spend tab standing.
//
// NOTHING HERE IS LOGGED. A tenant's cash on hand, CAC and MRR are precisely what CLAUDE.md §4
// keeps out of the audit table. If you ever add an audit event to this module, log the field NAME
// and a boolean, never the value.
import { activityFromSends, createDashboardBound } from "@pikar/core";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";

/** 31 days, matching the Cost console's reported window so the two tabs speak the same period. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** A bounded read. A tenant past this in one window has their count reported as a FLOOR. */
const SEND_SCAN_LIMIT = 1000;

export const activity = tenantQuery({
  args: { sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.sinceMs) || !Number.isSafeInteger(args.untilMs)) {
      throw new Error("INVALID_WINDOW");
    }
    if (args.sinceMs >= args.untilMs) throw new Error("INVALID_WINDOW");
    if (args.untilMs - args.sinceMs > MAX_WINDOW_MS) throw new Error("INVALID_WINDOW");

    const rows = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("status", "sent")
          .gte("createdAt", args.sinceMs)
          .lt("createdAt", args.untilMs),
      )
      .take(SEND_SCAN_LIMIT + 1);

    // A window that fills the cap is UNDER-reported. `partial` says the count is a floor rather
    // than letting a quietly small number read as the truth (the finance.ts readWindow precedent).
    const partial = rows.length > SEND_SCAN_LIMIT;
    const counted = rows.slice(0, SEND_SCAN_LIMIT);

    return {
      activity: activityFromSends({
        sentAtMs: counted.map((row) => row.createdAt),
        sinceMs: args.sinceMs,
        nowMs: args.untilMs,
      }),
      bound: createDashboardBound({
        returned: counted.length,
        limit: SEND_SCAN_LIMIT,
        nextCursor: null,
        partial,
        ...(partial ? { partialReason: "row-cap" as const } : {}),
      }),
    };
  },
});
