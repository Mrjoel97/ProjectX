// Operator dead-letter surface (OPSG-07) — a failure nobody sees is a failure
// nobody fixes. Tenant-scoped (NOT owner-gated — CONTEXT), and DISTINCT from the
// insert-only `deadLetter.ts` onComplete handler: this module only READS new rows
// and marks them resolved. Goes through tenantQuery/tenantMutation so tenantId is
// injected from identity and can never be forgotten (CLAUDE.md §2).
//
// The `by_tenant_status` compound index filters tenant AND status in the index —
// no in-memory cross-filter. "Mark resolved" ships now; replay is deferred.
import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/functions";

/** Count of unresolved dead letters for the caller's tenant — drives the badge. */
export const newCount = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("deadLetters")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "new"))
      .collect();
    return rows.length;
  },
});

/** The unresolved dead letters for the caller's tenant. */
export const listNew = tenantQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("deadLetters")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "new"))
      .collect(),
});

/**
 * Flip one row new → resolved (clears it from the badge). Tenant-checked: ctx.db.get
 * bypasses scope, so the ownership guard is load-bearing. Idempotent on a non-new row.
 *
 * ponytail: "replayed" is an unwritten enum member in Phase 2 — a replay must be
 * idempotent (double-send is the one failure this phase most forbids), so it lands
 * once idempotency is specified, not before.
 */
export const markResolved = tenantMutation({
  args: { id: v.id("deadLetters") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("deadLetter not found");
    if (row.status !== "new") return { ok: true as const };
    await ctx.db.patch(id, { status: "resolved" });
    return { ok: true as const };
  },
});
