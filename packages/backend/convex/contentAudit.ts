// The promotion audit row — the caller's half of `vault.promoteToReference` (CONT-01, plan 26-13).
//
// **WHY THIS IS ITS OWN MODULE, and not one of the three obvious homes.**
//   • NOT `vault.ts`. `vaultRedaction.test.ts` asserts by static scan that the vault modules emit no
//     log-plane call at all: the vault content plane is the one place raw document text lives, so it
//     is kept log-free BY CONSTRUCTION rather than by inspecting a payload (ADR-025). The caller
//     audits instead — the shipped precedent is `vault.searched`, written by `llm.ts`.
//   • NOT `content.ts`. That module is read-only by construction and `content.test.ts` scans it for
//     exactly that: no write, no scheduler, no log-plane call, and every export a `tenantQuery`. One
//     mutation there would turn "cannot write" into "writes only this", which is a weaker promise.
//   • NOT `audit.ts`. Its header states it exposes no client-callable builder, and this row is
//     triggered by a person clicking Promote. (`auditImmutability.test.ts` would not have caught a
//     `tenantMutation` there — its `PUBLIC_BUILDER` regex only matches the raw builders — which is
//     a reason to respect the stated invariant rather than a licence to slip past the scan.)
//
// It is a SEPARATE call from the promotion, not a wrapper around it. `api.vault.promoteToReference`
// stays the single guarded surface the browser calls directly (26-11 owner decision, 2026-08-22);
// re-routing it through here would put a second function in the promotion path for no gain. The
// consequence is honest and already recorded in ADR-025: this row is supplementary, and the system
// of record that a promotion happened is the row's own `origin: "agent_promoted"` plus the ingest
// workflow's trail. A browser that closes between the two calls loses the audit line, not the fact.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { tenantMutation } from "./lib/functions";

/**
 * `vault.promoted` — refs, ids and a closed enum. NEVER the title, the body or the failure reason.
 *
 * **Only the document id crosses the wire.** `sourceThreadId` / `sourcePlanId` are read off the ROW
 * this mutation just verified the caller owns, never accepted as arguments — the same rule 26-11
 * applied at the four provenance write sites, for the same reason: a caller-supplied provenance
 * pair is a caller-authored claim about who produced an artifact.
 *
 * A row this tenant does not own writes nothing and returns `{logged:false}` — the same answer a
 * missing row gets, so this cannot be used to probe another tenant's ids.
 */
export const recordPromotion = tenantMutation({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    // Mirrors `promoteToReference`'s own return, flattened. The browser reports what it was told;
    // it cannot invent a fourth outcome, and nothing downstream branches on it.
    result: v.union(
      v.literal("processing"),
      v.literal("already_promoted"),
      v.literal("ineligible"),
    ),
  },
  handler: async (ctx, { vaultDocId, result }): Promise<{ logged: boolean }> => {
    const doc = await ctx.db.get(vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId) return { logged: false };
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      // The same deterministic correlation id `promoteToReference` hands its ingest workflow, so
      // the audit row and the ingest trail join without a second identifier existing.
      correlationId: `vault:promote:${vaultDocId}`,
      eventType: "vault.promoted",
      actor: "user",
      payload: {
        vaultDocId: String(vaultDocId),
        sourceThreadId: doc.sourceThreadId ?? null,
        sourcePlanId: doc.sourcePlanId === undefined ? null : String(doc.sourcePlanId),
        result,
      },
    });
    return { logged: true };
  },
});
