// Optional controls over native skill rows. No publication, body registry, or parallel version state.
import {
  recommendVerticals,
  VERTICAL_IDS,
  VERTICAL_PACKS,
  type VerticalId,
  verticalSkillName,
  verticalState,
} from "@pikar/core/verticalPacks";
import { hasValidPackProvenance } from "@pikar/core/workflowPacks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { ownerMutation, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { nativePackExposureReady, rollbackVerticalForTenant } from "./skills";
import { sealedIn } from "./vaultFolders";
import { verticalEventsFor } from "./verticalPackTelemetry";

const verticalIdArg = v.union(...VERTICAL_IDS.map((id) => v.literal(id)));

async function verticalDiscoveryFor(ctx: QueryCtx, tenantId: string) {
  const profile = await ctx.db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  const history = await verticalEventsFor(ctx, tenantId);
  const repeatCounts: Partial<Record<VerticalId, number>> = {};
  for (const id of VERTICAL_IDS) {
    const observed = history.rows
      .filter(
        (row) =>
          row.payload?.verticalId === id &&
          row.payload?.event === "artifact_created" &&
          row.payload?.preview !== true,
      )
      .map((row) => row.payload?.artifactId);
    const confirmed = profile?.verticalPreferences?.confirmedWorkloads?.find(
      (item) => item.verticalId === id,
    );
    // Historical demand was explicitly confirmed against owned ready unsealed artifacts at write time.
    repeatCounts[id] = new Set([...observed, ...(confirmed?.artifactIds ?? [])]).size;
  }
  const released: VerticalId[] = [];
  const states = [];
  for (const id of VERTICAL_IDS) {
    const name = verticalSkillName(id);
    const overlay = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_status", (q) =>
        q.eq("tenantId", tenantId).eq("name", name).eq("status", "active"),
      )
      .unique();
    const global = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
      .unique();
    const tenantCandidate = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_version", (q) => q.eq("tenantId", tenantId).eq("name", name))
      .order("desc")
      .first();
    const globalCandidate = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name))
      .order("desc")
      .first();
    const candidate = tenantCandidate ?? globalCandidate;
    const active = overlay ?? global;
    const ready = active !== null && (await nativePackExposureReady(ctx, active));
    if (ready) released.push(id);
    states.push({
      id,
      disabled: profile?.disabledVerticals?.includes(id) ?? false,
      candidateId: candidate?._id ?? null,
      candidateVersion: candidate?.version ?? null,
      activeVersion: ready ? (active?.version ?? null) : null,
      prerequisite: ready ? null : "native_evidence",
      requiredReview: VERTICAL_PACKS[id].requiredReview,
    });
  }
  const playbook =
    profile?.verticalPreferences?.legalPlaybookDocId === undefined
      ? null
      : await ctx.db.get(profile.verticalPreferences.legalPlaybookDocId);
  const docs = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "ready"))
    .take(5);
  const sealed = await sealedIn(ctx, docs);
  const readable = docs.filter((doc) => !sealed.has(doc._id));
  const hasSource = readable.some((doc) => Boolean(doc.text?.trim()));
  const dataSource = readable.find(
    (doc) =>
      doc.storageId &&
      [
        "text/csv",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].includes(doc.mimeType),
  );
  const visualSource = readable.find(
    (doc) => doc.storageId && ["image/png", "image/jpeg"].includes(doc.mimeType),
  );
  const playbookSealed = playbook ? (await sealedIn(ctx, [playbook])).has(playbook._id) : false;
  const evidence = {
    profileConfirmed: profile !== null && profile.tierSource !== "legacy",
    tier: profile?.tier ?? ("solopreneur" as const),
    confirmedNeeds: profile?.verticalPreferences?.needs ?? [],
    repeatCounts,
    sources: hasSource || dataSource || visualSource ? (["vault"] as const) : [],
    released,
    disabled: profile?.disabledVerticals ?? [],
    reviewReady: profile?.verticalPreferences?.reviewReady ?? [],
    confirmedLegalPlaybook:
      playbook?.tenantId === tenantId &&
      playbook?.status === "ready" &&
      Boolean(playbook.text?.trim()) &&
      !playbookSealed,
    deterministicDataValidationReady: dataSource !== undefined,
    visualSourceReady: visualSource !== undefined,
    connectorVariants: [],
  };
  return {
    evidence,
    playbookText: evidence.confirmedLegalPlaybook ? playbook?.text : undefined,
    dataSourceId: dataSource?._id,
    visualSourceId: visualSource?._id,
    presentation: {
      recommendations: recommendVerticals(evidence),
      controls: states,
      partialHistory: history.partial,
    },
  };
}

export const discover = tenantQuery({
  args: {},
  handler: async (ctx) => (await verticalDiscoveryFor(ctx, ctx.tenantId)).presentation,
});

/** Small native pages bound full-document reads; an empty filtered page can still have a cursor. */
export const workloadSources = tenantQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "ready"))
      .order("desc")
      .paginate({ cursor: cursor ?? null, numItems: 5 });
    const sealed = await sealedIn(ctx, page.page);
    return {
      docs: page.page
        .filter((doc) => !sealed.has(doc._id))
        .map((doc) => ({ docId: doc._id, title: doc.title })),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Shared ordinary-start eligibility; preview is an internal capability supplied only by the owner door. */
export const prepare = internalQuery({
  args: { tenantId: v.string(), verticalId: verticalIdArg, previewVersion: v.optional(v.number()) },
  handler: async (ctx, { tenantId, verticalId, previewVersion }) => {
    const { evidence, dataSourceId, visualSourceId, playbookText } = await verticalDiscoveryFor(
      ctx,
      tenantId,
    );
    const preview = previewVersion !== undefined;
    const state = verticalState(
      verticalId,
      preview
        ? {
            ...evidence,
            released: [verticalId],
            repeatCounts: { ...evidence.repeatCounts, [verticalId]: 2 },
          }
        : evidence,
    );
    if (state.state !== "available") return { ok: false as const, reason: state.reason };
    const name = verticalSkillName(verticalId);
    if (preview && (!Number.isSafeInteger(previewVersion) || previewVersion < 1))
      return { ok: false as const, reason: "not-released" as const };
    const row = preview
      ? await ctx.db
          .query("skills")
          .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", previewVersion))
          .unique()
      : await ctx.db
          .query("skills")
          .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
          .unique();
    // Native vertical customization has no reviewed authoring template yet. Never silently run a global fallback for an overlay.
    const overlay = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_status", (q) =>
        q.eq("tenantId", tenantId).eq("name", name).eq("status", "active"),
      )
      .unique();
    if (!row || (!preview && (overlay || !(await nativePackExposureReady(ctx, row)))))
      return { ok: false as const, reason: "not-released" as const };
    if (
      !hasValidPackProvenance(row.provenance, name, row.version) ||
      (await contentHash(row.body)) !==
        (JSON.parse(row.provenance!) as { bodySha256: string }).bodySha256
    )
      return { ok: false as const, reason: "not-released" as const };
    return {
      ok: true as const,
      skillId: row._id,
      name,
      version: row.version,
      dataSourceId,
      visualSourceId,
      ...(verticalId === "legal" ? { playbookText } : {}),
    };
  },
});

export const configure = tenantMutation({
  args: {
    needs: v.array(verticalIdArg),
    reviewReady: v.array(verticalIdArg),
    legalPlaybookDocId: v.optional(v.id("vaultDocuments")),
    confirmWorkload: v.optional(
      v.object({ verticalId: verticalIdArg, artifactIds: v.array(v.id("vaultDocuments")) }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.needs.length > VERTICAL_IDS.length || args.reviewReady.length > VERTICAL_IDS.length)
      throw new Error("CHOICE_LIMIT");
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (!profile) throw new Error("PROFILE_REQUIRED");
    if (args.legalPlaybookDocId !== undefined) {
      const doc = await ctx.db.get(args.legalPlaybookDocId);
      if (!doc || doc.tenantId !== ctx.tenantId || doc.status !== "ready")
        throw new Error("NOT_FOUND");
    }
    const confirmedWorkloads = [...(profile.verticalPreferences?.confirmedWorkloads ?? [])];
    if (args.confirmWorkload) {
      const { verticalId, artifactIds } = args.confirmWorkload;
      if (artifactIds.length !== 2 || new Set(artifactIds).size !== 2)
        throw new Error("TWO_DISTINCT_ARTIFACTS_REQUIRED");
      if (!args.needs.includes(verticalId)) throw new Error("CONFIRMED_NEED_REQUIRED");
      const docs = [];
      for (const id of artifactIds) {
        const doc = await ctx.db.get(id);
        if (!doc || doc.tenantId !== ctx.tenantId || doc.status !== "ready")
          throw new Error("NOT_FOUND");
        docs.push(doc);
      }
      if ((await sealedIn(ctx, docs)).size) throw new Error("SOURCE_SEALED");
      const value = { verticalId, artifactIds, confirmedAt: Date.now() };
      const previous = confirmedWorkloads.findIndex((item) => item.verticalId === verticalId);
      if (previous < 0) confirmedWorkloads.push(value);
      else confirmedWorkloads[previous] = value;
    }
    await ctx.db.patch(profile._id, {
      verticalPreferences: {
        ...(args.legalPlaybookDocId ? { legalPlaybookDocId: args.legalPlaybookDocId } : {}),
        confirmedWorkloads,
        needs: [...new Set(args.needs)],
        reviewReady: [...new Set(args.reviewReady)],
      },
    });
  },
});

/** Suppression is honored by loadEffectiveSkill before either tenant or global fallback. */
export const setDisabled = tenantMutation({
  args: { verticalId: verticalIdArg, disabled: v.boolean() },
  handler: async (ctx, { verticalId, disabled }) => {
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (!profile) throw new Error("PROFILE_REQUIRED");
    const values = new Set(profile.disabledVerticals ?? []);
    if (disabled) values.add(verticalId);
    else values.delete(verticalId);
    await ctx.db.patch(profile._id, { disabledVerticals: [...values] });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: String(profile._id),
      eventType: "vertical_pack.control",
      actor: "user",
      payload: { verticalId, disabled },
    });
    return { verticalId, disabled };
  },
});

/** Preserve the native owner gate and further narrow it to this owner's own tenant. */
export const rollback = ownerMutation({
  args: { verticalId: verticalIdArg, targetId: v.id("tenantSkills") },
  handler: async (ctx, { verticalId, targetId }) => {
    const result = await rollbackVerticalForTenant(ctx, targetId, verticalSkillName(verticalId));
    await ctx.runMutation(internal.verticalPackTelemetry.record, {
      tenantId: ctx.tenantId,
      candidateId: targetId,
      verticalId,
      event: "rollback",
    });
    return { changed: result.changed, version: result.version };
  },
});
