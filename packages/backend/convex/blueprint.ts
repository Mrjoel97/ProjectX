/**
 * Business-blueprint reads run on the hot path in the DEFAULT (V8) runtime — no `"use node"`.
 * Every handler has an explicit Promise return type to prevent generated-API circular inference.
 * CLAUDE.md §2 bans public query/mutation/action builders; these identity-less tenant-scoped
 * readers deliberately use the allowed internalQuery builder and accept an explicit tenantId.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const TOP_ENTITY_COUNT = 20;

/** The live blueprint, read in TWO document reads. The unbounded `.collect` shape used by
 *  `currentProfileDoc` (onboarding.ts:521-533) is FORBIDDEN here: it reads every vaultDocuments row
 *  INCLUDING the `text` blob, and this runs on every grounding call. */
export const liveForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<{
    docId: string;
    text: string;
    sourceDocIds: readonly string[];
    confirmedAt: number | null;
  } | null> => {
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!profile?.blueprintDocId) return null;

    const doc = await ctx.db.get(profile.blueprintDocId);
    if (doc?.tenantId !== tenantId || doc.kind !== "business_blueprint" || !doc.text) return null;

    return {
      docId: doc._id,
      text: doc.text,
      sourceDocIds: profile.blueprintSourceDocIds ?? [],
      confirmedAt: profile.blueprintConfirmedAt ?? null,
    };
  },
});

/** Top graph entities by degree — a free DB read, one of the blueprint's three inputs (D4). */
export const topEntities = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string[]> =>
    (
      await ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_degree", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(TOP_ENTITY_COUNT)
    ).map((node) => node.name),
});
