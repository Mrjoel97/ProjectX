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
