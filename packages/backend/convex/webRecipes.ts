import {
  hasPassingWebRecipeBrowserEvidence,
  hasPassingWebRecipeEvidence,
  hasValidWebRecipeProvenance,
  isWebRecipeSkill,
  WEB_RECIPE_BROWSER_LANE_OUTCOMES,
  type WebRecipeSkillName,
  webRecipeFamilyForSkill,
} from "@pikar/contracts/skill";
import {
  canonicalWebRecipeDefinition,
  hashWebRecipeDefinition,
  materializeWebRecipeWithProvenance,
  parseWebRecipeDefinition,
  renderDesignedWebDocumentBytes,
  sha256Bytes,
  WEB_DESIGN_RENDERER_VERSION,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_COMPILER_ID,
  WEB_RECIPE_DEFINITIONS,
  type WebRecipeId,
} from "@pikar/core";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ownerMutation, ownerQuery, tenantMutation, tenantQuery } from "./lib/functions";
import { createProjectWithVersion, type RecipeRef } from "./webProjects";

const recipeId = v.union(
  v.literal("business-site"),
  v.literal("campaign-landing"),
  v.literal("storefront-catalogue"),
);
const expectedAvailability = v.optional(
  v.union(v.literal("tenant_discoverable"), v.literal("private_qualification")),
);

/**
 * ponytail: storefront exposure stays a code-owned false seam until Phase 50's typed
 * merchant-lifecycle contract exists. Upgrade only from that contract; never from request,
 * environment, tenant, owner or mutable database state.
 */
export const commerceContractReady = (): false => false;

type RecipeRow = Pick<
  Doc<"skills">,
  "_id" | "name" | "version" | "body" | "status" | "provenance" | "evidence" | "browserEvidence"
>;
type RecipeIdentity = {
  name: WebRecipeSkillName;
  version: number;
  skillId: string;
  bodyHash: string;
  definitionHash: string;
};
type ScopedMutationCtx = MutationCtx & { tenantId: string; userId: string };

function definitionFor(id: WebRecipeId) {
  const definition = WEB_RECIPE_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error("WEB_RECIPE_UNAVAILABLE");
  return definition;
}

function identityFor(
  row: RecipeRow,
  expected: ReturnType<typeof definitionFor>,
): {
  identity: RecipeIdentity;
  definition: ReturnType<typeof parseWebRecipeDefinition>;
} {
  if (!isWebRecipeSkill(row.name)) throw new Error("WEB_RECIPE_UNAVAILABLE");
  let definition: ReturnType<typeof parseWebRecipeDefinition>;
  try {
    definition = parseWebRecipeDefinition(JSON.parse(row.body));
    // The active row is trusted only when it is byte-for-byte the current code-owned registry
    // definition. Canonicalizing the stored body alone would let a stale or tampered row become
    // authoritative for lineage while materialization still used the compiled definition.
    if (
      row.name !== expected.registryName ||
      definition.registryName !== expected.registryName ||
      canonicalWebRecipeDefinition(definition) !== row.body ||
      row.body !== canonicalWebRecipeDefinition(expected)
    ) {
      throw new Error("WEB_RECIPE_ROW_NOT_CANONICAL");
    }
  } catch {
    throw new Error("WEB_RECIPE_UNAVAILABLE");
  }
  const identity: RecipeIdentity = {
    name: row.name,
    version: row.version,
    skillId: String(row._id),
    bodyHash: sha256Bytes(new TextEncoder().encode(row.body)),
    definitionHash: hashWebRecipeDefinition(definition),
  };
  return { identity, definition };
}

function evidenceReady(row: RecipeRow, identity: RecipeIdentity): boolean {
  return (
    hasValidWebRecipeProvenance(row.provenance, identity, {
      bundleHash: WEB_RECIPE_BUNDLE_HASH,
      compilerId: WEB_RECIPE_COMPILER_ID,
    }) &&
    hasPassingWebRecipeEvidence(row.evidence, identity) &&
    hasPassingWebRecipeBrowserEvidence(row.browserEvidence, identity)
  );
}

async function activeRecipe(
  ctx: QueryCtx | MutationCtx,
  id: WebRecipeId,
  allowStorefront: boolean,
): Promise<{
  row: RecipeRow;
  identity: RecipeIdentity;
  definition: ReturnType<typeof parseWebRecipeDefinition>;
}> {
  const definition = definitionFor(id);
  const name = definition.registryName;
  const row = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
    .unique();
  if (row === null) throw new Error("WEB_RECIPE_UNAVAILABLE");
  const resolved = identityFor(row, definition);
  if (!evidenceReady(row, resolved.identity)) throw new Error("WEB_RECIPE_UNAVAILABLE");
  if (
    resolved.definition.outputKind === "storefront" &&
    !allowStorefront &&
    !commerceContractReady()
  )
    throw new Error("COMMERCE_UNAVAILABLE");
  return { row, ...resolved };
}

function discoveryRow(
  identity: RecipeIdentity,
  definition: ReturnType<typeof parseWebRecipeDefinition>,
) {
  return {
    id: definition.id,
    name: identity.name,
    version: identity.version,
    skillId: identity.skillId,
    bodyHash: identity.bodyHash,
    definitionHash: identity.definitionHash,
    bundleHash: definition.bundleHash,
    outputKind: definition.outputKind,
    family: webRecipeFamilyForSkill(identity.name),
    fields: definition.fields,
  } as const;
}

/** Active, exact, still-evidenced site/landing recipes only. Storefront is intentionally absent. */
export const listAvailable = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const definition of WEB_RECIPE_DEFINITIONS) {
      if (definition.outputKind === "storefront") continue;
      try {
        const resolved = await activeRecipe(ctx, definition.id, false);
        out.push(discoveryRow(resolved.identity, resolved.definition));
      } catch {
        // Discovery is an availability read, not a diagnostics surface; stale/malformed rows stay
        // hidden and never disclose raw registry bodies or evidence payloads.
      }
    }
    return out;
  },
});

function recipeArgs() {
  return {
    recipeId,
    values: v.any(),
    slug: v.string(),
    title: v.string(),
    expectedAvailability,
  };
}

function recipeRefFor(
  identity: RecipeIdentity,
  materialized: ReturnType<typeof materializeWebRecipeWithProvenance>,
): RecipeRef {
  return {
    name: identity.name,
    version: identity.version,
    skillId: identity.skillId,
    bodyHash: identity.bodyHash,
    definitionHash: identity.definitionHash,
    inputHash: materialized.inputHash,
    rendererVersion: WEB_DESIGN_RENDERER_VERSION,
    designProfile: materialized.designProfile,
  };
}

async function createFromActiveRecipe(
  ctx: ScopedMutationCtx,
  args: {
    recipeId: WebRecipeId;
    values: unknown;
    slug: string;
    title: string;
    allowStorefront: boolean;
  },
) {
  const resolved = await activeRecipe(ctx, args.recipeId, args.allowStorefront);
  const materialized = materializeWebRecipeWithProvenance(args.recipeId, args.values);
  if (materialized.recipe.registryName !== resolved.identity.name)
    throw new Error("WEB_RECIPE_UNAVAILABLE");
  return createProjectWithVersion(ctx, {
    kind: materialized.document.kind,
    slug: args.slug,
    title: args.title,
    document: materialized.document,
    recipeRef: recipeRefFor(resolved.identity, materialized),
    createdBy: ctx.userId,
  });
}

/** Tenant-facing recipe creation. Caller controls values only; registry authority is server-owned. */
export const createProjectFromRecipe = tenantMutation({
  args: recipeArgs(),
  handler: async (ctx, args) => {
    if (
      args.expectedAvailability !== undefined &&
      args.expectedAvailability !== "tenant_discoverable"
    )
      throw new Error("WEB_RECIPE_UNAVAILABLE");
    if (args.recipeId === "storefront-catalogue") throw new Error("COMMERCE_UNAVAILABLE");
    return createFromActiveRecipe(ctx, { ...args, allowStorefront: false });
  },
});

/** Owner-only private storefront materialization for qualification and preview. */
export const qualifyStorefront = ownerMutation({
  args: recipeArgs(),
  handler: async (ctx, args) => {
    if (args.recipeId !== "storefront-catalogue") throw new Error("WEB_RECIPE_UNAVAILABLE");
    if (
      args.expectedAvailability !== undefined &&
      args.expectedAvailability !== "private_qualification"
    )
      throw new Error("WEB_RECIPE_UNAVAILABLE");
    // Registry activation may be proven for qualification, but public/tenant exposure remains false.
    const resolved = await activeRecipe(ctx, args.recipeId, true);
    const materialized = materializeWebRecipeWithProvenance(args.recipeId, args.values);
    return createProjectWithVersion(ctx, {
      kind: "storefront",
      slug: args.slug,
      title: args.title,
      document: materialized.document,
      recipeRef: recipeRefFor(resolved.identity, materialized),
      createdBy: ctx.userId,
    });
  },
});

// Descriptive alias for owner UI callers; both routes share the same owner gate and implementation.
export const createStorefrontQualification = qualifyStorefront;

/**
 * Owner-only, candidate-bound document preview. This is a qualification seam: it materializes
 * the exact pending row and returns document refs for the owner UI, but never inserts a project,
 * changes an active pointer, or makes a tenant/public route discoverable.
 */
export const previewWebRecipeCandidate = ownerMutation({
  args: {
    candidateId: v.id("skills"),
    runId: v.string(),
    revision: v.number(),
    viewport: v.union(v.literal("desktop"), v.literal("mobile")),
    values: v.any(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.candidateId);
    if (!row || !isWebRecipeSkill(row.name) || row.status !== "candidate")
      throw new Error("WEB_RECIPE_CANDIDATE_UNAVAILABLE");
    const transcript = row.browserQualification;
    const id = row.name.replace("web-recipe-", "") as WebRecipeId;
    const resolved = identityFor(row, definitionFor(id));
    if (
      !transcript ||
      transcript.runId !== args.runId ||
      transcript.ownerId !== ctx.userId ||
      transcript.revision !== args.revision ||
      transcript.finalizedHash !== undefined ||
      transcript.candidateName !== row.name ||
      transcript.candidateVersion !== row.version ||
      transcript.bodyHash !== resolved.identity.bodyHash ||
      transcript.definitionHash !== resolved.identity.definitionHash ||
      transcript.bundleHash !== WEB_RECIPE_BUNDLE_HASH ||
      transcript.rendererVersion !== WEB_DESIGN_RENDERER_VERSION
    )
      throw new Error("WEB_RECIPE_BROWSER_RUN_REQUIRED");
    const lane = transcript.lanes.find((item) => item.viewport === args.viewport);
    if (!lane) throw new Error("WEB_RECIPE_BROWSER_LANE_REQUIRED");
    const outcome = WEB_RECIPE_BROWSER_LANE_OUTCOMES[lane.observations.length];
    if (!outcome || outcome === "selected") throw new Error("WEB_RECIPE_BROWSER_LANE_COMPLETE");
    const raw = JSON.stringify(args.values);
    if (!raw || new TextEncoder().encode(raw).byteLength > 16_384)
      throw new Error("WEB_RECIPE_BROWSER_INPUT_TOO_LARGE");
    let materialized: ReturnType<typeof materializeWebRecipeWithProvenance>;
    try {
      materialized = materializeWebRecipeWithProvenance(id, args.values);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("WEB_RECIPE_INPUT_INVALID:"))
        throw error;
      if (outcome !== "refusal") throw new Error("WEB_RECIPE_INPUT_REFUSED");
      const inputHash = `sha256:${sha256Bytes(new TextEncoder().encode(raw))}`;
      const revision = transcript.revision + 1;
      const observations = [...lane.observations, { outcome: "refusal" as const, inputHash }];
      await ctx.db.patch(args.candidateId, {
        browserQualification: {
          ...transcript,
          revision,
          updatedAt: Date.now(),
          lanes: transcript.lanes.map((item) =>
            item.viewport === args.viewport ? { ...item, observations } : item,
          ),
        },
      });
      return {
        kind: "refusal" as const,
        outcome: "refusal" as const,
        revision,
        candidateId: String(args.candidateId),
        inputHash,
      };
    }
    if (outcome === "refusal") throw new Error("WEB_RECIPE_REFUSAL_NOT_OBSERVED");
    if (
      outcome === "partial" &&
      (!args.values ||
        typeof args.values !== "object" ||
        !resolved.definition.fields.some(
          (field) => !field.required && !Object.hasOwn(args.values as object, field.id),
        ))
    )
      throw new Error("WEB_RECIPE_PARTIAL_NOT_OBSERVED");
    const documentHash = sha256Bytes(
      new TextEncoder().encode(JSON.stringify(materialized.document)),
    );
    const bytes = renderDesignedWebDocumentBytes(
      materialized.document,
      materialized.designProfile,
      { slug: "qualification", page: materialized.document.pages[0]?.slug ?? "" },
    );
    const artifactHash = sha256Bytes(bytes);
    const previous = lane.observations.at(-1);
    if (outcome === "recovery" && previous?.outcome !== "refusal")
      throw new Error("WEB_RECIPE_RECOVERY_ORDER_INVALID");
    if (
      outcome === "edit" &&
      (previous?.inputHash === materialized.inputHash || previous?.artifactHash === artifactHash)
    )
      throw new Error("WEB_RECIPE_EDIT_UNCHANGED");
    if (
      outcome === "preview" &&
      (previous?.inputHash !== materialized.inputHash || previous?.artifactHash !== artifactHash)
    )
      throw new Error("WEB_RECIPE_PREVIEW_MISMATCH");
    const revision = transcript.revision + 1;
    const observations = [
      ...lane.observations,
      {
        outcome,
        inputHash: materialized.inputHash,
        documentHash,
        artifactHash,
        byteLength: bytes.byteLength,
      },
    ];
    await ctx.db.patch(args.candidateId, {
      browserQualification: {
        ...transcript,
        revision,
        updatedAt: Date.now(),
        lanes: transcript.lanes.map((item) =>
          item.viewport === args.viewport ? { ...item, observations } : item,
        ),
      },
    });
    return {
      kind: "rendered" as const,
      outcome,
      revision,
      candidateId: String(args.candidateId),
      name: row.name,
      version: row.version,
      bodyHash: resolved.identity.bodyHash,
      inputHash: materialized.inputHash,
      documentHash,
      artifactHash,
      byteLength: bytes.byteLength,
      rendererVersion: WEB_DESIGN_RENDERER_VERSION,
      bundleHash: WEB_RECIPE_BUNDLE_HASH,
      definitionHash: resolved.identity.definitionHash,
      html: new TextDecoder().decode(bytes),
      title: materialized.document.title,
      sections: materialized.document.pages.length,
      commerceAvailable: false,
    };
  },
});

/** Owner-only read-back for the private qualification surface; ordinary tenant reads stay dark. */
export const getStorefrontQualification = ownerQuery({
  args: { projectId: v.id("webProjects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId || project.kind !== "storefront") return null;
    const version = project.draftVersion
      ? await ctx.db
          .query("webProjectVersions")
          .withIndex("by_tenant_project_version", (q) =>
            q
              .eq("tenantId", ctx.tenantId)
              .eq("projectId", args.projectId)
              .eq("version", project.draftVersion!),
          )
          .first()
      : null;
    return { project, version };
  },
});
