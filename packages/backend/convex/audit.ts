// Insert-only audit module (OPSG-02).
//
// This is the SOLE write surface for the `audit` table. It exposes ONLY an
// insert (`internalMutation`) — no patch/replace/delete functions exist here,
// and no public (client-callable) builder writes `audit`. Immutability is
// enforced by this convention plus the static-scan test (auditImmutability.test.ts);
// true WORM retention lives outside Convex via the scheduled S3 export.
//
// `payload` is redaction-safe (refs/hashes/ids/counts only — see AuditPayload /
// CLAUDE.md rule 4). Redaction must happen BEFORE calling log().
import type { AuditPayload } from "@pikar/contracts/audit";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { auditCounts } from "./aggregates";

export const log = internalMutation({
  args: {
    tenantId: v.string(),
    correlationId: v.string(),
    eventType: v.string(),
    actor: v.string(),
    // v.any() at the Convex boundary; the redaction-safe shape is the AuditPayload
    // contract (enforced upstream at redact-then-write time).
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload: AuditPayload = args.payload;
    const id = await ctx.db.insert("audit", {
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      eventType: args.eventType,
      actor: args.actor,
      payload,
      ts: Date.now(),
    });
    // OPSG-01: this is the SOLE audit insert surface, so counting the aggregate here
    // covers the invariant without Triggers. Still insert-only (CLAUDE.md §3) — the
    // aggregate mirrors inserts, it never mutates an audit row.
    const doc = await ctx.db.get(id);
    if (doc) await auditCounts.insert(ctx, doc);
  },
});

// OPSG-01 read side: count a tenant's audit rows in O(log n) — never a .collect() scan.
export const countAudit = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => auditCounts.count(ctx, { namespace: tenantId }),
});

/**
 * The most recent audit payloads of ONE `eventType`, newest first — the read side of a diagnosis.
 *
 * Exists because the counts written on a refusal path had no reader. `dispatch.deckTokenCounts`
 * puts five numbers beside `media.deck_refused` precisely so a `no_deck` / `bad_target_duration`
 * can be told apart from its twin cause after the fact — but the specialist's raw body is never
 * persisted on that path (`landStoryboardRefusal` stores the COMPOSED refusal, not the model's
 * prose), so those numbers ARE the whole evidence, and until now the only way to reach them was a
 * browser session against the deployment. One `npx convex run --prod` now answers it:
 *
 *   npx convex run --prod audit:recentByType '{"eventType":"media.deck_refused"}'
 *
 * CROSS-TENANT on purpose, and that is the point rather than an oversight: `by_ts` is already the
 * named cross-tenant exception in `isolation.test.ts` ("a named internal/owner-plane consumer with
 * no tenant-facing caller"), and this is one — `internalQuery`, never client-callable. A
 * tenant-scoped variant would make the owner look up a tenantId first, which is the browser
 * session this replaces.
 *
 * Returning `payload` verbatim needs no redaction step, and that is CLAUDE.md §4 paying out: the
 * table's contract is refs/hashes/ids/counts ONLY, enforced redact-then-WRITE. If a payload ever
 * carried content, this query would not be the bug.
 *
 * ponytail: the `sinceMs` window is the scan bound, NOT `limit`. Convex's `.filter()` post-filters
 * the index range, so with a rare eventType `.take()` alone would walk the table backwards to the
 * first row. Ceiling: fine while a window holds a beta's worth of rows. Upgrade path if it stops
 * being: a `by_eventType_ts` index, which makes the range itself the filter.
 */
export const recentByType = internalQuery({
  args: {
    eventType: v.string(),
    /** Epoch ms; only rows strictly newer are considered. Defaults to the last 7 days. */
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventType, sinceMs, limit }) => {
    const since = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_ts", (q) => q.gt("ts", since))
      .order("desc")
      .filter((q) => q.eq(q.field("eventType"), eventType))
      .take(Math.min(limit ?? 20, 100));
    // tenantId rides along: an id is §4-clean, and without it a cross-tenant read cannot say whose
    // run refused. `actor` and `eventType` are dropped — the caller already knows both.
    return rows.map((r) => ({
      ts: r.ts,
      tenantId: r.tenantId,
      correlationId: r.correlationId,
      payload: r.payload,
    }));
  },
});

// One-time reconciliation for pre-existing dev rows the aggregate never saw: clear
// then re-insert every audit row so counts match the table. Idempotent.
export const backfillAuditCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    await auditCounts.clearAll(ctx);
    const rows = await ctx.db.query("audit").collect();
    for (const row of rows) await auditCounts.insert(ctx, row);
    return { reinserted: rows.length };
  },
});
