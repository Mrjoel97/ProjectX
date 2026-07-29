import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
  SPINE_CHAR_CAP,
  serializeBlueprint,
  type BusinessBlueprint,
} from "@pikar/core";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const makeTest = () => convexTest(schema, modules);

async function insertVaultDocument(
  t: ReturnType<typeof makeTest>,
  options: {
    tenantId: string;
    kind?: string;
    text?: string | undefined;
    status?: "processing" | "ready";
  },
): Promise<Id<"vaultDocuments">> {
  const {
    tenantId,
    kind = "business_blueprint",
    status = "ready",
  } = options;
  const text = Object.hasOwn(options, "text") ? options.text : "# Business Blueprint";
  return await t.run(async (ctx) => {
    return await ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Business blueprint",
      kind,
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      size: text?.length ?? 0,
      contentHash: `${tenantId}-${kind}-${Date.now()}-${Math.random()}`,
      ...(text === undefined ? {} : { text }),
      status,
      createdAt: Date.now(),
    });
  });
}

async function insertTenantProfile(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  blueprint?: {
    docId: Id<"vaultDocuments">;
    sourceDocIds?: string[];
    confirmedAt?: number;
    draft?: string;
  },
): Promise<Id<"tenantProfiles">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "startup",
      tierSource: "derived",
      derivedAt: Date.now(),
      ...(blueprint
        ? {
            blueprintDocId: blueprint.docId,
            blueprintSourceDocIds: blueprint.sourceDocIds ?? [],
            blueprintConfirmedAt: blueprint.confirmedAt,
            blueprintDraft: blueprint.draft,
          }
        : {}),
    });
  });
}

const LIVE_BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: {
    values: ["A tenant-scoped business"],
    origin: "derived",
    source: "source-a.md",
  },
  stage: null,
  tier: { values: ["startup"], origin: "stated" },
  offering: null,
  targetCustomer: null,
  revenueModel: null,
  bindingConstraint: null,
  primaryGoals: null,
  knownConstraints: null,
  entities: null,
} satisfies BusinessBlueprint);

async function insertLiveBlueprint(
  t: ReturnType<typeof makeTest>,
  tenantId: string,
  {
    sourceDocIds = [],
    draft,
    text = LIVE_BLUEPRINT_TEXT,
  }: {
    sourceDocIds?: string[];
    draft?: string;
    text?: string;
  } = {},
): Promise<Id<"vaultDocuments">> {
  const docId = await insertVaultDocument(t, { tenantId, text });
  await insertTenantProfile(t, tenantId, {
    docId,
    sourceDocIds,
    confirmedAt: 1_725_000_000_000,
    draft,
  });
  return docId;
}

describe("blueprint live read plane", () => {
  test("returns the owning tenant's live blueprint", async () => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      text: "# Acme Blueprint",
    });
    await insertTenantProfile(t, "tenant_a", {
      docId,
      sourceDocIds: ["source-a", "source-b"],
      confirmedAt: 1_725_000_000_000,
    });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toEqual({
      docId,
      text: "# Acme Blueprint",
      sourceDocIds: ["source-a", "source-b"],
      confirmedAt: 1_725_000_000_000,
    });
  });

  test("returns null when the tenant profile row is absent", async () => {
    const t = makeTest();

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_missing" }),
    ).resolves.toBeNull();
  });

  test("returns null when the tenant profile has no blueprint pointer", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("returns null when the pointed-to blueprint document was deleted", async () => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, { tenantId: "tenant_a" });
    await insertTenantProfile(t, "tenant_a", { docId });
    await t.run(async (ctx) => {
      await ctx.db.delete(docId);
    });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("returns null when the pointed-to blueprint belongs to another tenant", async () => {
    const t = makeTest();
    const tenantADoc = await insertVaultDocument(t, { tenantId: "tenant_a" });
    await insertTenantProfile(t, "tenant_b", { docId: tenantADoc });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_b" }),
    ).resolves.toBeNull();
  });

  test.each([
    { kind: "business_profile", text: "# Not a blueprint" },
    { kind: "business_blueprint", text: undefined },
  ])("returns null for an invalid pointed-to document: %o", async ({ kind, text }) => {
    const t = makeTest();
    const docId = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind,
      text,
    });
    await insertTenantProfile(t, "tenant_a", { docId });

    await expect(
      t.query(internal.blueprint.liveForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });
});

describe("blueprint top entities", () => {
  test("returns at most 20 tenant-scoped names ordered by descending degree", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      for (let degree = 0; degree < 25; degree += 1) {
        await ctx.db.insert("graphNodes", {
          tenantId: "tenant_a",
          type: "topic",
          name: `Entity ${degree}`,
          normalizedName: `entity-${degree}`,
          degree,
        });
      }
      await ctx.db.insert("graphNodes", {
        tenantId: "tenant_b",
        type: "topic",
        name: "Tenant B secret",
        normalizedName: "tenant-b-secret",
        degree: 10_000,
      });
    });

    const names = await t.query(internal.blueprint.topEntities, {
      tenantId: "tenant_a",
    });

    expect(names).toEqual(
      Array.from({ length: 20 }, (_, index) => `Entity ${24 - index}`),
    );
    expect(names).not.toContain("Tenant B secret");
  });

  test("returns an empty list for a tenant with no graph", async () => {
    const t = makeTest();

    await expect(
      t.query(internal.blueprint.topEntities, { tenantId: "tenant_empty" }),
    ).resolves.toEqual([]);
  });
});

describe("blueprint spine and Stage-1 drift", () => {
  test("reports exactly one unincorporated ready document, then removes it when processing", async () => {
    const t = makeTest();
    const incorporatedA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const incorporatedB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    const unincorporated = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "C",
    });
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: [incorporatedA, incorporatedB],
    });

    const stale = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(stale).toContain("⚠ 1 documents");

    await t.run(async (ctx) => {
      await ctx.db.patch(unincorporated, { status: "processing" });
    });
    const current = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(current).not.toContain("documents have been added");
  });

  test("uses a set difference when recorded source ids are stale", async () => {
    const t = makeTest();
    for (const text of ["A", "B", "C"]) {
      await insertVaultDocument(t, {
        tenantId: "tenant_a",
        kind: "upload",
        text,
      });
    }
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: ["deleted-source-a", "deleted-source-b"],
    });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("⚠ 3 documents");
    expect(spine).not.toContain("⚠ 1 documents");
  });

  test("omits staleness when every ready source document is incorporated", async () => {
    const t = makeTest();
    const sourceIds = await Promise.all(
      ["A", "B", "C"].map((text) =>
        insertVaultDocument(t, {
          tenantId: "tenant_a",
          kind: "upload",
          text,
        }),
      ),
    );
    await insertLiveBlueprint(t, "tenant_a", { sourceDocIds: sourceIds });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).not.toContain("documents have been added");
  });

  test("keeps live staleness unchanged when a draft exists", async () => {
    const t = makeTest();
    const incorporatedA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const incorporatedB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "C",
    });
    await insertLiveBlueprint(t, "tenant_a", {
      sourceDocIds: [incorporatedA, incorporatedB],
      draft: JSON.stringify({
        blueprint: { unrelated: true },
        sourceDocIds: ["draft-covers-everything"],
      }),
    });

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("⚠ 1 documents");
  });

  test("returns null when the tenant has no live blueprint", async () => {
    const t = makeTest();
    await insertTenantProfile(t, "tenant_a");
    await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "Ready but no blueprint exists",
    });

    await expect(
      t.query(internal.blueprint.spineForTenant, { tenantId: "tenant_a" }),
    ).resolves.toBeNull();
  });

  test("renders the marked spine within the dedicated character cap", async () => {
    const t = makeTest();
    await insertLiveBlueprint(t, "tenant_a");

    const spine = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });

    expect(spine).toContain("[stated]");
    expect(spine).toContain("[source: source-a.md]");
    expect(spine?.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
  });

  test("reflects two unincorporated documents and then zero", async () => {
    const t = makeTest();
    const sourceA = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "A",
    });
    const sourceB = await insertVaultDocument(t, {
      tenantId: "tenant_a",
      kind: "upload",
      text: "B",
    });
    await insertLiveBlueprint(t, "tenant_a");

    const stale = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(stale).toContain("⚠ 2 documents");

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("tenantProfiles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "tenant_a"))
        .unique();
      if (profile === null) throw new Error("missing fixture profile");
      await ctx.db.patch(profile._id, {
        blueprintSourceDocIds: [sourceA, sourceB],
      });
    });
    const current = await t.query(internal.blueprint.spineForTenant, {
      tenantId: "tenant_a",
    });
    expect(current).not.toContain("documents have been added");
  });

  test("never returns another tenant's spine", async () => {
    const t = makeTest();
    const tenantADoc = await insertLiveBlueprint(t, "tenant_a");
    await insertTenantProfile(t, "tenant_b", { docId: tenantADoc });

    await expect(
      t.query(internal.blueprint.spineForTenant, { tenantId: "tenant_b" }),
    ).resolves.toBeNull();
  });
});
