import {
  AUDIT_ARCHIVE_STATEMENT,
  TENANT_EXPORT_SCHEMA_VERSION,
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
