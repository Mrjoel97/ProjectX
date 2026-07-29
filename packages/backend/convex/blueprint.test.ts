import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const makeTest = () => convexTest(schema, modules);

async function insertVaultDocument(
  t: ReturnType<typeof makeTest>,
  {
    tenantId,
    kind = "business_blueprint",
    text = "# Business Blueprint",
    status = "ready",
  }: {
    tenantId: string;
    kind?: string;
    text?: string | undefined;
    status?: "processing" | "ready";
  },
): Promise<Id<"vaultDocuments">> {
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
          }
        : {}),
    });
  });
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
