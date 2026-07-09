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
import { internalMutation } from "./_generated/server";

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
    await ctx.db.insert("audit", {
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      eventType: args.eventType,
      actor: args.actor,
      payload,
      ts: Date.now(),
    });
  },
});
