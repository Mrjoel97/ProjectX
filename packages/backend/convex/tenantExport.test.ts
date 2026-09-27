import {
  AUDIT_ARCHIVE_STATEMENT,
  deletableTables,
  STORAGE_ID_FIELDS,
  TENANT_EXPORT_SCHEMA_VERSION,
  TENANT_TABLE_CLASSIFICATION,
  type TenantDataExport,
  type TenantDataExportPage,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { TENANT_EXPORT_ROWS_PER_TABLE } from "./tenantExport";

const modules = import.meta.glob("./**/*.*s");
const exportTenantData = makeFunctionReference<
  "query",
  { cursor?: TenantExportCursor },
  TenantDataExportPage
>("tenantExport:exportTenantData");

async function downloadExport(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
): Promise<TenantDataExport> {
  let cursor: TenantExportCursor | undefined;
  let header: TenantDataExport["header"] | undefined;
  let limits: TenantDataExport["limits"] | undefined;
  const tables: Record<string, readonly unknown[]> = {};
  const omitted: Record<string, string> = {};

  do {
    const page = await t
      .withIdentity({ subject: `${tenantId}|export-session` })
      .query(exportTenantData, cursor ? { cursor } : {});
    header ??= page.header;
    tables[page.table.name] = [...(tables[page.table.name] ?? []), ...page.table.rows];
    Object.assign(omitted, page.omitted);
    limits = page.limits;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  if (!header || !limits) throw new Error("EMPTY_EXPORT");
  return { header, tables, omitted, limits };
}

async function seedTwoTenants() {
  const t = convexTest(schema, modules);
  const { tenantA, tenantB } = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("users", { email: "tenant-a@example.test" });
    const tenantB = await ctx.db.insert("users", { email: "tenant-b@example.test" });

    await ctx.db.insert("demoItems", { tenantId: tenantA, label: "A-only-row" });
    await ctx.db.insert("demoItems", { tenantId: tenantB, label: "B-secret-row" });
    await ctx.db.insert("gmailTokens", {
      tenantId: tenantA,
      refreshToken: "A_REFRESH_CROWN_JEWEL",
      accessToken: "A_ACCESS_CROWN_JEWEL",
      scope: "scope-one scope-two",
      updatedAt: 1_786_830_000_000,
    });
    await ctx.db.insert("microsoftCalendarTokens", {
      tenantId: tenantA,
      refreshToken: "MS_REFRESH_CROWN_JEWEL",
      accessToken: "MS_ACCESS_CROWN_JEWEL",
      expiresAt: 1_786_840_000_000,
      scope: "Calendars.ReadWrite Mail.Send Mail.Read",
      updatedAt: 1_786_830_100_000,
    });
    await ctx.db.insert("audit", {
      tenantId: tenantA,
      correlationId: "audit-not-personal-data",
      eventType: "test.event",
      actor: "test",
      payload: { ref: "row-ref" },
      ts: 1_786_830_200_000,
    });
    await ctx.db.insert("deadLetters", {
      tenantId: tenantA,
      correlationId: "dlq-ref",
      workflowId: "workflow-ref",
      payload: { ref: "row-ref" },
      error: "test",
      status: "new",
      createdAt: 1_786_830_300_000,
    });

    return { tenantA, tenantB };
  });
  return { t, tenantA, tenantB };
}

describe("tenant data export", () => {
  test("commerce export projects policy branches and omits retry material for one tenant", async () => {
    const { t, tenantA, tenantB } = await seedTwoTenants();
    await t.run(async (ctx) => {
      for (const tenantId of [tenantA, tenantB]) {
        const projectId = await ctx.db.insert("webProjects", {
          tenantId: String(tenantId),
          kind: "storefront",
          slug: `store-${tenantId}`,
          title: "Private",
          publicHost: "private.test",
          domainMode: "platform_path",
          hostingDeclaration: {
            hosting: "pikar_platform_path",
            source: "tenant_structured_content",
          },
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        const productId = await ctx.db.insert("tenantProducts", {
          tenantId,
          goodsKind: "digital",
          sku: tenantId === tenantA ? "mine" : "foreign",
          variant: "one",
          currency: "USD",
          priceMinor: 125,
          status: "active",
          revision: 2,
          createdAt: 1,
          updatedAt: 2,
        });
        const cartId = await ctx.db.insert("tenantCarts", {
          tenantId,
          projectId,
          lines: [
            {
              presentationItemId: "item",
              productId,
              quantity: 1,
              expectedProductRevision: 2,
              expectedUnitMinor: 125,
            },
          ],
          addressCountry: "US",
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: 1000,
        });
        const policyId = await ctx.db.insert("tenantCommercePolicies", {
          tenantId,
          projectId,
          revision: 3,
          sellerOfRecordRef: "seller-ref",
          currency: "USD",
          countries: ["US"],
          physical: {
            shippingSourceRef: "shipping-ref",
            shippingMinor: 20,
            returnsPolicyRef: "returns-ref",
            taxSourceRef: "tax-ref",
            taxBasisPoints: 500,
            refundPolicyRef: "refund-ref",
            buyerRetentionRef: "retention-ref",
          },
          digital: {
            deliveryRef: "delivery-ref",
            revocationRef: "revocation-ref",
            noShipping: true,
            taxSourceRef: "tax-ref",
            taxBasisPoints: 500,
            refundPolicyRef: "refund-ref",
            buyerRetentionRef: "retention-ref",
          },
          createdAt: 1,
        });
        const orderId = await ctx.db.insert("tenantOrders", {
          tenantId,
          projectId,
          cartId,
          cartRevision: 1,
          snapshot: {
            tenantId,
            projectId: String(projectId),
            currency: "USD",
            country: "US",
            policyId: String(policyId),
            policyRevision: 3,
            sellerOfRecordRef: "seller-ref",
            digitalPolicy: {
              deliveryRef: "delivery-ref",
              revocationRef: "revocation-ref",
              noShipping: true,
              taxSourceRef: "tax-ref",
              taxBasisPoints: 500,
              refundPolicyRef: "refund-ref",
              buyerRetentionRef: "retention-ref",
            },
            lines: [
              {
                presentationItemId: "item",
                productId: String(productId),
                sku: "mine",
                goodsKind: "digital",
                productRevision: 2,
                stockRevision: 1,
                unitMinor: 125,
                quantity: 1,
                lineMinor: 125,
              },
            ],
            subtotalMinor: 125,
            taxMinor: 6,
            shippingMinor: 0,
            totalMinor: 131,
            hash: "snapshot-hash",
          },
          snapshotHash: "snapshot-hash",
          status: "pending",
          expiresAt: 1000,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("tenantOrderAttempts", {
          tenantId,
          orderId,
          cartId,
          cartRevision: 1,
          retryKeyHash: "SECRET_RETRY_HASH",
          snapshotHash: "snapshot-hash",
          status: "local_pending",
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const result = await downloadExport(t, tenantA);
    expect(result.tables.tenantCommercePolicies).toEqual([
      expect.objectContaining({
        revision: 3,
        physical: expect.objectContaining({ buyerRetentionRef: "retention-ref" }),
        digital: expect.objectContaining({ noShipping: true }),
      }),
    ]);
    expect(result.tables.tenantOrders).toEqual([
      expect.objectContaining({
        snapshot: expect.objectContaining({
          lines: [expect.objectContaining({ goodsKind: "digital", lineMinor: 125 })],
        }),
      }),
    ]);
    expect(result.tables.tenantOrderAttempts).toEqual([
      expect.not.objectContaining({ retryKeyHash: expect.anything() }),
    ]);
    const bytes = JSON.stringify(result);
    expect(bytes).not.toContain("SECRET_RETRY_HASH");
    expect(bytes).not.toContain("foreign");
  });
  test("Phase 48 rows and rendered artifact links are in the generic export walk", () => {
    expect(TENANT_TABLE_CLASSIFICATION.webProjects).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webProjectVersions).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webMetrics).toBe("tenant_owned");
    expect(TENANT_TABLE_CLASSIFICATION.webSubmissions).toBe("tenant_owned");
    expect(deletableTables()).toEqual(
      expect.arrayContaining(["webProjects", "webProjectVersions", "webMetrics", "webSubmissions"]),
    );
    expect(STORAGE_ID_FIELDS.webProjectVersions).toContain("artifactStorageId");
  });

  test("Phase 50 catalogue, stock and reservations export only the authenticated tenant", async () => {
    const { t, tenantA, tenantB } = await seedTwoTenants();
    await t.run(async (ctx) => {
      for (const [tenantId, sku] of [
        [tenantA, "a-lamp"],
        [tenantB, "b-secret-lamp"],
      ] as const) {
        const productId = await ctx.db.insert("tenantProducts", {
          tenantId,
          sku,
          variant: "one",
          currency: "USD",
          priceMinor: 100,
          status: "active",
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("tenantStock", {
          tenantId,
          productId,
          kind: "finite",
          onHand: 2,
          reserved: 1,
          reservationTtlMs: 900_000,
          revision: 2,
          updatedAt: 1,
        });
        await ctx.db.insert("tenantReservations", {
          tenantId,
          productId,
          quantity: 1,
          status: "held",
          expiresAt: 900_001,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const result = await downloadExport(t, tenantA);
    expect(result.tables.tenantProducts).toHaveLength(1);
    expect(result.tables.tenantStock).toHaveLength(1);
    expect(result.tables.tenantReservations).toHaveLength(1);
    expect(JSON.stringify(result.tables.tenantProducts)).toContain("a-lamp");
    expect(JSON.stringify(result)).not.toContain("b-secret-lamp");
  });

  test("exports only the authenticated tenant and states the immutable-audit omission", async () => {
    const { t, tenantA } = await seedTwoTenants();

    const result = await downloadExport(t, tenantA);
    const bytes = JSON.stringify(result);

    expect(result.header).toMatchObject({
      schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
      tenantId: String(tenantA),
      auditArchive: AUDIT_ARCHIVE_STATEMENT,
    });
    expect(result.header.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(bytes).toContain("A-only-row");
    expect(bytes).toContain("tenant-a@example.test");
    expect(bytes).not.toContain("B-secret-row");
    expect(bytes).not.toContain("tenant-b@example.test");
    expect(result.omitted.audit).toMatch(/immutable/i);
    expect(result.omitted.deadLetters).toMatch(/audit|compliance/i);
  });

  test("reduces credential rows and contains no token material in the produced bytes", async () => {
    const { t, tenantA } = await seedTwoTenants();

    const result = await downloadExport(t, tenantA);
    const bytes = JSON.stringify(result);

    expect(result.tables.gmailTokens).toEqual([
      { connected: true, updatedAt: 1_786_830_000_000, scopeHalves: [9, 9] },
    ]);
    expect(result.tables.microsoftCalendarTokens).toEqual([
      { connected: true, updatedAt: 1_786_830_100_000, scopeHalves: [19, 9, 9] },
    ]);
    for (const secret of [
      "A_REFRESH_CROWN_JEWEL",
      "A_ACCESS_CROWN_JEWEL",
      "MS_REFRESH_CROWN_JEWEL",
      "MS_ACCESS_CROWN_JEWEL",
    ]) {
      expect(bytes).not.toContain(secret);
    }
    expect(bytes).not.toMatch(/refreshToken|accessToken/);
  });

  // Seeds `savedPrompts` past its own budget. It sits 6th in TENANT_TABLE_CLASSIFICATION, well
  // ahead of `demoItems` (~24th), which is what makes it the right instrument for both tests.
  async function seedOverBudgetEarlyTable() {
    const seeded = await seedTwoTenants();
    await seeded.t.run(async (ctx) => {
      for (let i = 0; i < TENANT_EXPORT_ROWS_PER_TABLE + 40; i++) {
        await ctx.db.insert("savedPrompts", {
          tenantId: seeded.tenantA,
          text: `bounded-${i}`,
          title: `bounded-${i}`,
          textHash: `hash-${i}`,
          createdAt: 1_786_830_000_000 + i,
        });
      }
    });
    return seeded;
  }

  test("bounds a table at its own budget and says so, rather than reading it whole", async () => {
    const { t, tenantA } = await seedOverBudgetEarlyTable();

    const result = await downloadExport(t, tenantA);

    expect(result.limits.pageSize).toBeGreaterThan(0);
    expect(result.tables.savedPrompts).toHaveLength(TENANT_EXPORT_ROWS_PER_TABLE);
    expect(result.limits.truncated).toBe(true);
  });

  // The regression a GLOBAL row budget caused: `exportableTables()` is a fixed order, so one
  // oversized table ahead of the rest spent the whole budget and every later table exported as
  // nothing — silently, under a "portable record of your data" promise. The per-table budget is
  // what makes coverage independent of position, and this is the test that holds it there.
  test("a table AFTER an over-budget one still exports — coverage is not order-dependent", async () => {
    const { t, tenantA } = await seedOverBudgetEarlyTable();

    const result = await downloadExport(t, tenantA);

    expect(result.tables.demoItems).toEqual([expect.objectContaining({ label: "A-only-row" })]);
    expect(result.tables.gmailTokens).toHaveLength(1);
    // …and the sticky flag survived the ~two dozen pages between the truncation and the last one.
    expect(result.limits.truncated).toBe(true);
  });
});

// ══ THE EXPORT HANDS OVER THE FILES (2026-09-08) ═════════════════════════════════════════════
//
// Until this commit a grep of `tenantExport.ts` for "storage" returned ZERO, while the erasure
// surface said "Download your data first if you want a copy." It was false for the two things a
// user would most want back — their documents and their generated media. It is the mirror image of
// the 44-01 delete defect: export promised a copy and omitted the files, delete promised removal
// and kept them. One promise, two halves.
test("a page carries download links for the files its rows point at", async () => {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("users", { email: "files-a@example.test" });
    const tenantB = await ctx.db.insert("users", { email: "files-b@example.test" });
    const mine = await ctx.storage.store(new Blob(["my reel"]));
    const theirs = await ctx.storage.store(new Blob(["not mine"]));
    const webMine = await ctx.storage.store(new Blob(["<html>mine</html>"]));
    const webTheirs = await ctx.storage.store(new Blob(["<html>theirs</html>"]));
    await ctx.db.insert("plans", {
      tenantId: tenantA,
      threadId: "thread_files",
      status: "done",
      renderStorageId: mine,
      createdAt: Date.now(),
    });
    await ctx.db.insert("plans", {
      tenantId: tenantB,
      threadId: "thread_theirs",
      status: "done",
      renderStorageId: theirs,
      createdAt: Date.now(),
    });
    const webProjectA = await ctx.db.insert("webProjects", {
      tenantId: tenantA,
      kind: "landing",
      slug: "files-a",
      title: "Files A",
      publicHost: "pikar-platform",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const webProjectB = await ctx.db.insert("webProjects", {
      tenantId: tenantB,
      kind: "landing",
      slug: "files-b",
      title: "Files B",
      publicHost: "pikar-platform",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("webProjectVersions", {
      tenantId: tenantA,
      projectId: webProjectA,
      version: 1,
      document: { kind: "landing", title: "Files A" },
      contentHash: "sha256:web-a",
      rendererVersion: "web-runtime-v1",
      artifactStorageId: webMine,
      artifactByteLength: 18,
      createdBy: String(tenantA),
      createdAt: Date.now(),
      sourceRefs: [],
      recipeRef: {
        name: "web-recipe-business-site",
        version: 1,
        skillId: "skill-export-fixture",
        bodyHash: "sha256:body",
        definitionHash: "sha256:definition",
        inputHash: "sha256:input",
        designProfile: {
          bundleHash: "bundle",
          compilerHash: "compiler",
          patternId: "pattern",
          styleId: "style",
          paletteId: "palette",
          typographyId: "typography",
          formProfileId: "form",
          dials: { variance: 1, motion: 1, density: 1 },
        },
      },
    });
    await ctx.db.insert("webProjectVersions", {
      tenantId: tenantB,
      projectId: webProjectB,
      version: 1,
      document: { kind: "landing", title: "Files B" },
      contentHash: "sha256:web-b",
      rendererVersion: "web-runtime-v1",
      artifactStorageId: webTheirs,
      artifactByteLength: 20,
      createdBy: String(tenantB),
      createdAt: Date.now(),
      sourceRefs: [],
    });
    return { tenantA, mine, theirs, webMine, webTheirs };
  });

  const files: { storageId: string; url: string | null }[] = [];
  const pages: TenantDataExportPage[] = [];
  let cursor: TenantExportCursor | undefined;
  do {
    const page = await t
      .withIdentity({ subject: `${seeded.tenantA}|export-session` })
      .query(exportTenantData, cursor ? { cursor } : {});
    pages.push(page);
    files.push(...page.files);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  // MUTATION: delete the `files` loop from the handler → empty, red.
  const mine = files.filter((f) => f.storageId === String(seeded.mine));
  expect(mine, "the tenant's own file is missing from their export").toHaveLength(1);
  expect(mine[0]?.url, "the file is listed but has no download link").toBeTruthy();
  // TENANT ISOLATION, on the same assertion: another tenant's blob must never appear.
  expect(files.map((f) => f.storageId)).not.toContain(String(seeded.theirs));
  expect(files.map((f) => f.storageId)).toContain(String(seeded.webMine));
  expect(files.map((f) => f.storageId)).not.toContain(String(seeded.webTheirs));
  const exportedVersion = pages.find((page) => page.table.name === "webProjectVersions")?.table
    .rows[0] as Record<string, unknown> | undefined;
  expect(exportedVersion?.recipeRef).toMatchObject({
    name: "web-recipe-business-site",
    skillId: "skill-export-fixture",
  });
});
