// Operator dead-letter surface (OPSG-07) — a failure nobody sees is a failure
// nobody fixes. Tenant-scoped (NOT owner-gated — CONTEXT), and DISTINCT from the
// insert-only `deadLetter.ts` onComplete handler: this module only READS new rows
// and marks them resolved. Goes through tenantQuery/tenantMutation so tenantId is
// injected from identity and can never be forgotten (CLAUDE.md §2).
//
// The `by_tenant_status` compound index filters tenant AND status in the index —
// no in-memory cross-filter. "Mark resolved" ships now; replay is deferred.
import { v } from "convex/values";
import { ownerQuery, tenantMutation, tenantQuery } from "./lib/functions";

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

/** The server's ceiling on one page of the operator listing, and its default. */
const LIST_ALL_CAP = 200;
const LIST_ALL_DEFAULT = 50;

/**
 * D13 (25.1-06) — the OPERATOR read: unresolved dead letters ACROSS every tenant.
 *
 * `listNew` above has served the signed-in tenant since 02-06 and is already on `/ops`. What did
 * not exist is this: **a dead letter belonging to any other tenant was invisible to the person who
 * runs the deployment.** Every writer stamps the row with the failing tenant's id, so in a
 * multi-tenant beta most of what the pipeline wrote could not be seen by anyone with the standing
 * to act on it. That is the gap, not "the DLQ is write-only" — it never was.
 *
 * OWNER-ONLY, through the same `ownerQuery` primitive `ops.envCheck` uses: the wrapper refuses a
 * non-owner BEFORE the handler reads a row, so this is a trust boundary and not a hidden button.
 *
 * READ ONLY, and deliberately. Re-drive is deferred (25.1-CONTEXT) and `markResolved` below stays
 * TENANT-scoped, so seeing another tenant's failure does not come with the power to act on it —
 * two different decisions, and only the first one has been made.
 *
 * BOUNDED, because the moment this listing matters most is the moment there are thousands of rows:
 * an unbounded `.collect()` on a failing deployment is a second outage on the screen you are trying
 * to diagnose the first one from. `truncated` says so honestly rather than pretending the page is
 * the whole story.
 *
 * The rows are returned AS STORED — refs, ids, codes and counts (CLAUDE.md §4). Nothing here joins
 * a tenant to a name or a request to its content; `tenantId` is an id on the screen, exactly as the
 * tenant-candidates panel already renders it.
 *
 * ponytail: `by_status` (which existed and had no reader) plus `.order("desc")`, which is insertion
 * order — equal to `createdAt` order, because every one of the six insert sites stamps
 * `createdAt: Date.now()` at insert. No new index, no sort in memory. Ceiling: a backfill that
 * writes historical `createdAt` values out of insertion order would list them wrong; the upgrade
 * path is a `by_status_createdAt` compound index, which is additive and needs no migration.
 */
export const listAll = ownerQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = Math.min(Math.max(Math.floor(limit ?? LIST_ALL_DEFAULT), 1), LIST_ALL_CAP);
    // cap + 1: one row past the page is how `truncated` is KNOWN rather than guessed.
    const rows = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .order("desc")
      .take(cap + 1);
    return {
      cap,
      truncated: rows.length > cap,
      rows: rows.slice(0, cap).map((r) => ({
        id: r._id,
        tenantId: r.tenantId,
        workflowId: r.workflowId,
        correlationId: r.correlationId,
        error: r.error,
        status: r.status,
        createdAt: r.createdAt,
        payload: r.payload,
      })),
    };
  },
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
