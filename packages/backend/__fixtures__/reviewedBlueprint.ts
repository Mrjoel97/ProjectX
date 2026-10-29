import { BLUEPRINT_FIELDS, blueprintEntryIdentity, deserializeBlueprint } from "@pikar/core";
import type { TestConvex } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { contentHash } from "../convex/lib/hash";
import type schema from "../convex/schema";

/**
 * Offline simulated user acceptance, never live owner evidence. Callers register auditCounts.
 * The actual public confirmation mints every review/audit reference; this helper cannot fabricate
 * provenance by writing profile metadata or user audit rows directly.
 */
export async function reviewBlueprintFixture(
  t: TestConvex<typeof schema>,
  tenantId: string,
  existingBlueprintDocId: Id<"vaultDocuments">,
): Promise<{
  blueprintDocId: Id<"vaultDocuments">;
  sourceDocId: Id<"vaultDocuments">;
  confirmedAt: number;
  fieldCount: number;
}> {
  const document = await t.run((ctx) => ctx.db.get(existingBlueprintDocId));
  if (
    !document ||
    document.tenantId !== tenantId ||
    document.kind !== "business_blueprint" ||
    !document.text
  )
    throw new Error("REVIEWED_BLUEPRINT_FIXTURE_INVALID");
  const blueprint = deserializeBlueprint(document.text);
  const sourceText = `# Offline synthetic Blueprint review source\n\n${document.text}`;
  const sourceHash = await contentHash(sourceText);
  const sourceDocId = await t.run(async (ctx) => {
    const candidates = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", tenantId).eq("contentHash", sourceHash),
      )
      .take(2);
    const retained = candidates.find(
      (row) =>
        row.status === "ready" &&
        row.text === sourceText &&
        row.title === "Offline synthetic Blueprint review source",
    );
    const id =
      retained?._id ??
      (await ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "Offline synthetic Blueprint review source",
        kind: "brief",
        category: "business",
        source: "upload",
        mimeType: "text/markdown",
        text: sourceText,
        contentHash: sourceHash,
        size: new TextEncoder().encode(sourceText).length,
        status: "ready",
        createdAt: Date.now(),
      }));
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    // Pin the supplied existing row so confirm updates it in place, as production does.
    if (profile) await ctx.db.patch(profile._id, { blueprintDocId: existingBlueprintDocId });
    else
      await ctx.db.insert("tenantProfiles", {
        tenantId,
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        blueprintDocId: existingBlueprintDocId,
      });
    return id;
  });
  const sourceBindings = await Promise.all(
    BLUEPRINT_FIELDS.flatMap((field) => {
      const entry = blueprint[field];
      return entry
        ? [
            contentHash(blueprintEntryIdentity(entry)).then((entryHash) => ({
              field,
              entryHash,
              docId: sourceDocId,
              sourceHash,
            })),
          ]
        : [];
    }),
  );
  const originalSourceIds = await t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("tenantProfiles")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .unique()
      )?.blueprintSourceDocIds ?? [],
  );
  await t.mutation(internal.blueprint.writeDraft, {
    tenantId,
    draftJson: JSON.stringify({
      blueprint,
      diff: [],
      sourceDocIds: [...new Set([...originalSourceIds, sourceDocId])],
    }),
    sourceBindings,
  });
  const user = t.withIdentity({ subject: tenantId });
  const confirmed = await user.mutation(api.blueprint.confirmBlueprint, {
    acceptedContradictions: [],
  });
  if (!confirmed.ok || confirmed.docId !== existingBlueprintDocId)
    throw new Error("REVIEWED_BLUEPRINT_FIXTURE_CONFIRMATION_FAILED");
  const ledger = await user.query(api.blueprint.businessLedger, {});
  const state = await user.query(api.blueprint.blueprintState, {});
  if (
    ledger.fields.length !== sourceBindings.length ||
    ledger.fields.some((field) => field.sourceState !== "current") ||
    state.confirmedAt === null
  )
    throw new Error("REVIEWED_BLUEPRINT_FIXTURE_PROVENANCE_FAILED");
  return {
    blueprintDocId: confirmed.docId,
    sourceDocId,
    confirmedAt: state.confirmedAt,
    fieldCount: ledger.fields.length,
  };
}
