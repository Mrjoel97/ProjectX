/**
 * Business-blueprint reads run on the hot path in the DEFAULT (V8) runtime — no `"use node"`.
 * Every handler has an explicit Promise return type to prevent generated-API circular inference.
 * CLAUDE.md §2 bans public query/mutation/action builders; these identity-less tenant-scoped
 * readers deliberately use the allowed internalQuery builder and accept an explicit tenantId.
 */
import { deserializeBlueprint, renderSpine } from "@pikar/core";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";

const TOP_ENTITY_COUNT = 20;
const DRIFT_SCAN_CAP = 100;

type LiveBlueprint = {
  docId: string;
  text: string;
  sourceDocIds: readonly string[];
  confirmedAt: number | null;
};

async function readLiveForTenant(
  ctx: QueryCtx,
  tenantId: string,
): Promise<LiveBlueprint | null> {
  try {
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
  } catch {
    return null;
  }
}

/** The live blueprint, read in TWO document reads. The unbounded `.collect` shape used by
 *  `currentProfileDoc` (onboarding.ts:521-533) is FORBIDDEN here: it reads every vaultDocuments row
 *  INCLUDING the `text` blob, and this runs on every grounding call. */
export const liveForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<LiveBlueprint | null> => await readLiveForTenant(ctx, tenantId),
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

/** Stage-1 drift: a pure set difference, no detector, no cron (CONTEXT: "there is no separate
 *  drift detector"). `ready` docs whose id is not in the LIVE blueprint's source set.
 *  ponytail: a PLAIN async helper, not a registered internalQuery — every caller
 *  (`spineForTenant` here, `blueprintState` in plan 08) lives in this module, so registering it
 *  would add a `ctx.runQuery` hop to the exact path this plan exists to keep cheap. */
async function unincorporatedFor(
  ctx: QueryCtx,
  tenantId: string,
  sourceDocIds: readonly string[],
): Promise<{ count: number; docIds: string[] }> {
  const sourceSet = new Set(sourceDocIds);
  /**
   * ponytail: Convex has no projection, so this bounded read pulls whole rows including `text`.
   * Ceiling ≈ 100 × document size per grounding call. Upgrade path: maintain
   * `blueprintStaleCount` on tenantProfiles and increment it when a document reaches `ready`.
   * Deliberately deferred because that requires editing `vaultIngest.ts`, which Phase 15.2's lane
   * is actively restructuring (the same reason the automatic Stage-2 trigger is deferred).
   */
  const ready = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "ready"))
    .take(DRIFT_SCAN_CAP);
  const docIds = ready
    .filter((doc) => doc.kind !== "business_blueprint" && !sourceSet.has(doc._id))
    .map((doc) => doc._id);
  return { count: docIds.length, docIds };
}

/** The ONE function both seams call (BLPR-02). Returns the rendered standing-context block, or
 *  null when the tenant has no live blueprint — in which case every caller's output is
 *  byte-identical to today. */
export const spineForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string | null> => {
    try {
      const live = await readLiveForTenant(ctx, tenantId);
      if (live === null) return null;
      const blueprint = deserializeBlueprint(live.text);
      const { count } = await unincorporatedFor(ctx, tenantId, live.sourceDocIds);
      return renderSpine(blueprint, { unincorporatedCount: count });
    } catch {
      return null;
    }
  },
});
