import { readFileSync } from "node:fs";
import {
  hasPassingWebRecipeEvidence,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
} from "@pikar/contracts/skill";
import type { WebDocument } from "@pikar/contracts/webRuntime";
import {
  canonicalWebRecipeDefinition,
  designedWebDocumentHash,
  WEB_DESIGN_RENDERER_VERSION,
  WEB_RECIPE_BUNDLE_HASH,
  WEB_RECIPE_DEFINITIONS,
} from "@pikar/core";
import type { DesignProfileRef } from "@pikar/core/designKnowledge";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";
import { evaluateWebRecipeCandidate } from "./webRecipeEvals";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const SOURCE = readFileSync(new URL("./webRecipes.ts", import.meta.url), "utf8");
const PROJECTS = readFileSync(new URL("./webProjects.ts", import.meta.url), "utf8");
const RUNTIME = readFileSync(new URL("./webRuntime.ts", import.meta.url), "utf8");
const HTTP = readFileSync(new URL("./http.ts", import.meta.url), "utf8");

// These project-boundary fixtures patch only the test database. The production internal writer
// and owner transcript protocol are covered in skills.test.ts.
function browserEvidenceFor(
  row: { _id: unknown; name: string; version: number; body: string },
  refs: ReturnType<typeof evaluateWebRecipeCandidate>,
) {
  return JSON.stringify({
    runner: WEB_RECIPE_BROWSER_RUNNER,
    runId: "project-boundary-fixture",
    pass: true,
    authenticated: true,
    actorClass: "owner",
    route: "/ops",
    rendered: true,
    skillId: String(row._id),
    name: row.name,
    version: row.version,
    bodyHash: refs.bodyHash,
    definitionHash: refs.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    evidenceRevision: WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
    viewports: WEB_RECIPE_REQUIRED_VIEWPORTS,
    casesPassed: 1,
    casesTotal: 1,
    revision: 12,
    outcomeRefs: [
      "selected",
      "partial",
      "refusal",
      "recovery",
      "edit",
      "preview",
      "storefront-private",
    ],
    transcriptHash: "a".repeat(64),
    ts: 1,
  });
}

describe("Phase 49 recipe project boundary", () => {
  test("owner can privately materialize storefront while tenant/public paths stay dark", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    await t.mutation(internal.skills.evaluateWebRecipe, {
      name: "web-recipe-storefront-catalogue",
      version: 1,
      runId: "phase49-test",
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-storefront-catalogue").eq("version", 1),
        )
        .unique(),
    );
    if (!row) throw new Error("candidate row missing");
    const refs = evaluateWebRecipeCandidate(row, "phase49-test", 1);
    const browserEvidence = browserEvidenceFor(row, refs);
    await t.run((ctx) => ctx.db.patch(row._id, { browserEvidence }));
    await t.run((ctx) => ctx.db.patch(row._id, { status: "active" }));
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    const ref = (internal as unknown as { webRecipes: Record<string, unknown> }).webRecipes
      .qualifyStorefront;
    const result = await (
      owner.mutation as unknown as (
        fn: unknown,
        args: unknown,
      ) => Promise<{
        projectId: string;
        version: number;
        contentHash: string;
        revision: number;
      }>
    )(ref, {
      recipeId: "storefront-catalogue",
      values: {
        brandName: "Private Catalogue",
        items: [{ id: "item-1", name: "Item One", description: "A presentation item" }],
      },
      slug: "private-catalogue",
      title: "Private Catalogue",
      expectedAvailability: "private_qualification",
    });
    expect(result.projectId).toBeTruthy();
    const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
    const tenant = t.withIdentity({ subject: `${tenantId}|session` });
    const createRef = (internal as unknown as { webRecipes: Record<string, unknown> }).webRecipes
      .createProjectFromRecipe;
    await expect(
      (tenant.mutation as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(createRef, {
        recipeId: "storefront-catalogue",
        values: { brandName: "Tenant attempt", items: [] },
        slug: "tenant-storefront",
        title: "Tenant attempt",
        expectedAvailability: "tenant_discoverable",
      }),
    ).rejects.toThrow(/COMMERCE_UNAVAILABLE/);
    await expect(
      (tenant.query as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        (internal as unknown as { webRecipes: Record<string, unknown> }).webRecipes.listAvailable,
        {},
      ),
    ).resolves.toEqual([]);
    const publication = (internal as unknown as { webProjects: Record<string, unknown> })
      .webProjects;
    for (const action of ["publishVersion", "updateVersion", "rollback"] as const) {
      await expect(
        (
          owner.mutation as unknown as (
            fn: unknown,
            args: unknown,
          ) => Promise<{ ok: boolean; code: string }>
        )(publication[action], {
          projectId: result.projectId,
          version: result.version,
          contentHash: result.contentHash,
          expectedRevision: result.revision,
        }),
      ).resolves.toMatchObject({ ok: false, code: "COMMERCE_UNAVAILABLE" });
    }
    await expect(
      (
        owner.mutation as unknown as (
          fn: unknown,
          args: unknown,
        ) => Promise<{ ok: boolean; code: string }>
      )(publication.unpublish, { projectId: result.projectId, expectedRevision: result.revision }),
    ).resolves.toMatchObject({ ok: false, code: "COMMERCE_UNAVAILABLE" });
    await expect(
      t.query(internal.webRuntime.resolvePage, {
        host: "pikar-platform",
        slug: "private-catalogue",
        page: "catalogue",
      }),
    ).resolves.toEqual({ state: "invalid_host" });
    expect(hasPassingWebRecipeEvidence(row.evidence, refs)).toBe(true);
  });

  test("site creation resolves exact active identity and manual edits retain origin lineage", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    await t.mutation(internal.skills.evaluateWebRecipe, {
      name: "web-recipe-business-site",
      version: 1,
      runId: "phase49-site-test",
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    if (!row) throw new Error("candidate row missing");
    const refs = evaluateWebRecipeCandidate(row, "phase49-site-test", 1);
    await t.run((ctx) => ctx.db.patch(row._id, { browserEvidence: browserEvidenceFor(row, refs) }));
    await t.run((ctx) => ctx.db.patch(row._id, { status: "active" }));
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const createRef = (internal as unknown as { webRecipes: Record<string, unknown> }).webRecipes
      .createProjectFromRecipe;
    const created = await (
      asUser.mutation as unknown as (
        fn: unknown,
        args: unknown,
      ) => Promise<{ projectId: string; version: number; contentHash: string }>
    )(createRef, {
      recipeId: "business-site",
      values: { brandName: "Lineage Studio", headline: "A bounded site" },
      slug: "lineage-studio",
      title: "Lineage Studio",
      expectedAvailability: "tenant_discoverable",
    });
    const projectCountBeforeInvalid = await t.run((ctx) => ctx.db.query("webProjects").collect());
    const versionCountBeforeInvalid = await t.run((ctx) =>
      ctx.db.query("webProjectVersions").collect(),
    );
    await expect(
      (asUser.mutation as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(createRef, {
        recipeId: "business-site",
        values: {},
        slug: "invalid-input",
        title: "Invalid input",
        expectedAvailability: "tenant_discoverable",
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("webProjects").collect())).toHaveLength(
      projectCountBeforeInvalid.length,
    );
    expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(
      versionCountBeforeInvalid.length,
    );
    const otherUserId = await t.run((ctx) => ctx.db.insert("users", {}));
    const other = t.withIdentity({ subject: `${otherUserId}|session` });
    const projectRead = (internal as unknown as { webProjects: Record<string, unknown> })
      .webProjects;
    await expect(
      (other.query as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        projectRead.getProject,
        { projectId: created.projectId },
      ),
    ).resolves.toBeNull();
    await expect(
      (other.query as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        projectRead.getVersion,
        { projectId: created.projectId, version: 1 },
      ),
    ).resolves.toBeNull();
    await expect(
      (asUser.mutation as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(createRef, {
        recipeId: "business-site",
        values: { brandName: "No authority", authority: "owner", recipeRef: "forged" },
        slug: "forged-authority",
        title: "Forged authority",
        recipeRef: { name: "forged", version: 999 },
      }),
    ).rejects.toThrow();
    const first = await t.run((ctx) =>
      ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q
            .eq("tenantId", String(userId))
            .eq("projectId", created.projectId as never)
            .eq("version", 1),
        )
        .first(),
    );
    expect(first?.recipeRef).toMatchObject({
      name: "web-recipe-business-site",
      version: 1,
      skillId: String(row._id),
      bodyHash: refs.bodyHash,
      inputHash: expect.any(String),
      designProfile: expect.objectContaining({ bundleHash: expect.any(String) }),
    });
    expect(first?.rendererVersion).toBe(WEB_DESIGN_RENDERER_VERSION);
    expect(first?.recipeRef?.rendererVersion).toBe(WEB_DESIGN_RENDERER_VERSION);
    expect(first?.artifactHtml).toContain("<style>");
    expect(first?.contentHash).toBe(
      designedWebDocumentHash(
        first?.document as WebDocument,
        first?.recipeRef?.designProfile as DesignProfileRef,
      ),
    );
    const saveRef = (internal as unknown as { webProjects: Record<string, unknown> }).webProjects
      .saveDraft;
    await (asUser.mutation as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
      saveRef,
      {
        projectId: created.projectId,
        document: {
          kind: "site",
          title: "Lineage Studio edited",
          brand: { name: "Lineage Studio" },
          navigation: [],
          pages: [{ slug: "home", title: "Edited", nodes: [{ kind: "text", text: "Edited" }] }],
        },
      },
    );
    const versions = await t.run((ctx) =>
      ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q.eq("tenantId", String(userId)).eq("projectId", created.projectId as never),
        )
        .order("asc")
        .collect(),
    );
    expect(versions).toHaveLength(2);
    expect(versions[1]?.recipeRef).toEqual(versions[0]?.recipeRef);
    expect(versions[1]?.contentHash).not.toBe(versions[0]?.contentHash);
    expect(versions[1]?.rendererVersion).toBe(WEB_DESIGN_RENDERER_VERSION);
    expect(versions[1]?.artifactHtml).toContain("<style>");
  });

  test("tampered or mispinned active rows are hidden before evidence and materialization", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    await t.mutation(internal.skills.evaluateWebRecipe, {
      name: "web-recipe-business-site",
      version: 1,
      runId: "phase49-tamper-test",
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    if (!row) throw new Error("candidate row missing");
    const refs = evaluateWebRecipeCandidate(row, "phase49-tamper-test", 1);
    await t.run((ctx) => ctx.db.patch(row._id, { browserEvidence: browserEvidenceFor(row, refs) }));
    await t.run((ctx) => ctx.db.patch(row._id, { status: "active", body: `${row.body} ` }));
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const recipes = (internal as unknown as { webRecipes: Record<string, unknown> }).webRecipes;
    await expect(
      (asUser.query as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        recipes.listAvailable,
        {},
      ),
    ).resolves.toEqual([]);
    await expect(
      (asUser.mutation as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        recipes.createProjectFromRecipe,
        {
          recipeId: "business-site",
          values: { brandName: "Hidden", headline: "Hidden" },
          slug: "hidden-tampered",
          title: "Hidden tampered",
        },
      ),
    ).rejects.toThrow(/WEB_RECIPE_UNAVAILABLE/);

    const expected = WEB_RECIPE_DEFINITIONS.find((candidate) => candidate.id === "business-site");
    if (!expected) throw new Error("definition missing");
    const mispinnedBody = canonicalWebRecipeDefinition(
      WEB_RECIPE_DEFINITIONS.find((candidate) => candidate.id === "campaign-landing")!,
    );
    await t.run((ctx) => ctx.db.patch(row._id, { body: mispinnedBody }));
    expect(
      await (asUser.query as unknown as (fn: unknown, args: unknown) => Promise<unknown>)(
        recipes.listAvailable,
        {},
      ),
    ).toEqual([]);
  });

  test("discovery resolves active exact rows and omits storefront", () => {
    expect(SOURCE).toContain("export const listAvailable = tenantQuery");
    expect(SOURCE).toContain('definition.outputKind === "storefront"');
    expect(SOURCE).toContain("hasValidWebRecipeProvenance");
    expect(SOURCE).toContain("hasPassingWebRecipeEvidence");
    expect(SOURCE).toContain("hasPassingWebRecipeBrowserEvidence");
    expect(SOURCE).toContain("canonicalWebRecipeDefinition");
    expect(SOURCE).not.toContain("tenantId: v.string()");
  });

  test("recipe writes stamp server-owned origin and never accept caller lineage", () => {
    expect(SOURCE).toContain("export const createProjectFromRecipe = tenantMutation");
    expect(SOURCE).toContain("recipeRefFor");
    expect(SOURCE).toContain("createProjectWithVersion");
    expect(SOURCE).not.toContain("skillId: v.string()");
    expect(SOURCE).not.toContain("provenance: v.string()");
    expect(PROJECTS).toContain("previous?.recipeRef");
    expect(PROJECTS).toContain("recipeRef?: RecipeRef");
    const manual = PROJECTS.slice(
      PROJECTS.indexOf("export const createDraft"),
      PROJECTS.indexOf("export const saveDraft"),
    );
    expect(manual).not.toContain("recipeRef");
  });

  test("storefront has a private owner seam but no readiness toggle or public resolver", () => {
    expect(SOURCE).toContain("export const commerceContractReady = (): false => false");
    expect(SOURCE).toContain("export const qualifyStorefront = ownerMutation");
    expect(SOURCE).toContain("export const getStorefrontQualification = ownerQuery");
    expect(PROJECTS).toContain('project.kind === "storefront"');
    expect(PROJECTS).toContain("COMMERCE_UNAVAILABLE");
    expect(RUNTIME).toContain('resolved.project.kind === "storefront"');
    expect(HTTP).toContain('resolved.project.kind === "storefront"');
  });

  test("recipe identity stays refs/hashes only", () => {
    expect(SOURCE).toContain("bodyHash");
    expect(SOURCE).toContain("inputHash");
    expect(SOURCE).toContain("designProfile");
    for (const forbidden of ["rawContent", "renderedHtml", "fixture", "prompt"]) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });
});
