/**
 * The CRM attention list and customer pulse (28-10, REVN-04) — a THIN adapter over
 * `@pikar/revenue`'s pure `crm.ts` (CLAUDE.md §1).
 *
 * REVN-04's hard line is "without creating a second CRM". This module therefore:
 *
 *   • reads Phase 19's `contacts`, `followUps` and `suppressions` as the ONLY person substrate,
 *   • joins to a provider through `contactProviderRefs`, which holds an OPAQUE external id and
 *     nothing else — no name, no email, no company, no stage label ever crosses that join,
 *   • WRITES NOTHING. There is no mutation in this file and there is not meant to be one. The
 *     moment this module can write a stage or a value, the second CRM exists.
 *
 * THE SUPPRESSION JOIN IS THE ONE PLACE AN EMAIL IS TOUCHED, and it is touched to EXCLUDE. Phase
 * 19 keys suppression by address, so the only way to honour do-not-contact is to compare a
 * contact's address against the suppression list. That comparison happens here, server-side, and
 * the address never reaches the output — the ranked row carries a `contactId` and nothing else.
 */
import {
  type AttentionInput,
  type AttentionRow,
  customerPulse,
  type PulseStatus,
  rankAttention,
} from "@pikar/revenue";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/**
 * How many contacts one attention pass considers.
 *
 * BOUNDED BY CONSTRUCTION, like every read in this phase. An unbounded scan over a large tenant's
 * contacts is a query that works in development and times out for the customer who most needs it.
 * `ponytail:` a fixed cap rather than pagination — the output is a working list a person reads, and
 * nobody works a list of 500. Upgrade path: a cursor, when a tenant genuinely outgrows this.
 */
export const ATTENTION_SCAN_CAP = 500;

/** What the pure ranker needs, assembled from Phase 19 rows only. */
async function localInputs(
  ctx: QueryCtx,
  tenantId: string,
): Promise<{ inputs: AttentionInput[]; scanned: number; capped: boolean }> {
  const page = await ctx.db
    .query("contacts")
    .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .take(ATTENTION_SCAN_CAP + 1);
  const contacts = page.slice(0, ATTENTION_SCAN_CAP);

  const suppressions = await ctx.db
    .query("suppressions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  // Lower-cased once: Phase 19 stores what the user typed, and a suppression that missed on case
  // would silently re-admit someone who asked not to be contacted.
  const suppressed = new Set(suppressions.map((s) => s.address.toLowerCase()));

  const followUps = await ctx.db
    .query("followUps")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  /** EARLIEST open follow-up per contact. A later one does not make an earlier one less overdue. */
  const dueByContact = new Map<string, number>();
  for (const f of followUps) {
    if (f.status !== "open" || f.contactId === undefined) continue;
    const key = String(f.contactId);
    const current = dueByContact.get(key);
    if (current === undefined || f.dueAt < current) dueByContact.set(key, f.dueAt);
  }

  const refs = await ctx.db
    .query("contactProviderRefs")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const refByContact = new Map<string, string>();
  for (const r of refs) {
    if (r.kind === "contact") refByContact.set(String(r.contactId), r.externalId);
  }

  const inputs = contacts.map((c): AttentionInput => {
    const id = String(c._id);
    return {
      contactId: id,
      providerRef: refByContact.get(id) ?? null,
      suppressed: c.email !== undefined && suppressed.has(c.email.toLowerCase()),
      followUpDueAt: dueByContact.get(id) ?? null,
      // Phase 19 has no activity timeline of its own yet, and INVENTING one from `_creationTime`
      // would make every contact look freshly touched on the day it was imported. Null is the
      // honest answer, and `rankAttention` never fires `gone_quiet` from it.
      lastActivityAt: null,
      // Deals and payment flags arrive with the provider lanes (28-11/28-12). Until a lane passes
      // there is nothing to say, and saying nothing is the point.
      deal: null,
      paymentFlag: null,
    };
  });
  return { inputs, scanned: contacts.length, capped: page.length > ATTENTION_SCAN_CAP };
}

export type AttentionView = {
  rows: readonly AttentionRow[];
  /** How many contacts were considered, and whether the cap truncated the scan. */
  scanned: number;
  capped: boolean;
  /**
   * `local` means no provider lane contributed. It is NOT a degraded state — it is the correct and
   * complete answer for a tenant with no connector, and the surface must not apologise for it.
   */
  coverage: "local" | "ready" | "partial";
};

/**
 * The attention list, from Phase 19 alone.
 *
 * A `tenantQuery` so it is reactive and costs no action. It deliberately does NOT fetch a provider:
 * a working list that stalls behind a HubSpot round trip is a list nobody opens, and every provider
 * lane is parked today anyway. When a lane passes, 28-12's tools compose provider facts on top of
 * these same pure functions rather than replacing them.
 */
export const attentionList = tenantQuery({
  args: {},
  handler: async (ctx): Promise<AttentionView> => {
    const { inputs, scanned, capped } = await localInputs(ctx, ctx.tenantId);
    return { rows: rankAttention(inputs, Date.now()), scanned, capped, coverage: "local" };
  },
});

/**
 * One customer's pulse.
 *
 * `coverage` is passed IN rather than assumed: the caller knows whether a provider read succeeded,
 * and `customerPulse` refuses to answer `healthy` on anything less than a full read. A default of
 * `ready` here would have made that refusal unreachable — the guard would exist and never fire.
 */
export const contactPulse = tenantQuery({
  args: {
    contactId: v.id("contacts"),
    coverage: v.union(v.literal("ready"), v.literal("partial"), v.literal("unavailable")),
  },
  handler: async (ctx, { contactId, coverage }): Promise<PulseStatus> => {
    const contact = await ctx.db.get(contactId);
    // Tenant scoping is not optional and not inherited: `ctx.db.get` takes an id a caller supplied,
    // so the row's own tenant is checked here or not at all.
    if (!contact || contact.tenantId !== ctx.tenantId) return "unknown";

    const followUps = await ctx.db
      .query("followUps")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const now = Date.now();
    const followUpOverdue = followUps.some(
      (f) => f.status === "open" && String(f.contactId) === String(contactId) && f.dueAt <= now,
    );

    return customerPulse(
      {
        // Payment signals arrive with the payment lanes (28-11). Until then they are FALSE, not
        // unknown: we have looked at everything we have.
        disputeOpen: false,
        invoiceOverdue: false,
        followUpOverdue,
        lastActivityAt: null,
        coverage,
      },
      now,
    );
  },
});

/** The same list for a server-side caller (28-12's revenue tools). No new authority. */
export const attentionForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<AttentionView> => {
    const { inputs, scanned, capped } = await localInputs(ctx, tenantId);
    return { rows: rankAttention(inputs, Date.now()), scanned, capped, coverage: "local" };
  },
});

export type { Id };
